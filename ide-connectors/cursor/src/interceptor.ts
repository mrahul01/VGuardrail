import * as vscode from 'vscode';
import { SDKClient } from './sdk-client';
import { Decision } from '@vguardrail/connector-sdk';

export class PromptInterceptor {
    private sdkClient: SDKClient;

    constructor() {
        this.sdkClient = new SDKClient();
    }

    /**
     * Simulates intercepting a prompt and validating it against the local policy engine.
     * In a real Cursor extension, this would hook into the AI Chat or Cmd+K interfaces.
     */
    public async intercept(prompt: string, referencedFiles: { path: string; content: string }[]): Promise<boolean> {
        try {
            const decision: Decision = await this.sdkClient.safeScanPrompt(prompt, referencedFiles);

            switch (decision.action) {
                case 'allow':
                    return true;
                
                case 'warn':
                    const response = await vscode.window.showWarningMessage(
                        `VGuardrail Warning: Policy violation detected.\n\n${decision.reason}`,
                        'Acknowledge & Proceed',
                        'Cancel'
                    );
                    
                    if (response === 'Acknowledge & Proceed') {
                        // In a real scenario, we might send a warning accepted event here
                        return true;
                    }
                    return false;

                case 'block':
                    vscode.window.showErrorMessage(
                        `VGuardrail Blocked: Prompt rejected by local policy.\n\n${decision.reason}`
                    );
                    return false;
                    
                default:
                    vscode.window.showErrorMessage('VGuardrail: Received unknown decision from policy engine.');
                    return false;
            }
        } catch (error) {
            vscode.window.showErrorMessage(`VGuardrail Error: Failed to evaluate prompt. ${error}`);
            // Fail-closed mechanism is handled by safeScan's fallback
            return false;
        }
    }

    /**
     * Registers dummy commands to simulate chat interactions for the MVP.
     */
    public registerCommands(context: vscode.ExtensionContext) {
        let disposable = vscode.commands.registerCommand('vguardrail.simulatePrompt', async () => {
            const prompt = await vscode.window.showInputBox({ prompt: 'Simulate an AI prompt submission:' });
            if (prompt) {
                // Simulate getting referenced files by using the current active editor
                const files = [];
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    files.push({
                        path: editor.document.uri.fsPath,
                        content: editor.document.getText()
                    });
                }
                
                const allowed = await this.intercept(prompt, files);
                if (allowed) {
                    vscode.window.showInformationMessage('Prompt Allowed by VGuardrail. Submitting to AI provider...');
                } else {
                    vscode.window.showInformationMessage('Prompt Submission Cancelled.');
                }
            }
        });

        context.subscriptions.push(disposable);
    }
}
