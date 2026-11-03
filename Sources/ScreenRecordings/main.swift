import AppKit

// `Rec --process <recording folder>` rebuilds final.mp4 without opening the app.
let args = CommandLine.arguments
if let i = args.firstIndex(of: "--process"), i + 1 < args.count {
    do {
        let out = try Processor.run(dir: URL(fileURLWithPath: args[i + 1]))
        print(out.path)
        exit(0)
    } catch {
        FileHandle.standardError.write("\(error)\n".data(using: .utf8)!)
        exit(1)
    }
}

let app = NSApplication.shared
let delegate = MainActor.assumeIsolated { AppDelegate() }
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
