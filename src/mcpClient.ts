import { spawn, ChildProcess } from 'child_process';
import * as vscode from 'vscode';
import * as readline from 'readline';

interface McpRequest {
    jsonrpc: '2.0';
    id: number;
    method: string;
    params?: Record<string, unknown>;
}

interface McpResponse {
    jsonrpc: '2.0';
    id: number;
    result?: unknown;
    error?: {
        code: number;
        message: string;
        data?: unknown;
    };
}

/**
 * Client for communicating with the canvas-mcp MCP server.
 * Spawns the server as a subprocess and communicates via JSON-RPC over stdin/stdout.
 */
export class CanvasMcpClient {
    private process: ChildProcess | null = null;
    private requestId = 0;
    private pendingRequests = new Map<number, {
        resolve: (value: unknown) => void;
        reject: (reason: Error) => void;
    }>();
    private initialized = false;
    private initPromise: Promise<void> | null = null;

    constructor() {
        this.initPromise = this.initialize();
    }

    private async initialize(): Promise<void> {
        const config = vscode.workspace.getConfiguration('canvas-author');
        const pythonPath = config.get<string>('pythonPath') || 'python3';

        return new Promise((resolve, reject) => {
            // Spawn the MCP server
            this.process = spawn(pythonPath, ['-m', 'canvas_mcp.server'], {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: {
                    ...process.env,
                    // Pass through Canvas credentials from VS Code settings or env
                    CANVAS_DOMAIN: config.get<string>('canvasDomain') || process.env.CANVAS_DOMAIN || '',
                    CANVAS_API_TOKEN: process.env.CANVAS_API_TOKEN || ''
                }
            });

            if (!this.process.stdout || !this.process.stdin) {
                reject(new Error('Failed to create MCP server process'));
                return;
            }

            // Read responses line by line
            const rl = readline.createInterface({
                input: this.process.stdout,
                crlfDelay: Infinity
            });

            rl.on('line', (line) => {
                try {
                    const response = JSON.parse(line) as McpResponse;
                    this.handleResponse(response);
                } catch (e) {
                    console.error('Failed to parse MCP response:', line);
                }
            });

            this.process.stderr?.on('data', (data) => {
                console.error('MCP server stderr:', data.toString());
            });

            this.process.on('error', (error) => {
                console.error('MCP server error:', error);
                reject(error);
            });

            this.process.on('exit', (code) => {
                console.log('MCP server exited with code:', code);
                this.initialized = false;
            });

            // Send initialize request
            this.sendRequest('initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: {
                    name: 'canvas-author-code',
                    version: '0.1.0'
                }
            }).then(() => {
                // Send initialized notification
                this.sendNotification('notifications/initialized', {});
                this.initialized = true;
                resolve();
            }).catch(reject);
        });
    }

    private handleResponse(response: McpResponse): void {
        const pending = this.pendingRequests.get(response.id);
        if (!pending) {
            console.warn('Received response for unknown request:', response.id);
            return;
        }

        this.pendingRequests.delete(response.id);

        if (response.error) {
            pending.reject(new Error(response.error.message));
        } else {
            pending.resolve(response.result);
        }
    }

    private sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
        return new Promise((resolve, reject) => {
            if (!this.process?.stdin) {
                reject(new Error('MCP server not running'));
                return;
            }

            const id = ++this.requestId;
            const request: McpRequest = {
                jsonrpc: '2.0',
                id,
                method,
                params
            };

            this.pendingRequests.set(id, { resolve, reject });

            try {
                this.process.stdin.write(JSON.stringify(request) + '\n');
            } catch (error) {
                this.pendingRequests.delete(id);
                reject(error);
            }
        });
    }

    private sendNotification(method: string, params?: Record<string, unknown>): void {
        if (!this.process?.stdin) {
            return;
        }

        const notification = {
            jsonrpc: '2.0',
            method,
            params
        };

        try {
            this.process.stdin.write(JSON.stringify(notification) + '\n');
        } catch (error) {
            console.error('Failed to send notification:', error);
        }
    }

    /**
     * Call an MCP tool by name with the given arguments.
     */
    async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        // Wait for initialization
        if (this.initPromise) {
            await this.initPromise;
        }

        if (!this.initialized) {
            throw new Error('MCP client not initialized');
        }

        const result = await this.sendRequest('tools/call', {
            name,
            arguments: args
        });

        return result;
    }

    /**
     * List available tools from the MCP server.
     */
    async listTools(): Promise<unknown> {
        if (this.initPromise) {
            await this.initPromise;
        }

        return this.sendRequest('tools/list', {});
    }

    /**
     * Dispose of the MCP client and kill the server process.
     */
    dispose(): void {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
        this.initialized = false;
        this.pendingRequests.clear();
    }
}
