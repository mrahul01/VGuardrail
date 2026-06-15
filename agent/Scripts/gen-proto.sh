#!/usr/bin/env bash
# Syncs the shared policy-engine gRPC contract into the VGGRPCClient target.
#
# The GRPCProtobufGenerator SwiftPM build plugin generates the Swift client from
# the synced .proto at build time, so there is no checked-in generated code. Run
# this whenever the engine's contract changes, then build with VG_GRPC=1.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/../policy-engine/crates/pe-grpc/proto/policy_engine/v1/policy_engine.proto"
DST="$ROOT/Sources/VGGRPCClient/policy_engine.proto"

if [[ ! -f "$SRC" ]]; then
    echo "error: engine proto not found at $SRC" >&2
    exit 1
fi

{
    echo "// SYNCED COPY — do not edit by hand."
    echo "// Source of truth: policy-engine/crates/pe-grpc/proto/policy_engine/v1/policy_engine.proto"
    echo "// Re-sync with Scripts/gen-proto.sh."
    cat "$SRC"
} > "$DST"

echo "synced proto -> $DST"
echo "build the gRPC client + daemon with:  VG_GRPC=1 swift build"
