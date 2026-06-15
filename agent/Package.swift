// swift-tools-version: 6.0
// VGuardrail macOS Endpoint Agent — Swift Package.
//
// The dependency-light core (VGCore, VGSQLite, VGEventQueue, VGXPCProtocol,
// VGAgentCore) plus vgselfcheck build and verify offline with the Command Line
// Tools. The gRPC client and the daemon that links it are gated behind VG_GRPC=1
// so a default `swift build` never resolves grpc-swift over the network.
//
// Testing note: unit suites use swift-testing (`import Testing`). They run on an
// Xcode/CI host; the Command Line Tools build them but cannot execute test
// bundles, so `vgselfcheck` (an executable) provides runtime verification here.
import PackageDescription
import Foundation

let enableGRPC = ProcessInfo.processInfo.environment["VG_GRPC"] == "1"

// swift-testing lives in the toolchain's Developer dir. Full Xcode wires this
// automatically; under the Command Line Tools we add the search path + rpaths
// explicitly. Override with VG_DEVELOPER_DIR if your toolchain differs.
let developerDir = ProcessInfo.processInfo.environment["VG_DEVELOPER_DIR"]
    ?? "/Library/Developer/CommandLineTools"
let devFrameworks = "\(developerDir)/Library/Developer/Frameworks"
let devUsrLib = "\(developerDir)/Library/Developer/usr/lib" // holds lib_TestingInterop.dylib

let testSwiftSettings: [SwiftSetting] = [.unsafeFlags(["-F", devFrameworks])]
let testLinkerSettings: [LinkerSetting] = [
    .unsafeFlags([
        "-F", devFrameworks,
        "-Xlinker", "-rpath", "-Xlinker", devFrameworks,
        "-Xlinker", "-rpath", "-Xlinker", devUsrLib,
    ])
]

var products: [Product] = [
    .library(name: "VGCore", targets: ["VGCore"]),
    .library(name: "VGSQLite", targets: ["VGSQLite"]),
    .library(name: "VGEventQueue", targets: ["VGEventQueue"]),
    .library(name: "VGXPCProtocol", targets: ["VGXPCProtocol"]),
    .library(name: "VGAgentCore", targets: ["VGAgentCore"]),
    .library(name: "VGOCRExtractor", targets: ["VGOCRExtractor"]),
    .executable(name: "vgselfcheck", targets: ["vgselfcheck"]),
    .executable(name: "vgctl", targets: ["vgctl"]),
    .executable(name: "VGuardrailMenuBar", targets: ["VGuardrailMenuBar"]),
]

var targets: [Target] = [
    .target(name: "VGCore", exclude: ["README.md"]),
    .systemLibrary(name: "CSQLite", path: "Sources/CSQLite"),
    .target(name: "VGSQLite", dependencies: ["CSQLite"], exclude: ["README.md"]),
    .target(name: "VGEventQueue", dependencies: ["VGCore", "VGSQLite"], exclude: ["README.md"]),
    .target(name: "VGXPCProtocol", dependencies: ["VGCore"], exclude: ["README.md"]),
    .target(name: "VGAgentCore", dependencies: ["VGCore", "VGEventQueue"], exclude: ["README.md"]),
    // Apple Vision OCR (system Vision framework; no external SPM deps).
    .target(name: "VGOCRExtractor"),
    .executableTarget(
        name: "vgselfcheck",
        dependencies: ["VGCore", "VGSQLite", "VGEventQueue", "VGXPCProtocol", "VGAgentCore", "VGOCRExtractor"]
    ),
    .executableTarget(name: "vgctl", dependencies: ["VGCore", "VGXPCProtocol", "VGOCRExtractor"], exclude: ["README.md"]),
    .executableTarget(
        name: "VGuardrailMenuBar", dependencies: ["VGCore", "VGXPCProtocol"], exclude: ["README.md"]
    ),

    // Tests (swift-testing).
    .testTarget(name: "VGCoreTests", dependencies: ["VGCore"],
                swiftSettings: testSwiftSettings, linkerSettings: testLinkerSettings),
    .testTarget(name: "VGSQLiteTests", dependencies: ["VGSQLite"],
                swiftSettings: testSwiftSettings, linkerSettings: testLinkerSettings),
    .testTarget(name: "VGEventQueueTests", dependencies: ["VGEventQueue"],
                swiftSettings: testSwiftSettings, linkerSettings: testLinkerSettings),
    .testTarget(name: "VGXPCProtocolTests", dependencies: ["VGXPCProtocol"],
                swiftSettings: testSwiftSettings, linkerSettings: testLinkerSettings),
    .testTarget(name: "VGAgentCoreTests", dependencies: ["VGAgentCore"],
                swiftSettings: testSwiftSettings, linkerSettings: testLinkerSettings),
]

// ── Daemon + gRPC (full build only) ──────────────────────────────────────────
var packageDeps: [Package.Dependency] = []
var daemonDeps: [Target.Dependency] = ["VGCore", "VGAgentCore", "VGXPCProtocol", "VGOCRExtractor"]
var daemonSettings: [SwiftSetting] = []

if enableGRPC {
    packageDeps = [
        .package(url: "https://github.com/grpc/grpc-swift.git", from: "2.0.0"),
        .package(url: "https://github.com/grpc/grpc-swift-nio-transport.git", from: "1.0.0"),
        .package(url: "https://github.com/grpc/grpc-swift-protobuf.git", from: "1.0.0"),
    ]
    targets.append(
        .target(
            name: "VGGRPCClient",
            dependencies: [
                "VGCore", "VGAgentCore",
                .product(name: "GRPCCore", package: "grpc-swift"),
                .product(name: "GRPCNIOTransportHTTP2", package: "grpc-swift-nio-transport"),
                .product(name: "GRPCProtobuf", package: "grpc-swift-protobuf"),
            ],
            exclude: ["README.md"],
            plugins: [
                .plugin(name: "GRPCProtobufGenerator", package: "grpc-swift-protobuf"),
            ]
        )
    )
    products.append(.library(name: "VGGRPCClient", targets: ["VGGRPCClient"]))
    daemonDeps.append("VGGRPCClient")
    daemonSettings.append(.define("VG_GRPC"))
}

targets.append(.executableTarget(
    name: "vguardiand", dependencies: daemonDeps, exclude: ["README.md"], swiftSettings: daemonSettings
))
products.append(.executable(name: "vguardiand", targets: ["vguardiand"]))

// vgctl / VGuardrailMenuBar executables are appended in later steps.

// grpc-swift v2 APIs require a macOS 15 deployment target; the offline core
// keeps .v14 so CLT-only hosts without the newer SDK still build it.
let package = Package(
    name: "VGuardrailAgent",
    platforms: [enableGRPC ? .macOS(.v15) : .macOS(.v14)],
    products: products,
    dependencies: packageDeps,
    targets: targets
)
