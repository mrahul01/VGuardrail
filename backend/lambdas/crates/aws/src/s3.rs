//! S3 adapter for the immutable audit archive (one object per batch, write-once
//! under the bucket's Object Lock retention).

use std::time::{SystemTime, UNIX_EPOCH};

use app::{ArchiveStore, StoreError};
use async_trait::async_trait;
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::Client;

/// Audit archive backed by an S3 bucket.
pub struct S3Archive {
    client: Client,
    bucket: String,
}

impl S3Archive {
    /// Builds the archive.
    pub fn new(client: Client, bucket: impl Into<String>) -> Self {
        Self {
            client,
            bucket: bucket.into(),
        }
    }
}

#[async_trait]
impl ArchiveStore for S3Archive {
    async fn put_raw(
        &self,
        org_id: &str,
        device_id: &str,
        upload_id: &str,
        body: &[u8],
    ) -> Result<String, StoreError> {
        let (year, month, day) = today_ymd();
        let key = format!(
            "org={org_id}/date={year:04}-{month:02}-{day:02}/device={device_id}/{upload_id}.json"
        );
        self.client
            .put_object()
            .bucket(&self.bucket)
            .key(&key)
            .body(ByteStream::from(body.to_vec()))
            .content_type("application/json")
            .send()
            .await
            .map_err(|e| StoreError::Backend(format!("s3 put_object: {e}")))?;
        Ok(key)
    }
}

/// Current UTC calendar date, derived without a date dependency
/// (Howard Hinnant's civil-from-days algorithm).
fn today_ymd() -> (i64, u32, u32) {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86_400);
    civil_from_days(days)
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::civil_from_days;

    #[test]
    fn civil_epoch_is_1970_01_01() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
    }

    #[test]
    fn civil_known_dates() {
        assert_eq!(civil_from_days(18_993), (2022, 1, 1)); // 2022-01-01
        assert_eq!(civil_from_days(20_454), (2026, 1, 1)); // 2026-01-01
    }
}
