import * as vscode from 'vscode';
import { MasterCLI } from '../cli/master-cli';
import { SlaveExecutor } from '../orchestration/slave-executor';
import { handleMasterToolCall } from '../orchestration/tool-handler';
import { outputChannel } from '../extension';

/**
 * Register the master chat participant
 */
export function registerMasterParticipant(
  context: vscode.ExtensionContext
): vscode.Disposable {
  console.log('[registerMasterParticipant] Starting registration...');

  // Get master CLI from config
  const masterCLI = getMasterCLI();
  console.log('[registerMasterParticipant] Master CLI created');

  const slaveExecutor = new SlaveExecutor();
  console.log('[registerMasterParticipant] Slave executor created');

  console.log('[registerMasterParticipant] Creating chat participant with ID: orka.master');

  const handler: vscode.ChatRequestHandler = async (request, context, stream, token) => {
    outputChannel.appendLine('');
    outputChannel.appendLine('=== Chat Request Received ===');
    outputChannel.appendLine(`Prompt: ${request.prompt}`);
    console.log('[ChatParticipant] Request received:', request.prompt);

    const projectPath =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    outputChannel.appendLine(`Project path: ${projectPath || 'NONE'}`);
    console.log('[ChatParticipant] Project path:', projectPath);

    if (!projectPath) {
      outputChannel.appendLine('✗ No workspace folder open!');
      console.log('[ChatParticipant] No workspace folder!');
      stream.markdown('❌ No workspace folder is open. Please open a project folder.');
      return { metadata: { command: '' } };
    }

    // Extract session ID from chat history
    const sessionId = extractSessionId(context.history) || undefined;
    outputChannel.appendLine(`Session ID: ${sessionId || 'none'}`);
    console.log('[ChatParticipant] Session ID from history:', sessionId);
    console.log('[ChatParticipant] History length:', context.history.length);

    // Debug: show last response metadata
    if (context.history.length > 0) {
      const lastTurn = context.history[context.history.length - 1];
      console.log('[ChatParticipant] Last turn type:', lastTurn instanceof vscode.ChatResponseTurn ? 'Response' : 'Request');
      if (lastTurn instanceof vscode.ChatResponseTurn) {
        console.log('[ChatParticipant] Last turn participant:', lastTurn.participant);
        const metadata = lastTurn.result?.metadata;
        console.log('[ChatParticipant] Last response metadata:', JSON.stringify(metadata));
      }
    }

    // Handle slash commands (from API or plain text '/...')
    const parsedCommand = request.command || parseSlashCommand(request.prompt);
    if (parsedCommand) {
      outputChannel.appendLine(`Handling slash command: /${parsedCommand}`);
      console.log('[ChatParticipant] Slash command:', parsedCommand);
      await handleSlashCommand(parsedCommand, slaveExecutor, stream, sessionId);
      return { metadata: { command: '' } };
    }

    // Optionally show effective config
    const showCfg = vscode.workspace.getConfiguration('orka').get<boolean>('chat.showConfigOnStart', false);
    if (showCfg) {
      const cfg = getEffectiveMasterConfig(sessionId);
      stream.markdown(formatConfigMarkdown(cfg));
    }

    // Execute master CLI
    outputChannel.appendLine('Calling masterCLI.execute()...');
    console.log('[ChatParticipant] Calling masterCLI.execute()...');
    let newSessionId: string | undefined;
    try {
      let streamedText = '';
      await masterCLI.execute({
        projectPath: projectPath!, // Safe because we checked above
        sessionId,
        command: request.prompt,
        onOutput: (data) => {
          const text = typeof data === 'string' ? data : JSON.stringify(data);
          streamedText += text;
          outputChannel.append(`[onOutput] ${text}\n`);
          stream.markdown(text);
        },
        onToolCall: async (tool) => {
          return await handleMasterToolCall(tool, slaveExecutor, stream);
        },
        onProgress: (status) => {
          stream.progress(status);
        },
        onSession: (sid) => {
          console.log('[ChatParticipant] ✅ Session ID received from MasterCLI:', sid);
          newSessionId = sid;
        },
        token,
      });
      if (!streamedText.trim()) {
        stream.markdown('*(master CLI produced no textual output)*');
      }
    } catch (error) {
      outputChannel.appendLine('✗ Error caught:');
      outputChannel.appendLine(`  ${String(error)}`);
      console.log('[ChatParticipant] Error caught:', error);
      stream.markdown(`\n\n❌ Error: ${String(error)}\n`);

      // Show helpful message if shell integration is not available
      if (String(error).includes('Shell integration')) {
        stream.markdown(
          '\n**Tip:** Shell integration is required. Ensure you are using a supported shell (bash, zsh, pwsh) and VS Code >= 1.93.\n'
        );
      }
    }

    outputChannel.appendLine('Handler completed');
    outputChannel.appendLine('');
    console.log('[ChatParticipant] Handler completed');

    const finalSessionId = newSessionId || sessionId || '';
    console.log('[ChatParticipant] Returning metadata with session ID:', finalSessionId);

    return { metadata: { command: '', sessionId: finalSessionId } } as any;
  };

  const participant = vscode.chat.createChatParticipant(
    'orka.master',
    handler
  );

  console.log('[registerMasterParticipant] Participant created:', participant);

  // Set participant metadata
  participant.iconPath = vscode.Uri.joinPath(
    context.extensionUri,
    'resources',
    'icon.svg'
  );

  console.log('[registerMasterParticipant] Icon path set:', participant.iconPath);

  // Register disposables
  context.subscriptions.push(participant);
  context.subscriptions.push(slaveExecutor);
  context.subscriptions.push(masterCLI);

  console.log('[registerMasterParticipant] Participant registered in context.subscriptions');
  console.log('[registerMasterParticipant] Registration complete!');

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
      // Metadata is stored in turn.result.metadata (not turn.metadata)
      const metadata = turn.result?.metadata;
      if (metadata?.sessionId) {
        return metadata.sessionId;
      }
    }
  }
  return undefined;
}

function parseSlashCommand(prompt?: string): string | undefined {
  if (!prompt) return undefined;
  const trimmed = prompt.trim();
  if (!trimmed.startsWith('/')) return undefined;
  const token = trimmed.slice(1).split(/\s+/)[0];
  return token || undefined;
}

/**
 * Handle slash commands
 */
async function handleSlashCommand(
  command: string,
  slaveExecutor: SlaveExecutor,
  stream: vscode.ChatResponseStream,
  sessionId?: string
): Promise<void> {
  switch (command) {
    case 'status':
      await showSlaveStatus(slaveExecutor, stream);
      break;

    case 'abort':
      stream.markdown('⚠️ Use the stop button in the chat to abort execution.');
      break;

    case 'config':
      const cfg = getEffectiveMasterConfig(sessionId);
      stream.markdown(formatConfigMarkdown(cfg));
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

type EffectiveMasterConfig = {
  cli: string;
  model: string;
  thinking: 'yes' | 'no' | 'unknown';
  maxTurns: number;
  terminalVisible: boolean;
  sessionId?: string;
};

function getEffectiveMasterConfig(sessionId?: string): EffectiveMasterConfig {
  const cfg = vscode.workspace.getConfiguration('orka');
  const cli = cfg.get<string>('master.cli', 'claude');
  const model = cfg.get<string>('master.model', '');
  const maxTurns = cfg.get<number>('master.maxTurns', 0);
  const terminalVisible = cfg.get<boolean>('terminal.visible', true);

  const thinking: EffectiveMasterConfig['thinking'] = /thinking/i.test(model)
    ? 'yes'
    : model ? 'no' : 'unknown';

  return {
    cli,
    model,
    thinking,
    maxTurns,
    terminalVisible,
    sessionId,
  };
}

function formatConfigMarkdown(cfg: EffectiveMasterConfig): string {
  return [
    '### ⚙️ Orka Runtime Config',
    `- CLI: ${cfg.cli}`,
    `- Model: ${cfg.model}`,
    `- Thinking: ${cfg.thinking}`,
    `- Max turns: ${cfg.maxTurns}`,
    `- Terminal visible: ${cfg.terminalVisible}`,
    `- Session: ${cfg.sessionId ?? 'none'}`,
  ].join('\n');
}
