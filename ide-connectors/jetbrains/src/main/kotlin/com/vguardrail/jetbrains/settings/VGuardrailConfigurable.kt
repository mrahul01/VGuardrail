// Settings panel (Settings → Tools → VGuardrail) for the bridge paths.

package com.vguardrail.jetbrains.settings

import com.intellij.openapi.options.BoundConfigurable
import com.intellij.openapi.ui.DialogPanel
import com.intellij.ui.dsl.builder.COLUMNS_LARGE
import com.intellij.ui.dsl.builder.bindText
import com.intellij.ui.dsl.builder.columns
import com.intellij.ui.dsl.builder.panel

class VGuardrailConfigurable : BoundConfigurable("VGuardrail") {

    override fun createPanel(): DialogPanel {
        val state = VGuardrailSettings.getInstance().state
        return panel {
            row("Node executable:") {
                textField()
                    .bindText(state::nodePath)
                    .columns(COLUMNS_LARGE)
                    .comment(
                        "Node ≥ 20. An absolute path (e.g. /opt/homebrew/bin/node) is recommended on macOS — " +
                            "GUI apps often launch without your shell PATH.",
                    )
            }
            row("Bridge script:") {
                textField()
                    .bindText(state::bridgePath)
                    .columns(COLUMNS_LARGE)
                    .comment(
                        "Path to ide-connectors/jetbrains/bridge/dist/index.js. " +
                            "Relative paths resolve against the project root.",
                    )
            }
        }
    }
}
