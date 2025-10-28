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

    // All slash commands are passed through to Claude CLI
    // No Orka-specific slash commands to avoid conflicts with Claude CLI's native commands

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
