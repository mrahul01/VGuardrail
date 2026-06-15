// Builds the single JSON request line written to the bridge's stdin. The
// shape matches ide-connectors/jetbrains/bridge/src/handler.ts: camelCase
// domain keys; the bridge fills in the user identity from
// ~/.vguardrail/connector.json.

package com.vguardrail.jetbrains.bridge

import com.google.gson.Gson

object BridgeRequest {
    private val gson = Gson()

    /** Scan request: {"text":…,"context":{source,app,repo?,file?}}. */
    fun scanLine(text: String, filePath: String?, fileExtension: String?, repoName: String?): String {
        val context = linkedMapOf<String, Any>(
            "source" to "ide",
            "app" to "jetbrains",
        )
        if (!repoName.isNullOrBlank()) {
            context["repo"] = mapOf("name" to repoName)
        }
        if (!filePath.isNullOrBlank()) {
            val file = linkedMapOf<String, Any>("path" to filePath)
            if (!fileExtension.isNullOrBlank()) file["fileExtension"] = fileExtension
            context["file"] = file
        }
        return gson.toJson(mapOf("text" to text, "context" to context))
    }

    /** Warn acknowledgement: {"acknowledge":{"eventId":…,"accepted":…}}. */
    fun ackLine(eventId: String, accepted: Boolean): String =
        gson.toJson(mapOf("acknowledge" to mapOf("eventId" to eventId, "accepted" to accepted)))
}
