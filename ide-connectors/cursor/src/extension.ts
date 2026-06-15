import * as vscode from 'vscode';
import { PromptInterceptor } from './interceptor';

export function activate(context: vscode.ExtensionContext) {
    console.log('VGuardrail Cursor Connector MVP is now active!');

    // Initialize the interceptor
    const interceptor = new PromptInterceptor();
    interceptor.registerCommands(context);

    // Command to check status
    let statusCmd = vscode.commands.registerCommand('vguardrail.status', () => {
        vscode.window.showInformationMessage('VGuardrail Connector: Active and monitoring prompts.');
    });

    context.subscriptions.push(statusCmd);
}

export function deactivate() {
    console.log('VGuardrail Cursor Connector MVP deactivated.');
}
