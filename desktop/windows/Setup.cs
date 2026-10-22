// LNF Run Log for Windows: the per-user installer and uninstaller (one exe).
// The payload (app folder, launcher, WebView2 DLLs, icon, licenses) is
// embedded as resources named "payload/<relative path>". C# 5 for the .NET
// Framework compiler that ships with Windows; built by
// scripts/build-windows.mjs with SetupFiles.cs, SetupForm.cs, Shell.cs and
// the generated BuildInfo.cs. See docs/DESKTOP.md.
//
//   Setup.exe                     dialog: install, or update an existing install
//   Setup.exe /uninstall          dialog: uninstall (also when the exe name starts with "Uninstall")
//   /S                            silent: no UI, yes to every question, data kept on uninstall
//   /D=<dir>                      install folder (default %LOCALAPPDATA%\Programs\LNF Run Log)
//   /SHORTCUTS=<dir>              both shortcuts go in <dir>\Start Menu and <dir>\Desktop instead
//   /NOREG  /NODESKTOP  /NOLAUNCH skip the Installed apps entry, the desktop shortcut, the start
//
// Exit codes: 0 done, 1 failed, 2 bad command line, 3 cancelled.
using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("LNF Run Log Setup")]
[assembly: AssemblyDescription("Installs LNF Run Log for this Windows account")]
[assembly: AssemblyProduct("LNF Run Log")]
[assembly: AssemblyCompany("LNF Run Log")]
[assembly: AssemblyVersion(LnfRunLog.BuildInfo.FileVersion)]
[assembly: AssemblyFileVersion(LnfRunLog.BuildInfo.FileVersion)]
[assembly: AssemblyInformationalVersion(LnfRunLog.BuildInfo.Version)]

namespace LnfRunLog
{
    static class Program
    {
        [STAThread]
        static int Main(string[] args)
        {
            Options opt;
            try
            {
                opt = Options.Parse(args, Application.ExecutablePath);
            }
            catch (ArgumentException ex)
            {
                if (Array.Exists(args, a => string.Equals(a, "/S", StringComparison.OrdinalIgnoreCase))) Console.Error.WriteLine(ex.Message);
                else MessageBox.Show(ex.Message, "LNF Run Log Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 2;
            }
            Installer inst = new Installer(opt);
            int code;
            if (opt.Silent)
            {
                code = RunSilent(inst);
            }
            else
            {
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                SetupForm form = new SetupForm(inst);
                Application.Run(form);
                code = form.ExitCode;
            }
            inst.DeleteSelfAfterExit();
            return code;
        }

        static int RunSilent(Installer inst)
        {
            try
            {
                bool done = inst.Opt.Uninstall ? inst.Uninstall(false, new SilentUi()) : inst.Install(!inst.Opt.NoDesktop, new SilentUi());
                if (!done) return 3;
                if (!inst.Opt.Uninstall && !inst.Opt.NoLaunch) inst.Launch();
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("LNF Run Log setup failed: " + ex.Message);
                return 1;
            }
        }
    }

    sealed class Options
    {
        public bool Silent, Uninstall, NoReg, NoDesktop, NoLaunch;
        public string InstallDir;  // /D=, else null
        public string ShortcutDir; // /SHORTCUTS=, else null (Start Menu and Desktop)

        public static Options Parse(string[] args, string exePath)
        {
            Options o = new Options();
            o.Uninstall = Path.GetFileName(exePath).StartsWith("Uninstall", StringComparison.OrdinalIgnoreCase);
            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i].ToUpperInvariant();
                if (a == "/S") o.Silent = true;
                else if (a == "/UNINSTALL") o.Uninstall = true;
                else if (a == "/NOREG") o.NoReg = true;
                else if (a == "/NODESKTOP") o.NoDesktop = true;
                else if (a == "/NOLAUNCH") o.NoLaunch = true;
                else if (a.StartsWith("/D=")) o.InstallDir = PathValue(args, ref i, 3);
                else if (a.StartsWith("/SHORTCUTS=")) o.ShortcutDir = PathValue(args, ref i, 11);
                else throw new ArgumentException("Unknown option: " + args[i] + "\n\nUse /S, /D=<folder>, /SHORTCUTS=<folder>, /NOREG, /NODESKTOP, /NOLAUNCH or /uninstall.");
            }
            return o;
        }

        // As in NSIS, an unquoted folder with spaces may run on into the next arguments.
        static string PathValue(string[] args, ref int i, int prefix)
        {
            StringBuilder sb = new StringBuilder(args[i].Substring(prefix));
            while (i + 1 < args.Length && !args[i + 1].StartsWith("/")) sb.Append(' ').Append(args[++i]);
            string v = sb.ToString().Trim().Trim('"');
            if (v.Length == 0) throw new ArgumentException(args[i] + " needs a folder.");
            return Path.GetFullPath(v);
        }
    }

    /// <summary>How the steps report progress and ask questions: the dialog, or silent mode (yes to all).</summary>
    interface ISetupUi
    {
        void Status(string text);
        bool Ask(string question, bool warning);
    }

    sealed class SilentUi : ISetupUi
    {
        public void Status(string text) { }
        public bool Ask(string question, bool warning) { return true; }
    }

    /// <summary>A failure with a message meant for the person.</summary>
    sealed class SetupException : Exception
    {
        public SetupException(string message) : base(message) { }
    }

    /// <summary>The install and uninstall steps; file and process mechanics are in SetupFiles.cs.</summary>
    sealed partial class Installer
    {
        const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\LNFRunLog";
        public readonly Options Opt;
        public readonly string Dir;

        public Installer(Options opt)
        {
            Opt = opt;
            Dir = (opt.InstallDir ?? DefaultDir(opt)).TrimEnd('\\');
        }

        /// <summary>True when Dir holds an install (the app exe or its uninstaller).</summary>
        public bool Existing
        {
            get { return File.Exists(Path.Combine(Dir, AppInfo.ExeName)) || File.Exists(Path.Combine(Dir, AppInfo.UninstallerName)); }
        }

        static string DefaultDir(Options opt)
        {
            // An explicit /D wins; otherwise the installed uninstaller works on its own folder.
            string own = Path.GetDirectoryName(Path.GetFullPath(Application.ExecutablePath));
            if (opt.Uninstall && File.Exists(Path.Combine(own, AppInfo.ExeName))) return own;
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", AppInfo.Name);
        }

        string Uninstaller
        {
            get { return Path.Combine(Dir, AppInfo.UninstallerName); }
        }

        /// <summary>True when this process is the uninstaller inside Dir.</summary>
        bool RunningFromDir
        {
            get { return SamePath(Application.ExecutablePath, Uninstaller); }
        }

        /// <summary>Install or update. Returns false when the person chose not to close the running app.</summary>
        public bool Install(bool desktopShortcut, ISetupUi ui)
        {
            if (Directory.Exists(Dir) && !Existing && Directory.EnumerateFileSystemEntries(Dir).Any())
            {
                throw new SetupException("The folder " + Dir + " is not empty and does not hold LNF Run Log. Choose a new or empty folder.");
            }
            if (!CloseRunning(ui)) return false;
            string[] names = PayloadNames();
            CheckNotInUse(names);
            Directory.CreateDirectory(Dir);
            ExtractPayload(names, ui);
            if (!RunningFromDir)
            {
                string self = Path.GetFullPath(Application.ExecutablePath);
                Retry(delegate { File.Copy(self, Uninstaller, true); });
            }
            ui.Status("Creating shortcuts…");
            string exe = Path.Combine(Dir, AppInfo.ExeName);
            string icon = Path.Combine(Dir, AppInfo.IconName);
            Shell.CreateShortcut(StartMenuShortcut(), exe, Dir, icon, AppInfo.Description, AppInfo.AppUserModelId);
            string desktop = DesktopShortcut();
            if (desktopShortcut) Shell.CreateShortcut(desktop, exe, Dir, icon, AppInfo.Description, AppInfo.AppUserModelId);
            else Shell.DeleteShortcutInto(desktop, Dir);
            if (!Opt.NoReg) Register(icon);
            ui.Status("Done.");
            return true;
        }

        /// <summary>Uninstall. Returns false when the person chose not to close the running app.</summary>
        public bool Uninstall(bool deleteData, ISetupUi ui)
        {
            if (!CloseRunning(ui)) return false;
            if (Existing) CheckNotInUse(PayloadNames());
            ui.Status("Removing shortcuts…");
            Shell.DeleteShortcutInto(StartMenuShortcut(), Dir);
            Shell.DeleteShortcutInto(DesktopShortcut(), Dir);
            if (!Opt.NoReg) Unregister();
            ui.Status("Removing program files…");
            RemoveProgramFiles();
            if (deleteData)
            {
                ui.Status("Deleting run data…");
                DeleteData();
            }
            ui.Status("Done.");
            return true;
        }

        public void Launch()
        {
            ProcessStartInfo psi = new ProcessStartInfo(Path.Combine(Dir, AppInfo.ExeName));
            psi.WorkingDirectory = Dir;
            psi.UseShellExecute = false;
            Process.Start(psi);
        }

        string StartMenuShortcut()
        {
            if (Opt.ShortcutDir != null) return Path.Combine(Opt.ShortcutDir, "Start Menu", AppInfo.ShortcutName);
            return Path.Combine(KnownFolder(Environment.SpecialFolder.Programs), AppInfo.ShortcutName);
        }

        string DesktopShortcut()
        {
            if (Opt.ShortcutDir != null) return Path.Combine(Opt.ShortcutDir, "Desktop", AppInfo.ShortcutName);
            // DesktopDirectory follows a OneDrive-redirected Desktop; never build %USERPROFILE%\Desktop by hand.
            return Path.Combine(KnownFolder(Environment.SpecialFolder.DesktopDirectory), AppInfo.ShortcutName);
        }

        static string KnownFolder(Environment.SpecialFolder f)
        {
            string p = Environment.GetFolderPath(f);
            if (string.IsNullOrEmpty(p)) throw new SetupException("Windows did not report the " + f + " folder.");
            return p;
        }

        void Register(string icon)
        {
            using (RegistryKey k = Registry.CurrentUser.CreateSubKey(UninstallKey))
            {
                k.SetValue("DisplayName", AppInfo.Name);
                k.SetValue("DisplayVersion", BuildInfo.Version);
                k.SetValue("Publisher", AppInfo.Publisher);
                k.SetValue("DisplayIcon", icon);
                k.SetValue("InstallLocation", Dir);
                k.SetValue("UninstallString", "\"" + Uninstaller + "\"");
                k.SetValue("QuietUninstallString", "\"" + Uninstaller + "\" /S");
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                k.SetValue("EstimatedSize", (int)Math.Min(int.MaxValue, FolderBytes(Dir) / 1024), RegistryValueKind.DWord);
                k.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd", CultureInfo.InvariantCulture));
            }
        }

        void Unregister()
        {
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(UninstallKey))
            {
                if (k == null) return;
                string location = k.GetValue("InstallLocation") as string;
                if (!string.IsNullOrEmpty(location) && !SamePath(location, Dir)) return; // the entry belongs to another install
            }
            Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false);
        }
    }
}
