// LNF Run Log for Windows: names shared by the app and its setup, the
// AppUserModelID, and .lnk shortcuts (IShellLinkW + IPropertyStore).
// C# 5 for the .NET Framework compiler that ships with Windows; built by
// scripts/build-windows.mjs.
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

namespace LnfRunLog
{
    /// <summary>Names and folders shared by the app and its setup.</summary>
    static class AppInfo
    {
        public const string Name = "LNF Run Log";
        public const string Publisher = "LNF Run Log";
        public const string ExeName = "LNF Run Log.exe";
        public const string IconName = "LNF Run Log.ico";
        public const string UninstallerName = "Uninstall LNF Run Log.exe";
        public const string ShortcutName = "LNF Run Log.lnk";
        public const string Description = "Log and look up cleanroom process runs";

        /// <summary>
        /// Taskbar identity. The app sets it on its process and the setup
        /// writes it into both shortcuts, so a pinned shortcut and the running
        /// window share one taskbar button. Keep the two in step.
        /// </summary>
        public const string AppUserModelId = "LNFRunLog.Desktop";

        /// <summary>
        /// Parent of the WebView2 user data folder (all run data) and
        /// window.txt: %LOCALAPPDATA%\LNF Run Log, or LNF_RUNLOG_DATA (tests).
        /// </summary>
        public static string DataParent()
        {
            string over = Environment.GetEnvironmentVariable("LNF_RUNLOG_DATA");
            if (!string.IsNullOrWhiteSpace(over)) return Path.GetFullPath(over.Trim());
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Name);
        }

        /// <summary>True when child is the folder itself or anywhere inside it.</summary>
        public static bool IsInside(string child, string folder)
        {
            if (string.IsNullOrEmpty(child) || string.IsNullOrEmpty(folder)) return false;
            string c = Path.GetFullPath(child).TrimEnd('\\');
            string f = Path.GetFullPath(folder).TrimEnd('\\');
            return string.Equals(c, f, StringComparison.OrdinalIgnoreCase)
                || c.StartsWith(f + "\\", StringComparison.OrdinalIgnoreCase);
        }
    }

    /// <summary>Shell helpers: process AppUserModelID and .lnk shortcuts.</summary>
    static class Shell
    {
        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
        static extern void SetCurrentProcessExplicitAppUserModelID(string appId);

        [DllImport("ole32.dll")]
        static extern int PropVariantClear(ref PropVariant pvar);

        const ushort VT_LPWSTR = 31;
        static readonly Guid AppUserModelFormat = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
        const uint AppUserModelIdPid = 5; // PKEY_AppUserModel_ID = {9F4C2855-...},5

        /// <summary>Give this process the app's taskbar identity. Call before any window opens.</summary>
        public static void SetProcessAppId()
        {
            try { SetCurrentProcessExplicitAppUserModelID(AppInfo.AppUserModelId); }
            catch (Exception) { /* Taskbar grouping is cosmetic. */ }
        }

        /// <summary>Write a shortcut that carries the app's AppUserModelID.</summary>
        public static void CreateShortcut(string lnkPath, string target, string workingDir, string iconPath, string description, string appId)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(lnkPath));
            IShellLinkW link = (IShellLinkW)new ShellLinkObject();
            try
            {
                link.SetPath(target);
                link.SetWorkingDirectory(workingDir);
                link.SetDescription(description);
                link.SetIconLocation(iconPath, 0);
                IPropertyStore store = (IPropertyStore)link;
                PropertyKey key = new PropertyKey(AppUserModelFormat, AppUserModelIdPid);
                PropVariant value = new PropVariant();
                value.vt = VT_LPWSTR;
                value.p = Marshal.StringToCoTaskMemUni(appId);
                try
                {
                    store.SetValue(ref key, ref value);
                    store.Commit();
                }
                finally
                {
                    PropVariantClear(ref value);
                }
                ((IPersistFile)link).Save(lnkPath, true);
            }
            finally
            {
                Marshal.FinalReleaseComObject(link);
            }
        }

        /// <summary>Read a shortcut's target path and AppUserModelID (either may be empty).</summary>
        public static void ReadShortcut(string lnkPath, out string target, out string appId)
        {
            target = "";
            appId = "";
            IShellLinkW link = (IShellLinkW)new ShellLinkObject();
            try
            {
                ((IPersistFile)link).Load(lnkPath, 0);
                StringBuilder sb = new StringBuilder(1024);
                link.GetPath(sb, sb.Capacity, IntPtr.Zero, 0);
                target = sb.ToString();
                IPropertyStore store = (IPropertyStore)link;
                PropertyKey key = new PropertyKey(AppUserModelFormat, AppUserModelIdPid);
                PropVariant value;
                store.GetValue(ref key, out value);
                try
                {
                    if (value.vt == VT_LPWSTR && value.p != IntPtr.Zero) appId = Marshal.PtrToStringUni(value.p);
                }
                finally
                {
                    PropVariantClear(ref value);
                }
            }
            finally
            {
                Marshal.FinalReleaseComObject(link);
            }
        }

        /// <summary>Delete a shortcut, but only one that points into folder. Returns true when deleted.</summary>
        public static bool DeleteShortcutInto(string lnkPath, string folder)
        {
            if (!File.Exists(lnkPath)) return false;
            string target, appId;
            try { ReadShortcut(lnkPath, out target, out appId); }
            catch (Exception) { return false; }
            if (!AppInfo.IsInside(target, folder)) return false;
            File.Delete(lnkPath);
            return true;
        }

        [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
        class ShellLinkObject { }

        [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IShellLinkW
        {
            void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int cch, IntPtr findData, uint flags);
            void GetIDList(out IntPtr pidl);
            void SetIDList(IntPtr pidl);
            void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder name, int cch);
            void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
            void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder dir, int cch);
            void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string dir);
            void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder args, int cch);
            void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string args);
            void GetHotkey(out short hotkey);
            void SetHotkey(short hotkey);
            void GetShowCmd(out int showCmd);
            void SetShowCmd(int showCmd);
            void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder iconPath, int cch, out int icon);
            void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string iconPath, int icon);
            void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string pathRel, uint reserved);
            void Resolve(IntPtr hwnd, uint flags);
            void SetPath([MarshalAs(UnmanagedType.LPWStr)] string file);
        }

        [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IPropertyStore
        {
            void GetCount(out uint count);
            void GetAt(uint index, out PropertyKey key);
            void GetValue(ref PropertyKey key, out PropVariant value);
            void SetValue(ref PropertyKey key, ref PropVariant value);
            void Commit();
        }

        [StructLayout(LayoutKind.Sequential, Pack = 4)]
        struct PropertyKey
        {
            public Guid fmtid;
            public uint pid;
            public PropertyKey(Guid fmtid, uint pid) { this.fmtid = fmtid; this.pid = pid; }
        }

        /// <summary>PROPVARIANT: 16 bytes on x86, 24 on x64, like the native struct.</summary>
        [StructLayout(LayoutKind.Sequential)]
        struct PropVariant
        {
            public ushort vt;
            public ushort reserved1, reserved2, reserved3;
            public IntPtr p;
            public IntPtr p2;
        }
    }
}
