import React, { useEffect, useState } from 'react';
import { ActivityLog, type ActivityEntry } from './components/ActivityLog';
import { StatusPill, type SyncStatus } from './components/StatusPill';
import { LoginPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';

interface PdSyncApi {
    getState(): Promise<{
        settings: {
            localFolder: string | null;
            remoteFolderName: string | null;
            syncDownloads: boolean;
            conflictStrategy: 'newest' | 'rename';
            closeToTray: boolean;
        };
        loggedIn: boolean;
        activity: ActivityEntry[];
    }>;
    login(): Promise<{ ok: boolean; error?: string }>;
    logout(): Promise<{ ok: boolean }>;
    listFolders(): Promise<{ ok: boolean; root?: any; error?: string }>;
    listChildren(uid: string): Promise<{ ok: boolean; children?: any[]; error?: string }>;
    pickLocalFolder(): Promise<{ ok: boolean; path?: string }>;
    saveSettings(settings: any): Promise<{ ok: boolean }>;
    triggerSync(): Promise<{ ok: boolean }>;
    on(channel: string, cb: (payload: any) => void): () => void;
}

declare global {
    interface Window {
        pdSync: PdSyncApi;
    }
}

export default function App() {
    const [ready, setReady] = useState(false);
    const [loggedIn, setLoggedIn] = useState(false);
    const [status, setStatus] = useState<SyncStatus>({ state: 'idle', lastSync: null, queue: 0 });
    const [activity, setActivity] = useState<ActivityEntry[]>([]);
    const [settings, setSettings] = useState<any>(null);

    useEffect(() => {
        let mounted = true;
        void window.pdSync.getState().then((state) => {
            if (!mounted) {
                return;
            }
            setLoggedIn(state.loggedIn);
            setActivity(state.activity ?? []);
            setSettings(state.settings);
            setReady(true);
        });
        const offs = [
            window.pdSync.on('status', (s: SyncStatus) => setStatus(s)),
            window.pdSync.on('activity', (a: ActivityEntry) =>
                setActivity((prev) => [...prev.slice(-499), a]),
            ),
            window.pdSync.on('auth:loggedIn', (v: boolean) => setLoggedIn(v)),
        ];
        return () => offs.forEach((off) => off());
    }, []);

    if (!ready) {
        return <div className="app"><main><p>Loading…</p></main></div>;
    }

    return (
        <div className="app">
            <header>
                <h1>Proton Drive Tray Sync</h1>
                <span className="spacer" />
                <StatusPill status={status} />
                {loggedIn && (
                    <button className="secondary" onClick={() => void window.pdSync.logout()}>
                        Sign out
                    </button>
                )}
            </header>
            <main>
                {!loggedIn ? (
                    <LoginPage onLoggedIn={() => setLoggedIn(true)} />
                ) : (
                    <>
                        <SetupPage settings={settings} onSaved={(s) => setSettings(s)} />
                        <ActivityLog activity={activity} />
                    </>
                )}
            </main>
        </div>
    );
}
