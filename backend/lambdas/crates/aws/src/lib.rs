//! # aws-adapters
//!
//! AWS implementations of the `app` ports for the VGuardrail Audit Cloud:
//! DynamoDB (audit store with atomic dedup + chain advance, idempotency records,
//! policy repo, device directory), S3 (immutable audit archive), Secrets Manager
//! (enrollment), and Cognito (device identity).
#![forbid(unsafe_code)]
#![warn(missing_docs)]

mod cognito;
mod config;
mod dynamo;
mod s3;
mod secrets;

pub use cognito::{CognitoIdentity, CognitoUserAdmin};
pub use config::{AwsClients, ResourceConfig};
pub use dynamo::{
    DynamoAuditStore, DynamoDevices, DynamoExceptions, DynamoIdempotency, DynamoPolicyRepo,
    DynamoSettings, DynamoUsers,
};
pub use s3::S3Archive;
pub use secrets::SecretsEnrollment;
