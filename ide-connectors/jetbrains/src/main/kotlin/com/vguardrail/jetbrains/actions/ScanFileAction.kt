// "Scan Current File with VGuardrail" — Tools menu + editor popup. Scans the
// active editor's full text against the policy engine. Mirrors the VS Code
// connector's passive-scanner cap: documents over 256 KiB are skipped with a
// notification instead of being scanned. Fail-closed like every scan path
// (the service returns a synthetic BLOCK when the engine is unreachable).

package com.vguardrail.jetbrains.actions

import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.components.service
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.project.DumbAware
import com.vguardrail.jetbrains.history.DecisionHistoryService
import com.vguardrail.jetbrains.model.Decision
import com.vguardrail.jetbrains.services.VGuardrailService
import com.vguardrail.jetbrains.ui.DecisionNotifier

class ScanFileAction : AnAction(), DumbAware {

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible =
            e.project != null && e.getData(CommonDataKeys.EDITOR) != null
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        val file = e.getData(CommonDataKeys.VIRTUAL_FILE)

        val text = editor.document.text
        if (text.isBlank()) {
            DecisionNotifier.info(project, "VGuardrail", "Nothing to scan — the file is empty.")
            return
        }
        if (text.toByteArray(Charsets.UTF_8).size > MAX_FILE_BYTES) {
            DecisionNotifier.info(
                project,
                "VGuardrail: scan skipped",
                "This file exceeds the 256 KiB scan cap — select a smaller region and use " +
                    "“Scan Prompt with VGuardrail” instead.",
            )
            return
        }

        val decision = ProgressManager.getInstance()
            .runProcessWithProgressSynchronously<Decision, RuntimeException>(
                { project.service<VGuardrailService>().scan(text, file) },
                "Scanning file with VGuardrail",
                false,
                project,
            )
        project.service<DecisionHistoryService>().record("file", decision)
        DecisionNotifier.show(project, decision)
    }

    companion object {
        /** Same cap as the VS Code connector's passive scanner (256 KiB). */
        const val MAX_FILE_BYTES = 256 * 1024
    }
}
