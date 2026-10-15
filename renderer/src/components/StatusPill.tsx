import React from 'react';

export interface SyncStatus {
    state: 'idle' | 'syncing' | 'error' | 'paused';
    lastSync: number | null;
    queue: number;
}

export function StatusPill({ status }: { status: SyncStatus }) {
    const label =
        status.state === 'syncing'
            ? `Syncing${status.queue > 0 ? ` (${status.queue})` : ''}`
            : status.state === 'error'
              ? 'Error'
              : status.state === 'paused'
                ? 'Paused'
                : status.lastSync
                  ? `Up to date · ${new Date(status.lastSync).toLocaleTimeString()}`
                  : 'Idle';
    return <span className={`status-pill ${status.state}`}>{label}</span>;
}
