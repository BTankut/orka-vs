import * as vscode from 'vscode';
import { MasterCLI } from '../cli/master-cli';
import { SlaveExecutor } from '../orchestration/slave-executor';
import { handleMasterToolCall } from '../orchestration/tool-handler';

/**
 * Register the master chat participant
 */
export function registerMasterParticipant(
  context: vscode.ExtensionContext
): vscode.Disposable {
  // Get master CLI from config
  const masterCLI = getMasterCLI();
  const slaveExecutor = new SlaveExecutor();

  const participant = vscode.chat.createChatParticipant(
    'orka.master',
    async (request, chatContext, stream, token) => {
      const projectPath =
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

      if (!projectPath) {
        stream.markdown('❌ No workspace folder is open. Please open a project folder.');
        return;
      }

      // Extract session ID from chat history
      const sessionId = extractSessionId(chatContext.history);

      // Handle slash commands
      if (request.command) {
        await handleSlashCommand(request.command, slaveExecutor, stream);
        return;
      }

      // Execute master CLI
      try {
        await masterCLI.execute({
          projectPath,
          sessionId,
          command: request.prompt,
          onOutput: (data) => {
            stream.markdown(data);
          },
          onToolCall: async (tool) => {
            return await handleMasterToolCall(tool, slaveExecutor, stream);
          },
          onProgress: (status) => {
            stream.progress(status);
          },
          token,
        });
      } catch (error) {
        stream.markdown(`\n\n❌ Error: ${String(error)}\n`);

        // Show helpful message if shell integration is not available
        if (String(error).includes('Shell integration')) {
          stream.markdown(
            '\n**Tip:** Shell integration is required. Ensure you are using a supported shell (bash, zsh, pwsh) and VS Code >= 1.93.\n'
          );
        }
      }
    }
  );

  // Set participant metadata
  participant.iconPath = vscode.Uri.joinPath(
    context.extensionUri,
    'resources',
    'icon.png'
  );

  // Register disposables
  context.subscriptions.push(participant);
  context.subscriptions.push(slaveExecutor);
  context.subscriptions.push(masterCLI);

  return participant;
}

/**
 * Get master CLI based on configuration
 */
function getMasterCLI(): MasterCLI {
  const masterAgent = vscode.workspace
    .getConfiguration('orka')
    .get<string>('master.cli', 'claude');

  return new MasterCLI(masterAgent);
}

/**
 * Extract session ID from chat history
 */
function extractSessionId(
  history: readonly (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[]
): string | undefined {
  // Look through history for session metadata
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i];
    if (turn instanceof vscode.ChatResponseTurn && turn.participant === 'orka.master') {
      const metadata = (turn as any).metadata;
      if (metadata?.sessionId) {
        return metadata.sessionId;
      }
    }
  }
  return undefined;
}

/**
 * Handle slash commands
 */
async function handleSlashCommand(
  command: string,
  slaveExecutor: SlaveExecutor,
  stream: vscode.ChatResponseStream
): Promise<void> {
  switch (command) {
    case 'status':
      await showSlaveStatus(slaveExecutor, stream);
      break;

    case 'abort':
      stream.markdown('⚠️ Use the stop button in the chat to abort execution.');
      break;

    default:
      stream.markdown(`❌ Unknown command: ${command}`);
  }
}

/**
 * Show slave task status
 */
async function showSlaveStatus(
  slaveExecutor: SlaveExecutor,
  stream: vscode.ChatResponseStream
): Promise<void> {
  const tasks = slaveExecutor.getAllTasks();

  if (tasks.length === 0) {
    stream.markdown('No slave tasks have been executed yet.');
    return;
  }

  stream.markdown('## Slave Task Status\n\n');

  const runningTasks = tasks.filter((t) => t.status === 'running');
  const completedTasks = tasks.filter((t) => t.status === 'completed');
  const errorTasks = tasks.filter((t) => t.status === 'error');

  if (runningTasks.length > 0) {
    stream.markdown('### 🔄 Running\n');
    runningTasks.forEach((task) => {
      stream.markdown(
        `- **${task.agent}**: ${task.instruction.substring(0, 60)}...\n`
      );
    });
    stream.markdown('\n');
  }

  if (completedTasks.length > 0) {
    stream.markdown('### ✅ Completed\n');
    completedTasks.forEach((task) => {
      const duration = task.endTime
        ? ((task.endTime - task.startTime) / 1000).toFixed(2)
        : 'N/A';
      stream.markdown(
        `- **${task.agent}** (${duration}s): ${task.instruction.substring(0, 60)}...\n`
      );
    });
    stream.markdown('\n');
  }

  if (errorTasks.length > 0) {
    stream.markdown('### ❌ Failed\n');
    errorTasks.forEach((task) => {
      stream.markdown(
        `- **${task.agent}**: ${task.instruction.substring(0, 60)}... (${task.error})\n`
      );
    });
    stream.markdown('\n');
  }
}
