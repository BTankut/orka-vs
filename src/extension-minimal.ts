import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  console.log('Orka extension activating...');

  const handler: vscode.ChatRequestHandler = async (request, chatCtx, stream, token) => {
    stream.markdown('🔵 Handler called!');
    return;
  };

  console.log('Creating participant with ID: orka-vs.test');
  const participant = vscode.chat.createChatParticipant('orka-vs.test', handler);

  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icon.svg');
  context.subscriptions.push(participant);

  console.log('Orka extension activated!');
}

export function deactivate() {}
