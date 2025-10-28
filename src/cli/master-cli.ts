import * as vscode from 'vscode';
import { MasterExecutionOptions, ToolCall, ToolResult } from '../types';
import { stripTerminalNoise } from '../util/terminal';

/**
 * Master CLI Manager
 * Executes the master planning CLI (default: Claude Code) using Terminal Shell Integration
 */
export class MasterCLI {
  private terminal: vscode.Terminal | undefined;
  private currentExecution: vscode.TerminalShellExecution | undefined;
  private pendingToolCalls = new Map<string, (result: ToolResult) => void>();
  private stdinWrite: ((data: string) => void) | undefined;

  constructor(private cliCommand: string = 'claude') {}

  /**
   * Execute a command using the master CLI
   */
  async execute(options: MasterExecutionOptions): Promise<void> {
    console.log('[MasterCLI] Starting execute...');
    await this.executeViaTerminal(options);
  }

  private async executeViaTerminal(options: MasterExecutionOptions): Promise<void> {
    // Create or reuse terminal
    if (!this.terminal || this.terminal.exitStatus) {
      const terminalVisible = vscode.workspace
        .getConfiguration('orka')
        .get('terminal.visible', true);

      console.log('[MasterCLI] Creating terminal, visible:', terminalVisible);

      this.terminal = vscode.window.createTerminal({
        name: `Orka Master (${this.cliCommand})`,
        cwd: options.projectPath,
        hideFromUser: !terminalVisible,
      } as vscode.TerminalOptions);

      console.log('[MasterCLI] Terminal created:', this.terminal.name);
    }

    // Log current working directory from shell integration
    if (this.terminal.shellIntegration?.cwd) {
      console.log('[MasterCLI] Terminal CWD:', this.terminal.shellIntegration.cwd.fsPath);
    }

    // Wait for shell integration to be ready
    console.log('[MasterCLI] Waiting for shell integration...');
    await this.waitForShellIntegration(this.terminal);
    console.log('[MasterCLI] Shell integration ready!');

    // Build command arguments for interactive session
    const args = this.buildCommandArgs(options);
    const commandLine = `${this.cliCommand} ${args.join(' ')}`;
    console.log('[MasterCLI] Terminal command:', commandLine);

    // Execute command to start interactive Claude session
    this.currentExecution = await this.terminal.shellIntegration!.executeCommand(commandLine);

    // Give Claude a moment to initialize
    await new Promise(resolve => setTimeout(resolve, 500));

    // Send the user's command via stdin
    console.log('[MasterCLI] Sending command via stdin:', options.command);
    this.terminal.sendText(options.command);

    // Provide stdin writer for tools
    this.stdinWrite = (data: string) => this.terminal?.sendText(data);

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
   *
   * Based on orka_ui pattern: uses --print, --output-format stream-json, --verbose
   * and --resume for session continuity
   */
  private buildCommandArgs(options: MasterExecutionOptions): string[] {
    const cfg = vscode.workspace.getConfiguration('orka');
    const maxTurns = cfg.get<number>('master.maxTurns', 0);
    const model = cfg.get<string>('master.model', '');

    const args: string[] = [];

    if (this.cliCommand === 'claude') {
      // Resume if we have a session
      if (options.sessionId) {
        args.push('--resume', this.escapeShellArg(options.sessionId));
        console.log('[MasterCLI] Resuming session:', options.sessionId);
      }

      // Basic flags for interactive mode with JSON streaming
      args.push('--output-format', 'stream-json');
      args.push('--verbose');

      // Model for new sessions only
      if (!options.sessionId && model) {
        args.push('--model', this.escapeShellArg(model));
      }

      // Max turns
      if (typeof maxTurns === 'number' && maxTurns > 0) {
        args.push('--max-turns', String(maxTurns));
      }

      // NO --print flag - we'll use interactive mode and send command via stdin
    }

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
    const nonJsonTail: string[] = [];
    const pushTail = (line: string) => {
      if (!line || /Shell cwd was reset/.test(line)) return;
      nonJsonTail.push(line);
      if (nonJsonTail.length > 40) nonJsonTail.shift();
    };

    for await (const raw of stream) {
      const data = stripTerminalNoise(raw);
      console.log('[MasterCLI] raw chunk:', JSON.stringify(raw));
      console.log('[MasterCLI] cleaned chunk:', JSON.stringify(data));
      buffer += data;
      const parts = buffer.split('\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        const line = part.trim();
        if (!line) continue;

        try {
          const json = JSON.parse(line);
          await this.handleStreamMessage(json, options);
        } catch {
          // Swallow non-JSON noise; log for diagnostics only
          console.log('[MasterCLI] non-JSON output:', line.slice(0, 200));
          pushTail(line);
        }
      }
    }

    // Flush any trailing partial line
    const tail = buffer.trim();
    if (tail) {
      try {
        const json = JSON.parse(tail);
        await this.handleStreamMessage(json, options);
      } catch {
        console.log('[MasterCLI] trailing non-JSON:', tail.slice(0, 200));
      }
    }

    // Exit the interactive session after this turn
    console.log('[MasterCLI] Sending exit command to close session');
    this.terminal?.sendText('exit');

    // Wait for completion
    await new Promise<void>((resolve) => {
      const disposable = vscode.window.onDidEndTerminalShellExecution((e) => {
        if (e.execution === execution) {
          disposable.dispose();
          if (e.exitCode !== 0) {
            options.onOutput(`\n\n❌ Master CLI exited with code ${e.exitCode}`);
            if (nonJsonTail.length) {
              options.onOutput(`\n\nLast output:\n\n\`\`\`\n${nonJsonTail.join('\n').slice(-1200)}\n\`\`\`\n`);
            }
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
    // Debug: log all messages
    console.log('[MasterCLI] Stream message:', JSON.stringify(message).substring(0, 200));

    switch (message.type) {
      case 'stream_event':
        // IGNORE wrapped events - they duplicate content_block_delta
        // Just capture session ID if present
        if (message.session_id && options.onSession) {
          options.onSession(message.session_id);
        }
        // Do NOT output text here - will be handled by content_block_delta
        break;

      case 'assistant':
        // Claude Code CLI format: assistant message with content
        // SKIP text output here - text will come from 'result' message to avoid duplicates
        // Only capture session ID
        if (message.session_id && options.onSession) {
          options.onSession(message.session_id);
        }
        break;

      case 'result':
        // Claude Code CLI format: final result summary (contains full response text)
        // This is the PRIMARY source of text output (matches orka_ui pattern)
        options.onOutput(this.flattenContent(message.result));

        // Capture session ID
        if (message.session_id && options.onSession) {
          options.onSession(message.session_id);
        }
        break;

      case 'content_block_delta':
        // Standard Anthropic streaming API format
        // Real-time text chunks come here
        if (message.delta?.type === 'text_delta' && message.delta?.text) {
          options.onOutput(message.delta.text);
        } else if (message.delta?.partial_json) {
          console.log('[MasterCLI] Tool input:', message.delta.partial_json);
        } else if (message.delta?.thinking) {
          console.log('[MasterCLI] Thinking:', message.delta.thinking);
        }
        break;

      case 'content_block_start':
      case 'content_block_stop':
      case 'message_start':
      case 'message_stop':
        // Standard API events, no action needed
        break;

      case 'message_delta':
        // Some CLI builds emit text via message_delta
        if (message.delta?.type === 'text_delta' && typeof message.delta?.text === 'string') {
          options.onOutput(message.delta.text);
        }
        break;

      case 'tool_use':
        await this.handleToolUse(message, options);
        break;

      case 'system':
        // System messages (init, etc.)
        console.log('[MasterCLI] System message:', message.subtype);
        if (message.session_id) {
          console.log('[MasterCLI] ✅ Session ID captured from system message:', message.session_id);
          if (options.onSession) {
            options.onSession(message.session_id);
            console.log('[MasterCLI] ✅ onSession callback called');
          } else {
            console.log('[MasterCLI] ⚠️ onSession callback is undefined!');
          }
        } else {
          console.log('[MasterCLI] ⚠️ No session_id in system message');
        }
        break;

      case 'error':
        options.onOutput(`\n\n❌ Error: ${message.message || message.error}`);
        break;

      case 'message':
        if (message.message?.content) {
          options.onOutput(this.flattenContent(message.message.content));
        }
        if (message.session_id && options.onSession) {
          options.onSession(message.session_id);
        }
        break;

      default:
        // Unknown message type, log but don't show
        console.log('[MasterCLI] Unknown message type:', message.type, message);
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
    this.stdinWrite?.(resultMessage);
  }

  /**
   * Wait for shell integration to be ready
   */
  private async waitForShellIntegration(
    terminal: vscode.Terminal
  ): Promise<void> {
    console.log('[MasterCLI] Checking shell integration...');

    if (terminal.shellIntegration) {
      console.log('[MasterCLI] Shell integration already available!');
      return;
    }

    console.log('[MasterCLI] Shell integration not ready, waiting for event...');

    return new Promise((resolve, reject) => {
      const disposable = vscode.window.onDidChangeTerminalShellIntegration(
        (e) => {
          console.log('[MasterCLI] Shell integration event received');
          if (e.terminal === terminal) {
            console.log('[MasterCLI] Shell integration ready for our terminal!');
            clearTimeout(timeoutHandle);
            disposable.dispose();
            resolve();
          }
        }
      );

      // Timeout after 10 seconds
      const timeoutHandle = setTimeout(() => {
        console.log('[MasterCLI] Shell integration TIMEOUT!');
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

  private flattenContent(content: any): string {
    if (!content) return '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map((entry) => this.flattenContent(entry)).join('\n\n');
    }
    if (typeof content === 'object' && typeof content.text === 'string') {
      return content.text;
    }
    return JSON.stringify(content);
  }
}
