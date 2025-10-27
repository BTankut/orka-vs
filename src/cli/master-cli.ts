import * as vscode from 'vscode';
import { MasterExecutionOptions, ToolCall, ToolResult } from '../types';

/**
 * Master CLI Manager
 * Executes the master planning CLI (default: Claude Code) using Terminal Shell Integration
 */
export class MasterCLI {
  private terminal: vscode.Terminal | undefined;
  private currentExecution: vscode.TerminalShellExecution | undefined;
  private pendingToolCalls = new Map<string, (result: ToolResult) => void>();

  constructor(private cliCommand: string = 'claude') {}

  /**
   * Execute a command using the master CLI
   */
  async execute(options: MasterExecutionOptions): Promise<void> {
    // Create or reuse terminal
    if (!this.terminal || this.terminal.exitStatus) {
      const terminalVisible = vscode.workspace
        .getConfiguration('orka')
        .get('terminal.visible', true);

      this.terminal = vscode.window.createTerminal({
        name: `Orka Master (${this.cliCommand})`,
        cwd: options.projectPath,
        hideFromUser: !terminalVisible,
      } as vscode.TerminalOptions);
    }

    // Wait for shell integration to be ready
    await this.waitForShellIntegration(this.terminal);

    // Build command arguments
    const args = this.buildCommandArgs(options);
    const commandLine = `${this.cliCommand} ${args.join(' ')}`;

    // Execute command
    this.currentExecution = await this.terminal.shellIntegration!.executeCommand(
      commandLine
    );

    // Handle cancellation
    if (options.token) {
      options.token.onCancellationRequested(() => {
        this.abort();
      });
    }

    // Stream output and handle tool calls
    await this.processExecutionStream(this.currentExecution, options);
  }

  /**
   * Build command arguments for master CLI
   */
  private buildCommandArgs(options: MasterExecutionOptions): string[] {
    const args: string[] = [];

    // Claude-specific arguments
    if (this.cliCommand === 'claude') {
      args.push('code', '--stream-json', '--project', options.projectPath);

      if (options.sessionId) {
        args.push('--session-id', options.sessionId);
      }

      // Define custom tools for slave orchestration
      args.push('--custom-tools', this.getCustomToolsJson());
    }

    // Add the user command
    args.push(this.escapeShellArg(options.command));

    return args;
  }

  /**
   * Get custom tools definition for master CLI
   */
  private getCustomToolsJson(): string {
    const tools = [
      {
        name: 'execute_slave_codex',
        description:
          'Execute a coding task using Codex CLI (slave agent). Use this for implementation, bug fixes, and code generation.',
        input_schema: {
          type: 'object',
          properties: {
            instruction: {
              type: 'string',
              description: 'Detailed instruction for the coding task',
            },
            context: {
              type: 'string',
              description: 'Additional context or constraints',
            },
          },
          required: ['instruction'],
        },
      },
      {
        name: 'execute_slave_gemini',
        description:
          'Execute a task using Gemini CLI (slave agent). Use this as an alternative to Codex for diverse approaches.',
        input_schema: {
          type: 'object',
          properties: {
            instruction: {
              type: 'string',
              description: 'Detailed instruction for the task',
            },
            context: {
              type: 'string',
              description: 'Additional context or constraints',
            },
          },
          required: ['instruction'],
        },
      },
      {
        name: 'get_slave_status',
        description: 'Check the status of a running slave task',
        input_schema: {
          type: 'object',
          properties: {
            task_id: {
              type: 'string',
              description: 'Task ID to check',
            },
          },
          required: ['task_id'],
        },
      },
    ];

    return JSON.stringify(tools);
  }

  /**
   * Process execution stream and handle tool calls
   */
  private async processExecutionStream(
    execution: vscode.TerminalShellExecution,
    options: MasterExecutionOptions
  ): Promise<void> {
    const stream = execution.read();
    let buffer = '';

    for await (const data of stream) {
      buffer += data;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const json = JSON.parse(line);
          await this.handleStreamMessage(json, options);
        } catch (e) {
          // Not JSON, raw output
          options.onOutput(data);
        }
      }
    }

    // Wait for completion
    await new Promise<void>((resolve) => {
      const disposable = vscode.window.onDidEndTerminalShellExecution((e) => {
        if (e.execution === execution) {
          disposable.dispose();
          if (e.exitCode !== 0) {
            options.onOutput(`\n\n❌ Master CLI exited with code ${e.exitCode}`);
          }
          resolve();
        }
      });
    });
  }

  /**
   * Handle individual stream messages from master CLI
   */
  private async handleStreamMessage(
    message: any,
    options: MasterExecutionOptions
  ): Promise<void> {
    switch (message.type) {
      case 'chunk':
        options.onOutput(message.data);
        break;

      case 'tool_use':
        await this.handleToolUse(message, options);
        break;

      case 'session_created':
        // Session ID can be extracted here if needed
        break;

      case 'result':
        options.onOutput('\n\n✅ Task completed');
        break;

      case 'error':
        options.onOutput(`\n\n❌ Error: ${message.message}`);
        break;

      default:
        // Unknown message type, just log
        console.log('Unknown message type:', message.type);
    }
  }

  /**
   * Handle tool use request from master CLI
   */
  private async handleToolUse(
    toolMessage: any,
    options: MasterExecutionOptions
  ): Promise<void> {
    const tool: ToolCall = {
      id: toolMessage.id,
      name: toolMessage.name,
      arguments: toolMessage.input,
    };

    options.onProgress(`🔧 Executing ${tool.name}...`);

    try {
      // Call the tool handler
      const result = await options.onToolCall(tool);

      // Send result back to master CLI via stdin
      await this.sendToolResult(tool.id, result);
    } catch (error) {
      // Send error result
      await this.sendToolResult(tool.id, {
        success: false,
        error: String(error),
      });
    }
  }

  /**
   * Send tool result back to master CLI
   */
  private async sendToolResult(
    toolCallId: string,
    result: ToolResult
  ): Promise<void> {
    const resultMessage = JSON.stringify({
      type: 'tool_result',
      tool_use_id: toolCallId,
      content: JSON.stringify(result),
    });

    // Send to terminal stdin
    this.terminal?.sendText(resultMessage);
  }

  /**
   * Wait for shell integration to be ready
   */
  private async waitForShellIntegration(
    terminal: vscode.Terminal
  ): Promise<void> {
    if (terminal.shellIntegration) {
      return;
    }

    return new Promise((resolve, reject) => {
      const disposable = vscode.window.onDidChangeTerminalShellIntegration(
        (e) => {
          if (e.terminal === terminal) {
            disposable.dispose();
            resolve();
          }
        }
      );

      // Timeout after 10 seconds
      setTimeout(() => {
        disposable.dispose();
        reject(
          new Error(
            'Shell integration not available. Please ensure your shell supports it.'
          )
        );
      }, 10000);
    });
  }

  /**
   * Abort current execution
   */
  abort(): void {
    if (this.terminal) {
      this.terminal.sendText('\x03'); // Ctrl+C
    }
  }

  /**
   * Show terminal
   */
  show(): void {
    this.terminal?.show();
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    // Don't dispose terminal, let user keep it open
  }

  /**
   * Escape shell argument for safe execution
   */
  private escapeShellArg(arg: string): string {
    // Simple escaping for common shells
    return `"${arg.replace(/"/g, '\\"')}"`;
  }
}
