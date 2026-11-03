// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "ScreenRecordings",
    platforms: [.macOS(.v15)],
    targets: [
        .executableTarget(name: "ScreenRecordings", path: "Sources/ScreenRecordings")
    ],
    swiftLanguageModes: [.v5]
)
