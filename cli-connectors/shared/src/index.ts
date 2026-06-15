import { spawn } from 'child_process';
import { ConnectorClient, Decision } from '@vguardrail/connector-sdk';
import inquirer from 'inquirer';

export interface ScanContext {
    prompt: string;
    files: Array<{
        path: string;
        content: string;
    }>;
}

export interface CliWrapperConfig {
    toolName: string;
    realExecutablePath: string;
    extractContext: (args: string[]) => Promise<ScanContext | null>;
}

export class CliWrapper {
    private client: ConnectorClient;

    constructor(private config: CliWrapperConfig) {
        this.client = new ConnectorClient({
            connectorId: `cli-${config.toolName}`,
            connectorVersion: '0.1.0'
        });
    }

    public async run(args: string[]): Promise<void> {
        let context: ScanContext | null = null;
        try {
            context = await this.config.extractContext(args);
        } catch (err) {
            console.error(`[VGuardrail] Error extracting context:`, err);
            // Fail open on extraction errors to not break the tool if flags change
            return this.spawnReal(args);
        }

        // If no prompt found, pass through immediately
        if (!context) {
            return this.spawnReal(args);
        }

        try {
            const decision: Decision = await this.client.safeScan(context, { fallback: 'block' });

            if (decision.action === 'block') {
                console.error(`\x1b[31m[VGuardrail] BLOCKED: ${decision.reason}\x1b[0m`);
                process.exit(1);
            }

            if (decision.action === 'warn') {
                console.warn(`\x1b[33m[VGuardrail] WARNING: ${decision.reason}\x1b[0m`);
                const answer = await inquirer.prompt([
                    {
                        type: 'confirm',
                        name: 'proceed',
                        message: 'Do you want to acknowledge and proceed?',
                        default: false
                    }
                ]);
                
                if (!answer.proceed) {
                    process.exit(1);
                }
            }

            // Allow or Warn accepted
            await this.spawnReal(args);
        } catch (err) {
            console.error(`[VGuardrail] Fatal transport error:`, err);
            // safeScan enforces fallback: block internally, but if it throws entirely:
            process.exit(1);
        }
    }

    private spawnReal(args: string[]): Promise<void> {
        return new Promise((resolve) => {
            const child = spawn(this.config.realExecutablePath, args, {
                stdio: 'inherit',
                env: process.env
            });

            child.on('exit', (code) => {
                process.exit(code ?? 1);
            });

            child.on('error', (err) => {
                console.error(`[VGuardrail] Error spawning real executable:`, err);
                process.exit(1);
            });
        });
    }
}
