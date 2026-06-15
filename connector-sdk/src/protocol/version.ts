// Version negotiation. On connect the SDK sends a `hello` advertising the
// protocol versions and model schema it supports; the bridge/daemon replies
// with the single protocol it selected plus its schema and agent version. The
// SDK accepts only a protocol it also supports and a schema it recognizes,
// otherwise it fails closed with `VersionMismatchError`.

import { z } from 'zod';
import { SCHEMA_VERSION } from '../models/schema.js';
import { VersionMismatchError } from '../resilience/errors.js';
import { PROTOCOL_VERSION } from './envelope.js';

/** SDK semantic version (keep in sync with package.json). */
export const SDK_VERSION = '0.1.0';

/** Bridge protocol versions this SDK understands, newest first. */
export const SUPPORTED_PROTOCOLS: readonly number[] = [PROTOCOL_VERSION];

/** The negotiated agreement returned from `connect()`. */
export interface NegotiatedVersion {
  proto: number;
  schema: string;
  agent: string;
}

/** Params the SDK sends in the `hello` request. */
export interface HelloParams {
  sdk: string;
  proto: readonly number[];
  schema: string;
}

/** Builds the `hello` params for this SDK build. */
export function helloParams(): HelloParams {
  return { sdk: SDK_VERSION, proto: SUPPORTED_PROTOCOLS, schema: SCHEMA_VERSION };
}

const HelloResultSchema = z.object({
  proto: z.number().int(),
  schema: z.string(),
  agent: z.string(),
});

/**
 * Validates the `hello` reply and returns the negotiated agreement. Throws
 * `VersionMismatchError` if the reply is malformed, selects a protocol this SDK
 * does not support, or carries an unrecognized schema.
 */
export function negotiate(helloResult: unknown): NegotiatedVersion {
  const parsed = HelloResultSchema.safeParse(helloResult);
  if (!parsed.success) {
    throw new VersionMismatchError('malformed hello reply from agent');
  }
  const { proto, schema, agent } = parsed.data;
  if (!SUPPORTED_PROTOCOLS.includes(proto)) {
    throw new VersionMismatchError(
      `agent selected protocol v${proto}; SDK supports [${SUPPORTED_PROTOCOLS.join(', ')}]`,
    );
  }
  if (schema !== SCHEMA_VERSION) {
    throw new VersionMismatchError(
      `agent schema "${schema}" != SDK schema "${SCHEMA_VERSION}"`,
    );
  }
  return { proto, schema, agent };
}
