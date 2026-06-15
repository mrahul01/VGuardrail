// Bridge method names. These mirror the four operations on the daemon's
// `AgentControl` XPC interface (agent/Sources/VGXPCProtocol/AgentControl.swift)
// plus the SDK↔bridge `hello` handshake.

export const Method = {
  /** Version-negotiation handshake (SDK ↔ bridge ↔ daemon). */
  Hello: 'hello',
  /** Submit a prompt for evaluation → Decision. */
  SubmitScan: 'submitScan',
  /** Current agent + engine health → AgentStatus. */
  GetStatus: 'getStatus',
  /** Record a user's response to a WARN → boolean. */
  AcknowledgeWarning: 'acknowledgeWarning',
  /** Recent decisions for display → DecisionSummary[]. */
  RecentDecisions: 'recentDecisions',
} as const;

export type MethodName = (typeof Method)[keyof typeof Method];
