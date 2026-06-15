import { execa } from 'execa';
import { BaseAdapter, AdapterResponse, ExecutionOptions } from './BaseAdapter.js';

export class OpenCodeAdapter extends BaseAdapter {
  public async execute(prompt: string, options: ExecutionOptions): Promise<AdapterResponse> {
    try {
      // Generic adapter for local LLMs (e.g., Llama.cpp or Ollama CLI)
      const result = await execa('ollama', ['run', 'codellama', prompt], {
        timeout: options.timeout,
        signal: options.signal,
      });

      return {
        content: result.stdout,
        status: 'success'
      };
    } catch (error: any) {
      return { status: 'error', error: error.message };
    }
  }
}