// LNF Run Log for macOS: JavaScript dialogs (alert, confirm, prompt) as
// native alerts, <input type="file"> as the standard open panel, and
// new-window requests (WKUIDelegate).
import AppKit
import WebKit

extension WebWindowController: WKUIDelegate {
    // window.alert()
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = WebWindowController.makeAlert(message)
        alert.addButton(withTitle: "OK")
        showAlert(alert) { _ in
            completionHandler()
        }
    }

    // window.confirm()
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = WebWindowController.makeAlert(message)
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        showAlert(alert) { response in
            completionHandler(response == .alertFirstButtonReturn)
        }
    }

    // window.prompt()
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        let alert = WebWindowController.makeAlert(prompt)
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        let field = NSTextField(string: defaultText ?? "")
        field.frame = NSRect(x: 0, y: 0, width: 300, height: 24)
        alert.accessoryView = field
        alert.window.initialFirstResponder = field
        showAlert(alert) { response in
            completionHandler(response == .alertFirstButtonReturn ? field.stringValue : nil)
        }
    }

    // <input type="file">: Import backup and photos.
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        if let window = webView.window {
            panel.beginSheetModal(for: window) { response in
                completionHandler(response == .OK ? panel.urls : nil)
            }
        } else {
            completionHandler(panel.runModal() == .OK ? panel.urls : nil)
        }
    }

    // window.open() and target="_blank": never a second window. The app's
    // own pages load here; anything else goes to the default browser.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if AppOrigin.contains(url) {
                webView.load(navigationAction.request)
            } else {
                WebWindowController.openExternally(url)
            }
        }
        return nil
    }

    // MARK: - Alerts

    /// Show an alert as a sheet on the app window (or on its own if the
    /// window is gone), then call done with the button that was clicked.
    func showAlert(_ alert: NSAlert, then done: @escaping (NSApplication.ModalResponse) -> Void) {
        if let window = window {
            alert.beginSheetModal(for: window) { response in
                done(response)
            }
        } else {
            done(alert.runModal())
        }
    }

    /// An alert whose bold title is the first line of text and whose body is
    /// the rest, so the web app's "Title\nmessage" confirm reads naturally.
    static func makeAlert(_ text: String) -> NSAlert {
        let alert = NSAlert()
        if let newline = text.firstIndex(of: "\n") {
            alert.messageText = String(text[..<newline])
            alert.informativeText = String(text[text.index(after: newline)...])
        } else {
            alert.messageText = text
        }
        return alert
    }
}
