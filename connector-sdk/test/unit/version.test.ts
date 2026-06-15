import { describe, expect, it } from 'vitest';
import { helloParams, negotiate, SDK_VERSION, SUPPORTED_PROTOCOLS } from '../../src/protocol/version.js';
import { SCHEMA_VERSION } from '../../src/models/schema.js';
import { VersionMismatchError } from '../../src/resilience/errors.js';

describe('version negotiation', () => {
  it('advertises this SDK build in hello', () => {
    const hello = helloParams();
    expect(hello.sdk).toBe(SDK_VERSION);
    expect(hello.proto).toEqual(SUPPORTED_PROTOCOLS);
    expect(hello.schema).toBe(SCHEMA_VERSION);
  });

  it('accepts a supported protocol + matching schema', () => {
    const agreed = negotiate({ proto: 1, schema: SCHEMA_VERSION, agent: 'vguardiand/1.0.0' });
    expect(agreed).toEqual({ proto: 1, schema: SCHEMA_VERSION, agent: 'vguardiand/1.0.0' });
  });

  it('rejects an unsupported protocol', () => {
    expect(() => negotiate({ proto: 99, schema: SCHEMA_VERSION, agent: 'a' })).toThrow(VersionMismatchError);
  });

  it('rejects an unknown schema', () => {
    expect(() => negotiate({ proto: 1, schema: 'vguardrail.event/v2', agent: 'a' })).toThrow(VersionMismatchError);
  });

  it('rejects a malformed hello reply', () => {
    expect(() => negotiate({ proto: 'one' })).toThrow(VersionMismatchError);
    expect(() => negotiate(null)).toThrow(VersionMismatchError);
  });
});
