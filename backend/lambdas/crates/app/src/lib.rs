//! # app
//!
//! Endpoint handler logic for the VGuardrail Audit Cloud, written against storage
//! and identity **ports** (traits) so it runs end-to-end with in-memory fakes —
//! no AWS required. AWS adapters live in the `aws-adapters` crate; the Lambda
//! binaries wire adapters to these handlers.
//!
//! The audit-ingestion handler implements the two integrity requirements:
//! a per-device tamper-evident **hash chain** and **idempotent** ingestion
//! (`upload_id` + `event_id`).
#![forbid(unsafe_code)]
#![warn(missing_docs)]

mod admin;
mod dto;
mod handlers;
mod ports;
pub mod testing;

pub use admin::{
    can_create_user, handle_admin_audit_chain, handle_admin_audit_detail, handle_admin_audit_list,
    handle_admin_audit_violation_list, handle_admin_device_delete, handle_admin_device_get,
    handle_admin_device_list, handle_admin_settings_get, handle_admin_settings_put,
    handle_admin_stats, handle_admin_user_create, handle_admin_user_delete, handle_admin_user_list,
    PageQuery as AdminPageQuery, SearchQuery as AdminSearchQuery,
};
pub use dto::{BatchRequest, BatchResponse, Health, RegisterRequest, RegisterResponse};
pub use handlers::{
    handle_events_batch, handle_health, handle_policy_latest, handle_register, PolicyOutcome,
    MAX_BATCH_BYTES, MAX_BATCH_EVENTS,
};
pub use ports::{
    AppendOutcome, ArchiveStore, AuditAdminRepository, AuditEventDetail, AuditEventSummary,
    AuditSearchQuery, AuditStore, BrowserExtension, CategoryCount, ChainHead, ChainSegment,
    DashboardAdminRepository, DashboardStats, DeviceAdminRepository, DeviceDetail, DeviceDirectory,
    DeviceIdentityIssuer, DeviceInventory, DeviceInventoryStore, DeviceProcess,
    DeviceRecord, DeviceSummary, EnrollmentVerifier, ExceptionAdminRepository, ExceptionDetail,
    ExceptionSummary, IdempotencyStore, OrgSettings, Page, PolicyAdminRepository, PolicyArtifact,
    PolicyDetail, PolicyPublishRequest, PolicyRepo, PolicySummary, RequestContext,
    SettingsAdminRepository, SettingsUpdateRequest, StoreError, Tokens, UploadRecord,
    UserAdminRepository, UserCreateRequest, UserIdentityAdmin, UserListQuery, UserSummary,
};
