import { describe, expect, it } from 'vitest';
import {
  ConnectorError,
  ConnectorErrorCode,
  EngineUnavailableError,
  NotConnectedError,
  RemoteError,
  RetryExhaustedError,
  TimeoutError,
  TransportError,
  ValidationError,
  VersionMismatchError,
  connectorErrorFromWire,
  isRetryable,
} from '../../src/resilience/errors.js';

describe('error taxonomy', () => {
  it('assigns stable codes and retryable flags', () => {
    const cases: Array<[ConnectorError, ConnectorErrorCode, boolean]> = [
      [new TransportError('x'), ConnectorErrorCode.Transport, true],
      [new NotConnectedError(), ConnectorErrorCode.NotConnected, true],
      [new TimeoutError('x', 100), ConnectorErrorCode.Timeout, false],
      [new RemoteError('x'), ConnectorErrorCode.Remote, false],
      [new ValidationError('x'), ConnectorErrorCode.Validation, false],
      [new VersionMismatchError('x'), ConnectorErrorCode.VersionMismatch, false],
      [new EngineUnavailableError(), ConnectorErrorCode.Unavailable, false],
      [new RetryExhaustedError(3, new Error('y')), ConnectorErrorCode.RetryExhausted, false],
    ];
    for (const [err, code, retryable] of cases) {
      expect(err).toBeInstanceOf(ConnectorError);
      expect(err.code).toBe(code);
      expect(err.retryable).toBe(retryable);
      expect(isRetryable(err)).toBe(retryable);
    }
  });

  it('instanceof works across subclasses (prototype chain preserved)', () => {
    const e = new TransportError('boom');
    expect(e).toBeInstanceOf(TransportError);
    expect(e).toBeInstanceOf(ConnectorError);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('TransportError');
  });

  it('preserves cause and timeout metadata', () => {
    const cause = new Error('root');
    expect(new TransportError('x', { cause }).cause).toBe(cause);
    expect(new TimeoutError('x', 2000).timeoutMs).toBe(2000);
    expect(new RetryExhaustedError(4, cause).attempts).toBe(4);
    expect(new RetryExhaustedError(4, cause).cause).toBe(cause);
  });

  it('isRetryable is false for non-ConnectorError values', () => {
    expect(isRetryable(new Error('plain'))).toBe(false);
    expect(isRetryable('nope')).toBe(false);
  });
});

describe('connectorErrorFromWire', () => {
  it('reconstructs a typed error per stable wire code', () => {
    const cases: Array<[string, new (...a: never[]) => ConnectorError, ConnectorErrorCode]> = [
      [ConnectorErrorCode.Unavailable, EngineUnavailableError, ConnectorErrorCode.Unavailable],
      [ConnectorErrorCode.NotConnected, NotConnectedError, ConnectorErrorCode.NotConnected],
      [ConnectorErrorCode.Transport, TransportError, ConnectorErrorCode.Transport],
      [ConnectorErrorCode.Timeout, TimeoutError, ConnectorErrorCode.Timeout],
      [ConnectorErrorCode.Validation, ValidationError, ConnectorErrorCode.Validation],
      [ConnectorErrorCode.VersionMismatch, VersionMismatchError, ConnectorErrorCode.VersionMismatch],
      [ConnectorErrorCode.Remote, RemoteError, ConnectorErrorCode.Remote],
    ];
    for (const [code, ctor, expectedCode] of cases) {
      const err = connectorErrorFromWire(code, `${code} happened`);
      expect(err).toBeInstanceOf(ctor);
      expect(err.code).toBe(expectedCode);
      expect(err.message).toBe(`${code} happened`);
    }
  });

  it('degrades an unknown code to a definitive RemoteError', () => {
    const err = connectorErrorFromWire('SOMETHING_NEW', 'from a newer bridge');
    expect(err).toBeInstanceOf(RemoteError);
    expect(err.code).toBe(ConnectorErrorCode.Remote);
  });
});
