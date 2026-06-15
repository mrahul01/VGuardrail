// swift-tools-version: 6.0
// VGuardrail xpc-bridge — the native helper that connector-sdk spawns.
//
// It reuses the agent's VGCore models and VGXPCProtocol (the AgentControl XPC
// interface + AgentXPCClient) via a local path dependency, so the wire contract
// and the trust boundary stay identical to the daemon's — no duplication, no
// drift, and no modification to the agent package.
//
// Build with the Command Line Tools: `swift build` (the agent package's gRPC
// path stays gated behind VG_GRPC=1, which we never set, so only VGCore +
// VGXPCProtocol compile here). Runtime verification: `swift run xpc-bridge-selfcheck`.
import PackageDescription
import Foundation

// swift-testing lives in the toolchain's Developer dir. Full Xcode wires this
// automatically; under the Command Line Tools we add the search path + rpaths so
// the test target at least builds (the CLT cannot execute test bundles, which is
// why xpc-bridge-selfcheck exists as a runnable verification executable).
let developerDir = ProcessInfo.processInfo.environment["VG_DEVELOPER_DIR"]
    ?? "/Library/Developer/CommandLineTools"
let devFrameworks = "\(developerDir)/Library/Developer/Frameworks"
let devUsrLib = "\(developerDir)/Library/Developer/usr/lib"

let testSwiftSettings: [SwiftSetting] = [.unsafeFlags(["-F", devFrameworks])]
let testLinkerSettings: [LinkerSetting] = [
    .unsafeFlags([
        "-F", devFrameworks,
        "-Xlinker", "-rpath", "-Xlinker", devFrameworks,
        "-Xlinker", "-rpath", "-Xlinker", devUsrLib,
    ])
]

let package = Package(
    name: "VGuardrailXPCBridge",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "vguardrail-xpc-bridge", targets: ["vguardrail-xpc-bridge"]),
        .executable(name: "xpc-bridge-selfcheck", targets: ["xpc-bridge-selfcheck"]),
        .library(name: "BridgeCore", targets: ["BridgeCore"]),
    ],
    dependencies: [
        .package(name: "VGuardrailAgent", path: "../../agent"),
    ],
    targets: [
        .target(
            name: "BridgeCore",
            dependencies: [
                .product(name: "VGCore", package: "VGuardrailAgent"),
                .product(name: "VGXPCProtocol", package: "VGuardrailAgent"),
            ]
        ),
        .executableTarget(
            name: "vguardrail-xpc-bridge",
            dependencies: [
                "BridgeCore",
                .product(name: "VGXPCProtocol", package: "VGuardrailAgent"),
            ]
        ),
        .executableTarget(
            name: "xpc-bridge-selfcheck",
            dependencies: [
                "BridgeCore",
                .product(name: "VGCore", package: "VGuardrailAgent"),
                .product(name: "VGXPCProtocol", package: "VGuardrailAgent"),
            ]
        ),
        .testTarget(
            name: "BridgeCoreTests",
            dependencies: [
                "BridgeCore",
                .product(name: "VGCore", package: "VGuardrailAgent"),
            ],
            swiftSettings: testSwiftSettings,
            linkerSettings: testLinkerSettings
        ),
    ]
)
