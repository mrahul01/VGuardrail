//! `GET /admin/violations`, `GET /admin/audit`, `GET /admin/audit/{id}`, and
//! `GET /admin/audit/{id}/chain`.

use std::sync::Arc;

use app::{
    handle_admin_audit_chain, handle_admin_audit_detail, handle_admin_audit_list,
    handle_admin_audit_violation_list,
};
use aws_adapters::DynamoDevices;
use functions::{admin_request_context, error_response, init_tracing, json_response, AppCtx};
use lambda_http::{run, service_fn, Body, Error, Request, Response};

#[tokio::main]
async fn main() -> Result<(), Error> {
    init_tracing();
    let ctx = Arc::new(AppCtx::load().await.map_err(Error::from)?);
    run(service_fn(move |req| {
        let ctx = ctx.clone();
        async move { handler(req, ctx).await }
    }))
    .await
}

fn event_id_from_path(path: &str) -> Option<String> {
    let parts: Vec<&str> = path.trim_matches('/').split('/').collect();
    match parts.as_slice() {
        ["admin", "audit", event_id] => Some((*event_id).to_string()),
        ["admin", "audit", event_id, "chain"] => Some((*event_id).to_string()),
        ["admin", "violations", event_id] => Some((*event_id).to_string()),
        _ => None,
    }
}

async fn handler(req: Request, ctx: Arc<AppCtx>) -> Result<Response<Body>, Error> {
    let rc = match admin_request_context(&req) {
        Ok(rc) => rc,
        Err(e) => return Ok(error_response(&e, None)),
    };
    if !matches!(
        rc.role.as_str(),
        "super_admin" | "org_admin" | "auditor" | "viewer"
    ) {
        return Ok(error_response(
            &audit_core::ApiError::Unauthorized("invalid role".into()),
            None,
        ));
    }
    let repo = DynamoDevices::new(ctx.clients.dynamodb.clone(), ctx.config.audit_table.clone());
    let path = req.uri().path();
    match req.method().as_str() {
        "GET" if path == "/admin/violations" => {
            let query = parse_query(req.uri().query().unwrap_or(""));
            match handle_admin_audit_violation_list(&repo, &rc.org_id, query).await {
                Ok(resp) => Ok(json_response(200, &resp)),
                Err(e) => Ok(error_response(&e, None)),
            }
        }
        "GET" if path == "/admin/audit" => {
            let query = parse_query(req.uri().query().unwrap_or(""));
            match handle_admin_audit_list(&repo, &rc.org_id, query).await {
                Ok(resp) => Ok(json_response(200, &resp)),
                Err(e) => Ok(error_response(&e, None)),
            }
        }
        "GET" if path.ends_with("/chain") => {
            let Some(event_id) = event_id_from_path(path) else {
                return Ok(error_response(
                    &audit_core::ApiError::BadRequest("invalid audit path".into()),
                    None,
                ));
            };
            let query = req.uri().query().unwrap_or("");
            let offset = query_arg(query, "offset").unwrap_or(0).max(0) as u64;
            let max_events = query_arg(query, "max_events").unwrap_or(100).max(1) as u64;
            match handle_admin_audit_chain(&repo, &rc.org_id, &event_id, None, offset, max_events)
                .await
            {
                Ok(resp) => Ok(json_response(200, &resp)),
                Err(e) => Ok(error_response(&e, None)),
            }
        }
        "GET" => {
            let Some(event_id) = event_id_from_path(path) else {
                return Ok(error_response(
                    &audit_core::ApiError::BadRequest("invalid audit path".into()),
                    None,
                ));
            };
            let viewer = rc.role == "viewer";
            match handle_admin_audit_detail(&repo, &rc.org_id, &event_id, viewer).await {
                Ok(resp) => Ok(json_response(200, &resp)),
                Err(e) => Ok(error_response(&e, None)),
            }
        }
        _ => Ok(error_response(
            &audit_core::ApiError::BadRequest("unsupported method".into()),
            None,
        )),
    }
}

fn parse_query(raw: &str) -> app::AdminSearchQuery {
    let mut q = app::AdminSearchQuery {
        page: 1,
        per_page: 25,
        date_from_ms: None,
        date_to_ms: None,
        decision: None,
        risk_level: None,
        user_id: None,
        category: None,
        device_id: None,
        search: None,
    };
    q.page = query_arg(raw, "page").unwrap_or(1).max(1) as u64;
    q.per_page = query_arg(raw, "per_page").unwrap_or(25).max(1) as u64;
    q.date_from_ms = query_arg(raw, "date_from");
    q.date_to_ms = query_arg(raw, "date_to");
    q.decision = query_str(raw, "decision");
    q.risk_level = query_str(raw, "risk_level");
    q.user_id = query_str(raw, "user_id");
    q.category = query_str(raw, "category");
    q.device_id = query_str(raw, "device_id");
    q.search = query_str(raw, "search");
    q
}

fn query_arg(raw: &str, key: &str) -> Option<i64> {
    query_str(raw, key)?.parse().ok()
}

fn query_str(raw: &str, key: &str) -> Option<String> {
    for part in raw.split('&').filter(|s| !s.is_empty()) {
        let mut kv = part.splitn(2, '=');
        let k = kv.next().unwrap_or_default();
        let v = kv.next().unwrap_or_default();
        if k == key {
            return Some(v.to_string());
        }
    }
    None
}
