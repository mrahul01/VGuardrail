// Pure helpers for the file-upload interceptor: deciding whether a decision
// blocks an upload, pulling File objects out of a fetch body, and encoding a
// file for the scan transport. Kept free of DOM/extension globals (beyond the
// standard File/Blob/FormData) so it is unit-testable under vitest/jsdom.

import { SEND_ANYWAY_THRESHOLD, type Decision } from '../shared/contract.js';
import type { ScanFile } from '../shared/protocol.js';

/** Default cap on a single uploaded file we will read + scan (bytes). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Whether a file-upload decision should block the upload. An upload can't show
 * an interactive "Send anyway" modal mid-flight, so the rule mirrors the typed
 * gate's hard-block band: `block` always blocks, a `warn` blocks only when its
 * risk score exceeds the threshold; allow / low-risk warns proceed.
 */
export function shouldBlockUpload(decision: Decision): boolean {
  if (decision.action === 'block') return true;
  if (decision.action === 'warn') {
    const score = typeof decision.riskScore === 'number' ? decision.riskScore : 0;
    return score > SEND_ANYWAY_THRESHOLD;
  }
  return false;
}

/** A file pulled from a fetch body, with a best-effort name. */
export interface UploadFile {
  blob: Blob;
  name: string;
}

/** Extracts File/Blob attachments from a fetch `init.body` (FormData / File / Blob). */
export function extractUploadFiles(body: unknown): UploadFile[] {
  const out: UploadFile[] = [];
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    for (const value of body.values()) {
      if (typeof File !== 'undefined' && value instanceof File) {
        out.push({ blob: value, name: value.name || 'upload' });
      }
    }
  } else if (typeof File !== 'undefined' && body instanceof File) {
    out.push({ blob: body, name: body.name || 'upload' });
  } else if (typeof Blob !== 'undefined' && body instanceof Blob) {
    out.push({ blob: body, name: 'upload.bin' });
  }
  return out;
}

/** Base64-encodes a byte array (chunked to avoid call-stack limits). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Reads + base64-encodes an upload for the scan transport, or returns null when
 * it exceeds the size cap (too large to read into memory — allow + audit).
 * File/Blob are re-readable, so this does not consume the body the page sends.
 */
export async function encodeUploadFile(
  file: UploadFile,
  maxBytes: number = MAX_UPLOAD_BYTES,
): Promise<ScanFile | null> {
  if (file.blob.size > maxBytes) return null;
  const buffer = await file.blob.arrayBuffer();
  return {
    name: file.name,
    mime: file.blob.type || undefined,
    content_base64: bytesToBase64(new Uint8Array(buffer)),
  };
}
