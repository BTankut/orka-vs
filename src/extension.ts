import * as vscode from 'vscode';
import { registerMasterParticipant } from './chat/master-participant';
import { TelegramBridge } from './telegram/bridge';
import { MasterCLI } from './cli/master-cli';
import { SlaveExecutor } from './orchestration/slave-executor';

let telegramBridge: TelegramBridge | undefined;

/**
 * Extension activation
 */
export function activate(context: vscode.ExtensionContext) {
  console.log('Orka VS extension is activating...');

  // Register master chat participant
  registerMasterParticipant(context);

  // Register commands
  registerCommands(context);

  // Start Telegram bridge if enabled
  startTelegramBridge(context);

  // Listen for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('orka.telegram')) {
        restartTelegramBridge();
      }
    })
  );

  console.log('Orka VS extension activated successfully!');
}

/**
 * Extension deactivation
 */
export function deactivate() {
  if (telegramBridge) {
    telegramBridge.stop();
  }
  console.log('Orka VS extension deactivated');
}

/**
 * Register extension commands
 */
function registerCommands(context: vscode.ExtensionContext) {
  // Open master terminal
  context.subscriptions.push(
    vscode.commands.registerCommand('orka.openMasterTerminal', () => {
      const terminals = vscode.window.terminals;
      const masterTerminal = terminals.find((t) =>
        t.name.startsWith('Orka Master')
      );

      if (masterTerminal) {
        masterTerminal.show();
      } else {
        vscode.window.showInformationMessage(
          'Master terminal not yet created. Start a chat with @orka first.'
        );
      }
    })
  );

  // Show slave status
  context.subscriptions.push(
    vscode.commands.registerCommand('orka.showSlaveStatus', () => {
      // This will be handled by the chat participant with /status command
      vscode.commands.executeCommand('workbench.action.chat.open', {
        query: '@orka /status',
      });
    })
  );

  // Abort execution
  context.subscriptions.push(
    vscode.commands.registerCommand('orka.abortExecution', () => {
      vscode.window.showInformationMessage(
        'Use the stop button in the chat to abort execution.'
      );
    })
  );

  // Toggle Telegram bridge
  context.subscriptions.push(
    vscode.commands.registerCommand('orka.toggleTelegram', async () => {
      const config = vscode.workspace.getConfiguration('orka');
      const enabled = config.get<boolean>('telegram.enabled', false);

      await config.update(
        'telegram.enabled',
        !enabled,
        vscode.ConfigurationTarget.Global
      );

      if (!enabled) {
        vscode.window.showInformationMessage('Telegram bridge enabled');
      } else {
        vscode.window.showInformationMessage('Telegram bridge disabled');
      }
    })
  );
}

/**
 * Start Telegram bridge based on configuration
 */
function startTelegramBridge(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration('orka');
  const enabled = config.get<boolean>('telegram.enabled', false);

  if (!enabled) {
    return;
  }

  const port = config.get<number>('telegram.port', 3001);
  const masterCLI = new MasterCLI(
    config.get<string>('master.cli', 'claude')
  );
  const slaveExecutor = new SlaveExecutor();

  telegramBridge = new TelegramBridge(masterCLI, slaveExecutor);

  try {
    telegramBridge.start(port);
    vscode.window.showInformationMessage(
      `Orka Telegram bridge started on port ${port}`
    );
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to start Telegram bridge: ${String(error)}`
    );
  }

  context.subscriptions.push({
    dispose: () => telegramBridge?.stop(),
  });
}

/**
 * Restart Telegram bridge
 */
function restartTelegramBridge() {
  if (telegramBridge) {
    telegramBridge.stop();
    telegramBridge = undefined;
  }

  const config = vscode.workspace.getConfiguration('orka');
  const enabled = config.get<boolean>('telegram.enabled', false);

  if (enabled) {
    const port = config.get<number>('telegram.port', 3001);
    const masterCLI = new MasterCLI(
      config.get<string>('master.cli', 'claude')
    );
    const slaveExecutor = new SlaveExecutor();

    telegramBridge = new TelegramBridge(masterCLI, slaveExecutor);

    try {
      telegramBridge.start(port);
      vscode.window.showInformationMessage(
        `Orka Telegram bridge restarted on port ${port}`
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to restart Telegram bridge: ${String(error)}`
      );
    }
  }
}
