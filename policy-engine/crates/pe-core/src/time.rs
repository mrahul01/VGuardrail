//! Time abstractions: an injectable [`Clock`] for timestamps/expiry and a
//! cooperative [`Budget`] for honouring the latency SLO.
//!
//! Evaluation *logic* never reads a clock directly; the engine injects the
//! current time (for exception expiry / event timestamps) and a deadline (for
//! detector cancellation), keeping decisions deterministic and testable.

use std::sync::atomic::{AtomicI64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// A source of wall-clock time, injected so it can be controlled in tests.
pub trait Clock: Send + Sync {
    /// Current time as Unix milliseconds.
    fn now_millis(&self) -> i64;
}

/// The real system clock.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_millis(&self) -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    }
}

/// A test/control clock whose time is set explicitly. Thread-safe.
#[derive(Debug, Default)]
pub struct ManualClock {
    now: AtomicI64,
}

impl ManualClock {
    /// Creates a clock fixed at `now_millis`.
    #[must_use]
    pub fn new(now_millis: i64) -> Self {
        Self {
            now: AtomicI64::new(now_millis),
        }
    }

    /// Sets the current time.
    pub fn set(&self, now_millis: i64) {
        self.now.store(now_millis, Ordering::SeqCst);
    }

    /// Advances the current time by `delta_millis`.
    pub fn advance(&self, delta_millis: i64) {
        self.now.fetch_add(delta_millis, Ordering::SeqCst);
    }
}

impl Clock for ManualClock {
    fn now_millis(&self) -> i64 {
        self.now.load(Ordering::SeqCst)
    }
}

/// A cooperative time budget passed to every detector. Detectors poll
/// [`Budget::is_exhausted`] and stop early when the deadline is reached.
#[derive(Debug, Clone, Copy)]
pub struct Budget {
    deadline: Option<Instant>,
}

impl Budget {
    /// An unbounded budget (used in tests and offline tooling).
    #[must_use]
    pub fn unlimited() -> Self {
        Self { deadline: None }
    }

    /// A budget expiring `millis` from now.
    #[must_use]
    pub fn from_millis(millis: u64) -> Self {
        Self {
            deadline: Instant::now().checked_add(Duration::from_millis(millis)),
        }
    }

    /// A budget expiring at a specific instant.
    #[must_use]
    pub fn with_deadline(deadline: Instant) -> Self {
        Self {
            deadline: Some(deadline),
        }
    }

    /// Whether the budget has been exhausted.
    #[must_use]
    pub fn is_exhausted(&self) -> bool {
        match self.deadline {
            Some(d) => Instant::now() >= d,
            None => false,
        }
    }

    /// Remaining time, if bounded and not yet exhausted.
    #[must_use]
    pub fn remaining(&self) -> Option<Duration> {
        self.deadline
            .map(|d| d.saturating_duration_since(Instant::now()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manual_clock_is_controllable() {
        let c = ManualClock::new(1_000);
        assert_eq!(c.now_millis(), 1_000);
        c.advance(500);
        assert_eq!(c.now_millis(), 1_500);
        c.set(42);
        assert_eq!(c.now_millis(), 42);
    }

    #[test]
    fn unlimited_budget_never_exhausts() {
        assert!(!Budget::unlimited().is_exhausted());
        assert!(Budget::unlimited().remaining().is_none());
    }

    #[test]
    fn expired_budget_is_exhausted() {
        let b = Budget::with_deadline(Instant::now() - Duration::from_millis(1));
        assert!(b.is_exhausted());
    }

    #[test]
    fn system_clock_is_positive() {
        assert!(SystemClock.now_millis() > 0);
    }
}
