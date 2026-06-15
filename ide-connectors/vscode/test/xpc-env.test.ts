// prepareXpcEnvironment — bridge-path and user-agent-domain env fill-in for
// GUI-launched IDEs (no shell PATH; local dev uses a user LaunchAgent).

import { describe, expect, it } from 'vitest';
import { DEFAULT_BRIDGE_PATH, prepareXpcEnvironment } from '../src/xpc-env';

const HOME = '/Users/tester';
const PLIST = `${HOME}/Library/LaunchAgents/com.vguardrail.agent.local.plist`;

describe('prepareXpcEnvironment', () => {
  it('sets bridge path and user-agent lookup when both artifacts exist', () => {
    const env: NodeJS.ProcessEnv = {};
    prepareXpcEnvironment(env, HOME, (p) => p === DEFAULT_BRIDGE_PATH || p === PLIST);
    expect(env.VG_XPC_BRIDGE_PATH).toBe(DEFAULT_BRIDGE_PATH);
    expect(env.VG_XPC_USER_AGENT).toBe('1');
  });

  it('leaves everything unset when neither artifact exists', () => {
    const env: NodeJS.ProcessEnv = {};
    prepareXpcEnvironment(env, HOME, () => false);
    expect(env.VG_XPC_BRIDGE_PATH).toBeUndefined();
    expect(env.VG_XPC_USER_AGENT).toBeUndefined();
  });

  it('never overrides explicit user-provided values', () => {
    const env: NodeJS.ProcessEnv = {
      VG_XPC_BRIDGE_PATH: '/opt/custom/bridge',
      VG_XPC_USER_AGENT: '0',
    };
    prepareXpcEnvironment(env, HOME, () => true);
    expect(env.VG_XPC_BRIDGE_PATH).toBe('/opt/custom/bridge');
    expect(env.VG_XPC_USER_AGENT).toBe('0');
  });
});
