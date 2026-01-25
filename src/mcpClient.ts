import * as vscode from 'vscode'
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
  private sessionId: string | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  private outputChannel: vscode.OutputChannel

  constructor(apiToken?: string) {
    const config = vscode.workspace.getConfiguration('canvas-author')
    const host = config.get<string>('mcpServerHost') || '127.0.0.1'
    const port = config.get<number>('mcpServerPort') || 8000
    this.serverUrl = `http://${host}:${port}/mcp`

    this.outputChannel = vscode.window.createOutputChannel('Canvas Author MCP')
    this.initPromise = this.initialize()
  }

  private log(message: string): void {
    this.outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`)
    console.log(`Canvas MCP: ${message}`)
  }

  private async initialize(): Promise<void> {
    this.log(`Connecting to MCP server at ${this.serverUrl}`)

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
   * Dispose of the MCP client.
   */
  dispose(): void {
    this.initialized = false
    this.sessionId = null
  }
}
