// LNF Run Log for Windows: a WinForms window that hosts Microsoft Edge
// WebView2 and serves the bundled app folder under a fixed HTTPS origin.
// C# 5 for the .NET Framework compiler that ships with Windows; built by
// scripts/build-windows.mjs together with Shell.cs, Placement.cs and the
// generated BuildInfo.cs. See docs/DESKTOP.md.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("LNF Run Log")]
[assembly: AssemblyDescription("Log and look up cleanroom process runs")]
[assembly: AssemblyProduct("LNF Run Log")]
[assembly: AssemblyCompany("LNF Run Log")]
[assembly: AssemblyVersion(LnfRunLog.BuildInfo.FileVersion)]
[assembly: AssemblyFileVersion(LnfRunLog.BuildInfo.FileVersion)]
[assembly: AssemblyInformationalVersion(LnfRunLog.BuildInfo.Version)]

namespace LnfRunLog
{
    static class Program
    {
        const string RuntimeDownloadUrl = "https://developer.microsoft.com/microsoft-edge/webview2/";

        [STAThread]
        static int Main(string[] args)
        {
            Shell.SetProcessAppId(); // before any window, so the taskbar groups it with the shortcuts
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            bool devtools = false;
            foreach (string a in args)
            {
                if (string.Equals(a, "--devtools", StringComparison.OrdinalIgnoreCase)) devtools = true;
            }

            string appDir = Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), "app");
            if (!File.Exists(Path.Combine(appDir, "index.html")))
            {
                Fail("The app files are missing from " + appDir + ".\n\nRun the LNF Run Log installer again to repair it.");
                return 1;
            }
            try
            {
                CoreWebView2Environment.GetAvailableBrowserVersionString();
            }
            catch (WebView2RuntimeNotFoundException)
            {
                OfferRuntimeDownload();
                return 1;
            }
            catch (DllNotFoundException)
            {
                Fail("WebView2Loader.dll is missing.\n\nRun the LNF Run Log installer again to repair it.");
                return 1;
            }
            catch (Exception ex)
            {
                Fail("LNF Run Log could not load Microsoft Edge WebView2.\n\n" + ex.Message
                    + "\n\nRun the LNF Run Log installer again to repair it.");
                return 1;
            }
            Application.Run(new MainForm(appDir, AppInfo.DataParent(), devtools));
            return 0;
        }

        /// <summary>Explain the missing Edge WebView2 Runtime and offer Microsoft's download page.</summary>
        public static void OfferRuntimeDownload()
        {
            DialogResult r = MessageBox.Show(
                "LNF Run Log needs the Microsoft Edge WebView2 Runtime, which is not installed on this PC.\n\n"
                + "Windows 11 includes it, and most Windows 10 PCs get it with Microsoft Edge. "
                + "Install the \"Evergreen\" runtime from Microsoft, then start LNF Run Log again.\n\n"
                + "Open the download page now?",
                AppInfo.Name, MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
            if (r == DialogResult.Yes) MainForm.OpenExternal(RuntimeDownloadUrl);
        }

        public static void Fail(string message)
        {
            MessageBox.Show(message, AppInfo.Name, MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    sealed class MainForm : Form
    {
        /// <summary>
        /// The app's origin is https://app.lnf-runlog.example. NEVER CHANGE THIS
        /// HOST NAME: IndexedDB, where all of the user's runs live, is keyed by
        /// origin, so a different name would open an empty app and strand the
        /// existing data. (.example is reserved and never resolves on the
        /// internet; WebView2 maps it to the bundled app folder.)
        /// </summary>
        public const string AppHost = "app.lnf-runlog.example";
        const string StartUrl = "https://" + AppHost + "/index.html";

        readonly WebView2 view = new WebView2();
        readonly string appDir;
        readonly string dataParent;
        readonly bool devtools;
        readonly Placement placement;
        bool hiddenForClose;

        public MainForm(string appDir, string dataParent, bool devtools)
        {
            this.appDir = appDir;
            this.dataParent = dataParent;
            this.devtools = devtools;
            Text = AppInfo.Name;
            Icon = OwnIcon();
            Color bg = WindowsUsesDarkMode() ? Color.FromArgb(0x0e, 0x13, 0x17) : Color.FromArgb(0xf3, 0xf5, 0xf7);
            BackColor = bg; // the app's --bg, so startup does not flash white in dark mode
            view.DefaultBackgroundColor = bg;
            view.Dock = DockStyle.Fill;
            Controls.Add(view);
            placement = new Placement(this, Path.Combine(dataParent, "window.txt"));
            placement.Restore();
        }

        /// <summary>The icon compiled into this exe, at every size Windows asks for.</summary>
        static Icon OwnIcon()
        {
            try
            {
                using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("app.ico"))
                {
                    if (s != null) return new Icon(s);
                }
            }
            catch (Exception) { /* fall back below */ }
            return Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            if (WindowsUsesDarkMode())
            {
                int on = 1; // DWMWA_USE_IMMERSIVE_DARK_MODE: a dark title bar to match
                try { DwmSetWindowAttribute(Handle, 20, ref on, 4); } catch (Exception) { }
            }
        }

        protected override async void OnLoad(EventArgs e)
        {
            base.OnLoad(e);
            try
            {
                await StartWebView();
            }
            catch (WebView2RuntimeNotFoundException)
            {
                Program.OfferRuntimeDownload();
                BeginInvoke(new Action(Close));
            }
            catch (Exception ex)
            {
                Program.Fail("LNF Run Log could not start its web view.\n\n" + ex.Message
                    + "\n\nIf another copy of LNF Run Log is starting or closing, wait a moment and try again.");
                BeginInvoke(new Action(Close));
            }
        }

        async Task StartWebView()
        {
            Directory.CreateDirectory(dataParent);
            // Every launch passes identical options, so several windows can share
            // one user data folder (WebView2 refuses a mismatch).
            CoreWebView2EnvironmentOptions options = new CoreWebView2EnvironmentOptions();
            CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(
                null, Path.Combine(dataParent, "WebView2"), options);
            await view.EnsureCoreWebView2Async(env);
            CoreWebView2 core = view.CoreWebView2;
            core.Settings.AreDevToolsEnabled = devtools;
            core.SetVirtualHostNameToFolderMapping(AppHost, appDir, CoreWebView2HostResourceAccessKind.Allow);
            core.NavigationStarting += OnNavigationStarting;
            core.NewWindowRequested += OnNewWindowRequested;
            core.DocumentTitleChanged += OnTitleChanged;
            core.ProcessFailed += OnProcessFailed;
            // Lets the web app recognise the desktop wrapper (app/js/ui/pwa.js).
            await core.AddScriptToExecuteOnDocumentCreatedAsync(
                "window.LNF_DESKTOP = Object.freeze({ platform: 'windows', version: '" + BuildInfo.Version + "' });");
            core.Navigate(StartUrl);
        }

        /// <summary>True for the app's own pages; everything else opens in the default browser.</summary>
        static bool IsAppUrl(string uri)
        {
            Uri u;
            return Uri.TryCreate(uri, UriKind.Absolute, out u)
                && u.Scheme == Uri.UriSchemeHttps
                && string.Equals(u.Host, AppHost, StringComparison.OrdinalIgnoreCase);
        }

        void OnNavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs e)
        {
            if (IsAppUrl(e.Uri)) return;
            e.Cancel = true;
            OpenExternal(e.Uri);
        }

        void OnNewWindowRequested(object sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            e.Handled = true; // never a second WebView2 window
            if (IsAppUrl(e.Uri)) view.CoreWebView2.Navigate(e.Uri);
            else OpenExternal(e.Uri);
        }

        /// <summary>Open a web or mail link in the default browser or mail app; other schemes are ignored.</summary>
        public static void OpenExternal(string uri)
        {
            Uri u;
            if (!Uri.TryCreate(uri, UriKind.Absolute, out u)) return;
            if (u.Scheme != Uri.UriSchemeHttp && u.Scheme != Uri.UriSchemeHttps && u.Scheme != Uri.UriSchemeMailto) return;
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(u.AbsoluteUri);
                psi.UseShellExecute = true;
                Process.Start(psi);
            }
            catch (Exception) { /* no default browser: nothing else to do */ }
        }

        void OnTitleChanged(object sender, object e)
        {
            string t = view.CoreWebView2.DocumentTitle;
            Text = string.IsNullOrWhiteSpace(t) || t.Contains("://") ? AppInfo.Name : t;
        }

        void OnProcessFailed(object sender, CoreWebView2ProcessFailedEventArgs e)
        {
            if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited)
            {
                view.CoreWebView2.Reload(); // forms autosave, so a reload loses nothing
            }
            else if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited)
            {
                Program.Fail("LNF Run Log's web view stopped unexpectedly. Start LNF Run Log again.\n\n"
                    + "Everything you saved is kept.");
                BeginInvoke(new Action(Close));
            }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (!hiddenForClose)
            {
                placement.Save();
                if (view.CoreWebView2 != null && e.CloseReason != CloseReason.WindowsShutDown)
                {
                    // Hide first: the page sees visibilitychange and saves a half-typed
                    // form at once (app/js/ui/autosave.js); close half a second later,
                    // once IndexedDB has committed it. (Never delay a Windows shutdown.)
                    hiddenForClose = true;
                    e.Cancel = true;
                    Hide();
                    Timer t = new Timer();
                    t.Interval = 500;
                    t.Tick += delegate
                    {
                        t.Dispose();
                        Close();
                    };
                    t.Start();
                    return;
                }
            }
            base.OnFormClosing(e);
        }

        protected override void WndProc(ref Message m)
        {
            const int WM_DPICHANGED = 0x02E0;
            if (m.Msg == WM_DPICHANGED)
            {
                // Per-monitor DPI aware: take the size Windows suggests for the new screen.
                Rect r = (Rect)Marshal.PtrToStructure(m.LParam, typeof(Rect));
                SetBounds(r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top);
            }
            base.WndProc(ref m);
        }

        static bool WindowsUsesDarkMode()
        {
            try
            {
                object v = Registry.GetValue(
                    @"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1);
                return v is int && (int)v == 0;
            }
            catch (Exception)
            {
                return false;
            }
        }

        [DllImport("dwmapi.dll")]
        static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

        [StructLayout(LayoutKind.Sequential)]
        struct Rect
        {
            public int Left, Top, Right, Bottom;
        }
    }
}
