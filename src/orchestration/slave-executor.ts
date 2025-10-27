import * as vscode from 'vscode';
import {
  AgentType,
  SlaveTask,
  SlaveExecutionOptions,
  ToolResult,
} from '../types';

/**
 * Slave Executor
 * Manages execution of slave CLI agents (Codex, Gemini) using Terminal Shell Integration
 */
export class SlaveExecutor {
  private terminals = new Map<AgentType, vscode.Terminal>();
  private activeTasks = new Map<string, SlaveTask>();
  private taskCounter = 0;

  /**
   * Execute a task on a slave agent
   */
  async execute(options: SlaveExecutionOptions): Promise<ToolResult> {
    const taskId = this.generateTaskId();

    const task: SlaveTask = {
      id: taskId,
      agent: options.agent,
      instruction: options.instruction,
      context: options.context,
      status: 'running',
      startTime: Date.now(),
    };

    this.activeTasks.set(taskId, task);

    try {
      const result = await this.executeAgent(options, task);
      task.status = 'completed';
      task.result = result;
      task.endTime = Date.now();

      return result;
    } catch (error) {
      task.status = 'error';
      task.error = String(error);
      task.endTime = Date.now();

      return {
        success: false,
        agent: options.agent,
        task_id: taskId,
        error: String(error),
      };
    }
  }

  /**
   * Execute specific agent CLI
   */
  private async executeAgent(
    options: SlaveExecutionOptions,
    task: SlaveTask
  ): Promise<ToolResult> {
    switch (options.agent) {
      case 'codex':
        return await this.executeCodex(options, task);
      case 'gemini':
        return await this.executeGemini(options, task);
      case 'claude':
        return await this.executeClaude(options, task);
      default:
        throw new Error(`Unknown agent: ${options.agent}`);
    }
  }

  /**
   * Execute Codex CLI
   */
  private async executeCodex(
    options: SlaveExecutionOptions,
    task: SlaveTask
  ): Promise<ToolResult> {
    const terminal = await this.getOrCreateTerminal('codex', options.projectPath);

    // Build instruction with context
    const fullInstruction = options.context
      ? `${options.instruction}\n\nContext: ${options.context}`
      : options.instruction;

    // Execute Codex CLI
    const commandLine = `codex exec --json "${this.escapeString(fullInstruction)}"`;

    const execution = await terminal.shellIntegration!.executeCommand(commandLine);

    // Collect output
    let output = '';
    const stream = execution.read();

    for await (const data of stream) {
      output += data;
    }

    // Wait for completion
    const exitCode = await new Promise<number>((resolve) => {
      const disposable = vscode.window.onDidEndTerminalShellExecution((e) => {
        if (e.execution === execution) {
          disposable.dispose();
          resolve(e.exitCode || 0);
        }
      });
    });

    if (exitCode === 0) {
      try {
        // Parse Codex JSON output
        const result = JSON.parse(output);

        return {
          success: true,
          agent: 'codex',
          task_id: task.id,
          output: result.output || output,
          files_modified: result.files_modified || [],
          execution_time: (Date.now() - task.startTime) / 1000,
        };
      } catch (e) {
        // Output is not JSON, return raw
        return {
          success: true,
          agent: 'codex',
          task_id: task.id,
          output: output,
          execution_time: (Date.now() - task.startTime) / 1000,
        };
      }
    } else {
      throw new Error(`Codex CLI exited with code ${exitCode}: ${output}`);
    }
  }

  /**
   * Execute Gemini CLI
   */
  private async executeGemini(
    options: SlaveExecutionOptions,
    task: SlaveTask
  ): Promise<ToolResult> {
    const terminal = await this.getOrCreateTerminal('gemini', options.projectPath);

    const fullInstruction = options.context
      ? `${options.instruction}\n\nContext: ${options.context}`
      : options.instruction;

    // Execute Gemini CLI (adjust command based on actual Gemini CLI)
    const commandLine = `gemini chat --stream "${this.escapeString(fullInstruction)}"`;

    const execution = await terminal.shellIntegration!.executeCommand(commandLine);

    let output = '';
    const stream = execution.read();

    for await (const data of stream) {
      output += data;
    }

    // Wait for completion
    const exitCode = await new Promise<number>((resolve) => {
      const disposable = vscode.window.onDidEndTerminalShellExecution((e) => {
        if (e.execution === execution) {
          disposable.dispose();
          resolve(e.exitCode || 0);
        }
      });
    });

    if (exitCode === 0) {
      return {
        success: true,
        agent: 'gemini',
        task_id: task.id,
        output: output,
        execution_time: (Date.now() - task.startTime) / 1000,
      };
    } else {
      throw new Error(`Gemini CLI exited with code ${exitCode}: ${output}`);
    }
  }

  /**
   * Execute Claude CLI (as slave)
   */
  private async executeClaude(
    options: SlaveExecutionOptions,
    task: SlaveTask
  ): Promise<ToolResult> {
    const terminal = await this.getOrCreateTerminal('claude', options.projectPath);

    const fullInstruction = options.context
      ? `${options.instruction}\n\nContext: ${options.context}`
      : options.instruction;

    const commandLine = `claude code --stream-json "${this.escapeString(fullInstruction)}"`;

    const execution = await terminal.shellIntegration!.executeCommand(commandLine);

    let output = '';
    const stream = execution.read();

    for await (const data of stream) {
      output += data;
    }

    // Wait for completion
    const exitCode = await new Promise<number>((resolve) => {
      const disposable = vscode.window.onDidEndTerminalShellExecution((e) => {
        if (e.execution === execution) {
          disposable.dispose();
          resolve(e.exitCode || 0);
        }
      });
    });

    if (exitCode === 0) {
      return {
        success: true,
        agent: 'claude',
        task_id: task.id,
        output: output,
        execution_time: (Date.now() - task.startTime) / 1000,
      };
    } else {
      throw new Error(`Claude CLI exited with code ${exitCode}: ${output}`);
    }
  }

  /**
   * Get or create terminal for an agent
   */
  private async getOrCreateTerminal(
    agent: AgentType,
    projectPath: string
  ): Promise<vscode.Terminal> {
    let terminal = this.terminals.get(agent);

    if (!terminal || terminal.exitStatus) {
      const terminalVisible = vscode.workspace
        .getConfiguration('orka')
        .get('terminal.visible', true);

      terminal = vscode.window.createTerminal({
        name: `Orka Slave (${agent})`,
        cwd: projectPath,
        hideFromUser: !terminalVisible,
      } as vscode.TerminalOptions);

      this.terminals.set(agent, terminal);

      // Wait for shell integration
      await this.waitForShellIntegration(terminal);
    }

    return terminal;
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
      const disposable = vscode.window.onDidChangeTerminalShellIntegration((e) => {
        if (e.terminal === terminal) {
          disposable.dispose();
          resolve();
        }
      });

      setTimeout(() => {
        disposable.dispose();
        reject(new Error('Shell integration timeout'));
      }, 10000);
    });
  }

  /**
   * Get status of a task
   */
  getTaskStatus(taskId: string): SlaveTask | undefined {
    return this.activeTasks.get(taskId);
  }

  /**
   * Get all active tasks
   */
  getAllTasks(): SlaveTask[] {
    return Array.from(this.activeTasks.values());
  }

  /**
   * Get tasks by status
   */
  getTasksByStatus(
    status: SlaveTask['status']
  ): SlaveTask[] {
    return Array.from(this.activeTasks.values()).filter(
      (task) => task.status === status
    );
  }

  /**
   * Generate unique task ID
   */
  private generateTaskId(): string {
    return `task_${++this.taskCounter}_${Date.now()}`;
  }

  /**
   * Escape string for shell command
   */
  private escapeString(str: string): string {
    return str.replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }

  /**
   * Show terminal for an agent
   */
  showTerminal(agent: AgentType): void {
    this.terminals.get(agent)?.show();
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    // Don't dispose terminals, let user keep them open
  }
}
