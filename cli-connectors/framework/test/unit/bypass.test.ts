/**
 * Unit tests for the emergency bypass flag.
 *
 * Tests cover:
 * - --bypass flag detection and stripping
 * - VG_BYPASS=1 environment equivalent
 * - precedence and source reporting
 * - argument forwarding is otherwise untouched
 */

import { describe, it, expect } from 'vitest';
import {
  resolveBypass,
  BYPASS_FLAG,
  BYPASS_ENV_VAR,
} from '../../src/core/bypass.js';

const NO_ENV: NodeJS.ProcessEnv = {};

describe('resolveBypass', () => {
  it('is inactive when neither flag nor env is present', () => {
    const result = resolveBypass(['do', 'something', '--verbose'], NO_ENV);
    expect(result.bypass).toBe(false);
    expect(result.source).toBeUndefined();
    expect(result.args).toEqual(['do', 'something', '--verbose']);
  });

  it('activates on --bypass and strips it from the arguments', () => {
    const result = resolveBypass(['--bypass', 'write a function'], NO_ENV);
    expect(result.bypass).toBe(true);
    expect(result.source).toBe('flag');
    expect(result.args).toEqual(['write a function']);
  });

  it('strips --bypass regardless of position', () => {
    const result = resolveBypass(['exec', 'fix the bug', '--bypass'], NO_ENV);
    expect(result.bypass).toBe(true);
    expect(result.args).toEqual(['exec', 'fix the bug']);
  });

  it('strips every occurrence of --bypass', () => {
    const result = resolveBypass(['--bypass', 'prompt', '--bypass'], NO_ENV);
    expect(result.bypass).toBe(true);
    expect(result.args).toEqual(['prompt']);
  });

  it('does not strip arguments that merely contain the flag text', () => {
    const result = resolveBypass(['explain --bypass to me', '--bypass-cache'], NO_ENV);
    expect(result.bypass).toBe(false);
    expect(result.args).toEqual(['explain --bypass to me', '--bypass-cache']);
  });

  it('activates on VG_BYPASS=1 without changing arguments', () => {
    const result = resolveBypass(['prompt text'], { [BYPASS_ENV_VAR]: '1' });
    expect(result.bypass).toBe(true);
    expect(result.source).toBe('env');
    expect(result.args).toEqual(['prompt text']);
  });

  it('ignores VG_BYPASS values other than exactly "1"', () => {
    for (const value of ['0', 'true', 'yes', '']) {
      const result = resolveBypass(['prompt'], { [BYPASS_ENV_VAR]: value });
      expect(result.bypass).toBe(false);
    }
  });

  it('reports the flag as source when both flag and env are set', () => {
    const result = resolveBypass(['--bypass', 'prompt'], { [BYPASS_ENV_VAR]: '1' });
    expect(result.bypass).toBe(true);
    expect(result.source).toBe('flag');
    expect(result.args).toEqual(['prompt']);
  });

  it('handles an empty argument list', () => {
    const result = resolveBypass([], NO_ENV);
    expect(result.bypass).toBe(false);
    expect(result.args).toEqual([]);
  });

  it('exposes the documented flag and env var names', () => {
    expect(BYPASS_FLAG).toBe('--bypass');
    expect(BYPASS_ENV_VAR).toBe('VG_BYPASS');
  });
});
