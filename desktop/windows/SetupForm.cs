// LNF Run Log for Windows: the setup and uninstall dialog. The steps run on
// a worker thread (STA, for the shell link COM objects) so the window stays
// responsive while a running copy of the app closes. C# 5; built by
// scripts/build-windows.mjs with Setup.cs.
using System;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

namespace LnfRunLog
{
    sealed class SetupForm : Form
    {
        readonly Installer inst;
        readonly bool uninstall;
        readonly bool update;
        readonly CheckBox desktop = new CheckBox();
        readonly CheckBox launch = new CheckBox();
        readonly CheckBox deleteData = new CheckBox();
        readonly Label status = new Label();
        readonly Button ok = new Button();
        readonly Button cancel = new Button();
        bool busy;

        /// <summary>Exit code for Main: 0 done, 1 failed, 3 cancelled.</summary>
        public int ExitCode = 3;

        public SetupForm(Installer inst)
        {
            this.inst = inst;
            uninstall = inst.Opt.Uninstall;
            update = !uninstall && inst.Existing;
            Text = uninstall ? "Uninstall LNF Run Log" : "LNF Run Log Setup";
            Font = SystemFonts.MessageBoxFont;
            Icon = SetupIcon();
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            AutoSize = true;
            AutoSizeMode = AutoSizeMode.GrowAndShrink;
            Padding = new Padding(Font.Height);
            int wrap = Font.Height * 30;

            FlowLayoutPanel body = new FlowLayoutPanel();
            body.FlowDirection = FlowDirection.TopDown;
            body.WrapContents = false;
            body.AutoSize = true;
            body.AutoSizeMode = AutoSizeMode.GrowAndShrink;
            body.Location = new Point(Padding.Left, Padding.Top);

            Label title = new Label();
            title.AutoSize = true;
            title.Font = new Font(Font.FontFamily, Font.Size * 1.5f, FontStyle.Bold);
            title.Text = AppInfo.Name + " " + BuildInfo.Version;
            title.Margin = new Padding(0, 0, 0, Font.Height / 2);
            body.Controls.Add(title);
            body.Controls.Add(Paragraph(Intro(), wrap));

            if (uninstall)
            {
                AddCheck(body, deleteData, "Also delete my run data (cannot be undone; export a backup first)", false);
            }
            else
            {
                AddCheck(body, desktop, "Desktop shortcut", !inst.Opt.NoDesktop);
                AddCheck(body, launch, "Start LNF Run Log when done", !inst.Opt.NoLaunch);
            }
            status.AutoSize = true;
            status.MaximumSize = new Size(wrap, 0);
            status.Margin = new Padding(0, Font.Height / 2, 0, Font.Height / 2);
            body.Controls.Add(status);

            ok.Text = uninstall ? "Uninstall" : update ? "Update" : "Install";
            cancel.Text = "Cancel";
            foreach (Button b in new[] { ok, cancel })
            {
                b.AutoSize = true;
                b.MinimumSize = new Size(Font.Height * 6, 0);
                b.Padding = new Padding(Font.Height / 3, 2, Font.Height / 3, 2);
            }
            ok.Click += OnOk;
            cancel.Click += delegate { Close(); };
            AcceptButton = ok;
            CancelButton = cancel;
            FlowLayoutPanel buttons = new FlowLayoutPanel();
            buttons.FlowDirection = FlowDirection.RightToLeft;
            buttons.AutoSize = true;
            buttons.AutoSizeMode = AutoSizeMode.GrowAndShrink;
            buttons.Dock = DockStyle.Fill;
            buttons.Controls.Add(cancel);
            buttons.Controls.Add(ok);
            buttons.MinimumSize = new Size(wrap, 0);
            body.Controls.Add(buttons);
            Controls.Add(body);
        }

        string Intro()
        {
            if (uninstall)
            {
                return "Removes LNF Run Log, its shortcuts and its entry in Installed apps from\n" + inst.Dir + "\n\n"
                    + "Your run data stays on this PC unless you tick the box below.";
            }
            string where = "For this Windows account only; no administrator rights are needed.\nFolder: " + inst.Dir
                + "\n\nLicense: GNU AGPL v3 or later (see LICENSE.txt)";
            return update
                ? "LNF Run Log is already installed. Update replaces the program files; your run data is kept.\n\n" + where
                : "Installs LNF Run Log, an offline log and lookup for cleanroom process runs.\n\n" + where;
        }

        static Label Paragraph(string text, int wrap)
        {
            Label l = new Label();
            l.AutoSize = true;
            l.MaximumSize = new Size(wrap, 0);
            l.Text = text;
            l.Margin = new Padding(0, 0, 0, 8);
            return l;
        }

        static void AddCheck(Control parent, CheckBox box, string text, bool on)
        {
            box.Text = text;
            box.Checked = on;
            box.AutoSize = true;
            parent.Controls.Add(box);
        }

        static Icon SetupIcon()
        {
            try
            {
                using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload/" + AppInfo.IconName))
                {
                    if (s != null) return new Icon(s);
                }
            }
            catch (Exception) { /* fall back below */ }
            return Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            if (uninstall && !inst.Existing)
            {
                MessageBox.Show(this, "LNF Run Log is not installed in\n" + inst.Dir, Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
                ExitCode = 1;
                Close();
            }
        }

        void OnOk(object sender, EventArgs e)
        {
            if (uninstall && deleteData.Checked && MessageBox.Show(this,
                    "Delete all LNF Run Log data on this PC?\n\n" + AppInfo.DataParent()
                    + "\n\nThis cannot be undone. Export a backup first (Settings → Backup) if you might need it.",
                    Text, MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes)
            {
                return;
            }
            SetBusy(true);
            bool wantDesktop = desktop.Checked;
            bool wantDataGone = deleteData.Checked;
            FormUi ui = new FormUi(this, status);
            Thread worker = new Thread(delegate ()
            {
                bool done = false;
                Exception error = null;
                try
                {
                    done = uninstall ? inst.Uninstall(wantDataGone, ui) : inst.Install(wantDesktop, ui);
                }
                catch (Exception ex)
                {
                    error = ex;
                }
                BeginInvoke(new Action(delegate { Finish(done, error, wantDesktop, wantDataGone); }));
            });
            worker.SetApartmentState(ApartmentState.STA);
            worker.IsBackground = true;
            worker.Start();
        }

        void Finish(bool done, Exception error, bool withDesktop, bool dataDeleted)
        {
            SetBusy(false);
            if (error != null)
            {
                status.Text = "";
                ExitCode = 1;
                MessageBox.Show(this, (uninstall ? "Uninstall" : "Setup") + " did not finish.\n\n" + error.Message,
                    Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            if (!done)
            {
                status.Text = "Close LNF Run Log, then click " + ok.Text + " again.";
                return;
            }
            ExitCode = 0;
            string message;
            if (uninstall)
            {
                message = dataDeleted
                    ? "LNF Run Log and its run data were removed."
                    : "LNF Run Log was removed.\n\nYour run data was kept in\n" + AppInfo.DataParent() + "\nInstall LNF Run Log again to use it.";
            }
            else
            {
                message = (update ? "LNF Run Log is updated to " : "LNF Run Log ") + BuildInfo.Version + (update ? "." : " is installed.")
                    + "\n\nStart it from the Start menu" + (withDesktop ? " or the desktop shortcut." : ".");
            }
            MessageBox.Show(this, message, Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
            if (!uninstall && launch.Checked)
            {
                try
                {
                    inst.Launch();
                }
                catch (Exception ex)
                {
                    MessageBox.Show(this, "LNF Run Log could not start: " + ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
            }
            Close();
        }

        void SetBusy(bool on)
        {
            busy = on;
            UseWaitCursor = on;
            foreach (Control c in new Control[] { ok, cancel, desktop, launch, deleteData }) c.Enabled = !on;
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (busy) e.Cancel = true; // let the steps finish
            base.OnFormClosing(e);
        }

        /// <summary>Progress and questions from the worker thread, shown on the dialog's thread.</summary>
        sealed class FormUi : ISetupUi
        {
            readonly Form form;
            readonly Label label;

            public FormUi(Form form, Label label)
            {
                this.form = form;
                this.label = label;
            }

            public void Status(string text)
            {
                form.BeginInvoke(new Action(delegate { label.Text = text; }));
            }

            public bool Ask(string question, bool warning)
            {
                return (bool)form.Invoke(new Func<bool>(delegate
                {
                    return MessageBox.Show(form, question, form.Text, MessageBoxButtons.YesNo,
                        warning ? MessageBoxIcon.Warning : MessageBoxIcon.Question) == DialogResult.Yes;
                }));
            }
        }
    }
}
