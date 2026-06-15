// Startup check: verify the Node bridge is invocable and tell the user how to
// fix it when it is not. Purely informational — enforcement stays fail-closed
// regardless (a missing bridge means every scan BLOCKs).

package com.vguardrail.jetbrains.startup

import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity
import com.vguardrail.jetbrains.bridge.BridgeLocator

class BridgeAvailabilityActivity : ProjectActivity {

    override suspend fun execute(project: Project) {
        val problems = BridgeLocator.diagnose(project)
        if (problems.isEmpty()) {
            LOG.info("VGuardrail bridge is available")
            return
        }
        NotificationGroupManager.getInstance()
            .getNotificationGroup("VGuardrail")
            .createNotification(
                "VGuardrail bridge not available",
                problems.joinToString(" ") +
                    " Scans will fail closed (BLOCK) until this is fixed — " +
                    "configure paths under Settings → Tools → VGuardrail.",
                NotificationType.WARNING,
            )
            .notify(project)
    }

    companion object {
        private val LOG = logger<BridgeAvailabilityActivity>()
    }
}
