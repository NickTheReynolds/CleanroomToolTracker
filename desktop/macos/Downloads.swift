// LNF Run Log for macOS: file downloads with WKDownload (macOS 11.3+).
// The web app's backup and CSV exports click an <a download> link to a
// blob: URL. The file is saved in ~/Downloads under the name the app
// suggests ("name (1).json" when that name is taken), then shown in Finder.
import AppKit
import WebKit

extension WebWindowController: WKDownloadDelegate {
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let fileManager = FileManager.default
        guard let folder = fileManager.urls(for: .downloadsDirectory, in: .userDomainMask).first else {
            completionHandler(nil) // cancels the download
            return
        }
        try? fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
        let destination = WebWindowController.uniqueFile(in: folder, suggestedName: suggestedFilename)
        downloadDestinations[download] = destination
        completionHandler(destination)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let destination = downloadDestinations.removeValue(forKey: download) else {
            return
        }
        NSWorkspace.shared.activateFileViewerSelecting([destination])
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let name = downloadDestinations.removeValue(forKey: download)?.lastPathComponent ?? "the file"
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Could not save \(name)"
        alert.informativeText = error.localizedDescription
            + "\n\nIf macOS blocked access to the Downloads folder, allow it under"
            + " Privacy & Security > Files and Folders, then export again."
        alert.addButton(withTitle: "OK")
        showAlert(alert) { _ in }
    }

    /// folder/name, or "name (1).ext", "name (2).ext" and so on when that
    /// file already exists. WebKit never overwrites an existing file.
    static func uniqueFile(in folder: URL, suggestedName: String) -> URL {
        var name = (suggestedName as NSString).lastPathComponent
        if name.isEmpty || name == "." || name == ".." || name == "/" {
            name = "download"
        }
        let base = (name as NSString).deletingPathExtension
        let ext = (name as NSString).pathExtension
        var candidate = folder.appendingPathComponent(name)
        var number = 1
        while FileManager.default.fileExists(atPath: candidate.path) {
            let numbered = ext.isEmpty ? "\(base) (\(number))" : "\(base) (\(number)).\(ext)"
            candidate = folder.appendingPathComponent(numbered)
            number += 1
        }
        return candidate
    }
}
