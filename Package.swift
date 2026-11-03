// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "Rec",
    platforms: [.macOS(.v15)],
    targets: [
        .executableTarget(name: "Rec", path: "Sources/ScreenRecordings")
    ],
    swiftLanguageModes: [.v5]
)
