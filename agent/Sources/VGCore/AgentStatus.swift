// Status DTOs surfaced to the menu bar app over XPC.

import Foundation

/// A snapshot of agent + engine health for the menu bar UI.
public struct AgentStatus: Codable, Sendable, Equatable {
    /// Whether the engine reported SERVING on the last health check.
    public var engineServing: Bool
    /// Active policy version reported by the engine.
    public var activePolicyVersion: UInt32
    /// Number of events still owing upload in the local queue.
    public var queuedEvents: UInt64
    /// Outcome of the most recent upload batch, if any.
    public var lastUploadOutcome: String?
    /// Whether the agent currently has a live connection to the engine.
    public var engineConnected: Bool
    /// Agent version string.
    public var agentVersion: String

    public init(
        engineServing: Bool,
        activePolicyVersion: UInt32,
        queuedEvents: UInt64,
        lastUploadOutcome: String?,
        engineConnected: Bool,
        agentVersion: String
    ) {
        self.engineServing = engineServing
        self.activePolicyVersion = activePolicyVersion
        self.queuedEvents = queuedEvents
        self.lastUploadOutcome = lastUploadOutcome
        self.engineConnected = engineConnected
        self.agentVersion = agentVersion
    }
}

/// A compact recent-decision row for the menu bar list.
public struct DecisionSummary: Codable, Sendable, Equatable {
    public var requestID: String
    public var timestampMs: Int64
    public var action: Action
    public var riskLevel: RiskLevel
    public var matchedRuleID: String?
    public var provider: String?
    public var app: String?

    public init(
        requestID: String,
        timestampMs: Int64,
        action: Action,
        riskLevel: RiskLevel,
        matchedRuleID: String?,
        provider: String?,
        app: String?
    ) {
        self.requestID = requestID
        self.timestampMs = timestampMs
        self.action = action
        self.riskLevel = riskLevel
        self.matchedRuleID = matchedRuleID
        self.provider = provider
        self.app = app
    }
}
