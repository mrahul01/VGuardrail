// "Scan Prompt with VGuardrail" — editor popup + Tools menu + ⌘⇧G. Takes the
// editor selection when present, otherwise prompts for text, evaluates it via
// the project service under a progress indicator, and renders the decision.

package com.vguardrail.jetbrains.actions

import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.components.service
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.ui.Messages
import com.vguardrail.jetbrains.history.DecisionHistoryService
import com.vguardrail.jetbrains.model.Decision
import com.vguardrail.jetbrains.services.VGuardrailService
import com.vguardrail.jetbrains.ui.DecisionNotifier

class ScanPromptAction : AnAction(), DumbAware {

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = e.project != null
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val editor = e.getData(CommonDataKeys.EDITOR)
        val file = e.getData(CommonDataKeys.VIRTUAL_FILE)

        val selection = editor?.selectionModel?.selectedText
        val text = if (!selection.isNullOrBlank()) {
            selection
        } else {
            Messages.showMultilineInputDialog(
                project,
                "Prompt to scan before sending to an AI provider:",
                "Scan Prompt with VGuardrail",
                null,
                Messages.getQuestionIcon(),
                null,
            )
        }
        if (text.isNullOrBlank()) return

        val decision = ProgressManager.getInstance()
            .runProcessWithProgressSynchronously<Decision, RuntimeException>(
                { project.service<VGuardrailService>().scan(text, file) },
                "Scanning with VGuardrail",
                false,
                project,
            )
        project.service<DecisionHistoryService>().record("prompt", decision)
        DecisionNotifier.show(project, decision)
    }
}
