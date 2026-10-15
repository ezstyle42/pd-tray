import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export interface AppSettings {
    localFolder: string | null;
    remoteFolderUid: string | null;
    remoteFolderName: string | null;
    syncDownloads: boolean;
    conflictStrategy: 'newest' | 'rename';
    closeToTray: boolean;
}

export function defaultSettings(): AppSettings {
    return {
        localFolder: null,
        remoteFolderUid: null,
        remoteFolderName: null,
        syncDownloads: true,
        conflictStrategy: 'newest',
        closeToTray: true,
    };
}

export function settingsPath(): string {
    return path.join(app.getPath('userData'), 'settings.json');
}

export function loadSettings(): AppSettings {
    try {
        const raw = fs.readFileSync(settingsPath(), 'utf8');
        return { ...defaultSettings(), ...JSON.parse(raw) };
    } catch {
        return defaultSettings();
    }
}

export function saveSettings(settings: AppSettings): void {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), { mode: 0o600 });
}
