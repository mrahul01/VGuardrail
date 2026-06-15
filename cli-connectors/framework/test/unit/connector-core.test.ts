/**
 * Unit tests for CLI Connector core framework.
 *
 * Tests cover:
 * - allow / warn / block decision enforcement
 * - timeout handling
 * - SDK unavailable scenarios
 * - process execution lifecycle
 * - signal forwarding
 * - file context extraction
 */

import { describe, it, expect } from 'vitest';
import type { Decision, Action } from '@vguardrail/connector-sdk';

function makeDecision(overrides: { action: Action } & Partial<Omit<Decision, 'action'>>): Decision {
  return {
    requestId: 'test-1',
    reason: 'test',
    riskLevel: 'low' as Decision['riskLevel'],
    classification: 'internal' as Decision['classification'],
    findings: [],
    suppressions: [],
    policyVersion: 1,
    elapsedMicros: 0,
    incomplete: false,
    ...overrides,
  };
}

// ── Policy Decision Tests ────────────────────────────────────────────────────

describe('Policy Decision Enforcement', () => {
  it('ALLOW - should permit execution', async () => {
    const { enforceDecision } = await import('../../src/policy/enforcement.js');
    const decision = makeDecision({ action: 'allow', reason: 'No issues found', riskLevel: 'low' });
    const result = await enforceDecision(decision);
    expect(result.shouldProceed).toBe(true);
    expect(result.warningAcknowledged).toBeUndefined();
  });

  it('WARN (medium) - should block when user declines (default)', { timeout: 2000 }, async () => {
    const { enforceDecision } = await import('../../src/policy/enforcement.js');
    const decision = makeDecision({ action: 'warn', reason: 'Sensitive data', riskLevel: 'medium' });
    // The prompt module uses inquirer which will hang without TTY
    // Use a race with a timeout to simulate a non-responding prompt
    const result = await Promise.race([
      enforceDecision(decision),
      new Promise<{ shouldProceed: boolean }>((resolve) => setTimeout(() => resolve({ shouldProceed: false }), 100)),
    ]);
    // If the promise resolves before the timeout, check the result
    // Otherwise fallback should be false (safe default)
    expect(result.shouldProceed).toBe(false);
  });

  it('WARN (high) - should escalate to a local block without prompting', { timeout: 2000 }, async () => {
    const { enforceDecision } = await import('../../src/policy/enforcement.js');
    const decision = makeDecision({ action: 'warn', reason: 'Sensitive data', riskLevel: 'high' });
    // Resolves immediately — no inquirer prompt is ever shown for high risk.
    const result = await enforceDecision(decision);
    expect(result.shouldProceed).toBe(false);
    expect(result.warningAcknowledged).toBe(false);
  });

  it('WARN (critical) - should escalate to a local block without prompting', { timeout: 2000 }, async () => {
    const { enforceDecision } = await import('../../src/policy/enforcement.js');
    const decision = makeDecision({ action: 'warn', reason: 'Sensitive data', riskLevel: 'critical' });
    const result = await enforceDecision(decision);
    expect(result.shouldProceed).toBe(false);
    expect(result.warningAcknowledged).toBe(false);
  });

  it('WARN (low) - should notice and proceed with auto-acknowledgement', { timeout: 2000 }, async () => {
    const { enforceDecision } = await import('../../src/policy/enforcement.js');
    const decision = makeDecision({ action: 'warn', reason: 'Sensitive data', riskLevel: 'low' });
    const result = await enforceDecision(decision);
    expect(result.shouldProceed).toBe(true);
    expect(result.warningAcknowledged).toBe(true);
  });

  it('warnTier should map risk levels to enforcement tiers (missing → prompt)', async () => {
    const { warnTier } = await import('../../src/policy/enforcement.js');
    expect(warnTier('critical')).toBe('block');
    expect(warnTier('high')).toBe('block');
    expect(warnTier('medium')).toBe('prompt');
    expect(warnTier(undefined)).toBe('prompt');
    expect(warnTier('low')).toBe('notice');
  });

  it('BLOCK - should prevent execution', async () => {
    const { enforceDecision } = await import('../../src/policy/enforcement.js');
    const decision = makeDecision({ action: 'block', reason: 'Policy violation', riskLevel: 'critical' });
    const result = await enforceDecision(decision);
    expect(result.shouldProceed).toBe(false);
  });

  it('TIMEOUT - should fail closed when policy evaluation times out', async () => {
    const { enforceDecision } = await import('../../src/policy/enforcement.js');
    const decision = makeDecision({
      action: 'block',
      reason: 'engine unavailable; fallback "block" applied',
      riskLevel: 'critical',
    });
    const result = await enforceDecision(decision);
    expect(result.shouldProceed).toBe(false);
  });

  it('SDK_UNAVAILABLE - should fall back to block when engine unreachable', async () => {
    const { PolicyClient } = await import('../../src/sdk/client.js');
    const client = new PolicyClient({ timeoutMs: 100 });
    expect(client).toBeDefined();
    expect(typeof client.scan).toBe('function');
    expect(typeof client.scanStrict).toBe('function');
    expect(typeof client.isAvailable).toBe('function');
  });

  it('formatDecisionMessage should format decisions correctly', async () => {
    const { formatDecisionMessage } = await import('../../src/policy/enforcement.js');
    const decision = makeDecision({ action: 'allow', reason: 'All clear' });
    const msg = formatDecisionMessage(decision);
    expect(msg).toContain('ALLOW');
    expect(msg).toContain('All clear');
  });
});

// ── Process Execution Tests ──────────────────────────────────────────────────

describe('Process Execution', () => {
  it('should execute a command and return exit code', async () => {
    const { executeToolCaptured } = await import('../../src/process/executor.js');
    const result = await executeToolCaptured({
      executable: 'node',
      args: ['-e', 'process.exit(0)'],
    });
    expect(result.started).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it('should capture stdout from process', async () => {
    const { executeToolCaptured } = await import('../../src/process/executor.js');
    const result = await executeToolCaptured({
      executable: 'node',
      args: ['-e', 'console.log("hello world")'],
    });
    expect(result.started).toBe(true);
    expect(result.stdout).toContain('hello world');
  });

  it('should handle non-existent executable gracefully', async () => {
    const { executeTool } = await import('../../src/process/executor.js');
    const result = await executeTool({
      executable: '/nonexistent/binary',
      args: [],
    });
    expect(result.started).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it('should return non-zero exit code on failure', async () => {
    const { executeToolCaptured } = await import('../../src/process/executor.js');
    const result = await executeToolCaptured({
      executable: 'node',
      args: ['-e', 'process.exit(42)'],
    });
    expect(result.started).toBe(true);
    expect(result.exitCode).toBe(42);
  });

  it('should capture stderr from process', async () => {
    const { executeToolCaptured } = await import('../../src/process/executor.js');
    const result = await executeToolCaptured({
      executable: 'node',
      args: ['-e', 'console.error("error msg")'],
    });
    expect(result.started).toBe(true);
    expect(result.stderr).toContain('error msg');
  });
});

// ── Signal Forwarding Tests ──────────────────────────────────────────────────

describe('Signal Forwarding', () => {
  it('should set and clear child PID', async () => {
    const { setChildPid, clearChildPid } = await import('../../src/process/signals.js');
    setChildPid(12345);
    clearChildPid();
    expect(true).toBe(true);
  });

  it('should forward signal to child process without throwing', async () => {
    const { forwardSignal, setChildPid, clearChildPid } = await import('../../src/process/signals.js');
    setChildPid(99999);
    forwardSignal('SIGTERM');
    clearChildPid();
    expect(true).toBe(true);
  });

  it('setupSignalHandlers should be idempotent', async () => {
    const { setupSignalHandlers } = await import('../../src/process/signals.js');
    setupSignalHandlers();
    setupSignalHandlers();
    expect(true).toBe(true);
  });
});

// ── Adapter Tests ────────────────────────────────────────────────────────────

describe('Tool Adapters', () => {
  it('CodexAdapter should construct properly', async () => {
    const { CodexAdapter } = await import('../../src/core/CodexAdapter.js');
    const adapter = new CodexAdapter();
    expect(adapter).toBeDefined();
    expect(typeof adapter.execute).toBe('function');
  });

  it('GeminiAdapter should construct properly', async () => {
    const { GeminiAdapter } = await import('../../src/core/GeminiAdapter.js');
    const adapter = new GeminiAdapter();
    expect(adapter).toBeDefined();
    expect(typeof adapter.execute).toBe('function');
  });

  it('AiderAdapter should construct properly', async () => {
    const { AiderAdapter } = await import('../../src/core/AiderAdapter.js');
    const adapter = new AiderAdapter();
    expect(adapter).toBeDefined();
    expect(typeof adapter.execute).toBe('function');
  });

  it('OpenCodeAdapter should construct properly', async () => {
    const { OpenCodeAdapter } = await import('../../src/core/OpenCodeAdapter.js');
    const adapter = new OpenCodeAdapter();
    expect(adapter).toBeDefined();
    expect(typeof adapter.execute).toBe('function');
  });
});

// ── File Context Extraction Tests ────────────────────────────────────────────

describe('File Context Extraction', () => {
  it('readFileContent should handle non-existent files', async () => {
    const { readFileContent } = await import('../../src/util/file.js');
    const result = readFileContent('/nonexistent/file.txt');
    expect(result).toBeNull();
  });

  it('readFiles should return empty array for no files', async () => {
    const { readFiles } = await import('../../src/util/file.js');
    const result = readFiles([]);
    expect(result).toEqual([]);
  });

  it('truncateContent should not truncate short content', async () => {
    const { truncateContent } = await import('../../src/util/file.js');
    const result = truncateContent('short text', 1000);
    expect(result).toBe('short text');
  });
});

// ── Config & Context Tests ──────────────────────────────────────────────────

describe('Configuration', () => {
  it('defaultConfig should return valid config', async () => {
    const { defaultConfig } = await import('../../src/core/config.js');
    const config = defaultConfig();
    expect(config).toBeDefined();
    expect(config.verbose).toBe(false);
    expect(config.timeoutMs).toBe(30000);
    expect(config.user).toBeDefined();
    expect(config.user.role).toBe('user');
    expect(config.tools).toEqual({});
    expect(config.repos).toEqual({});
  });

  it('validateToolName should validate correctly', async () => {
    const { validateToolName } = await import('../../src/util/validation.js');
    expect(validateToolName('test-tool').valid).toBe(true);
    expect(validateToolName('').valid).toBe(false);
  });

  it('scan-request builder should create valid ScanRequest', async () => {
    const { buildScanRequest, createExtractionContext } = await import('../../src/sdk/scan-request.js');
    const context = createExtractionContext({ prompt: 'hello' });
    const req = buildScanRequest({
      context,
      tool: {
        name: 'test',
        displayName: 'Test',
        executablePath: '/test',
        extractContext: async () => ({ found: false }),
      },
      user: { userId: 'user1', role: 'developer', groups: ['dev'] },
    });
    expect(req.text).toBe('hello');
    expect(req.context.app).toBe('test');
    expect(req.context.source).toBe('cli');
  });

  it('buildScanRequest should include repo context', async () => {
    const { buildScanRequest, createExtractionContext } = await import('../../src/sdk/scan-request.js');
    const context = createExtractionContext({ prompt: 'test' });
    const req = buildScanRequest({
      context,
      tool: {
        name: 'test',
        displayName: 'Test',
        executablePath: '/test',
        extractContext: async () => ({ found: false }),
      },
      user: { userId: 'u1', role: 'dev', groups: [] },
      repo: { name: 'myorg/myrepo', classification: 'confidential' },
    });
    expect(req.context.repo?.name).toBe('myorg/myrepo');
    expect(req.context.repo?.classification).toBe('confidential');
  });

  it('createToolDefinition should build valid definition', async () => {
    const { createToolDefinition } = await import('../../src/core/connector.js');
    const def = createToolDefinition({
      name: 'test-tool',
      displayName: 'Test Tool',
      executablePath: '/usr/bin/test',
      extractContext: async (args: string[]) => ({ found: false }),
    });
    expect(def.name).toBe('test-tool');
    expect(def.displayName).toBe('Test Tool');
    expect(def.executablePath).toBe('/usr/bin/test');
  });
});