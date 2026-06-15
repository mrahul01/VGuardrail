// Ties the bridge's hardcoded schema constant to the agent's model source of
// truth: builds a real AuditEvent and compares its stamped schema. The binary
// refuses to start if they ever diverge, so the constant can't silently drift
// from VGCore.

import VGCore

/// True iff `BridgeProtocol.schema` equals the schema the agent stamps onto
/// audit events.
public func bridgeSchemaMatchesAgentModels() -> Bool {
    let decision = Decision(
        requestID: "schema-check",
        action: .allow,
        riskLevel: .low,
        classification: .public
    )
    let context = ScanContext(user: UserContext(userID: "schema-check"))
    let event = AuditEvent.make(
        type: .policyEvaluated,
        eventID: "schema-check",
        timestampMs: 0,
        context: context,
        deviceID: "schema-check",
        decision: decision
    )
    return event.schema == BridgeProtocol.schema
}
