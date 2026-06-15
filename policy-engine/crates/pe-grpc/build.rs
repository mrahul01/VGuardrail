//! Compiles the gRPC contract into Rust (tonic client + server) at build time.

fn main() -> Result<(), Box<dyn std::error::Error>> {
    tonic_build::configure()
        .build_client(true)
        .build_server(true)
        .compile(&["proto/policy_engine/v1/policy_engine.proto"], &["proto"])?;
    println!("cargo:rerun-if-changed=proto/policy_engine/v1/policy_engine.proto");
    Ok(())
}
