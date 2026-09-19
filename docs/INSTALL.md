# Installing Cutroom

Cutroom is not code-signed, so macOS and Windows will show a one-time
"unknown developer" warning on first install. The steps below get you
through it. Linux installs without warnings.

**Before you start:** install FFmpeg and make sure `ffmpeg` and `ffprobe`
run from a terminal. Cutroom needs them on your PATH.

## macOS — use the `.dmg`

Pick `Cutroom_0.1.0_aarch64.dmg` on Apple Silicon Macs, `Cutroom_0.1.0_x64.dmg`
on Intel Macs. (The `.app.tar.gz` files are the same app for manual installs.)

1. Open the `.dmg` and drag Cutroom into Applications.
2. Don't double-click it yet. Right-click (Ctrl-click) Cutroom in
   Applications, choose **Open**, then click **Open** in the dialog.
   That's it — macOS remembers your choice and later launches are normal.
3. If you already double-clicked and got blocked: open **System Settings →
   Privacy & Security**, scroll to the Security section, and click
   **Open Anyway** next to the Cutroom message.

## Windows — use the `-setup.exe`

Grab `Cutroom_0.1.0_x64-setup.exe`. (The `.msi` is the same installer for
managed/enterprise setups.)

1. Run the installer. SmartScreen will say "Windows protected your PC".
2. Click **More info**, then **Run anyway**.
3. Follow the installer. The warning appears only once.

## Linux — pick your format

- **Ubuntu / Debian:** `sudo apt install ./Cutroom_0.1.0_amd64.deb`
  (installs required system libraries automatically)
- **Fedora / RHEL:** `sudo dnf install ./Cutroom-0.1.0-1.x86_64.rpm`
- **Any distro:** `chmod +x Cutroom_0.1.0_amd64.AppImage` then double-click
  it or run it from a terminal. No installation needed.

After installing, launch Cutroom from your app menu. If video features
report missing tools, double-check `ffmpeg` is on your PATH (see above).
