import * as vscode from 'vscode';
import { WebSocketServer, WebSocket } from 'ws';
import { MasterCLI } from '../cli/master-cli';
import { SlaveExecutor } from '../orchestration/slave-executor';
import { handleMasterToolCall } from '../orchestration/tool-handler';
import { TelegramMessage, WebSocketMessage } from '../types';

/**
 * Telegram Bridge
 * Provides WebSocket server for Telegram bot integration
 */
export class TelegramBridge {
  private wss: WebSocketServer | undefined;
  private connections = new Set<WebSocket>();
  private masterCLI: MasterCLI;
  private slaveExecutor: SlaveExecutor;

  constructor(masterCLI: MasterCLI, slaveExecutor: SlaveExecutor) {
    this.masterCLI = masterCLI;
    this.slaveExecutor = slaveExecutor;
  }

  /**
   * Start the WebSocket server
   */
  start(port: number): void {
    if (this.wss) {
      console.log('Telegram bridge already running');
      return;
    }

    this.wss = new WebSocketServer({ port });

    this.wss.on('connection', (ws) => {
      console.log('Telegram bot connected');
      this.connections.add(ws);

      ws.on('message', async (data) => {
        try {
          const message: TelegramMessage = JSON.parse(data.toString());
          await this.handleTelegramMessage(message, ws);
        } catch (error) {
          console.error('Error handling Telegram message:', error);
          ws.send(
            JSON.stringify({
              type: 'error',
              error: String(error),
            })
          );
        }
      });

      ws.on('close', () => {
        console.log('Telegram bot disconnected');
        this.connections.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });
    });

    this.wss.on('error', (error) => {
      console.error('WebSocket server error:', error);
    });

    console.log(`Telegram bridge listening on port ${port}`);
  }

  /**
   * Handle incoming Telegram message
   */
  private async handleTelegramMessage(
    message: TelegramMessage,
    ws: WebSocket
  ): Promise<void> {
    if (message.type !== 'telegram-message') {
      return;
    }

    const projectPath =
      message.projectPath ||
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
      process.cwd();

    let response = '';

    try {
      await this.masterCLI.execute({
        projectPath,
        sessionId: message.sessionId,
        command: message.content,
        onOutput: (data) => {
          response += data;

          // Stream chunk to Telegram
          this.sendToTelegram(ws, {
            type: 'chunk',
            session_id: message.sessionId,
            data,
          });
        },
        onToolCall: async (tool) => {
          // Notify Telegram about tool execution
          this.sendToTelegram(ws, {
            type: 'progress',
            session_id: message.sessionId,
            status: `Executing ${tool.name}...`,
          });

          return await handleMasterToolCall(
            tool,
            this.slaveExecutor,
            this.createMockStream(ws, message.sessionId)
          );
        },
        onProgress: (status) => {
          this.sendToTelegram(ws, {
            type: 'progress',
            session_id: message.sessionId,
            status,
          });
        },
      });

      // Send completion
      this.sendToTelegram(ws, {
        type: 'complete',
        session_id: message.sessionId,
        data: response,
      });
    } catch (error) {
      this.sendToTelegram(ws, {
        type: 'error',
        session_id: message.sessionId,
        error: String(error),
      });
    }
  }

  /**
   * Send message to Telegram
   */
  private sendToTelegram(ws: WebSocket, message: WebSocketMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcast to all connected Telegram clients
   */
  private broadcast(message: WebSocketMessage): void {
    const payload = JSON.stringify(message);
    this.connections.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    });
  }

  /**
   * Create a mock stream for tool handlers
   */
  private createMockStream(
    ws: WebSocket,
    sessionId?: string
  ): vscode.ChatResponseStream {
    return {
      markdown: (value: string) => {
        this.sendToTelegram(ws, {
          type: 'chunk',
          session_id: sessionId,
          data: value,
        });
      },
      progress: (value: string) => {
        this.sendToTelegram(ws, {
          type: 'progress',
          session_id: sessionId,
          status: value,
        });
      },
    } as any;
  }

  /**
   * Stop the WebSocket server
   */
  stop(): void {
    if (this.wss) {
      this.connections.forEach((ws) => ws.close());
      this.connections.clear();
      this.wss.close();
      this.wss = undefined;
      console.log('Telegram bridge stopped');
    }
  }

  /**
   * Check if bridge is running
   */
  isRunning(): boolean {
    return this.wss !== undefined;
  }
}
