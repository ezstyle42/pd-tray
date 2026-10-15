import React, { useEffect, useState } from 'react';

interface RemoteFolder {
    uid: string;
    name: string;
    type: string;
}

export function SetupPage({
    settings,
    onSaved,
}: {
    settings: any;
    onSaved: (s: any) => void;
}) {
    const [localFolder, setLocalFolder] = useState<string>(settings?.localFolder ?? '');
    const [remote, setRemote] = useState<RemoteFolder | null>(
        settings?.remoteFolderUid
            ? { uid: settings.remoteFolderUid, name: settings.remoteFolderName ?? 'Selected folder', type: 'folder' }
            : null,
    );
    const [syncDownloads, setSyncDownloads] = useState<boolean>(settings?.syncDownloads ?? true);
    const [conflictStrategy, setConflictStrategy] = useState<'newest' | 'rename'>(
        settings?.conflictStrategy ?? 'newest',
    );
    const [closeToTray, setCloseToTray] = useState<boolean>(settings?.closeToTray ?? true);
    const [browsing, setBrowsing] = useState(false);
    const [pathStack, setPathStack] = useState<{ uid: string; name: string }[]>([]);
    const [currentFolders, setCurrentFolders] = useState<RemoteFolder[]>([]);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function browse(uid?: string) {
        setBrowsing(true);
        setError(null);
        setSaved(false);
        try {
            let rootResult;
            if (uid) {
                const res = await window.pdSync.listChildren(uid);
                if (res.ok) {
                    setCurrentFolders((res.children ?? []).filter((c: any) => c.type === 'folder'));
                    return;
                }
                setError(res.error ?? 'Failed to list folders');
                return;
            }
            rootResult = await window.pdSync.listFolders();
            if (!rootResult.ok) {
                setError(rootResult.error ?? 'Failed to load Drive folders');
                return;
            }
            if (rootResult.root) {
                setPathStack([{ uid: rootResult.root.uid, name: rootResult.root.name }]);
                const res = await window.pdSync.listChildren(rootResult.root.uid);
                if (res.ok) {
                    setCurrentFolders((res.children ?? []).filter((c: any) => c.type === 'folder'));
                } else {
                    setError(res.error ?? 'Failed to list folders');
                }
            }
        } catch (e: any) {
            setError(e?.message ?? String(e));
        } finally {
            setBrowsing(false);
        }
    }

    async function enterFolder(folder: RemoteFolder) {
        setPathStack((prev) => [...prev, { uid: folder.uid, name: folder.name }]);
        await browse(folder.uid);
    }

    async function goToBreadcrumb(index: number) {
        const target = pathStack[index];
        setPathStack((prev) => prev.slice(0, index + 1));
        await browse(target.uid);
    }

    async function pickLocal() {
        const res = await window.pdSync.pickLocalFolder();
        if (res.ok && res.path) {
            setLocalFolder(res.path);
            setSaved(false);
        }
    }

    async function save() {
        setSaving(true);
        setError(null);
        try {
            const result = await window.pdSync.saveSettings({
                localFolder: localFolder || null,
                remoteFolderUid: remote?.uid ?? null,
                remoteFolderName: remote?.name ?? null,
                syncDownloads,
                conflictStrategy,
                closeToTray,
            });
            if (result.ok) {
                setSaved(true);
                onSaved({
                    ...settings,
                    localFolder,
                    remoteFolderUid: remote?.uid ?? null,
                    remoteFolderName: remote?.name ?? null,
                    syncDownloads,
                    conflictStrategy,
                    closeToTray,
                });
            }
        } catch (e: any) {
            setError(e?.message ?? String(e));
        } finally {
            setSaving(false);
        }
    }

    const configured = localFolder && remote;

    return (
        <>
            <section className="panel">
                <h2>Synchronized folders</h2>
                <div className="field">
                    <label>Local folder</label>
                    <div className="path-row">
                        <span className="path-value">{localFolder || 'Not selected'}</span>
                        <button className="secondary" onClick={() => void pickLocal()}>
                            Choose…
                        </button>
                    </div>
                </div>
                <div className="field">
                    <label>Proton Drive folder</label>
                    <div className="path-row">
                        <span className="path-value">{remote ? `/${remote.name}` : 'Not selected'}</span>
                        <button className="secondary" disabled={browsing} onClick={() => void browse()}>
                            {browsing ? 'Loading…' : 'Choose…'}
                        </button>
                        {remote && (
                            <button
                                className="secondary"
                                onClick={() => {
                                    setRemote(null);
                                    setSaved(false);
                                }}
                            >
                                Clear
                            </button>
                        )}
                    </div>
                </div>
                {error && (
                    <p style={{ color: 'var(--error)', fontSize: 13, whiteSpace: 'pre-wrap' }}>{error}</p>
                )}
                {browsing && pathStack.length > 0 && (
                    <div>
                        <div className="breadcrumb">
                            {pathStack.map((p, i) => (
                                <span key={p.uid}>
                                    <a onClick={() => void goToBreadcrumb(i)}>{p.name}</a>
                                    {i < pathStack.length - 1 ? ' / ' : ''}
                                </span>
                            ))}
                        </div>
                        <ul className="folder-list">
                            {currentFolders.length === 0 && <li className="crumbs">No subfolders here</li>}
                            {currentFolders.map((f) => (
                                <li key={f.uid}>
                                    <a onClick={() => void enterFolder(f)}>📁 {f.name}</a>
                                    <span className="spacer" />
                                    <button
                                        className="secondary"
                                        onClick={() => {
                                            setRemote(f);
                                            setBrowsing(false);
                                            setSaved(false);
                                        }}
                                    >
                                        Select this folder
                                    </button>
                                </li>
                            ))}
                        </ul>
                        <button
                            className="secondary"
                            style={{ marginTop: 8 }}
                            onClick={() => {
                                const top = pathStack[pathStack.length - 1];
                                setRemote({ uid: top.uid, name: top.name, type: 'folder' });
                                setBrowsing(false);
                                setSaved(false);
                            }}
                        >
                            Select {pathStack[pathStack.length - 1]?.name}
                        </button>
                    </div>
                )}
                <div className="field">
                    <label>Options</label>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, color: 'var(--text)' }}>
                        <input
                            type="checkbox"
                            checked={syncDownloads}
                            onChange={(e) => {
                                setSyncDownloads(e.target.checked);
                                setSaved(false);
                            }}
                        />
                        Download changes made in Proton Drive to this computer
                    </label>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, color: 'var(--text)' }}>
                        <input
                            type="checkbox"
                            checked={closeToTray}
                            onChange={(e) => {
                                setCloseToTray(e.target.checked);
                                setSaved(false);
                            }}
                        />
                        Keep running in the system tray when the window is closed
                    </label>
                </div>
                <div className="field">
                    <label>When both sides changed the same file</label>
                    <select
                        value={conflictStrategy}
                        onChange={(e) => {
                            setConflictStrategy(e.target.value as any);
                            setSaved(false);
                        }}
                    >
                        <option value="newest">Keep the newest version, overwrite the other</option>
                        <option value="rename">Keep both files (add “conflict” copy)</option>
                    </select>
                </div>
                <button disabled={!configured || saving} onClick={() => void save()}>
                    {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save & start syncing'}
                </button>
                {configured && (
                    <button className="secondary" style={{ marginLeft: 8 }} onClick={() => void window.pdSync.triggerSync()}>
                        Sync now
                    </button>
                )}
            </section>
        </>
    );
}
