// LNF Run Log for macOS: entry point, app lifecycle and menu actions.
// A native AppKit app with one window that shows the bundled web app (app/)
// in a WKWebView. Built by desktop/macos/build-macos.sh with swiftc: there is
// no Xcode project and no storyboard. See docs/DESKTOP-MACOS.md.
import AppKit

/// The entry point. There is no nib: AppDelegate builds the menu bar and the
/// window in code. (A separate type, so AppKit's own NSApplicationDelegate
/// main(), which loads a nib, is never in play.)
@main
@MainActor
enum LNFRunLogMain {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate // a weak reference, so keep the delegate alive below
        app.setActivationPolicy(.regular)
        withExtendedLifetime(delegate) {
            app.run()
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var windowController: WebWindowController?
    private var quitScheduled = false

    func applicationWillFinishLaunching(_ notification: Notification) {
        NSWindow.allowsAutomaticWindowTabbing = false // one window, so no tab bar menu items
        NSApp.mainMenu = makeMainMenu()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let appFolder = Bundle.main.resourceURL?.appendingPathComponent("app", isDirectory: true),
              FileManager.default.fileExists(atPath: appFolder.appendingPathComponent("index.html").path) else {
            failToStart("The web app's files are missing from this copy of LNF Run Log.\n\n"
                + "Install it again from the disk image, or build it again with desktop/macos/build-macos.sh.")
            return
        }
        #if DEBUG
        let devtools = true
        #else
        let devtools = ProcessInfo.processInfo.arguments.contains("--devtools")
        #endif
        let controller = WebWindowController(appFolder: appFolder, devtools: devtools)
        windowController = controller
        controller.showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    /// Closing the window quits, as on Windows: the app has only one window.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool {
        return true
    }

    /// Quit half a second after being asked. Hiding the page first makes the
    /// web app save a half-typed form at once (app/js/ui/autosave.js flushes
    /// when the page is hidden), and IndexedDB gets time to commit it.
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let window = windowController?.window, !quitScheduled else {
            return .terminateNow
        }
        quitScheduled = true
        window.orderOut(nil)
        // While it waits, AppKit runs the run loop in the modal panel mode.
        perform(#selector(finishQuit), with: nil, afterDelay: 0.5, inModes: [.default, .modalPanel])
        return .terminateLater
    }

    @objc private func finishQuit() {
        NSApp.reply(toApplicationShouldTerminate: true)
    }

    /// View > Reload (Command-R).
    @objc func reloadPage(_ sender: Any?) {
        windowController?.reloadApp()
    }

    private func failToStart(_ message: String) {
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = "LNF Run Log cannot start"
        alert.informativeText = message
        alert.addButton(withTitle: "Quit")
        alert.runModal()
        NSApp.terminate(nil)
    }
}
