#!/usr/bin/env node
// Entry point Chrome launches (via the native-messaging host manifest). Wires a
// real ConnectorClient (default transport spawns the signed xpc-bridge) to the
// stdio host loop. Exits 0 on graceful EOF.

import { ConnectorClient } from '@vguardrail/connector-sdk';
import { runHost } from './host.js';
import { loadIdentity } from './identity.js';

const client = new ConnectorClient();
const identity = loadIdentity();

runHost({ client, identity, input: process.stdin, output: process.stdout })
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
