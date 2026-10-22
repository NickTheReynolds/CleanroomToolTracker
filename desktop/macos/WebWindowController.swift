// LNF Run Log for macOS: the app window, its WKWebView, and which
// navigations stay in the app. JavaScript dialogs and the file picker are in
// WebUIDelegate.swift; downloads are in Downloads.swift.
import AppKit
import WebKit

final class WebWindowController: NSWindowController, WKNavigationDelegate {
    let webView: WKWebView
    /// Kept so the scheme handler lives as long as the web view.
    private let schemeHandler: AppSchemeHandler

    /// Where each running download is being saved (WKDownload does not say).
    var downloadDestinations: [WKDownload: URL] = [:]

    /// Name under which AppKit saves the window's size and position.
    private static let frameName = "LNFRunLogMainWindow"

    /// Schemes a page may show in place: blank frames, blob: and data: content.
    private static let inPageSchemes: Set<String> = ["about", "blob", "data"]

    init(appFolder: URL, devtools: Bool) {
        let handler = AppSchemeHandler(root: appFolder)
        let configuration = WKWebViewConfiguration()
        // The persistent default store: IndexedDB survives restarts and
        // updates. WebKit keeps it per bundle id, under ~/Library/WebKit.
        configuration.websiteDataStore = WKWebsiteDataStore.default()
        configuration.setURLSchemeHandler(handler, forURLScheme: AppOrigin.scheme)
        configuration.userContentController.addUserScript(WKUserScript(
            source: WebWindowController.desktopScript(),
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true))
        let web = WKWebView(frame: .zero, configuration: configuration)

        let window = NSWindow(
            contentRect: WebWindowController.defaultContentRect(),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false)
        window.isReleasedWhenClosed = false
        window.title = AppInfo.name
        window.contentMinSize = NSSize(width: 360, height: 420)
        window.contentView = web
        window.initialFirstResponder = web
        window.center()
        // Restore the last size and position (the first launch stays
        // centred); AppKit saves every later change by itself.
        window.setFrameAutosaveName(WebWindowController.frameName)
        window.setFrameUsingName(WebWindowController.frameName)

        schemeHandler = handler
        webView = web
        super.init(window: window)

        web.navigationDelegate = self
        web.uiDelegate = self
        if #available(macOS 13.3, *) {
            web.isInspectable = devtools // Safari > Develop > this Mac > LNF Run Log
        }
        // The title bar follows the page title ("Settings · LNF Run Log").
        window.bind(.title, to: web, withKeyPath: "title", options: [.nullPlaceholder: AppInfo.name])
        web.load(URLRequest(url: AppOrigin.startURL))
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not used")
    }

    /// View > Reload. Any page other than the app's own goes back to the start page.
    func reloadApp() {
        if let url = webView.url, AppOrigin.contains(url) {
            webView.reload()
        } else {
            webView.load(URLRequest(url: AppOrigin.startURL))
        }
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download) // <a download>: the backup and CSV exports
            return
        }
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        let scheme = url.scheme?.lowercased() ?? ""
        if AppOrigin.contains(url) || WebWindowController.inPageSchemes.contains(scheme) {
            decisionHandler(.allow)
        } else {
            decisionHandler(.cancel)
            WebWindowController.openExternally(url)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        reloadApp() // forms autosave, so a reload loses nothing
    }

    // MARK: - Helpers

    /// Web and mail links open in the default browser or mail app, like the
    /// Windows app; other schemes are ignored.
    static func openExternally(_ url: URL) {
        guard let scheme = url.scheme?.lowercased(), ["http", "https", "mailto"].contains(scheme) else {
            return
        }
        NSWorkspace.shared.open(url)
    }

    /// window.LNF_DESKTOP tells the web app that it runs in the desktop app
    /// (app/js/ui/pwa.js), so it skips the service worker and explains how
    /// to update. Same shape as the Windows app's.
    private static func desktopScript() -> String {
        let version = AppInfo.version.filter { "0123456789.".contains($0) }
        return "window.LNF_DESKTOP = Object.freeze({ platform: 'macos', version: '\(version)' });"
    }

    /// 1200 x 860 points, or 90% of the screen when that is smaller.
    private static func defaultContentRect() -> NSRect {
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1280, height: 800)
        return NSRect(x: 0, y: 0, width: min(1200, screen.width * 0.9), height: min(860, screen.height * 0.9))
    }
}
