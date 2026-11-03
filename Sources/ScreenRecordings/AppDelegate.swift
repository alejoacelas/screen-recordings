import AppKit
import Carbon

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private let recorder = Recorder()
    private var timer: Timer?

    func applicationWillFinishLaunching(_ notification: Notification) {
        // screenrec://start|stop|pause|toggle — lets scripts and launchers drive the app.
        NSAppleEventManager.shared().setEventHandler(self, andSelector: #selector(handleURL(_:reply:)),
                                                     forEventClass: AEEventClass(kInternetEventClass),
                                                     andEventID: AEEventID(kAEGetURL))
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        recorder.onChange = { [weak self] in self?.refresh() }
        HotKeys.install()
        HotKeys.register(id: 1, keyCode: kVK_ANSI_R, modifiers: HotKeys.controlOptionCommand) { [weak self] in
            self?.toggleRecording()
        }
        HotKeys.register(id: 2, keyCode: kVK_ANSI_P, modifiers: HotKeys.controlOptionCommand) { [weak self] in
            self?.togglePause()
        }
        refresh()
        Log.write("Launched")
    }

    // MARK: Actions

    @objc func toggleRecording() {
        switch recorder.state {
        case .idle: start()
        case .recording, .paused: stop()
        default: break
        }
    }

    @objc func togglePause() {
        Task { await recorder.togglePause() }
    }

    private func start() {
        Task {
            do { try await recorder.start() } catch { show(error, title: "Could not start recording") }
        }
    }

    private func stop() {
        Task {
            do {
                if let output = try await recorder.stop() {
                    NSWorkspace.shared.activateFileViewerSelecting([output])
                }
            } catch { show(error, title: "Could not finish the recording") }
        }
    }

    @objc private func openFolder() {
        try? FileManager.default.createDirectory(at: Recorder.recordingsRoot, withIntermediateDirectories: true)
        NSWorkspace.shared.open(Recorder.recordingsRoot)
    }

    @objc private func openLast() {
        if let url = recorder.lastOutput { NSWorkspace.shared.open(url) }
    }

    @objc private func handleURL(_ event: NSAppleEventDescriptor, reply: NSAppleEventDescriptor) {
        guard let string = event.paramDescriptor(forKeyword: keyDirectObject)?.stringValue,
              let host = URL(string: string)?.host else { return }
        Log.write("URL command: \(host)")
        switch (host, recorder.state) {
        case ("start", .idle), ("stop", .recording), ("stop", .paused), ("toggle", _): toggleRecording()
        case ("pause", .recording), ("resume", .paused), ("togglepause", _): togglePause()
        default: Log.write("Ignored \(host) while \(recorder.state)")
        }
    }

    private func show(_ error: Error, title: String) {
        Log.write("\(title): \(error)")
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = error.localizedDescription
        alert.runModal()
    }

    // MARK: UI

    private func refresh() {
        let button = statusItem.button!
        let state = recorder.state
        let symbol: String
        switch state {
        case .recording: symbol = "record.circle.fill"
        case .paused: symbol = "pause.circle.fill"
        case .processing, .starting, .transitioning: symbol = "hourglass.circle"
        case .idle: symbol = "record.circle"
        }
        button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: "Screen Recordings")
        button.contentTintColor = state == .recording ? .systemRed : nil
        button.title = (state == .recording || state == .paused) ? " " + format(recorder.elapsed) : ""
        button.imagePosition = .imageLeading

        if state == .recording, timer == nil {
            timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.refresh() }
            }
        } else if state != .recording {
            timer?.invalidate()
            timer = nil
        }
        statusItem.menu = buildMenu(state)
    }

    private func buildMenu(_ state: Recorder.State) -> NSMenu {
        let menu = NSMenu()
        func add(_ title: String, _ action: Selector?, key: String = "", enabled: Bool = true) {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
            item.keyEquivalentModifierMask = [.control, .option, .command]
            item.target = self
            item.isEnabled = enabled
            menu.addItem(item)
        }
        menu.autoenablesItems = false
        switch state {
        case .idle:
            add("Start Recording", #selector(toggleRecording), key: "r")
        case .recording, .paused:
            add("Stop Recording", #selector(toggleRecording), key: "r")
            add(state == .paused ? "Resume" : "Pause", #selector(togglePause), key: "p")
        case .processing:
            add("Adding camera bubble…", nil, enabled: false)
        case .starting, .transitioning:
            add("Working…", nil, enabled: false)
        }
        menu.addItem(.separator())
        add("Open Last Recording", #selector(openLast), enabled: recorder.lastOutput != nil)
        add("Open Recordings Folder", #selector(openFolder))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        return menu
    }

    private func format(_ seconds: TimeInterval) -> String {
        let s = Int(seconds)
        return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60)
                         : String(format: "%d:%02d", s / 60, s % 60)
    }
}
