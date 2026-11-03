import Foundation

/// Joins the segments of a recording folder and overlays the camera as a round bubble in the
/// upper-right corner. Writes final.mp4 and process.log into the folder.
enum Processor {
    static let ffmpeg = "/opt/homebrew/bin/ffmpeg"
    static let ffprobe = "/opt/homebrew/bin/ffprobe"

    /// Bubble diameter as a fraction of the screen height, and margin from the edges.
    static let bubbleFraction = 0.2
    static let marginFraction = 0.025

    enum Failure: LocalizedError {
        case message(String)
        var errorDescription: String? { if case .message(let m) = self { return m }; return nil }
    }

    static func run(dir: URL) throws -> URL {
        guard FileManager.default.isExecutableFile(atPath: ffmpeg) else {
            throw Failure.message("ffmpeg not found at \(ffmpeg). Install it with `brew install ffmpeg`.")
        }
        let manifest = try JSONDecoder().decode(Manifest.self,
                                                from: Data(contentsOf: dir.appendingPathComponent("manifest.json")))
        var inputs: [String] = []
        var filters: [String] = []
        var screenParts = "", cameraParts = ""
        var screenSize: (Int, Int)?
        var count = 0
        let f = { (x: Double) in String(format: "%.3f", x) }

        for segment in manifest.segments {
            let screen = dir.appendingPathComponent(segment.screen).path
            let camera = dir.appendingPathComponent(segment.camera).path
            guard FileManager.default.fileExists(atPath: screen), FileManager.default.fileExists(atPath: camera) else {
                Log.write("Skipping \(segment.screen): a file is missing")
                continue
            }
            // Line up both files on whichever started writing later.
            let screenStart = segment.screenStart ?? 0, cameraStart = segment.cameraStart ?? 0
            let t0 = max(screenStart, cameraStart)
            let screenTrim = t0 - screenStart, cameraTrim = t0 - cameraStart
            let duration = min(try probeDuration(screen) - screenTrim, try probeDuration(camera) - cameraTrim)
            guard duration > 0.1 else {
                Log.write("Skipping \(segment.screen): shorter than 0.1 s")
                continue
            }
            if screenSize == nil { screenSize = try probeSize(screen) }

            let s = 2 * count, c = 2 * count + 1
            inputs += ["-i", screen, "-i", camera]
            filters.append("[\(s):v]trim=start=\(f(screenTrim)):duration=\(f(duration)),setpts=PTS-STARTPTS[sv\(count)]")
            if try hasAudio(screen) {
                filters.append("[\(s):a]atrim=start=\(f(screenTrim)):duration=\(f(duration)),asetpts=PTS-STARTPTS,aresample=48000[sa\(count)]")
            } else {
                // The screen file carries no audio track when nothing played; use silence of the same length.
                filters.append("anullsrc=r=48000:cl=stereo,atrim=duration=\(f(duration))[sa\(count)]")
            }
            guard try hasAudio(camera) else { throw Failure.message("\(segment.camera) has no microphone audio.") }
            filters.append("[\(c):v]trim=start=\(f(cameraTrim)):duration=\(f(duration)),setpts=PTS-STARTPTS[cv\(count)]")
            filters.append("[\(c):a]atrim=start=\(f(cameraTrim)):duration=\(f(duration)),asetpts=PTS-STARTPTS,aresample=48000[ca\(count)]")
            screenParts += "[sv\(count)][sa\(count)]"
            cameraParts += "[cv\(count)][ca\(count)]"
            count += 1
        }
        guard count > 0, let (_, height) = screenSize else { throw Failure.message("No usable segments in \(dir.path).") }

        let bubble = Int(Double(height) * bubbleFraction) / 2 * 2
        let margin = Int(Double(height) * marginFraction)
        filters.append("\(screenParts)concat=n=\(count):v=1:a=1[sv][sa]")
        filters.append("\(cameraParts)concat=n=\(count):v=1:a=1[cv][ca]")
        filters.append("[sv]fps=30[screen]")
        // Center-crop to a square, scale, and cut a circle with a one-pixel soft edge.
        // The circular mask is drawn once and repeated for every frame.
        filters.append("color=black:s=\(bubble)x\(bubble):r=30:d=1,format=gray,"
            + "geq=lum='255*clip(W/2-hypot(X-W/2+0.5,Y-H/2+0.5)+0.5,0,1)',loop=loop=-1:size=1[mask]")
        filters.append("[cv]fps=30,crop='min(iw,ih)':'min(iw,ih)',scale=\(bubble):\(bubble),format=yuv420p[face]")
        filters.append("[face][mask]alphamerge=shortest=1[bubble]")
        filters.append("[screen][bubble]overlay=x=W-w-\(margin):y=\(margin),format=yuv420p[v]")
        filters.append("[sa][ca]amix=inputs=2:duration=longest:normalize=0[a]")

        let output = dir.appendingPathComponent("final.mp4")
        let arguments = ["-y", "-hide_banner"] + inputs + [
            "-filter_complex", filters.joined(separator: ";"),
            "-map", "[v]", "-map", "[a]",
            "-c:v", "h264_videotoolbox", "-b:v", "12M",
            "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart", output.path,
        ]
        Log.write("Processing \(count) segment(s) in \(dir.path)")
        let (status, log) = try execute(ffmpeg, arguments)
        try ("ffmpeg " + arguments.joined(separator: " ") + "\n\n" + log)
            .write(to: dir.appendingPathComponent("process.log"), atomically: true, encoding: .utf8)
        guard status == 0 else {
            throw Failure.message("ffmpeg failed (\(status)). See \(dir.appendingPathComponent("process.log").path)")
        }
        Log.write("Wrote \(output.path)")
        return output
    }

    // MARK: Probing

    private static func probeDuration(_ path: String) throws -> Double {
        let out = try probe(["-show_entries", "format=duration", "-of", "csv=p=0", path])
        guard let value = Double(out) else { throw Failure.message("Cannot read duration of \(path)") }
        return value
    }

    private static func probeSize(_ path: String) throws -> (Int, Int) {
        let parts = try probe(["-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", path])
            .split(separator: "x").compactMap { Int($0) }
        guard parts.count == 2 else { throw Failure.message("Cannot read video size of \(path)") }
        return (parts[0], parts[1])
    }

    private static func hasAudio(_ path: String) throws -> Bool {
        !(try probe(["-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", path])).isEmpty
    }

    private static func probe(_ arguments: [String]) throws -> String {
        let (status, out) = try execute(ffprobe, ["-v", "error"] + arguments, mergeStderr: false)
        guard status == 0 else { throw Failure.message("ffprobe failed on \(arguments.last ?? "")") }
        return out.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func execute(_ tool: String, _ arguments: [String], mergeStderr: Bool = true) throws -> (Int32, String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: tool)
        process.arguments = arguments
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = mergeStderr ? pipe : FileHandle.nullDevice
        try process.run()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return (process.terminationStatus, String(decoding: data, as: UTF8.self))
    }
}
