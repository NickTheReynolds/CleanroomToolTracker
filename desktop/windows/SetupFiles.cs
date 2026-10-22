// LNF Run Log for Windows: the setup's file and process mechanics. It
// writes and deletes only what the payload names, and closes only copies
// of the app that run from the install folder. C# 5; built by
// scripts/build-windows.mjs with Setup.cs.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;

namespace LnfRunLog
{
    sealed partial class Installer
    {
        const string Prefix = "payload/";
        string selfToDelete;

        /// <summary>The installed uninstaller cannot delete its own exe while it runs; a hidden cmd does it after exit.</summary>
        public void DeleteSelfAfterExit()
        {
            if (selfToDelete == null) return;
            string cmd = "/c ping -n 4 127.0.0.1 >nul & del /f /q \"" + selfToDelete + "\" & rmdir \"" + Path.GetDirectoryName(selfToDelete) + "\"";
            ProcessStartInfo psi = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "cmd.exe"), cmd);
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.WindowStyle = ProcessWindowStyle.Hidden;
            psi.WorkingDirectory = Path.GetTempPath(); // not the folder being removed
            try { Process.Start(psi); } catch (Exception) { /* the empty folder stays behind */ }
        }

        static string[] PayloadNames()
        {
            return Assembly.GetExecutingAssembly().GetManifestResourceNames()
                .Where(n => n.StartsWith(Prefix, StringComparison.Ordinal))
                .OrderBy(n => n, StringComparer.Ordinal).ToArray();
        }

        static bool IsTopLevel(string name)
        {
            return name.IndexOf('/', Prefix.Length) < 0;
        }

        static IEnumerable<string> TopLevelDirs(string[] names)
        {
            return names.Where(n => !IsTopLevel(n)).Select(n => n.Substring(Prefix.Length, n.IndexOf('/', Prefix.Length) - Prefix.Length))
                .Distinct(StringComparer.OrdinalIgnoreCase);
        }

        /// <summary>
        /// Top-level files first: a running copy would lock those, and failing
        /// there leaves the old app folder intact. Then each folder (app\) is
        /// replaced whole, which drops files an older version had.
        /// </summary>
        void ExtractPayload(string[] names, ISetupUi ui)
        {
            string[] ordered = names.Where(IsTopLevel).Concat(names.Where(n => !IsTopLevel(n))).ToArray();
            bool cleared = false;
            for (int i = 0; i < ordered.Length; i++)
            {
                if (!cleared && !IsTopLevel(ordered[i]))
                {
                    foreach (string sub in TopLevelDirs(names))
                    {
                        string old = Path.Combine(Dir, sub);
                        if (Directory.Exists(old)) Retry(delegate { Directory.Delete(old, true); });
                    }
                    cleared = true;
                }
                ui.Status(string.Format(CultureInfo.InvariantCulture, "Copying files… {0} of {1}", i + 1, ordered.Length));
                Extract(ordered[i]);
            }
        }

        void Extract(string name)
        {
            string dest = Path.GetFullPath(Path.Combine(Dir, name.Substring(Prefix.Length).Replace('/', '\\')));
            if (!AppInfo.IsInside(dest, Dir) || SamePath(dest, Dir)) throw new SetupException("Bad payload name: " + name);
            Directory.CreateDirectory(Path.GetDirectoryName(dest));
            Retry(delegate
            {
                using (Stream src = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
                using (FileStream dst = new FileStream(dest, FileMode.Create, FileAccess.Write, FileShare.None))
                {
                    src.CopyTo(dst);
                }
            });
        }

        /// <summary>
        /// Fail before changing anything when a program file is locked, for
        /// example by a copy of the app this setup could not find.
        /// </summary>
        void CheckNotInUse(string[] names)
        {
            List<string> files = names.Where(IsTopLevel).Select(n => Path.Combine(Dir, n.Substring(Prefix.Length))).ToList();
            if (!RunningFromDir) files.Add(Uninstaller);
            foreach (string f in files.Where(File.Exists))
            {
                try
                {
                    Retry(delegate { using (new FileStream(f, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) { } });
                }
                catch (Exception ex)
                {
                    if (!(ex is IOException || ex is UnauthorizedAccessException)) throw;
                    throw new SetupException(f + " is in use. Close LNF Run Log, then try again. Nothing was changed.");
                }
            }
        }

        /// <summary>Delete what the payload installed (plus this folder when empty), never anything else.</summary>
        void RemoveProgramFiles()
        {
            if (!Existing) return;
            string[] names = PayloadNames();
            foreach (string name in names.Where(IsTopLevel))
            {
                string f = Path.Combine(Dir, name.Substring(Prefix.Length));
                if (File.Exists(f)) Retry(delegate { File.Delete(f); });
            }
            foreach (string sub in TopLevelDirs(names))
            {
                string d = Path.Combine(Dir, sub);
                if (Directory.Exists(d)) Retry(delegate { Directory.Delete(d, true); });
            }
            if (RunningFromDir) selfToDelete = Path.GetFullPath(Uninstaller);
            else if (File.Exists(Uninstaller)) Retry(delegate { File.Delete(Uninstaller); });
            try
            {
                if (selfToDelete == null && !Directory.EnumerateFileSystemEntries(Dir).Any()) Directory.Delete(Dir);
            }
            catch (IOException) { /* in use or not empty: leave it */ }
        }

        /// <summary>Delete the WebView2 profile (all run data) and window.txt; other files in the folder stay.</summary>
        static void DeleteData()
        {
            string parent = AppInfo.DataParent();
            string profile = Path.Combine(parent, "WebView2");
            // WebView2's browser processes exit a moment after the app window closes.
            for (int i = 0; Directory.Exists(profile); i++)
            {
                try
                {
                    Directory.Delete(profile, true);
                }
                catch (Exception ex)
                {
                    if (!(ex is IOException || ex is UnauthorizedAccessException)) throw;
                    if (i >= 40) throw new SetupException("Some run data could not be deleted. Delete this folder yourself: " + profile);
                    Thread.Sleep(250);
                }
            }
            try
            {
                File.Delete(Path.Combine(parent, "window.txt"));
                if (Directory.Exists(parent) && !Directory.EnumerateFileSystemEntries(parent).Any()) Directory.Delete(parent);
            }
            catch (IOException) { /* harmless leftovers */ }
        }

        /// <summary>Ask running copies of the installed app to close. False when the person says no.</summary>
        bool CloseRunning(ISetupUi ui)
        {
            List<Process> running = RunningCopies();
            if (running.Count == 0) return true;
            if (!ui.Ask("LNF Run Log is open. Close it now to continue?\n\nIts forms save themselves as you type.", false)) return false;
            ui.Status("Closing LNF Run Log…");
            foreach (Process p in running)
            {
                try { p.CloseMainWindow(); } catch (Exception) { }
            }
            if (WaitForExit(running, 10000)) return true;
            if (!ui.Ask("LNF Run Log did not close. Force it to close?\n\nTyping from the last second or two may be lost.", true)) return false;
            foreach (Process p in running)
            {
                try { if (!p.HasExited) p.Kill(); } catch (Exception) { }
            }
            if (WaitForExit(running, 5000)) return true;
            throw new SetupException("LNF Run Log is still running. Close it, then try again.");
        }

        /// <summary>Running "LNF Run Log.exe" processes started from this install folder, and no others.</summary>
        List<Process> RunningCopies()
        {
            string dirFinal = FinalPath(Dir);
            List<Process> list = new List<Process>();
            foreach (Process p in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(AppInfo.ExeName)))
            {
                // Windows reports the exe path with junctions resolved, so compare final paths too.
                string path = ProcessPath(p.Id);
                if (path != null && (AppInfo.IsInside(path, Dir) || AppInfo.IsInside(FinalPath(path), dirFinal))) list.Add(p);
                else p.Dispose();
            }
            return list;
        }

        static bool WaitForExit(List<Process> procs, int ms)
        {
            DateTime end = DateTime.UtcNow.AddMilliseconds(ms);
            foreach (Process p in procs)
            {
                int left = (int)Math.Max(0, (end - DateTime.UtcNow).TotalMilliseconds);
                try { if (!p.WaitForExit(left)) return false; } catch (Exception) { /* gone */ }
            }
            return true;
        }

        /// <summary>Retry briefly: virus scanners and sync tools hold new files for a moment.</summary>
        static void Retry(Action action)
        {
            for (int i = 0; ; i++)
            {
                try
                {
                    action();
                    return;
                }
                catch (Exception ex)
                {
                    if (!(ex is IOException || ex is UnauthorizedAccessException) || i >= 20) throw;
                }
                Thread.Sleep(250);
            }
        }

        static long FolderBytes(string dir)
        {
            return new DirectoryInfo(dir).EnumerateFiles("*", SearchOption.AllDirectories).Sum(f => f.Length);
        }

        /// <summary>The same file or folder, also when one path goes through a junction or symbolic link.</summary>
        static bool SamePath(string a, string b)
        {
            Func<string, string> norm = p => Path.GetFullPath(p).TrimEnd('\\');
            return string.Equals(norm(a), norm(b), StringComparison.OrdinalIgnoreCase)
                || string.Equals(norm(FinalPath(a)), norm(FinalPath(b)), StringComparison.OrdinalIgnoreCase);
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder name, ref int size);

        [DllImport("kernel32.dll")]
        static extern bool CloseHandle(IntPtr handle);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern uint GetFinalPathNameByHandle(SafeFileHandle file, StringBuilder path, uint size, uint flags);

        /// <summary>Full exe path of a process (junctions resolved), also across 32/64-bit; null when unreadable.</summary>
        static string ProcessPath(int pid)
        {
            IntPtr h = OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION
            if (h == IntPtr.Zero) return null;
            try
            {
                StringBuilder sb = new StringBuilder(1024);
                int size = sb.Capacity;
                return QueryFullProcessImageName(h, 0, sb, ref size) ? sb.ToString(0, size) : null;
            }
            finally
            {
                CloseHandle(h);
            }
        }

        /// <summary>A path with junctions and symbolic links resolved; the input when it cannot be resolved.</summary>
        static string FinalPath(string path)
        {
            // Share everything, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS so folders open too.
            using (SafeFileHandle h = CreateFile(path, 0, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero))
            {
                if (h.IsInvalid) return path;
                StringBuilder sb = new StringBuilder(1024);
                uint n = GetFinalPathNameByHandle(h, sb, (uint)sb.Capacity, 0);
                if (n == 0 || n >= sb.Capacity) return path;
                string s = sb.ToString();
                if (s.StartsWith(@"\\?\UNC\", StringComparison.Ordinal)) return @"\\" + s.Substring(8);
                return s.StartsWith(@"\\?\", StringComparison.Ordinal) ? s.Substring(4) : s;
            }
        }
    }
}
