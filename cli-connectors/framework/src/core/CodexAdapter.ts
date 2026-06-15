import { execa } from 'execa';
import { BaseAdapter, AdapterResponse, ExecutionOptions } from './BaseAdapter.js';

export class CodexAdapter extends BaseAdapter {
  public async execute(prompt: string, options: ExecutionOptions): Promise<AdapterResponse> {
    try {
      const timeout = options.timeout ?? 30000;
      const result = await execa('openai', ['api', 'completions.create', '-m', 'code-davinci-002', '-p', prompt], {
        timeout,
        cancelSignal: options.signal,
        reject: false,
      });

      return {
        content: result.stdout,
        metadata: { model: 'code-davinci-002' },
        status: 'success',
      };
    } catch (error: any) {
      if (error?.timedOut) return { status: 'error', error: 'TIMEOUT' };
      return { status: 'error', error: error?.message ?? String(error) };
    }
  }
}