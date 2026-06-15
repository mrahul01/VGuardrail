import { describe, expect, it } from 'vitest';
import { Method, MockTransport, RemoteError, TransportError } from '@vguardrail/connector-sdk';

import {
  CANCEL_ACTION,
  ENGINE_UNAVAILABLE_MESSAGE,
  PROCEED_ACTION,
  PromptInterceptor,
  warnTier,
  type DecisionUi,
  type InterceptOutcome,
} from '../src/interceptor';
import { ScanService } from '../src/scan-service';
import { allowDecision, blockDecision, warnDecision } from './fixtures';

const identity = { userId: 'u-test', role: 'user' as const, groups: ['eng'] };
const editorCtx = {
  filePath: '/repo/src/main.ts',
  fileExtension: 'ts',
  languageId: 'typescript',
  workspaceName: 'acme-repo',
};

class FakeUi implements DecisionUi {
  warnings: Array<{ message: string; actions: string[] }> = [];
  errors: string[] = [];
  answer: string | undefined;

  showWarning(message: string, ...actions: string[]): Promise<string | undefined> {
    this.warnings.push({ message, actions });
    return Promise.resolve(this.answer);
  }

  showError(message: string): void {
    this.errors.push(message);
  }
}

function setup(transport: MockTransport): {
  ui: FakeUi;
  interceptor: PromptInterceptor;
  outcomes: InterceptOutcome[];
} {
  const ui = new FakeUi();
  const service = new ScanService({ app: 'cursor', transport, identity });
  const outcomes: InterceptOutcome[] = [];
  const interceptor = new PromptInterceptor(service, ui, (outcome) => outcomes.push(outcome));
  return { ui, interceptor, outcomes };
}

describe('PromptInterceptor over MockTransport', () => {
  it('allows an allow decision without any UI', async () => {
    const transport = new MockTransport().respondWith(Method.SubmitScan, allowDecision);
    const { ui, interceptor, outcomes } = setup(transport);

    const outcome = await interceptor.intercept('plain prompt', editorCtx);

    expect(outcome.allowed).toBe(true);
    expect(outcome.response.decision.action).toBe('allow');
    expect(ui.warnings).toHaveLength(0);
    expect(ui.errors).toHaveLength(0);
    expect(outcomes).toEqual([outcome]);
  });

  it('sends ide context (app, repo, file, user) on the wire', async () => {
    const transport = new MockTransport().respondWith(Method.SubmitScan, allowDecision);
    const { interceptor } = setup(transport);

    await interceptor.intercept('plain prompt', editorCtx);

    const submit = transport.calls.find((c) => c.method === Method.SubmitScan)!;
    const params = submit.params as {
      text: string;
      context: {
        source: string;
        app: string;
        repo: { name: string };
        file: { path: string; extension: string };
        user: { user_id: string; role: string; groups: string[] };
      };
    };
    expect(params.text).toBe('plain prompt');
    expect(params.context.source).toBe('ide');
    expect(params.context.app).toBe('cursor');
    expect(params.context.repo).toEqual({ name: 'acme-repo' });
    expect(params.context.file).toEqual({ path: '/repo/src/main.ts', extension: 'ts' });
    expect(params.context.user).toEqual({ user_id: 'u-test', role: 'user', groups: ['eng'] });
  });

  it('falls back to languageId when the file has no extension', async () => {
    const transport = new MockTransport().respondWith(Method.SubmitScan, allowDecision);
    const { interceptor } = setup(transport);

    await interceptor.intercept('x', { filePath: '/repo/Dockerfile', languageId: 'dockerfile' });

    const submit = transport.calls.find((c) => c.method === Method.SubmitScan)!;
    const params = submit.params as { context: { file: { path: string; extension: string } } };
    expect(params.context.file).toEqual({ path: '/repo/Dockerfile', extension: 'dockerfile' });
  });

  it('warn + Proceed allows and acknowledges accepted=true', async () => {
    const transport = new MockTransport()
      .respondWith(Method.SubmitScan, warnDecision)
      .respondWith(Method.AcknowledgeWarning, true);
    const { ui, interceptor } = setup(transport);
    ui.answer = PROCEED_ACTION;

    const outcome = await interceptor.intercept('prompt with email', editorCtx);

    expect(outcome.allowed).toBe(true);
    expect(ui.warnings[0]!.message).toContain('email address detected in prompt');
    expect(ui.warnings[0]!.message).toContain('Personal data (PII)');
    expect(ui.warnings[0]!.actions).toEqual([PROCEED_ACTION, CANCEL_ACTION]);

    const ack = transport.calls.find((c) => c.method === Method.AcknowledgeWarning)!;
    expect(ack.params).toEqual({ eventID: 'req-warn-1', accepted: true });
  });

  it('warn + Cancel denies and acknowledges accepted=false', async () => {
    const transport = new MockTransport()
      .respondWith(Method.SubmitScan, warnDecision)
      .respondWith(Method.AcknowledgeWarning, true);
    const { ui, interceptor } = setup(transport);
    ui.answer = CANCEL_ACTION;

    const outcome = await interceptor.intercept('prompt with email', editorCtx);

    expect(outcome.allowed).toBe(false);
    const ack = transport.calls.find((c) => c.method === Method.AcknowledgeWarning)!;
    expect(ack.params).toEqual({ eventID: 'req-warn-1', accepted: false });
  });

  it('warn dismissed (no choice) is treated as Cancel', async () => {
    const transport = new MockTransport()
      .respondWith(Method.SubmitScan, warnDecision)
      .respondWith(Method.AcknowledgeWarning, true);
    const { ui, interceptor } = setup(transport);
    ui.answer = undefined;

    const outcome = await interceptor.intercept('prompt with email', editorCtx);
    expect(outcome.allowed).toBe(false);
  });

  it('warn + high risk is escalated to a local block: error UI, no choice, ack false', async () => {
    const transport = new MockTransport()
      .respondWith(Method.SubmitScan, { ...warnDecision, risk_level: 'high' })
      .respondWith(Method.AcknowledgeWarning, true);
    const { ui, interceptor } = setup(transport);
    ui.answer = PROCEED_ACTION; // must be irrelevant — there is no proceed affordance

    const outcome = await interceptor.intercept('prompt with email', editorCtx);

    expect(outcome.allowed).toBe(false);
    expect(ui.warnings).toHaveLength(0);
    expect(ui.errors).toHaveLength(1);
    expect(ui.errors[0]).toContain('VGuardrail blocked (high risk)');
    expect(ui.errors[0]).toContain('email address detected in prompt');

    const ack = transport.calls.find((c) => c.method === Method.AcknowledgeWarning)!;
    expect(ack.params).toEqual({ eventID: 'req-warn-1', accepted: false });
  });

  it('warn + critical risk is escalated to a local block too', async () => {
    const transport = new MockTransport()
      .respondWith(Method.SubmitScan, { ...warnDecision, risk_level: 'critical' })
      .respondWith(Method.AcknowledgeWarning, true);
    const { ui, interceptor } = setup(transport);

    const outcome = await interceptor.intercept('prompt with email', editorCtx);

    expect(outcome.allowed).toBe(false);
    expect(ui.warnings).toHaveLength(0);
    expect(ui.errors[0]).toContain('VGuardrail blocked (high risk)');
  });

  it('warn + low risk shows a buttonless notice, allows, and acks true', async () => {
    const transport = new MockTransport()
      .respondWith(Method.SubmitScan, { ...warnDecision, risk_level: 'low' })
      .respondWith(Method.AcknowledgeWarning, true);
    const { ui, interceptor } = setup(transport);
    ui.answer = undefined; // dismissing the notice must not block the prompt

    const outcome = await interceptor.intercept('prompt with email', editorCtx);

    expect(outcome.allowed).toBe(true);
    expect(ui.errors).toHaveLength(0);
    expect(ui.warnings).toHaveLength(1);
    expect(ui.warnings[0]!.message).toContain('email address detected in prompt');
    expect(ui.warnings[0]!.actions).toEqual([]);

    const ack = transport.calls.find((c) => c.method === Method.AcknowledgeWarning)!;
    expect(ack.params).toEqual({ eventID: 'req-warn-1', accepted: true });
  });

  it('a failed acknowledge does not change the warn verdict', async () => {
    const transport = new MockTransport()
      .respondWith(Method.SubmitScan, warnDecision)
      .on(Method.AcknowledgeWarning, () => {
        throw new TransportError('ack pipe broke');
      });
    const { ui, interceptor } = setup(transport);
    ui.answer = PROCEED_ACTION;

    const outcome = await interceptor.intercept('prompt with email', editorCtx);
    expect(outcome.allowed).toBe(true);
  });

  it('block shows the reason and all finding categories, and denies', async () => {
    const transport = new MockTransport().respondWith(Method.SubmitScan, blockDecision);
    const { ui, interceptor } = setup(transport);

    const outcome = await interceptor.intercept('here is AKIA…', editorCtx);

    expect(outcome.allowed).toBe(false);
    expect(ui.errors).toHaveLength(1);
    expect(ui.errors[0]).toContain('AWS access key detected');
    expect(ui.errors[0]).toContain('Secrets & credentials');
    expect(ui.errors[0]).toContain('Personal data (PII)');
    expect(ui.warnings).toHaveLength(0);
  });

  it('fails closed even on non-availability (remote) errors safeScan rethrows', async () => {
    const transport = new MockTransport().on(Method.SubmitScan, () => {
      throw new RemoteError('daemon rejected the request');
    });
    const { ui, interceptor } = setup(transport);

    const outcome = await interceptor.intercept('any prompt', editorCtx);

    expect(outcome.allowed).toBe(false);
    expect(outcome.response.fromFallback).toBe(true);
    expect(outcome.response.decision.action).toBe('block');
    expect(ui.errors).toEqual([ENGINE_UNAVAILABLE_MESSAGE]);
  });

  it('fails closed with the engine-unavailable message when transport is down', async () => {
    const transport = new MockTransport().on(Method.SubmitScan, () => {
      throw new TransportError('xpc bridge died');
    });
    const { ui, interceptor } = setup(transport);

    const outcome = await interceptor.intercept('any prompt', editorCtx);

    expect(outcome.allowed).toBe(false);
    expect(outcome.response.fromFallback).toBe(true);
    expect(outcome.response.decision.action).toBe('block');
    expect(ui.errors).toEqual([ENGINE_UNAVAILABLE_MESSAGE]);
  });
});

describe('warnTier', () => {
  it('escalates high/critical to a local block', () => {
    expect(warnTier('high')).toBe('block');
    expect(warnTier('critical')).toBe('block');
  });

  it('keeps medium interactive and treats a missing risk level as medium', () => {
    expect(warnTier('medium')).toBe('prompt');
    expect(warnTier(undefined)).toBe('prompt');
  });

  it('demotes low to a non-blocking notice', () => {
    expect(warnTier('low')).toBe('notice');
  });
});
