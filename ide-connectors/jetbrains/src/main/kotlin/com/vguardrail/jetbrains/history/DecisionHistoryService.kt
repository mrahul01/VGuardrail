// Project-level, in-memory decision history backing the VGuardrail tool
// window. A fixed-capacity ring buffer (last 50 decisions) — nothing is
// persisted, nothing leaves the IDE. Every scan path (ScanPromptAction,
// ScanFileAction) appends here after the engine decides; listeners (the tool
// window panel) are notified with an immutable snapshot and are responsible
// for hopping to the EDT themselves.

package com.vguardrail.jetbrains.history

import com.intellij.openapi.components.Service
import com.vguardrail.jetbrains.model.Decision
import com.vguardrail.jetbrains.model.Verdict
import java.time.Instant
import java.util.concurrent.CopyOnWriteArrayList

@Service(Service.Level.PROJECT)
class DecisionHistoryService {

    /** One rendered row of history. Content is metadata only — never the scanned text. */
    data class Entry(
        val at: Instant,
        val verdict: Verdict,
        /** What was scanned: "prompt" (selection/dialog) or "file". */
        val origin: String,
        /** Display labels of the findings' categories (may be empty). */
        val categories: List<String>,
        val reason: String,
        /** True when the entry is a synthetic engine-unavailable block. */
        val fromFallback: Boolean,
    )

    fun interface Listener {
        /** Called on the recording thread with a newest-last snapshot. */
        fun historyChanged(entries: List<Entry>)
    }

    private val lock = Any()
    private val entries = ArrayDeque<Entry>(CAPACITY)
    private val listeners = CopyOnWriteArrayList<Listener>()

    /** Appends a decision (evicting the oldest beyond [CAPACITY]) and notifies listeners. */
    fun record(origin: String, decision: Decision) {
        val entry = Entry(
            at = Instant.now(),
            verdict = decision.verdict(),
            origin = origin,
            categories = decision.categoryLabels(),
            reason = decision.reason.orEmpty(),
            fromFallback = decision.fromFallback,
        )
        val snapshot: List<Entry>
        synchronized(lock) {
            if (entries.size >= CAPACITY) entries.removeFirst()
            entries.addLast(entry)
            snapshot = entries.toList()
        }
        for (listener in listeners) listener.historyChanged(snapshot)
    }

    /** Newest-last copy of the current history. */
    fun snapshot(): List<Entry> = synchronized(lock) { entries.toList() }

    fun addListener(listener: Listener) {
        listeners.add(listener)
    }

    fun removeListener(listener: Listener) {
        listeners.remove(listener)
    }

    companion object {
        const val CAPACITY = 50
    }
}
