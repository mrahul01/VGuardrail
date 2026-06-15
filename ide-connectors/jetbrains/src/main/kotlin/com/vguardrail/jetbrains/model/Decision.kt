// Decision model parsed from the bridge's stdout line. Mirrors the camelCase
// domain shape of @vguardrail/connector-sdk's Decision, plus `fromFallback`
// provenance. All fields are nullable-with-defaults because the reply crosses
// a process boundary; `verdict()` normalizes anything unknown to BLOCK so the
// plugin stays fail-closed.

package com.vguardrail.jetbrains.model

import com.google.gson.Gson
import com.google.gson.JsonParseException

enum class Verdict { ALLOW, WARN, BLOCK }

/** How a WARN decision is enforced locally, derived from its risk level. */
enum class WarnTier { BLOCK, PROMPT, NOTICE }

data class Finding(
    val detectorId: String? = null,
    val category: String? = null,
    val kind: String? = null,
    val severity: String? = null,
    val redactedPreview: String? = null,
)

data class Decision(
    val requestId: String? = null,
    val action: String? = null,
    val riskLevel: String? = null,
    val classification: String? = null,
    val reason: String? = null,
    val findings: List<Finding>? = null,
    val policyVersion: Int = 0,
    val fromFallback: Boolean = false,
) {
    /** Normalized enforcement verdict — unknown/missing actions fail closed. */
    fun verdict(): Verdict = when (action) {
        "allow" -> Verdict.ALLOW
        "warn" -> Verdict.WARN
        else -> Verdict.BLOCK
    }

    /**
     * Local enforcement tier for a WARN verdict. High/critical warns are
     * escalated to a hard block with no proceed affordance — the server-side
     * warn plus this client-side gate is defense in depth, and the no-override
     * UX is a product requirement. Missing/unknown risk levels take the safe
     * middle: the interactive acknowledge flow.
     */
    fun warnTier(): WarnTier = when (riskLevel) {
        "critical", "high" -> WarnTier.BLOCK
        "low" -> WarnTier.NOTICE
        else -> WarnTier.PROMPT
    }

    /** Unique, order-preserving display labels for the findings' categories. */
    fun categoryLabels(): List<String> =
        (findings ?: emptyList())
            .mapNotNull { it.category }
            .distinct()
            .map { CATEGORY_LABELS[it] ?: it.replace('_', ' ') }

    companion object {
        private val gson = Gson()

        private val CATEGORY_LABELS = mapOf(
            "secret" to "Secrets & credentials",
            "pii" to "Personal data (PII)",
            "source_code" to "Source code",
            "company_confidential" to "Company confidential",
            "financial" to "Financial data",
            "intellectual_property" to "Intellectual property",
            "usage_policy" to "Usage policy",
            "prompt_injection" to "Prompt injection",
            "sensitive_document" to "Sensitive document",
            "customer_data" to "Customer data",
            "compliance" to "Compliance",
            "keyword" to "Watched keyword",
            "file_policy" to "File policy",
            "image_policy" to "Image policy",
            "ai_classification" to "AI classification",
            "classification" to "Data classification",
        )

        /** Parses one bridge reply line; null on malformed JSON (caller fails closed). */
        fun parse(json: String): Decision? = try {
            gson.fromJson(json, Decision::class.java)
        } catch (_: JsonParseException) {
            null
        }

        /** Synthetic fail-closed BLOCK used when the bridge cannot be consulted. */
        fun failClosed(reason: String): Decision =
            Decision(action = "block", reason = reason, fromFallback = true)
    }
}
