//! Unix-domain-socket transport for the local engine (doc 03 §1, P-03).
//!
//! The socket is created with mode `0600` so only the daemon user can connect —
//! the primary local-access control. The engine binds it and serves the
//! tonic-generated [`crate::PolicyEngineServer`] over the returned stream.

use std::os::unix::fs::PermissionsExt;

use tokio::net::UnixListener;
use tokio_stream::wrappers::UnixListenerStream;

/// Binds a Unix domain socket at `path`, removing any stale socket first and
/// restricting it to `0600`. Returns a stream of incoming connections suitable
/// for `tonic::transport::Server::serve_with_incoming`.
///
/// # Errors
/// Returns an [`std::io::Error`] if binding or `chmod` fails.
pub fn bind_uds(path: &str) -> std::io::Result<UnixListenerStream> {
    // Remove a stale socket from a previous run (ENOENT is fine).
    match std::fs::remove_file(path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }
    let listener = UnixListener::bind(path)?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    Ok(UnixListenerStream::new(listener))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn bind_sets_0600_permissions() {
        let dir = std::env::temp_dir().join(format!("vg-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("policy.sock");
        let path_str = path.to_str().unwrap();

        let _stream = bind_uds(path_str).unwrap();
        let mode = std::fs::metadata(path_str).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);

        // Re-binding removes the stale socket and succeeds.
        let _stream2 = bind_uds(path_str).unwrap();

        std::fs::remove_file(path_str).ok();
        std::fs::remove_dir(&dir).ok();
    }
}
