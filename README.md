# Proton Drive Tray Sync (pd-tray-sync)

An unofficial **Linux desktop app** that keeps a local folder in sync with a folder in your **Proton Drive** account. It lives in the **system tray** when you close the window and keeps syncing in the background. Built for Linux Mint Cinnamon (works on any modern Linux desktop).

> **This is a third-party application not officially supported by Proton.**

Built on the official [Proton Drive SDK](https://www.npmjs.com/package/@protontech/drive-sdk) (`@protontech/drive-sdk`) — the same implementation used by Proton's first-party clients.

## Features

- **GUI** — sign in with your browser, pick a local folder, browse and pick a Proton Drive folder, all from a friendly window.
- **System tray** — closing the window keeps the app running in the tray; use the tray menu to reopen or quit.
- **Two-way sync on change**
  - Local changes (new/edited files and folders, deletions) are uploaded automatically as they happen (via filesystem watching).
  - Remote changes are downloaded automatically via Drive **event-based updates** (no polling; complies with Proton's third-party guidelines).
- **Conflict handling** — choose between "keep the newest version" or "keep both files" (a conflict copy is created).
- **Safety** — content integrity is verified with SHA-1 during upload and download; uploads include expected size and modification time.
- Your session is stored locally on your computer only (`~/.config/<app>/session.json`, readable only by your user).

## Requirements

- Linux with a desktop environment (tray icon uses your DE's notification area — on Mint Cinnamon this works out of the box).
- Node.js 22+ and npm (for running from source).

## Getting started

```bash
git clone https://github.com/ezstyle42/pd-tray-sync.git
cd pd-tray-sync
npm install        # also applies the required @protontech/crypto patch
npm run build
npm start
```

First run:

1. Click **Sign in with Proton** — your browser opens the Proton sign-in page (you can sign in on another device if you copy the link).
2. Back in the app, choose a **local folder** (e.g. `~/ProtonDrive`) and a **Proton Drive folder** to sync it with.
3. Adjust options (download remote changes, conflict strategy, keep in tray) and click **Save & start syncing**.

The window can be closed — the app stays in the tray and keeps syncing. Right-click the tray icon to open the app, sync now, or quit.

## Building a package

```bash
npm run dist   # produces an AppImage in out/
```

## How it works

- **Electron** main process wires the Proton Drive SDK with:
  - the SDK's OpenPGP crypto proxy (`@protontech/crypto`),
  - a vendored copy of the SDK repo's incubating account module (`src/vendor/account`) for browser-based sign-in and session handling (this module is not published on npm; it is vendored for Node compatibility),
  - SDK in-memory caches and event subscriptions.
- **Local → remote**: `chokidar` watches the local folder; changed files are uploaded with SHA-1/size/mtime metadata; deletions move the remote node to trash (recoverable in Drive's trash).
- **Remote → local**: the SDK's `subscribeToDriveEvents` delivers node created/updated/deleted events; the engine reconciles the selected subtree and downloads changed files, preserving modification times.
- The app identifies itself as `external-drive-pd_tray_sync@<version>` in the `x-pm-appversion` header, per Proton's third-party requirements.

## Scope and limitations

- One synced folder pair (local folder ↔ Drive folder) per configuration.
- The Proton Drive SDK is pre-GA; expect interface changes until the SDK reaches general availability (including the upcoming cryptographic model change — this app will need an SDK upgrade then).
- Proton Drive's own official sync clients may use different conflict semantics; use the conflict strategy that suits you.
- No Proton branding: this is an unofficial product and is not affiliated with Proton AG.

## License

MIT. The vendored account module is MIT-licensed by Proton AG (see `src/vendor/account`).

Using Proton's hosted services remains subject to Proton's terms; third-party integration rules from the [SDK README](https://github.com/ProtonDriveApps/sdk) apply to this app.
