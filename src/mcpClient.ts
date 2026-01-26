import * as vscode from 'vscode'
import * as child_process from 'child_process'
import fetch from 'node-fetch'

interface McpRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: Record<string, unknown>
}

interface McpResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

/**
 * Client for communicating with the canvas-author MCP server.
 * Connects to a shared HTTP server instead of spawning subprocesses.
 */
export class CanvasMcpClient {
  private requestId = 0;
  private serverUrl: string;
  private serverHost: string;
  private serverPort: number;
  private sessionId: string | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private serverProcess: child_process.ChildProcess | null = null;
  private static instance: CanvasMcpClient | null = null;

  private outputChannel: vscode.OutputChannel

  constructor(apiToken?: string) {
    const config = vscode.workspace.getConfiguration('canvas-author')
    this.serverHost = config.get<string>('mcpServerHost') || '127.0.0.1'
    this.serverPort = config.get<number>('mcpServerPort') || 8000
    this.serverUrl = `http://${this.serverHost}:${this.serverPort}/mcp`

    this.outputChannel = vscode.window.createOutputChannel('Canvas Author MCP')
    this.initPromise = this.initialize()

    CanvasMcpClient.instance = this
  }

  /**
   * Get the singleton instance of the MCP client.
   */
  static getInstance(): CanvasMcpClient | null {
    return CanvasMcpClient.instance
  }

  private log(message: string): void {
    this.outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`)
    console.log(`Canvas MCP: ${message}`)
  }

  private async initialize(): Promise<void> {
    this.log(`Connecting to MCP server at ${this.serverUrl}`)

    // First check if server is already running
    const serverRunning = await this.checkServerHealth()

    if (!serverRunning) {
      this.log('MCP server not running, attempting to start...')
      const started = await this.startServer()
      if (!started) {
        throw new Error('Failed to start MCP server')
      }
    }

    try {
      // Send initialize request to create a session
      const result = await this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'canvas-author-code',
          version: '0.1.0'
        }
      })

      this.initialized = true
      this.log('MCP client initialized successfully')
    } catch (error) {
      this.log(`MCP initialization failed: ${error}`)
      throw error
    }
  }

  /**
   * Check if the MCP server is running and healthy.
   */
  private async checkServerHealth(): Promise<boolean> {
    try {
      const response = await fetch(`http://${this.serverHost}:${this.serverPort}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000)
      })
      return response.ok
    } catch (error) {
      // Server not running or not responding
      return false
    }
  }

  /**
   * Start the MCP server as a subprocess.
   */
  private async startServer(): Promise<boolean> {
    const config = vscode.workspace.getConfiguration('canvas-author')
    const pythonPath = config.get<string>('pythonPath') || 'python3'

    // Find canvas-author and canvas-common paths
    const homeDir = process.env.HOME || process.env.USERPROFILE || ''
    const canvasAuthorPath = `${homeDir}/canvas-author`
    const canvasCommonPath = `${homeDir}/canvas-common`

    // Set up environment with PYTHONPATH and server config
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PYTHONPATH: `${canvasAuthorPath}:${canvasCommonPath}:${process.env.PYTHONPATH || ''}`,
      FASTMCP_HOST: this.serverHost,
      FASTMCP_PORT: String(this.serverPort)
    }

    this.log(`Starting MCP server with Python: ${pythonPath}`)
    this.log(`PYTHONPATH: ${env.PYTHONPATH}`)
    this.log(`Server will listen on ${this.serverHost}:${this.serverPort}`)

    try {
      // Start the server process
      this.serverProcess = child_process.spawn(
        pythonPath,
        ['-m', 'canvas_author.server', '--http'],
        {
          env,
          cwd: canvasAuthorPath,
          detached: false,
          stdio: ['ignore', 'pipe', 'pipe']
        }
      )

      // Log server output
      this.serverProcess.stdout?.on('data', (data: Buffer) => {
        this.log(`[server] ${data.toString().trim()}`)
      })

      this.serverProcess.stderr?.on('data', (data: Buffer) => {
        this.log(`[server:err] ${data.toString().trim()}`)
      })

      this.serverProcess.on('error', (err) => {
        this.log(`Server process error: ${err.message}`)
      })

      this.serverProcess.on('exit', (code, signal) => {
        this.log(`Server process exited with code ${code}, signal ${signal}`)
        this.serverProcess = null
      })

      // Wait for server to be ready
      const ready = await this.waitForServerReady(10000)
      if (ready) {
        this.log('MCP server started successfully')
        vscode.window.showInformationMessage('Canvas Author MCP server started')
      } else {
        this.log('MCP server failed to start in time')
        this.stopServer()
        return false
      }

      return ready
    } catch (error) {
      this.log(`Failed to start server: ${error}`)
      return false
    }
  }

  /**
   * Wait for the server to become ready.
   */
  private async waitForServerReady(timeoutMs: number): Promise<boolean> {
    const startTime = Date.now()
    const pollInterval = 500

    while (Date.now() - startTime < timeoutMs) {
      if (await this.checkServerHealth()) {
        return true
      }
      await new Promise(resolve => setTimeout(resolve, pollInterval))
    }

    return false
  }

  /**
   * Stop the MCP server if we started it.
   */
  stopServer(): void {
    if (this.serverProcess) {
      this.log('Stopping MCP server')
      this.serverProcess.kill('SIGTERM')
      this.serverProcess = null
    }
  }

  private async sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = ++this.requestId
    const request: McpRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params
    }

    this.log(`Sending request: ${method}`)

    try {
      const response = await fetch(this.serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.sessionId ? { 'X-Session-Id': this.sessionId } : {})
        },
        body: JSON.stringify(request)
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      // Extract session ID from response headers if present
      const sessionIdHeader = response.headers.get('X-Session-Id')
      if (sessionIdHeader) {
        this.sessionId = sessionIdHeader
      }

      const mcpResponse = await response.json() as McpResponse

      if (mcpResponse.error) {
        throw new Error(mcpResponse.error.message)
      }

      return mcpResponse.result
    } catch (error) {
      this.log(`Request failed: ${error}`)
      throw error
    }
  }

  /**
   * Call an MCP tool by name with the given arguments.
   */
  async callTool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    // Wait for initialization
    if (this.initPromise) {
      await this.initPromise
    }

    if (!this.initialized) {
      throw new Error('MCP client not initialized')
    }

    const result = await this.sendRequest('tools/call', {
      name,
      arguments: args
    })

    // MCP returns results in a content array with text type
    // We need to unwrap and parse the JSON
    const mcpResult = result as { content?: Array<{ type: string; text: string }> }
    if (mcpResult?.content && Array.isArray(mcpResult.content)) {
      const textContent = mcpResult.content.find(c => c.type === 'text')
      if (textContent?.text) {
        try {
          return JSON.parse(textContent.text) as T
        } catch (e) {
          this.log(`Failed to parse tool result as JSON: ${e}`)
          // Return the text as-is if not valid JSON
          return textContent.text as unknown as T
        }
      }
    }

    return result as T
  }

  /**
   * List available tools from the MCP server.
   */
  async listTools(): Promise<unknown> {
    if (this.initPromise) {
      await this.initPromise
    }

    return this.sendRequest('tools/list', {})
  }

  /**
   * Dispose of the MCP client and stop the server if we started it.
   */
  dispose(): void {
    this.stopServer()
    this.initialized = false
    this.sessionId = null
    CanvasMcpClient.instance = null
  }
}
