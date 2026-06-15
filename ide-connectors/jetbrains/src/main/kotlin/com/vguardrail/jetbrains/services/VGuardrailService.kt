// Project service that evaluates prompts through the Node bridge
// (ide-connectors/jetbrains/bridge). One short-lived process per request:
// write one JSON line on stdin, read one JSON decision line from stdout with a
// 5-second deadline. Every failure path — missing node, missing bridge, spawn
// failure, timeout, unparseable reply — fails closed to BLOCK.

package com.vguardrail.jetbrains.services

import com.google.gson.Gson
import com.google.gson.JsonParseException
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.util.concurrency.AppExecutorUtil
import com.vguardrail.jetbrains.bridge.BridgeLocator
import com.vguardrail.jetbrains.bridge.BridgeRequest
import com.vguardrail.jetbrains.model.Decision
import com.vguardrail.jetbrains.settings.VGuardrailSettings
import java.nio.charset.StandardCharsets
import java.util.concurrent.Callable
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

@Service(Service.Level.PROJECT)
class VGuardrailService(private val project: Project) {

    /**
     * Scans a prompt with the local policy engine. Must be called off the EDT
     * (the action wraps it in a progress task). Never throws; never allows on
     * error.
     */
    fun scan(text: String, file: VirtualFile?): Decision {
        val request = BridgeRequest.scanLine(
            text = text,
            filePath = file?.path,
            fileExtension = file?.extension,
            repoName = project.name,
        )
        val reply = invokeBridge(request)
            ?: return Decision.failClosed("policy engine unavailable; fail-closed block")
        return Decision.parse(reply)
            ?: return Decision.failClosed("unparseable bridge reply; fail-closed block")
    }

    /**
     * Records the user's response to a WARN decision (WarningAccepted /
     * WarningRejected audit events). Best-effort: a failure never changes
     * enforcement.
     */
    fun acknowledge(eventId: String, accepted: Boolean): Boolean {
        val reply = invokeBridge(BridgeRequest.ackLine(eventId, accepted)) ?: return false
        return try {
            gson.fromJson(reply, AckReply::class.java)?.acknowledged == true
        } catch (_: JsonParseException) {
            false
        }
    }

    /** Spawns the bridge, performs the line exchange, returns null on any failure. */
    private fun invokeBridge(requestLine: String): String? {
        val state = VGuardrailSettings.getInstance().state
        val node = BridgeLocator.resolveNodePath(state.nodePath) ?: run {
            LOG.warn("VGuardrail: node executable not found (configured: ${state.nodePath})")
            return null
        }
        val bridge = BridgeLocator.resolveBridgePath(project, state.bridgePath) ?: run {
            LOG.warn("VGuardrail: bridge script not found (configured: ${state.bridgePath})")
            return null
        }

        return try {
            val process = ProcessBuilder(node.toString(), bridge.toString())
                .redirectErrorStream(false)
                .start()
            try {
                process.outputStream.bufferedWriter(StandardCharsets.UTF_8).use { writer ->
                    writer.write(requestLine)
                    writer.write("\n")
                }
                val pendingReply = AppExecutorUtil.getAppExecutorService().submit(
                    Callable<String?> {
                        process.inputStream.bufferedReader(StandardCharsets.UTF_8).readLine()
                    },
                )
                try {
                    pendingReply.get(BRIDGE_TIMEOUT_MS, TimeUnit.MILLISECONDS)
                } catch (_: TimeoutException) {
                    LOG.warn("VGuardrail: bridge timed out after ${BRIDGE_TIMEOUT_MS}ms")
                    pendingReply.cancel(true)
                    null
                }
            } finally {
                if (!process.waitFor(200, TimeUnit.MILLISECONDS)) {
                    process.destroyForcibly()
                }
            }
        } catch (e: Exception) {
            LOG.warn("VGuardrail: bridge invocation failed", e)
            null
        }
    }

    private data class AckReply(val acknowledged: Boolean = false)

    companion object {
        private val LOG = logger<VGuardrailService>()
        private val gson = Gson()
        private const val BRIDGE_TIMEOUT_MS = 5_000L
    }
}
