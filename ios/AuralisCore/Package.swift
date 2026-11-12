// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "AuralisCore",
    platforms: [
        .iOS(.v16),
        .macOS(.v13)
    ],
    products: [
        .library(
            name: "AuralisCore",
            targets: ["AuralisCore"]
        )
    ],
    targets: [
        .target(
            name: "AuralisCore",
            path: "Sources/AuralisCore"
        ),
        .testTarget(
            name: "AuralisCoreTests",
            dependencies: ["AuralisCore"],
            path: "Tests/AuralisCoreTests",
            swiftSettings: [
                .unsafeFlags([
                    "-plugin-path",
                    "/Library/Developer/CommandLineTools/usr/lib/swift/host/plugins/testing"
                ])
            ]
        )
    ]
)
