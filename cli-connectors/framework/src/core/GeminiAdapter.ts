import { execa } from 'execa';
import { BaseAdapter, AdapterResponse, ExecutionOptions } from './BaseAdapter.js';

export class GeminiAdapter extends BaseAdapter {
  public async execute(prompt: string, options: ExecutionOptions): Promise<AdapterResponse> {
    try {
      // Wraps the Google Cloud Vertex AI / Gemini CLI
      const result = await execa('gcloud', ['ai', 'models', 'predict', '--prompt', prompt], {
        timeout: options.timeout || 30000,
        signal: options.signal,
        reject: false,
      });

      return {
        content: result.stdout,
        metadata: { provider: 'google-gemini' },
        status: 'success',
      };
    } catch (error: any) {
      if (error?.message?.includes('not found')) return { status: 'error', error: 'SDK_UNAVAILABLE' };
      return { status: 'error', error: error?.message ?? String(error) };
    }
  }
}