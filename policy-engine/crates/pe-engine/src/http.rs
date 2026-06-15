//! Minimal blocking HTTP/1.1 JSON POST shared by the optional classifier
//! clients ([`crate::llm`], [`crate::code_classifier`]).
//!
//! Deliberately not a full HTTP client: one bounded request to a local
//! sidecar, connect/read/write timeouts, 64 KiB response cap, fail-open
//! (`None`) on any error. No TLS — these endpoints are loopback services.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

/// POSTs `body` (JSON) to `http://{endpoint}{path}` and returns the parsed
/// JSON response body. Any transport, protocol, or parse failure → `None`.
#[must_use]
pub fn post_json(
    endpoint: &str,
    path: &str,
    body: &str,
    timeout: Duration,
) -> Option<serde_json::Value> {
    let request = format!(
        "POST {path} HTTP/1.1\r\nHost: {endpoint}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len(),
    );

    let addr = endpoint.parse().ok()?;
    let mut stream = TcpStream::connect_timeout(&addr, timeout).ok()?;
    stream.set_read_timeout(Some(timeout)).ok()?;
    stream.set_write_timeout(Some(timeout)).ok()?;
    stream.write_all(request.as_bytes()).ok()?;

    let mut response = Vec::new();
    // Connection: close → read to EOF, bounded by the read timeout.
    let _ = stream.take(64 * 1024).read_to_end(&mut response);
    let response = String::from_utf8_lossy(&response);
    let json_start = response.find("\r\n\r\n").map(|i| i + 4)?;
    let payload = response[json_start..].trim();
    // Tolerate chunked encoding / trailing noise: parse the outermost JSON
    // value (object or array) by brace trimming.
    let (open, close) = match payload.find(['{', '[']) {
        Some(i) if payload.as_bytes()[i] == b'{' => (i, payload.rfind('}')?),
        Some(i) => (i, payload.rfind(']')?),
        None => return None,
    };
    serde_json::from_str(&payload[open..=close]).ok()
}
