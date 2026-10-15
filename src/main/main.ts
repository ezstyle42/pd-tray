import { BrowserWindow, Menu, Tray, app, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { initDriveCore, type DriveCore } from './driveCore';
import { loadSettings, saveSettings, type AppSettings } from './settings';
import { SyncEngine, type SyncActivity, type SyncStatus } from '../sync/engine';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let driveCore: DriveCore | null = null;
let driveCorePromise: Promise<DriveCore> | null = null;
let syncEngine: SyncEngine | null = null;
let settings: AppSettings = loadSettings();
let quitting = false;

const isDev = !app.isPackaged;

function getAsset(name: string): string {
    return path.join(__dirname, isDev ? '../../build' : '../build', name);
}

function createWindow(): void {
    mainWindow = new BrowserWindow({
        width: 980,
        height: 680,
        minWidth: 760,
        minHeight: 520,
        icon: getAsset('icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });
    mainWindow.on('close', (event) => {
        if (!quitting && settings.closeToTray && tray) {
            event.preventDefault();
            mainWindow?.hide();
        }
    });
    mainWindow.webContents.on('console-message', (_event, _level, message) => {
        console.log(`[renderer] ${message}`);
    });
    mainWindow.webContents.on('did-fail-load', (_event, code, desc, url) => {
        console.error(`[renderer] failed to load ${url}: ${code} ${desc}`);
    });
    const devUrl = process.env.PD_TRAY_SYNC_DEV_URL;
    if (devUrl) {
        mainWindow.loadURL(devUrl);
    } else {
        mainWindow.loadFile(path.join(__dirname, '../../renderer/dist/index.html'));
    }
}

function showWindow(): void {
    if (!mainWindow) {
        createWindow();
        return;
    }
    mainWindow.show();
    mainWindow.focus();
}

function createTray(): void {
    tray = new Tray(getAsset('icon.png'));
    updateTrayMenu();
    tray.on('double-click', () => showWindow());
}

function updateTrayMenu(): void {
    if (!tray) {
        return;
    }
    const menu = Menu.buildFromTemplate([
        { label: 'Open Proton Drive Tray Sync', click: () => showWindow() },
        { type: 'separator' },
        {
            label: 'Sync now',
            click: async () => {
                await triggerFullSync();
            },
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                quitting = true;
                app.quit();
            },
        },
    ]);
    tray.setContextMenu(menu);
    tray.setToolTip('Proton Drive Tray Sync');
}

async function triggerFullSync(): Promise<void> {
    if (!syncEngine || !settings.localFolder || !settings.remoteFolderUid) {
        return;
    }
    await syncEngine.handleRemoteEvent({
        type: 'fast_forward' as never,
        treeEventScopeId: 'core',
        eventId: 'manual',
    } as never);
}

function send(channel: string, payload: unknown): void {
    mainWindow?.webContents.send(channel, payload);
}

let activityBuffer: SyncActivity[] = [];

function pushActivity(activity: SyncActivity): void {
    activityBuffer.push(activity);
    if (activityBuffer.length > 500) {
        activityBuffer = activityBuffer.slice(-500);
    }
    send('activity', activity);
}

async function ensureCore(): Promise<DriveCore> {
    if (driveCore) {
        return driveCore;
    }
    if (!driveCorePromise) {
        driveCorePromise = initDriveCore()
            .then((core) => {
                driveCore = core;
                return core;
            })
            .catch((error: unknown) => {
                driveCorePromise = null;
                throw error;
            });
    }
    return driveCorePromise;
}

async function startSyncIfConfigured(): Promise<void> {
    const core = await ensureCore();
    if (!core.auth.isLoggedIn()) {
        send('status', { state: 'idle', lastSync: null, queue: 0 });
        return;
    }
    if (!syncEngine) {
        syncEngine = new SyncEngine(core.sdk);
        await core.setEventListener(async (event) => {
            await syncEngine?.handleRemoteEvent(event);
        });
    } else {
        syncEngine.setSdk(core.sdk);
    }
    if (!settings.localFolder || !settings.remoteFolderUid) {
        send('status', { state: 'idle', lastSync: null, queue: 0 });
        return;
    }
    try {
        await syncEngine.start({
            localFolder: settings.localFolder,
            remoteFolderUid: settings.remoteFolderUid,
            syncDownloads: settings.syncDownloads,
            conflictStrategy: settings.conflictStrategy,
            onActivity: pushActivity,
            onStatus: (status: SyncStatus) => send('status', status),
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        pushActivity({ time: Date.now(), direction: 'error', message: `Failed to start sync: ${message}` });
        send('status', { state: 'error', lastSync: null, queue: 0 });
    }
}

app.whenReady().then(async () => {
    createTray();
    createWindow();

    ipcMain.handle('app:getState', async () => {
        await ensureCore().catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            pushActivity({ time: Date.now(), direction: 'error', message: `Init failed: ${message}` });
        });
        return {
            settings,
            loggedIn: driveCore?.auth.isLoggedIn() ?? false,
            activity: activityBuffer,
        };
    });

    ipcMain.handle('auth:login', async () => {
        const core = await ensureCore();
        return new Promise((resolve) => {
            void core.auth
                .authViaWeb((signInUrl: string) => {
                    send('auth:signInUrl', signInUrl);
                    void shell.openExternal(signInUrl);
                })
                .then(async () => {
                    await startSyncIfConfigured();
                    send('auth:loggedIn', true);
                    resolve({ ok: true });
                })
                .catch((error: unknown) => {
                    const message = error instanceof Error ? error.message : String(error);
                    send('auth:error', message);
                    resolve({ ok: false, error: message });
                });
        });
    });

    ipcMain.handle('auth:logout', async () => {
        const core = await ensureCore();
        await syncEngine?.stop();
        await core.auth.logout();
        send('auth:loggedIn', false);
        return { ok: true };
    });

    ipcMain.handle('drive:listFolders', async () => {
        try {
            const core = await ensureCore();
            if (!core.auth.isLoggedIn()) {
                return { ok: false, error: 'Not signed in' };
            }
            const root = await core.sdk.getMyFilesRootFolder();
            return { ok: true, root: serializeNode(root) };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            console.error('[drive:listFolders]', error);
            return { ok: false, error: message };
        }
    });

    ipcMain.handle('drive:listChildren', async (_event, nodeUid: string) => {
        const children: unknown[] = [];
        try {
            const core = await ensureCore();
            const parent = await core.sdk.getNode(nodeUid);
            for await (const maybeChild of core.sdk.iterateFolderChildren(parent)) {
                if ('missingUid' in maybeChild) {
                    continue;
                }
                children.push(serializeNode(maybeChild));
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            console.error('[drive:listChildren]', error);
            return { ok: false, error: message };
        }
        return { ok: true, children };
    });

    ipcMain.handle('settings:pickLocalFolder', async () => {
        const result = await dialog.showOpenDialog(mainWindow!, {
            properties: ['openDirectory', 'createDirectory'],
        });
        if (result.canceled || result.filePaths.length === 0) {
            return { ok: false };
        }
        return { ok: true, path: result.filePaths[0] };
    });

    ipcMain.handle('settings:save', async (_event, newSettings: Partial<AppSettings>) => {
        const previous = settings;
        settings = { ...settings, ...newSettings };
        saveSettings(settings);
        if (
            syncEngine &&
            (previous.localFolder !== settings.localFolder ||
                previous.remoteFolderUid !== settings.remoteFolderUid)
        ) {
            await syncEngine.stop();
            await startSyncIfConfigured();
        }
        return { ok: true };
    });

    ipcMain.handle('sync:trigger', async () => {
        await triggerFullSync();
        return { ok: true };
    });

    await ensureCore().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        pushActivity({ time: Date.now(), direction: 'error', message: `Init failed: ${message}` });
    });
    await startSyncIfConfigured();
});

app.on('before-quit', async () => {
    await syncEngine?.stop();
    await driveCore?.dispose();
});

app.on('window-all-closed', () => {
    if (!settings.closeToTray) {
        quitting = true;
        app.quit();
    }
});

function serializeNode(node: any): unknown {
    return {
        uid: node.uid,
        name: node.name?.ok ? node.name.value : '(undecryptable)',
        type: node.type,
    };
}
