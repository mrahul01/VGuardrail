/**
 * Unit tests for validation module.
 */

import { describe, it, expect } from 'vitest';
import { validatePath, sanitizePath, validateArguments, validatePrompt, validateToolName } from '../../src/util/validation.js';

describe('validatePath', () => {
  it('should reject empty paths', () => {
    expect(validatePath('')).toEqual({ valid: false, error: 'Empty path' });
    expect(validatePath('   ')).toEqual({ valid: false, error: 'Empty path' });
  });

  it('should reject paths with null bytes', () => {
    expect(validatePath('file\0.txt')).toEqual({ valid: false, error: 'Path contains null bytes' });
  });

  it('should accept valid relative paths', () => {
    const result = validatePath('src/index.ts');
    expect(result.valid).toBe(true);
  });

  it('should accept valid absolute paths within project', () => {
    // Use process.cwd() to get a real valid path
    const cwd = process.cwd();
    const result = validatePath(cwd + '/test.txt');
    expect(result.valid).toBe(true);
  });
});

describe('sanitizePath', () => {
  it('should remove null bytes', () => {
    const result = sanitizePath('file\0.txt');
    expect(result).not.toContain('\0');
  });

  it('should resolve to absolute path', () => {
    const result = sanitizePath('./relative/path');
    expect(result).toMatch(/^[/|]/); // Should start with / or drive letter
  });
});

describe('validateArguments', () => {
  it('should accept valid arguments', () => {
    const result = validateArguments(['--help', 'test', '-v']);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject arguments with null bytes', () => {
    const result = validateArguments(['test\0arg']);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Argument 0 contains null bytes');
  });

  it('should reject extremely long arguments', () => {
    const longArg = 'a'.repeat(200000);
    const result = validateArguments([longArg]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('exceeds maximum length');
  });

  it('should validate multiple arguments', () => {
    const result = validateArguments(['valid', 'args', '--flag']);
    expect(result.valid).toBe(true);
  });
});

describe('validatePrompt', () => {
  it('should reject empty prompts', () => {
    expect(validatePrompt('')).toEqual({ valid: false, error: 'Empty prompt' });
    expect(validatePrompt('   ')).toEqual({ valid: false, error: 'Empty prompt' });
  });

  it('should accept valid prompts', () => {
    expect(validatePrompt('Hello, world!')).toEqual({ valid: true });
  });

  it('should reject prompts exceeding max length', () => {
    const longPrompt = 'a'.repeat(2000000);
    expect(validatePrompt(longPrompt)).toEqual({
      valid: false,
      error: expect.stringContaining('exceeds maximum length'),
    });
  });

  it('should accept prompts at max length', () => {
    const exactPrompt = 'a'.repeat(1000000);
    expect(validatePrompt(exactPrompt)).toEqual({ valid: true });
  });
});

describe('validateToolName', () => {
  it('should reject empty names', () => {
    expect(validateToolName('')).toEqual({ valid: false, error: 'Empty tool name' });
    expect(validateToolName('   ')).toEqual({ valid: false, error: 'Empty tool name' });
  });

  it('should accept valid tool names', () => {
    expect(validateToolName('claude-code')).toEqual({ valid: true });
    expect(validateToolName('gemini_cli')).toEqual({ valid: true });
    expect(validateToolName('aider123')).toEqual({ valid: true });
  });

  it('should reject names with invalid characters', () => {
    expect(validateToolName('tool name')).toEqual({ valid: false, error: 'Tool name contains invalid characters' });
    expect(validateToolName('tool@name')).toEqual({ valid: false, error: 'Tool name contains invalid characters' });
    expect(validateToolName('tool/name')).toEqual({ valid: false, error: 'Tool name contains invalid characters' });
  });

  it('should reject names that are too long', () => {
    const longName = 'a'.repeat(100);
    expect(validateToolName(longName)).toEqual({
      valid: false,
      error: 'Tool name too long (max 64 characters)',
    });
  });
});