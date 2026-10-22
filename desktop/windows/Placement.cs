// LNF Run Log for Windows: remembers the window's size, position and
// maximized state in <data folder>\window.txt (physical pixels; the app is
// per-monitor DPI aware). C# 5, built by scripts/build-windows.mjs.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Windows.Forms;

namespace LnfRunLog
{
    sealed class Placement
    {
        readonly Form form;
        readonly string file;
        FormWindowState lastState = FormWindowState.Normal;

        public Placement(Form form, string file)
        {
            this.form = form;
            this.file = file;
            form.Resize += delegate
            {
                if (form.WindowState != FormWindowState.Minimized) lastState = form.WindowState;
            };
        }

        /// <summary>Apply the saved placement, or a centred default when there is none or it is off screen.</summary>
        public void Restore()
        {
            float scale = SystemDpi() / 96f;
            form.MinimumSize = new Size((int)(360 * scale), (int)(420 * scale));
            form.StartPosition = FormStartPosition.Manual;
            Rectangle saved;
            bool maximized;
            if (TryLoad(out saved, out maximized) && OnSomeScreen(saved))
            {
                form.Bounds = saved;
                if (maximized) form.WindowState = FormWindowState.Maximized;
                return;
            }
            Rectangle work = Screen.PrimaryScreen.WorkingArea;
            int w = Math.Min((int)(1200 * scale), work.Width * 9 / 10);
            int h = Math.Min((int)(860 * scale), work.Height * 9 / 10);
            form.Bounds = new Rectangle(work.Left + (work.Width - w) / 2, work.Top + (work.Height - h) / 2, w, h);
        }

        /// <summary>Write the current placement. Never throws: closing must not fail over this.</summary>
        public void Save()
        {
            try
            {
                Rectangle b = form.WindowState == FormWindowState.Normal ? form.Bounds : form.RestoreBounds;
                bool max = form.WindowState == FormWindowState.Maximized
                    || (form.WindowState == FormWindowState.Minimized && lastState == FormWindowState.Maximized);
                if (b.Width <= 0 || b.Height <= 0) return;
                Directory.CreateDirectory(Path.GetDirectoryName(file));
                File.WriteAllText(file, string.Format(CultureInfo.InvariantCulture,
                    "# LNF Run Log window placement (physical pixels)\r\nleft={0}\r\ntop={1}\r\nwidth={2}\r\nheight={3}\r\nmaximized={4}\r\n",
                    b.Left, b.Top, b.Width, b.Height, max ? 1 : 0));
            }
            catch (Exception) { /* the next start uses the default placement */ }
        }

        bool TryLoad(out Rectangle r, out bool maximized)
        {
            r = Rectangle.Empty;
            maximized = false;
            try
            {
                if (!File.Exists(file)) return false;
                Dictionary<string, int> v = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
                foreach (string line in File.ReadAllLines(file))
                {
                    int eq = line.IndexOf('=');
                    int n;
                    if (eq > 0 && int.TryParse(line.Substring(eq + 1).Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out n))
                    {
                        v[line.Substring(0, eq).Trim()] = n;
                    }
                }
                int left, top, width, height, max;
                if (!v.TryGetValue("left", out left) || !v.TryGetValue("top", out top)
                    || !v.TryGetValue("width", out width) || !v.TryGetValue("height", out height)) return false;
                if (width < 200 || height < 200) return false;
                r = new Rectangle(left, top, width, height);
                maximized = v.TryGetValue("maximized", out max) && max != 0;
                return true;
            }
            catch (Exception)
            {
                return false;
            }
        }

        /// <summary>True when the title bar would be on a connected screen (monitors change).</summary>
        static bool OnSomeScreen(Rectangle r)
        {
            Rectangle grip = new Rectangle(r.Left + 40, r.Top, Math.Max(r.Width - 80, 1), 30);
            foreach (Screen s in Screen.AllScreens)
            {
                if (s.WorkingArea.IntersectsWith(grip)) return true;
            }
            return false;
        }

        static float SystemDpi()
        {
            try
            {
                using (Graphics g = Graphics.FromHwnd(IntPtr.Zero)) return g.DpiX;
            }
            catch (Exception)
            {
                return 96f;
            }
        }
    }
}
