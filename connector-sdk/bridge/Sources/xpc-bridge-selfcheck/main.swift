// xpc-bridge-selfcheck — runtime verification for the bridge, runnable under the
// Command Line Tools (where swift-testing bundles cannot execute). Exits non-zero
// on any failure so it can gate CI and serve as a developer smoke test.

import Foundation

// Match the production binary: don't die from SIGPIPE during pipe teardown.
signal(SIGPIPE, SIG_IGN)
// Unbuffered stdout so progress is visible even if a check traps mid-run.
setvbuf(stdout, nil, _IONBF, 0)

let checker = Checker()

checkFrameCodec(checker)
checkOversizedFrame(checker)
await checkEnvelopeAndDispatch(checker)
await checkVersionNegotiation(checker)
await checkErrorMapping(checker)
await checkIntegrationOverPipes(checker)
checkSchemaConstant(checker)

checker.finish()
