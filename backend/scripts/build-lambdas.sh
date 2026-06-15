#!/usr/bin/env bash
# Builds the four Lambda functions for arm64 and zips them into
# lambdas/target/lambda-zips/<name>.zip (consumed by Terraform / LocalStack).
#
# Requires cargo-lambda (`cargo install cargo-lambda`) and zig for cross-compile.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/lambdas"

if ! cargo lambda --version >/dev/null 2>&1; then
    echo "error: cargo-lambda not installed. Run: cargo install cargo-lambda" >&2
    exit 1
fi

cargo lambda build --release --arm64 -p functions

OUT="target/lambda-zips"
mkdir -p "$OUT"
for bin in health register policy-latest events-batch admin-stats admin-devices admin-audit admin-policies-exceptions admin-users admin-settings; do
    (cd "target/lambda/$bin" && zip -j "$ROOT/lambdas/$OUT/$bin.zip" bootstrap >/dev/null)
    echo "packaged $OUT/$bin.zip"
done
