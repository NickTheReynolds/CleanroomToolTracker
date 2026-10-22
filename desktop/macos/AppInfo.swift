// LNF Run Log for macOS: the app's name, version and fixed web origin.
// Built by desktop/macos/build-macos.sh (swiftc, no Xcode project).
// See docs/DESKTOP-MACOS.md.
import Foundation

/// Name and version from Info.plist. build-macos.sh copies the version from
/// app/version.js, so the web app and the Mac app always agree.
enum AppInfo {
    static var name: String {
        return Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String ?? "LNF Run Log"
    }

    static var version: String {
        return Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
    }
}

/// The origin the bundled web app runs under: lnfrunlog://app
///
/// ************************************************************************
/// NEVER CHANGE `scheme` OR `host`.
/// WebKit keys IndexedDB, where all of the user's runs live, by origin
/// (scheme + host + port). Another scheme or host opens an empty app and
/// strands the existing data.
/// For the same reason, never change the bundle id (local.lnfrunlog.desktop
/// in Info.plist): WebKit keeps each app's website data in a folder named
/// after its bundle id.
/// ************************************************************************
enum AppOrigin {
    static let scheme = "lnfrunlog"
    static let host = "app"

    /// The page the window opens: lnfrunlog://app/index.html
    static let startURL = URL(string: "\(scheme)://\(host)/index.html")!

    /// True for the app's own pages and files.
    static func contains(_ url: URL) -> Bool {
        return url.scheme?.lowercased() == scheme
            && url.host?.lowercased() == host
            && url.port == nil
    }
}
