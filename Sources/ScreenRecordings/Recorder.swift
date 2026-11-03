import AppKit
import AVFoundation
import ScreenCaptureKit

struct Segment: Codable {
    var screen: String
    var camera: String
    /// CACurrentMediaTime() when each file reported that it started writing.
    var screenStart: Double?
    var cameraStart: Double?
}

struct Manifest: Codable {
    var segments: [Segment]
}

enum RecorderError: LocalizedError {
    case permission(String)
    case device(String)

    var errorDescription: String? {
        switch self {
        case .permission(let what): return "\(what) permission is missing."
        case .device(let what): return what
        }
    }
}

/// Records the main display with system audio (ScreenCaptureKit) and, in parallel, the camera with the
/// microphone (AVFoundation). The camera has no preview. Each pause closes one segment per source; stop
/// writes manifest.json and hands the folder to Processor.
@MainActor
final class Recorder: NSObject {
    enum State { case idle, starting, recording, paused, transitioning, processing }

    private(set) var state: State = .idle { didSet { onChange?() } }
    var onChange: (() -> Void)?
    private(set) var sessionDir: URL?
    private(set) var lastOutput: URL?

    private var stream: SCStream?
    private var recordingOutput: SCRecordingOutput?
    private var captureSession: AVCaptureSession?
    private var movieOutput: AVCaptureMovieFileOutput?
    private var segments: [Segment] = []
    private var pendingFinishes = 0
    private var finishContinuation: CheckedContinuation<Void, Never>?

    private var accumulated: TimeInterval = 0
    private var segmentStartedAt: Date?
    var elapsed: TimeInterval {
        accumulated + (segmentStartedAt.map { Date().timeIntervalSince($0) } ?? 0)
    }

    static let recordingsRoot = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Movies/Screen Recordings")

    // MARK: Public actions

    func start() async throws {
        guard state == .idle else { return }
        state = .starting
        do {
            try await ensurePermissions()
            let formatter = DateFormatter()
            formatter.dateFormat = "yyyy-MM-dd HH.mm.ss"
            let dir = Self.recordingsRoot.appendingPathComponent(formatter.string(from: Date()))
            try FileManager.default.createDirectory(at: dir.appendingPathComponent("segments"),
                                                    withIntermediateDirectories: true)
            sessionDir = dir
            segments = []
            accumulated = 0
            try await startCamera()
            try await startSegment()
            state = .recording
            Log.write("Recording started in \(dir.path)")
        } catch {
            Log.write("Start failed: \(error)")
            await teardown()
            state = .idle
            throw error
        }
    }

    func togglePause() async {
        switch state {
        case .recording:
            state = .transitioning
            await endSegment()
            state = .paused
            Log.write("Paused")
        case .paused:
            state = .transitioning
            do {
                try await startSegment()
                state = .recording
                Log.write("Resumed")
            } catch {
                Log.write("Resume failed: \(error)")
                state = .paused
            }
        default:
            break
        }
    }

    func stop() async throws -> URL? {
        guard state == .recording || state == .paused, let dir = sessionDir else { return nil }
        let wasRecording = state == .recording
        state = .transitioning
        if wasRecording { await endSegment() }
        await teardown()
        let data = try JSONEncoder.pretty.encode(Manifest(segments: segments))
        try data.write(to: dir.appendingPathComponent("manifest.json"))
        Log.write("Recording stopped, \(segments.count) segment(s)")

        state = .processing
        defer { state = .idle }
        let output = try await Task.detached { try Processor.run(dir: dir) }.value
        lastOutput = output
        return output
    }

    // MARK: Setup

    private func ensurePermissions() async throws {
        guard await AVCaptureDevice.requestAccess(for: .video) else { throw RecorderError.permission("Camera") }
        guard await AVCaptureDevice.requestAccess(for: .audio) else { throw RecorderError.permission("Microphone") }
        if !CGPreflightScreenCaptureAccess() {
            CGRequestScreenCaptureAccess()
            throw RecorderError.permission("Screen Recording (grant it in System Settings, then quit and reopen the app)")
        }
    }

    private func startCamera() async throws {
        let session = AVCaptureSession()
        session.beginConfiguration()
        if session.canSetSessionPreset(.hd1280x720) { session.sessionPreset = .hd1280x720 }
        guard let camera = AVCaptureDevice.default(for: .video) else { throw RecorderError.device("No camera found.") }
        guard let mic = AVCaptureDevice.default(for: .audio) else { throw RecorderError.device("No microphone found.") }
        for device in [camera, mic] {
            let input = try AVCaptureDeviceInput(device: device)
            guard session.canAddInput(input) else { throw RecorderError.device("Cannot use \(device.localizedName).") }
            session.addInput(input)
        }
        let output = AVCaptureMovieFileOutput()
        guard session.canAddOutput(output) else { throw RecorderError.device("Cannot record the camera.") }
        session.addOutput(output)
        session.commitConfiguration()
        await Task.detached { session.startRunning() }.value
        captureSession = session
        movieOutput = output
        Log.write("Camera: \(camera.localizedName), mic: \(mic.localizedName)")
    }

    private func makeStream() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() }) else {
            throw RecorderError.device("Main display not found.")
        }
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let config = SCStreamConfiguration()
        config.width = Int(Float(display.width) * filter.pointPixelScale)
        config.height = Int(Float(display.height) * filter.pointPixelScale)
        config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
        config.showsCursor = true
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.sampleRate = 48_000
        config.channelCount = 2
        stream = SCStream(filter: filter, configuration: config, delegate: self)
        Log.write("Display \(display.displayID): \(config.width)x\(config.height)")
    }

    // MARK: Segments

    /// Starts a fresh screen capture and camera file. Each segment gets its own SCStream because
    /// SCRecordingOutput never reports finishing when removed from a running stream.
    private func startSegment() async throws {
        try await makeStream()
        guard let dir = sessionDir, let stream, let movieOutput else { return }
        let index = segments.count + 1
        let screenName = String(format: "segments/%03d-screen.mov", index)
        let cameraName = String(format: "segments/%03d-camera.mov", index)

        let config = SCRecordingOutputConfiguration()
        config.outputURL = dir.appendingPathComponent(screenName)
        config.outputFileType = .mov
        config.videoCodecType = .hevc
        let output = SCRecordingOutput(configuration: config, delegate: self)
        try stream.addRecordingOutput(output)
        recordingOutput = output
        // Register the segment first: the start callbacks write their times into the last one.
        segments.append(Segment(screen: screenName, camera: cameraName))
        try await stream.startCapture()
        movieOutput.startRecording(to: dir.appendingPathComponent(cameraName), recordingDelegate: self)
        segmentStartedAt = Date()
    }

    /// Closes the current screen and camera files and waits until both are written.
    private func endSegment() async {
        if let started = segmentStartedAt { accumulated += Date().timeIntervalSince(started) }
        segmentStartedAt = nil
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            finishContinuation = continuation
            pendingFinishes = 2
            if let stream {
                Task {
                    // stopCapture returns once the screen file is written; on macOS 26
                    // recordingOutputDidFinishRecording is never called, so this is the signal.
                    do { try await stream.stopCapture() } catch {
                        Log.write("Could not close screen file: \(error)")
                    }
                    self.finishOne()
                }
            } else { finishOne() }
            stream = nil
            recordingOutput = nil
            if let movieOutput, movieOutput.isRecording { movieOutput.stopRecording() } else { finishOne() }
        }
    }

    private func finishOne() {
        pendingFinishes -= 1
        if pendingFinishes == 0, let continuation = finishContinuation {
            finishContinuation = nil
            continuation.resume()
        }
    }

    private func teardown() async {
        if let stream {
            do { try await stream.stopCapture() } catch { Log.write("Stop capture: \(error)") }
        }
        stream = nil
        if let session = captureSession { await Task.detached { session.stopRunning() }.value }
        captureSession = nil
        movieOutput = nil
    }
}

// MARK: Delegates

extension Recorder: SCRecordingOutputDelegate, SCStreamDelegate, AVCaptureFileOutputRecordingDelegate {
    nonisolated func recordingOutputDidStartRecording(_ recordingOutput: SCRecordingOutput) {
        Log.write("Screen file started")
        let now = CACurrentMediaTime()
        Task { @MainActor in
            if let i = self.segments.indices.last, self.segments[i].screenStart == nil { self.segments[i].screenStart = now }
        }
    }

    nonisolated func recordingOutputDidFinishRecording(_ recordingOutput: SCRecordingOutput) {
        Log.write("Screen file finished")
    }

    nonisolated func recordingOutput(_ recordingOutput: SCRecordingOutput, didFailWithError error: Error) {
        Log.write("Screen recording failed: \(error)")
    }

    nonisolated func stream(_ stream: SCStream, didStopWithError error: Error) {
        Log.write("Screen capture stopped: \(error)")
    }

    nonisolated func fileOutput(_ output: AVCaptureFileOutput, didStartRecordingTo fileURL: URL,
                                from connections: [AVCaptureConnection]) {
        Log.write("Camera file started")
        let now = CACurrentMediaTime()
        Task { @MainActor in
            if let i = self.segments.indices.last, self.segments[i].cameraStart == nil { self.segments[i].cameraStart = now }
        }
    }

    nonisolated func fileOutput(_ output: AVCaptureFileOutput, didFinishRecordingTo outputFileURL: URL,
                                from connections: [AVCaptureConnection], error: Error?) {
        Log.write("Camera file finished")
        if let error {
            let finished = (error as NSError).userInfo[AVErrorRecordingSuccessfullyFinishedKey] as? Bool ?? false
            if !finished { Log.write("Camera recording failed: \(error)") }
        }
        Task { @MainActor in self.finishOne() }
    }
}

extension JSONEncoder {
    static var pretty: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return encoder
    }
}
