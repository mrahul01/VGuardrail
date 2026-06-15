// Persistent application-level settings: where Node and the bridge script
// live. Stored in vguardrail.xml under the IDE's config directory.

package com.vguardrail.jetbrains.settings

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage

@State(name = "VGuardrailSettings", storages = [Storage("vguardrail.xml")])
@Service(Service.Level.APP)
class VGuardrailSettings : PersistentStateComponent<VGuardrailSettings.State> {

    class State {
        /** Node ≥ 20 executable; absolute path recommended on macOS. */
        var nodePath: String = "node"

        /**
         * The bridge entry point. Relative paths resolve against the project
         * root, so the default works when the VGuardrail monorepo is open.
         */
        var bridgePath: String = DEFAULT_BRIDGE_PATH
    }

    private var current = State()

    override fun getState(): State = current

    override fun loadState(state: State) {
        current = state
    }

    companion object {
        const val DEFAULT_BRIDGE_PATH = "ide-connectors/jetbrains/bridge/dist/index.js"

        fun getInstance(): VGuardrailSettings =
            ApplicationManager.getApplication().getService(VGuardrailSettings::class.java)
    }
}
