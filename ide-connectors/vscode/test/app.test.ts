import { describe, expect, it } from 'vitest';
import { detectIdeApp } from '../src/app';

describe('detectIdeApp', () => {
  it('detects Cursor', () => {
    expect(detectIdeApp('Cursor')).toBe('cursor');
  });

  it('detects Windsurf', () => {
    expect(detectIdeApp('Windsurf')).toBe('windsurf');
  });

  it('detects Trae', () => {
    expect(detectIdeApp('Trae')).toBe('trae');
    expect(detectIdeApp('Trae CN')).toBe('trae');
  });

  it('detects Antigravity', () => {
    expect(detectIdeApp('Antigravity')).toBe('antigravity');
    expect(detectIdeApp('Google Antigravity')).toBe('antigravity');
  });

  it('detects VS Code variants', () => {
    expect(detectIdeApp('Visual Studio Code')).toBe('vscode');
    expect(detectIdeApp('Visual Studio Code - Insiders')).toBe('vscode');
  });

  it('defaults unknown hosts to vscode', () => {
    expect(detectIdeApp('SomeFutureFork')).toBe('vscode');
  });
});
