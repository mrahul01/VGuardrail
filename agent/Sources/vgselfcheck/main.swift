// vgselfcheck — runs runtime verification for every implemented module and exits
// non-zero on failure. Usable as a CI gate where `swift test` cannot execute
// (Command Line Tools without full Xcode).

let checker = Checker()

checkVGCore(checker)
checkVGSQLite(checker)
await checkVGEventQueue(checker)
checkVGXPCProtocol(checker)
await checkVGAgentCore(checker)
checkAICatalog(checker)

checker.finish()
