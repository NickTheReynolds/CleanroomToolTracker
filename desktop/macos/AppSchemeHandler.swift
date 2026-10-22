// LNF Run Log for macOS: serves the bundled web app to the web view.
// A request for lnfrunlog://app/<path> is answered with the file <path> in
// Contents/Resources/app. This is how Capacitor serves capacitor://localhost
// on iOS; IndexedDB and ES modules work under such an origin.
import Foundation
import WebKit

final class AppSchemeHandler: NSObject, WKURLSchemeHandler {
    /// The folder that holds index.html.
    private let root: URL

    init(root: URL) {
        self.root = root.standardizedFileURL
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        guard AppOrigin.contains(url), let parts = AppSchemeHandler.pathComponents(of: url) else {
            reply(to: urlSchemeTask, url: url, status: 403, body: Data("Forbidden".utf8), type: "text/plain; charset=utf-8")
            return
        }
        var file = root
        for part in parts {
            file.appendPathComponent(part)
        }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: file.path, isDirectory: &isDirectory),
              !isDirectory.boolValue,
              let data = try? Data(contentsOf: file) else {
            reply(to: urlSchemeTask, url: url, status: 404, body: Data("Not found".utf8), type: "text/plain; charset=utf-8")
            return
        }
        reply(to: urlSchemeTask, url: url, status: 200, body: data,
              type: AppSchemeHandler.mimeType(forExtension: file.pathExtension))
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // Nothing to cancel: start answers every request before it returns.
    }

    /// The URL's path as names inside the app folder; "/" means index.html.
    /// Nil when a "." or ".." component would step out of the folder. The
    /// bundle holds no symbolic links, so the names cannot lead elsewhere.
    static func pathComponents(of url: URL) -> [String]? {
        // url.path is percent-decoded and has no query or fragment, so
        // "%2e%2e" arrives here as ".." and is refused.
        let parts = url.path.components(separatedBy: "/").filter { !$0.isEmpty }
        if parts.contains(where: { $0 == "." || $0 == ".." }) {
            return nil
        }
        return parts.isEmpty ? ["index.html"] : parts
    }

    /// Content-Type for a file extension. Module scripts must have a
    /// JavaScript type, or WebKit refuses to run them.
    static func mimeType(forExtension ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "map": return "application/json; charset=utf-8"
        case "webmanifest": return "application/manifest+json; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "webp": return "image/webp"
        case "ico": return "image/x-icon"
        case "txt": return "text/plain; charset=utf-8"
        case "woff2": return "font/woff2"
        default: return "application/octet-stream"
        }
    }

    /// Send a complete response. The files are small and local, so they are
    /// read and sent in one go on the main thread.
    private func reply(to task: WKURLSchemeTask, url: URL, status: Int, body: Data, type: String) {
        let headers = [
            "Content-Type": type,
            "Content-Length": String(body.count),
            "Cache-Control": "no-cache",
        ]
        guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else {
            task.didFailWithError(URLError(.cannotParseResponse))
            return
        }
        task.didReceive(response)
        if !body.isEmpty {
            task.didReceive(body)
        }
        task.didFinish()
    }
}
