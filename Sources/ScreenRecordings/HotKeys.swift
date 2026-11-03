import Carbon

/// System-wide shortcuts through Carbon, which needs no Accessibility permission.
enum HotKeys {
    private static var handlers: [UInt32: () -> Void] = [:]
    private static var refs: [EventHotKeyRef?] = []

    static let controlOptionCommand = UInt32(controlKey | optionKey | cmdKey)

    static func install() {
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, event, _ in
            var hotKey = EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                              nil, MemoryLayout<EventHotKeyID>.size, nil, &hotKey)
            HotKeys.handlers[hotKey.id]?()
            return noErr
        }, 1, &spec, nil, nil)
    }

    static func register(id: UInt32, keyCode: Int, modifiers: UInt32, handler: @escaping () -> Void) {
        handlers[id] = handler
        var ref: EventHotKeyRef?
        let status = RegisterEventHotKey(UInt32(keyCode), modifiers, EventHotKeyID(signature: 0x5352_4543, id: id),
                                         GetApplicationEventTarget(), 0, &ref)
        if status != noErr { Log.write("Could not register hotkey \(id): \(status)") }
        refs.append(ref)
    }
}
