import { execa } from 'execa';
import { BaseAdapter, AdapterResponse, ExecutionOptions } from './BaseAdapter.js';

export class AiderAdapter extends BaseAdapter {
  public async execute(prompt: string, options: ExecutionOptions): Promise<AdapterResponse> {
    try {
      // Aider is often used for in-place file editing
      const result = await execa('aider', ['--message', prompt, '--no-git'], {
        timeout: options.timeout,
        cancelSignal: options.signal,
        reject: false,
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      });

      return {
        content: result.stdout,
        status: 'success',
      };
    } catch (error: any) {
      return { status: 'error', error: error?.message ?? String(error) };
    }
  }
}