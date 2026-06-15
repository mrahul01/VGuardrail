// Renders engine decisions as IDE notifications:
//   allow → information balloon
//   warn  → tiered by risk level (Decision.warnTier): high/critical is an
//           error balloon with no actions (locally escalated block, auto-
//           rejected), medium/unknown keeps the "Acknowledge & Proceed" /
//           "Cancel" actions, low is a passive warning balloon (auto-accepted);
//           the outcome is reported back as WarningAccepted/WarningRejected
//   block → error balloon with the reason and the findings' category list;
//           an engine-down fallback gets the explicit unavailable message.

package com.vguardrail.jetbrains.ui

import com.intellij.notification.NotificationAction
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.vguardrail.jetbrains.model.Decision
import com.vguardrail.jetbrains.model.Verdict
import com.vguardrail.jetbrains.model.WarnTier
import com.vguardrail.jetbrains.services.VGuardrailService

object DecisionNotifier {
    private const val GROUP_ID = "VGuardrail"
    const val ENGINE_UNAVAILABLE_MESSAGE = "VGuardrail: policy engine unavailable — prompt blocked"

    fun show(project: Project, decision: Decision) {
        when (decision.verdict()) {
            Verdict.ALLOW -> notify(
                project,
                NotificationType.INFORMATION,
                "VGuardrail: prompt allowed",
                decision.reason.orEmpty().ifBlank { "No policy findings — safe to send." },
            )
            Verdict.WARN -> showWarn(project, decision)
            Verdict.BLOCK -> notify(
                project,
                NotificationType.ERROR,
                "VGuardrail: prompt blocked",
                if (decision.fromFallback) ENGINE_UNAVAILABLE_MESSAGE
                else withCategories(decision.reason ?: "Rejected by policy.", decision),
            )
        }
    }

    private fun showWarn(project: Project, decision: Decision) {
        when (decision.warnTier()) {
            WarnTier.BLOCK -> {
                notify(
                    project,
                    NotificationType.ERROR,
                    "VGuardrail: blocked (high risk)",
                    withCategories(decision.reason ?: "Rejected by policy.", decision),
                )
                decision.requestId?.let { acknowledgeAsync(project, it, accepted = false) }
            }
            WarnTier.NOTICE -> {
                notify(
                    project,
                    NotificationType.WARNING,
                    "VGuardrail: policy warning",
                    withCategories(decision.reason ?: "Policy warning.", decision),
                )
                decision.requestId?.let { acknowledgeAsync(project, it, accepted = true) }
            }
            WarnTier.PROMPT -> showWarnPrompt(project, decision)
        }
    }

    private fun showWarnPrompt(project: Project, decision: Decision) {
        val notification = NotificationGroupManager.getInstance()
            .getNotificationGroup(GROUP_ID)
            .createNotification(
                "VGuardrail: policy warning",
                withCategories(decision.reason ?: "Policy warning.", decision),
                NotificationType.WARNING,
            )
        val eventId = decision.requestId
        if (eventId != null) {
            notification.addAction(NotificationAction.createSimpleExpiring("Acknowledge & Proceed") {
                acknowledgeAsync(project, eventId, accepted = true)
                notify(
                    project,
                    NotificationType.INFORMATION,
                    "VGuardrail",
                    "Warning acknowledged — you may proceed with the prompt.",
                )
            })
            notification.addAction(NotificationAction.createSimpleExpiring("Cancel") {
                acknowledgeAsync(project, eventId, accepted = false)
            })
        }
        notification.notify(project)
    }

    private fun acknowledgeAsync(project: Project, eventId: String, accepted: Boolean) {
        // Audit bookkeeping over the bridge — never on the EDT, never fatal.
        ApplicationManager.getApplication().executeOnPooledThread {
            project.service<VGuardrailService>().acknowledge(eventId, accepted)
        }
    }

    /** Plain informational balloon (e.g. "scan skipped" notices from actions). */
    fun info(project: Project, title: String, content: String) {
        notify(project, NotificationType.INFORMATION, title, content)
    }

    private fun withCategories(reason: String, decision: Decision): String {
        val categories = decision.categoryLabels()
        return if (categories.isEmpty()) reason else "$reason [${categories.joinToString(", ")}]"
    }

    private fun notify(project: Project, type: NotificationType, title: String, content: String) {
        NotificationGroupManager.getInstance()
            .getNotificationGroup(GROUP_ID)
            .createNotification(title, content, type)
            .notify(project)
    }
}
