//! `/admin/audit` and `/admin/violations` — org-scoped audit search,
//! single-event detail, and bounded chain verification.

use std::sync::Mutex;

use app::{handle_admin_audit_chain, handle_admin_audit_detail, handle_admin_audit_list,
    handle_admin_audit_violation_list};
use app::AdminSearchQuery;
use aws_adapters::DynamoDevices;
use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    middleware,
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::auth::require_admin_mw;
use crate::error::ApiErrorResponse;
use crate::request_ctx::AdminRequestContext;
use crate::state::AppState;

// ── In-memory audit store for dev mode ───────────────────────────────
// When VG_DEV_CLAIMS=1, scans record audit events here so the dashboard
// can query them without DynamoDB.

#[derive(Debug, Clone, Serialize)]
pub struct DevAuditEvent {
    pub event_id: String,
    pub org_id: String,
    pub device_id: String,
    pub timestamp_ms: i64,
    pub event_type: String,
    pub severity: String,
    pub action: String,
    pub risk_level: String,
    pub category: Option<String>,
    pub reason: Option<String>,
    pub details: serde_json::Value,
}

static DEV_AUDIT_STORE: Mutex<Vec<DevAuditEvent>> = Mutex::new(Vec::new());

/// Record an audit event in the in-memory store (dev mode).
pub fn record_dev_audit(event: DevAuditEvent) {
    if let Ok(mut store) = DEV_AUDIT_STORE.lock() {
        store.push(event);
        // Keep only last 1000 events
        if store.len() > 1000 {
            store.remove(0);
        }
    }
}

/// Check whether we're in dev mode.
fn is_dev_mode() -> bool {
    std::env::var("VG_DEV_CLAIMS").is_ok()
}

pub fn router(state: AppState) -> Router<AppState> {
    // NOTE: axum 0.7 path-param syntax is `/:id`; `{id}` braces are axum 0.8
    // and silently never match (the route becomes a literal segment).
    Router::new()
        .route("/admin/violations", get(violations))
        .route("/admin/audit", get(audit_list))
        .route("/admin/audit/:id", get(audit_detail))
        .route("/admin/audit/:id/chain", get(audit_chain))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_admin_mw))
}

#[derive(Debug, Deserialize, Default)]
pub(crate) struct ListArgs {
    pub(crate) page: Option<u64>,
    pub(crate) per_page: Option<u64>,
    pub(crate) date_from_ms: Option<i64>,
    pub(crate) date_to_ms: Option<i64>,
    pub(crate) decision: Option<String>,
    pub(crate) risk_level: Option<String>,
    pub(crate) user_id: Option<String>,
    pub(crate) category: Option<String>,
    pub(crate) device_id: Option<String>,
    pub(crate) search: Option<String>,
}

impl From<ListArgs> for AdminSearchQuery {
    fn from(a: ListArgs) -> Self {
        Self {
            page: a.page.unwrap_or(1).max(1),
            per_page: a.per_page.unwrap_or(25).clamp(1, 100),
            date_from_ms: a.date_from_ms,
            date_to_ms: a.date_to_ms,
            decision: a.decision,
            risk_level: a.risk_level,
            user_id: a.user_id,
            category: a.category,
            device_id: a.device_id,
            search: a.search,
        }
    }
}

/// Dev-store filter shared by the audit/violation list endpoints and the
/// per-device events endpoint on `/admin/devices/:id/events`.
fn dev_event_matches(e: &DevAuditEvent, args: &ListArgs) -> bool {
    args.category.as_ref().is_none_or(|c| e.category.as_ref() == Some(c))
        && args.device_id.as_ref().is_none_or(|d| &e.device_id == d)
        && args.decision.as_ref().is_none_or(|d| &e.action == d)
        && args.search.as_ref().is_none_or(|text| {
            let needle = text.to_lowercase();
            e.device_id.to_lowercase().contains(&needle)
                || e.event_id.to_lowercase().contains(&needle)
                || e.reason
                    .as_deref()
                    .is_some_and(|r| r.to_lowercase().contains(&needle))
                || e.category
                    .as_deref()
                    .is_some_and(|c| c.to_lowercase().contains(&needle))
        })
}

/// Paginated JSON page over the dev audit store, newest first.
/// `severity_floor` restricts to high/critical (the violations view).
pub(crate) fn dev_audit_page(
    args: &ListArgs,
    org_id: Option<&str>,
    severity_floor: bool,
) -> serde_json::Value {
    let events = DEV_AUDIT_STORE.lock().unwrap();
    let mut filtered: Vec<&DevAuditEvent> = events
        .iter()
        .filter(|e| org_id.is_none_or(|org| e.org_id == org))
        .filter(|e| !severity_floor || e.severity == "high" || e.severity == "critical")
        .filter(|e| dev_event_matches(e, args))
        .collect();
    filtered.reverse(); // newest first
    let page = args.page.unwrap_or(1).max(1);
    let per_page = args.per_page.unwrap_or(25).clamp(1, 100);
    let start = ((page - 1) * per_page) as usize;
    let items: Vec<_> = filtered
        .iter()
        .skip(start)
        .take(per_page as usize)
        .map(|e| {
            json!({
                "event_id": e.event_id,
                "device_id": e.device_id,
                "timestamp_ms": e.timestamp_ms,
                "decision": e.action,
                "risk_level": e.risk_level,
                "event_type": e.event_type,
                "category": e.category,
                "reason": e.reason,
            })
        })
        .collect();
    json!({
        "items": items,
        "total": filtered.len(),
        "page": page,
        "per_page": per_page,
        "next_token": null,
    })
}

#[derive(Debug, Deserialize, Default)]
struct ChainArgs {
    offset: Option<u64>,
    max_events: Option<u64>,
}

fn repo(state: &AppState) -> DynamoDevices {
    DynamoDevices::new(
        state.dynamodb().clone(),
        state.resource.audit_table.clone(),
    )
}

async fn violations(
    State(state): State<AppState>,
    Extension(ctx): Extension<AdminRequestContext>,
    Query(args): Query<ListArgs>,
) -> Response {
    if !ctx.can_read() {
        return ApiErrorResponse::from_api(
            &audit_core::ApiError::Unauthorized("invalid role".into()),
            None,
        )
        .into_response();
    }

    // Dev mode: return in-memory audit events filtered by severity
    if is_dev_mode() {
        return (StatusCode::OK, Json(dev_audit_page(&args, None, true))).into_response();
    }

    let query: AdminSearchQuery = args.into();
    match handle_admin_audit_violation_list(&repo(&state), &ctx.org_id, query).await {
        Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
        Err(e) => ApiErrorResponse::from_api(&e, None).into_response(),
    }
}

async fn audit_list(
    State(state): State<AppState>,
    Extension(ctx): Extension<AdminRequestContext>,
    Query(args): Query<ListArgs>,
) -> Response {
    if !ctx.can_read() {
        return ApiErrorResponse::from_api(
            &audit_core::ApiError::Unauthorized("invalid role".into()),
            None,
        )
        .into_response();
    }

    // Dev mode: return in-memory audit events
    if is_dev_mode() {
        return (
            StatusCode::OK,
            Json(dev_audit_page(&args, Some(&ctx.org_id), false)),
        )
            .into_response();
    }

    let query: AdminSearchQuery = args.into();
    match handle_admin_audit_list(&repo(&state), &ctx.org_id, query).await {
        Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
        Err(e) => ApiErrorResponse::from_api(&e, None).into_response(),
    }
}

async fn audit_detail(
    State(state): State<AppState>,
    Extension(ctx): Extension<AdminRequestContext>,
    Path(event_id): Path<String>,
) -> Response {
    if !ctx.can_read() {
        return ApiErrorResponse::from_api(
            &audit_core::ApiError::Unauthorized("invalid role".into()),
            None,
        )
        .into_response();
    }

    // Dev mode: find event in memory. Match by event_id only — the dev list
    // endpoints above don't scope by org (scan-recorded events carry the
    // device's org, the dashboard session a dev-claims org), so an org check
    // here would 404 every row the list just showed.
    if is_dev_mode() {
        let events = DEV_AUDIT_STORE.lock().unwrap();
        if let Some(e) = events.iter().find(|e| e.event_id == event_id) {
            return (StatusCode::OK, Json(json!(e))).into_response();
        }
        return ApiErrorResponse::from_api(
            &audit_core::ApiError::NotFound("event not found".into()),
            None,
        ).into_response();
    }

    let viewer = ctx.role == "viewer";
    match handle_admin_audit_detail(&repo(&state), &ctx.org_id, &event_id, viewer).await {
        Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
        Err(e) => ApiErrorResponse::from_api(&e, None).into_response(),
    }
}

async fn audit_chain(
    State(state): State<AppState>,
    Extension(ctx): Extension<AdminRequestContext>,
    Path(event_id): Path<String>,
    Query(args): Query<ChainArgs>,
) -> Response {
    if !ctx.can_read() {
        return ApiErrorResponse::from_api(
            &audit_core::ApiError::Unauthorized("invalid role".into()),
            None,
        )
        .into_response();
    }

    // Dev mode: return empty chain
    if is_dev_mode() {
        return (StatusCode::OK, Json(json!({
            "events": [],
            "offset": args.offset.unwrap_or(0),
            "max_events": args.max_events.unwrap_or(100).clamp(1, 100),
        }))).into_response();
    }

    let offset = args.offset.unwrap_or(0);
    let max_events = args.max_events.unwrap_or(100).clamp(1, 100);
    match handle_admin_audit_chain(
        &repo(&state),
        &ctx.org_id,
        &event_id,
        None,
        offset,
        max_events,
    )
    .await
    {
        Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
        Err(e) => ApiErrorResponse::from_api(&e, None).into_response(),
    }
}
