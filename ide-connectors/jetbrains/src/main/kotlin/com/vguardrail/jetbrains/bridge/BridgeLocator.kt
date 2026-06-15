// Resolves the Node executable and the bridge script from settings, and
// produces human-readable diagnostics for the startup availability check.
//
// macOS GUI apps usually launch without the user's shell PATH, so a bare
// "node" is additionally searched in the standard Homebrew/MacPorts install
// locations before giving up.

package com.vguardrail.jetbrains.bridge

import com.intellij.openapi.project.Project
import com.vguardrail.jetbrains.settings.VGuardrailSettings
import java.io.File
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths

object BridgeLocator {
    private val FALLBACK_BIN_DIRS = listOf("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin")

    /** Resolves the configured Node executable to an absolute path, or null. */
    fun resolveNodePath(configured: String): Path? {
        if (configured.isBlank()) return null
        val path = Paths.get(configured)
        if (path.isAbsolute) {
            return if (Files.isExecutable(path)) path else null
        }
        val searchDirs = (System.getenv("PATH")?.split(File.pathSeparator).orEmpty()) + FALLBACK_BIN_DIRS
        for (dir in searchDirs) {
            if (dir.isBlank()) continue
            val candidate = Paths.get(dir).resolve(configured)
            if (Files.isExecutable(candidate)) return candidate
        }
        return null
    }

    /**
     * Resolves the configured bridge script. Relative paths resolve against
     * the project root (the default assumes the VGuardrail monorepo is open).
     */
    fun resolveBridgePath(project: Project, configured: String): Path? {
        if (configured.isBlank()) return null
        val path = Paths.get(configured)
        val resolved = if (path.isAbsolute) {
            path
        } else {
            val base = project.basePath ?: return null
            Paths.get(base).resolve(path)
        }
        return if (Files.isRegularFile(resolved)) resolved else null
    }

    /** Empty when the bridge is invocable; otherwise actionable problem lines. */
    fun diagnose(project: Project): List<String> {
        val state = VGuardrailSettings.getInstance().state
        val problems = mutableListOf<String>()
        if (resolveNodePath(state.nodePath) == null) {
            problems += "Node executable not found (configured: \"${state.nodePath}\")."
        }
        if (resolveBridgePath(project, state.bridgePath) == null) {
            problems += "Bridge script not found (configured: \"${state.bridgePath}\") — " +
                "build it with `npm install && npm run build` in ide-connectors/jetbrains/bridge."
        }
        return problems
    }
}
