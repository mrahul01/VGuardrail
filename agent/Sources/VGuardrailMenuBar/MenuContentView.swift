// The menu bar popover content.

import SwiftUI
import VGCore

struct MenuContentView: View {
    @Bindable var model: AgentViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            Divider()
            statusRows
            Divider()
            decisionsList
            Divider()
            footer
        }
        .padding(12)
        .frame(width: 320)
        .task { await model.refresh() }
    }

    private var header: some View {
        HStack {
            Image(systemName: "shield.lefthalf.filled")
            Text("VGuardrail").font(.headline)
            Spacer()
            if let v = model.status?.agentVersion { Text("v\(v)").foregroundStyle(.secondary).font(.caption) }
        }
    }

    @ViewBuilder
    private var statusRows: some View {
        if let status = model.status {
            row("Engine", status.engineServing ? "serving" : "not serving",
                ok: status.engineServing)
            row("Connection", status.engineConnected ? "connected" : "disconnected",
                ok: status.engineConnected)
            row("Policy version", "\(status.activePolicyVersion)", ok: status.activePolicyVersion > 0)
            row("Queued events", "\(status.queuedEvents)", ok: status.queuedEvents == 0)
            if let outcome = status.lastUploadOutcome {
                row("Last upload", outcome, ok: outcome == "success")
            }
        } else if let err = model.lastError {
            Text(err).foregroundStyle(.red).font(.caption)
        } else {
            ProgressView().controlSize(.small)
        }
    }

    private var decisionsList: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Recent decisions").font(.caption).foregroundStyle(.secondary)
            if model.decisions.isEmpty {
                Text("none yet").font(.caption2).foregroundStyle(.secondary)
            } else {
                ForEach(model.decisions.prefix(8), id: \.requestID) { d in
                    HStack {
                        Circle().fill(color(for: d.action)).frame(width: 8, height: 8)
                        Text(d.action.rawValue.uppercased()).font(.caption2).bold()
                        Text(d.provider ?? d.app ?? "—").font(.caption2).foregroundStyle(.secondary)
                        Spacer()
                        Text(d.riskLevel.rawValue).font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private var footer: some View {
        HStack {
            Button(model.busy ? "Sending…" : "Send test prompt") {
                Task { await model.sendTestPrompt() }
            }
            .disabled(model.busy)
            Spacer()
            Button("Refresh") { Task { await model.refresh() } }
            Button("Quit") { NSApplication.shared.terminate(nil) }
        }
        .font(.caption)
    }

    private func row(_ label: String, _ value: String, ok: Bool) -> some View {
        HStack {
            Text(label).font(.caption)
            Spacer()
            Text(value).font(.caption).foregroundStyle(ok ? Color.primary : Color.orange)
        }
    }

    private func color(for action: Action) -> Color {
        switch action {
        case .allow: return .green
        case .warn: return .orange
        case .block: return .red
        }
    }
}
