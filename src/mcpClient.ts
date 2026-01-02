import { spawn, ChildProcess } from 'child_process'
import * as vscode from 'vscode'
import * as readline from 'readline'

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
 * Spawns the server as a subprocess and communicates via JSON-RPC over stdin/stdout.
 */
export class CanvasMcpClient {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void
    reject: (reason: Error) => void
  }>();
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private apiToken: string

  private outputChannel: vscode.OutputChannel

  constructor(apiToken?: string) {
    this.apiToken = apiToken || ''
    this.outputChannel = vscode.window.createOutputChannel('Canvas Author MCP')
    this.initPromise = this.initialize()
  }

  private log(message: string): void {
    this.outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`)
    console.log(`Canvas MCP: ${message}`)
  }

  private async initialize(): Promise<void> {
    const config = vscode.workspace.getConfiguration('canvas-author')
    const pythonPath = config.get<string>('pythonPath') || 'python3'
    const canvasDomain = config.get<string>('canvasDomain') || process.env.CANVAS_DOMAIN || ''
    const tokenToUse = this.apiToken || process.env.CANVAS_API_TOKEN || ''

    this.log(`Initializing MCP client...`)
    this.log(`Python path: ${pythonPath}`)
    this.log(`Canvas domain: ${canvasDomain}`)
    this.log(`API token provided: ${tokenToUse ? 'yes (' + tokenToUse.substring(0, 8) + '...)' : 'no'}`)

    return new Promise((resolve, reject) => {
      // Spawn the MCP server
      this.process = spawn(pythonPath, ['-m', 'canvas_author.server'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          // Pass through Canvas credentials from VS Code settings or env
          CANVAS_DOMAIN: canvasDomain,
          CANVAS_API_TOKEN: tokenToUse
        }
      })

      if (!this.process.stdout || !this.process.stdin) {
        this.log('ERROR: Failed to create MCP server process')
        reject(new Error('Failed to create MCP server process'))
        return
      }

      this.log('MCP server process spawned')

      // Read responses line by line
      const rl = readline.createInterface({
        input: this.process.stdout,
        crlfDelay: Infinity
      })

      rl.on('line', (line) => {
        this.log(`MCP response: ${line.substring(0, 200)}${line.length > 200 ? '...' : ''}`)
        try {
          const response = JSON.parse(line) as McpResponse
          this.handleResponse(response)
        } catch (e) {
          this.log(`Failed to parse MCP response: ${line}`)
        }
      })

      this.process.stderr?.on('data', (data) => {
        this.log(`MCP stderr: ${data.toString()}`)
      })

      this.process.on('error', (error) => {
        this.log(`MCP server error: ${error.message}`)
        reject(error)
      })

      this.process.on('exit', (code) => {
        this.log(`MCP server exited with code: ${code}`)
        this.initialized = false
      })

      // Send initialize request
      this.log('Sending initialize request...')
      this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'canvas-author-code',
          version: '0.1.0'
        }
      }).then(() => {
        // Send initialized notification
        this.sendNotification('notifications/initialized', {})
        this.initialized = true
        this.log('MCP client initialized successfully')
        resolve()
      }).catch((err) => {
        this.log(`MCP initialization failed: ${err.message}`)
        reject(err)
      })
    })
  }

  private handleResponse(response: McpResponse): void {
    const pending = this.pendingRequests.get(response.id)
    if (!pending) {
      console.warn('Received response for unknown request:', response.id)
      return
    }

    this.pendingRequests.delete(response.id)

    if (response.error) {
      pending.reject(new Error(response.error.message))
    } else {
      pending.resolve(response.result)
    }
  }

  private sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error('MCP server not running'))
        return
      }

      const id = ++this.requestId
      const request: McpRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params
      }

      this.pendingRequests.set(id, { resolve, reject })

      try {
        this.process.stdin.write(JSON.stringify(request) + '\n')
      } catch (error) {
        this.pendingRequests.delete(id)
        reject(error)
      }
    })
  }

  private sendNotification(method: string, params?: Record<string, unknown>): void {
    if (!this.process?.stdin) {
      return
    }

    const notification = {
      jsonrpc: '2.0',
      method,
      params
    }

    try {
      this.process.stdin.write(JSON.stringify(notification) + '\n')
    } catch (error) {
      console.error('Failed to send notification:', error)
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
   * Dispose of the MCP client and kill the server process.
   */
  dispose(): void {
    if (this.process) {
      this.process.kill()
      this.process = null
    }
    this.initialized = false
    this.pendingRequests.clear()
  }
}
