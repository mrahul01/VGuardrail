// Unit tests for the file-upload interceptor helpers: block decision banding,
// pulling files out of a fetch body, and base64 encoding (incl. the size cap).

import { describe, expect, it } from 'vitest';
import {
  encodeUploadFile,
  extractUploadFiles,
  shouldBlockUpload,
} from '../src/content/upload-policy';
import type { Decision } from '../src/shared/contract';

function decision(action: Decision['action'], over: Partial<Decision> = {}): Decision {
  return {
    requestId: 'r',
    action,
    riskLevel: 'medium',
    findings: [],
    reason: 'x',
    ...over,
  };
}

describe('shouldBlockUpload', () => {
  it('blocks a block decision', () => {
    expect(shouldBlockUpload(decision('block'))).toBe(true);
  });
  it('blocks a high-risk warn (score > 55)', () => {
    expect(shouldBlockUpload(decision('warn', { riskScore: 80 }))).toBe(true);
  });
  it('allows a low/medium warn (score ≤ 55)', () => {
    expect(shouldBlockUpload(decision('warn', { riskScore: 40 }))).toBe(false);
  });
  it('allows an allow decision', () => {
    expect(shouldBlockUpload(decision('allow'))).toBe(false);
  });
});

describe('extractUploadFiles', () => {
  it('pulls a File out of FormData', () => {
    const fd = new FormData();
    fd.append('file', new File(['hello'], 'doc.pdf', { type: 'application/pdf' }));
    fd.append('text', 'a normal field');
    const files = extractUploadFiles(fd);
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe('doc.pdf');
  });

  it('handles a bare File body', () => {
    const files = extractUploadFiles(new File(['x'], 'a.txt'));
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe('a.txt');
  });

  it('ignores a plain string body', () => {
    expect(extractUploadFiles('just a json string')).toEqual([]);
  });
});

describe('encodeUploadFile', () => {
  it('base64-encodes a file under the cap', async () => {
    const blob = new File(['AKIA-secret'], 'leak.txt', { type: 'text/plain' });
    const encoded = await encodeUploadFile({ blob, name: 'leak.txt' });
    expect(encoded).not.toBeNull();
    expect(encoded?.name).toBe('leak.txt');
    expect(atob(encoded!.content_base64)).toBe('AKIA-secret');
  });

  it('returns null for a file over the cap (allow + audit)', async () => {
    const blob = new Blob([new Uint8Array(10)]);
    const encoded = await encodeUploadFile({ blob, name: 'big.bin' }, 4); // cap 4 bytes
    expect(encoded).toBeNull();
  });
});
