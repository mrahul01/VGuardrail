// "VGuardrail" tool window — a read-only list of the project's recent scan
// decisions (newest first), fed by DecisionHistoryService. Each row shows the
// local time, an action badge (ALLOW/WARN/BLOCK), the findings' category
// labels, and a truncated reason. Purely observational: enforcement decisions
// are rendered by DecisionNotifier; this window is the audit trail view.

package com.vguardrail.jetbrains.toolwindow

import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.ColoredListCellRenderer
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.content.ContentFactory
import com.vguardrail.jetbrains.history.DecisionHistoryService
import com.vguardrail.jetbrains.model.Verdict
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import javax.swing.DefaultListModel
import javax.swing.JList
import javax.swing.ListSelectionModel

class VGuardrailToolWindowFactory : ToolWindowFactory, DumbAware {

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val history = project.service<DecisionHistoryService>()

        val model = DefaultListModel<DecisionHistoryService.Entry>()
        val list = JBList(model).apply {
            selectionMode = ListSelectionModel.SINGLE_SELECTION
            emptyText.text = "No decisions yet — run “Scan Prompt with VGuardrail” or “Scan Current File with VGuardrail”."
            cellRenderer = EntryRenderer()
        }

        fun render(entries: List<DecisionHistoryService.Entry>) {
            model.clear()
            // Newest first for the view; the service stores newest-last.
            for (entry in entries.asReversed()) model.addElement(entry)
        }
        render(history.snapshot())

        val listener = DecisionHistoryService.Listener { entries ->
            ApplicationManager.getApplication().invokeLater {
                if (!project.isDisposed) render(entries)
            }
        }
        history.addListener(listener)

        val content = ContentFactory.getInstance().createContent(JBScrollPane(list), "", false)
        content.setDisposer(Disposable { history.removeListener(listener) })
        toolWindow.contentManager.addContent(content)
    }

    /** time · badge · categories · truncated reason. */
    private class EntryRenderer : ColoredListCellRenderer<DecisionHistoryService.Entry>() {
        override fun customizeCellRenderer(
            list: JList<out DecisionHistoryService.Entry>,
            value: DecisionHistoryService.Entry,
            index: Int,
            selected: Boolean,
            hasFocus: Boolean,
        ) {
            append(TIME_FORMAT.format(value.at), SimpleTextAttributes.GRAYED_ATTRIBUTES)
            append("  ")
            append(badgeText(value), badgeAttributes(value.verdict))
            append("  ")
            if (value.categories.isNotEmpty()) {
                append(value.categories.joinToString(", "), SimpleTextAttributes.REGULAR_BOLD_ATTRIBUTES)
                append("  ")
            }
            if (value.reason.isNotBlank()) {
                append("— ${truncate(value.reason)}", SimpleTextAttributes.GRAYED_ATTRIBUTES)
            }
        }

        private fun badgeText(entry: DecisionHistoryService.Entry): String {
            val verdict = if (entry.fromFallback) "BLOCK (engine down)" else entry.verdict.name
            return "[$verdict · ${entry.origin}]"
        }

        private fun badgeAttributes(verdict: Verdict): SimpleTextAttributes = when (verdict) {
            Verdict.ALLOW -> SimpleTextAttributes.REGULAR_ATTRIBUTES
            Verdict.WARN -> SimpleTextAttributes.ERROR_ATTRIBUTES
            Verdict.BLOCK -> SimpleTextAttributes.ERROR_ATTRIBUTES
        }

        private fun truncate(reason: String): String =
            if (reason.length <= MAX_REASON_CHARS) reason
            else reason.take(MAX_REASON_CHARS - 1) + "…"

        companion object {
            private const val MAX_REASON_CHARS = 120
            private val TIME_FORMAT: DateTimeFormatter =
                DateTimeFormatter.ofPattern("HH:mm:ss").withZone(ZoneId.systemDefault())
        }
    }
}
