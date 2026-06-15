import * as vscode from 'vscode';
import { ConnectorClient, Decision } from '@vguardrail/connector-sdk';

export class SDKClient {
    private client: ConnectorClient;

    constructor() {
        // Initialize client using XpcBridgeTransport underneath.
        // The transport implementation is handled by the SDK.
        this.client = new ConnectorClient({
            connectorId: 'cursor-ide-connector',
            connectorVersion: '0.1.0'
        });
    }

    public async scanPrompt(prompt: string, referencedFiles: { path: string; content: string }[]): Promise<Decision> {
        // Build the ScanRequest payload
        const request = {
            prompt,
            files: referencedFiles.map(f => ({
                path: f.path,
                content: f.content
            }))
        };

        // Call the SDK to scan the payload
        return await this.client.scan(request);
    }

    public async safeScanPrompt(prompt: string, referencedFiles: { path: string; content: string }[]): Promise<Decision> {
        const request = {
            prompt,
            files: referencedFiles.map(f => ({
                path: f.path,
                content: f.content
            }))
        };

        // safeScan defaults to Block if there's a fatal transport error
        return await this.client.safeScan(request, { fallback: 'block' });
    }
}
