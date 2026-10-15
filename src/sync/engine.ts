import {
    DriveEventType,
    NodeEntity,
    NodeType,
    NodeWithSameNameExistsValidationError,
    type DriveEvent,
    type ProtonDriveClient,
    type UploadMetadata,
} from '@protontech/drive-sdk';
import chokidar, { type FSWatcher } from 'chokidar';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface SyncActivity {
    time: number;
    direction: 'up' | 'down' | 'info' | 'error';
    message: string;
}

export interface SyncStatus {
    state: 'idle' | 'syncing' | 'error' | 'paused';
    lastSync: number | null;
    queue: number;
}

export interface SyncOptions {
    localFolder: string;
    remoteFolderUid: string;
    syncDownloads: boolean;
    conflictStrategy: 'newest' | 'rename';
    onActivity(activity: SyncActivity): void;
    onStatus(status: SyncStatus): void;
}

const MIN_INTERVAL_MS = 1000;

export class SyncEngine {
    private sdk: ProtonDriveClient;
    private options: SyncOptions | null = null;
    private watcher: FSWatcher | null = null;
    private status: SyncStatus = { state: 'idle', lastSync: null, queue: 0 };
    private running = false;
    private pendingRemoteEvents = false;
    private pendingLocalChanges = new Set<string>();
    private applyRemoteByUs = new Set<string>();
    private queueSize = 0;
    private remoteScopeIds = new Set<string>();
    private disposed = false;

    constructor(sdk: ProtonDriveClient) {
        this.sdk = sdk;
    }

    setSdk(sdk: ProtonDriveClient): void {
        this.sdk = sdk;
    }

    async start(options: SyncOptions): Promise<void> {
        this.options = options;
        this.disposed = false;
        await fs.mkdir(options.localFolder, { recursive: true });

        const remote = await this.sdk.getNode(options.remoteFolderUid);
        this.remoteScopeIds.add(remote.treeEventScopeId);
        options.onActivity({ time: Date.now(), direction: 'info', message: `Sync started: ${remote.name.ok ? remote.name.value : 'folder'}` });

        await this.fullSync();

        this.watcher = chokidar.watch(options.localFolder, {
            ignored: /(^|[/\\])\./,
            ignoreInitial: true,
            awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
        });
        this.watcher
            .on('add', (fp) => this.onLocalChange(fp))
            .on('change', (fp) => this.onLocalChange(fp))
            .on('addDir', (fp) => this.onLocalChange(fp))
            .on('unlink', (fp) => this.onLocalDelete(fp, false))
            .on('unlinkDir', (fp) => this.onLocalDelete(fp, true))
            .on('error', (err) => {
                options.onActivity({ time: Date.now(), direction: 'error', message: `Watcher error: ${err.message}` });
            });

        this.setStatus({ state: 'idle' });
    }

    async stop(): Promise<void> {
        this.disposed = true;
        await this.watcher?.close();
        this.watcher = null;
    }

    async handleRemoteEvent(event: DriveEvent): Promise<void> {
        if (!this.options) {
            return;
        }
        if ('treeEventScopeId' in event) {
            this.remoteScopeIds.add(event.treeEventScopeId);
        }
        const relevant =
            event.type === DriveEventType.NodeCreated ||
            event.type === DriveEventType.NodeUpdated ||
            event.type === DriveEventType.NodeDeleted ||
            event.type === DriveEventType.FastForward ||
            event.type === DriveEventType.TreeRefresh;
        if (!relevant) {
            return;
        }
        this.pendingRemoteEvents = true;
        this.schedule();
    }

    private async onLocalChange(filePath: string): Promise<void> {
        if (this.isDownloadByUs(filePath)) {
            return;
        }
        this.pendingLocalChanges.add(filePath);
        this.schedule();
    }

    private async onLocalDelete(filePath: string, isDir: boolean): Promise<void> {
        if (this.isDownloadByUs(filePath)) {
            this.applyRemoteByUs.delete(filePath);
            return;
        }
        this.pendingLocalChanges.add(filePath);
        this.schedule();
    }

    private isDownloadByUs(filePath: string): boolean {
        for (const prefix of this.applyRemoteByUs) {
            if (filePath === prefix || filePath.startsWith(prefix + path.sep)) {
                return true;
            }
        }
        return false;
    }

    private timer: NodeJS.Timeout | null = null;

    private schedule(): void {
        if (this.timer) {
            return;
        }
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.run();
        }, MIN_INTERVAL_MS);
    }

    private setStatus(partial: Partial<SyncStatus>): void {
        this.status = { ...this.status, ...partial, queue: this.queueSize };
        this.options?.onStatus(this.status);
    }

    private async run(): Promise<void> {
        if (this.running || !this.options || this.disposed) {
            return;
        }
        this.running = true;
        const opts = this.options;
        try {
            const hasRemote = this.pendingRemoteEvents;
            const localPaths = [...this.pendingLocalChanges];
            this.pendingRemoteEvents = false;
            this.pendingLocalChanges = new Set();

            if (!hasRemote && localPaths.length === 0) {
                return;
            }
            this.setStatus({ state: 'syncing' });
            let queue = 0;

            if (localPaths.length > 0) {
                queue += localPaths.length;
                this.queueSize = queue;
                this.setStatus({});
                for (const p of localPaths) {
                    await this.uploadLocalPath(p, opts);
                    this.queueSize = Math.max(0, this.queueSize - 1);
                    this.setStatus({});
                }
            }

            if (hasRemote && opts.syncDownloads) {
                await this.fullSync();
            }

            this.setStatus({ state: 'idle', lastSync: Date.now() });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            opts.onActivity({ time: Date.now(), direction: 'error', message: `Sync failed: ${message}` });
            this.setStatus({ state: 'error' });
        } finally {
            this.running = false;
            if (this.pendingRemoteEvents || this.pendingLocalChanges.size > 0) {
                this.schedule();
            }
        }
    }

    private async fullSync(): Promise<void> {
        const opts = this.options!;
        try {
            const remote = await this.sdk.getNode(opts.remoteFolderUid);
            const localEntries = await fs.readdir(opts.localFolder, { withFileTypes: true });
            const localNames = new Set(localEntries.map((e) => e.name));

            for await (const maybeChild of this.sdk.iterateFolderChildren(remote)) {
                if ('missingUid' in maybeChild) {
                    continue;
                }
                const child = maybeChild as NodeEntity;
                const name = child.name.ok ? child.name.value : null;
                if (!name) {
                    continue;
                }
                const localPath = path.join(opts.localFolder, name);
                try {
                    const stat = await fs.stat(localPath).catch(() => null);
                    if (child.type === NodeType.File) {
                        const remoteSha = child.activeRevision?.claimedDigests?.sha1;
                        if (!stat) {
                            await this.downloadFile(child, localPath);
                        } else if (remoteSha) {
                            const localSha = await sha1File(localPath);
                            if (localSha !== remoteSha) {
                                const localMtime = stat.mtimeMs;
                                const remoteMtime = child.activeRevision?.claimedModificationTime?.getTime() ?? 0;
                                if (
                                    opts.conflictStrategy === 'newest' &&
                                    remoteMtime > localMtime
                                ) {
                                    await this.downloadFile(child, localPath);
                                } else if (opts.conflictStrategy === 'newest') {
                                    // local is newer; uploaded below via pendingLocalChanges
                                    this.pendingLocalChanges.add(localPath);
                                } else {
                                    const conflictPath = conflictName(localPath);
                                    await this.downloadFile(child, conflictPath);
                                    opts.onActivity({
                                        time: Date.now(),
                                        direction: 'info',
                                        message: `Conflict: kept both ${name} and ${path.basename(conflictPath)}`,
                                    });
                                    this.pendingLocalChanges.add(localPath);
                                }
                            }
                        }
                    } else if (child.type === NodeType.Folder) {
                        if (!stat) {
                            this.applyRemoteByUs.add(localPath);
                            await fs.mkdir(localPath, { recursive: true });
                            this.applyRemoteByUs.delete(localPath);
                        }
                        await this.syncFolderRecursive(child, localPath, opts);
                    }
                    localNames.delete(name);
                } catch (error: unknown) {
                    const message = error instanceof Error ? error.message : String(error);
                    opts.onActivity({ time: Date.now(), direction: 'error', message: `Failed to sync ${name}: ${message}` });
                }
            }

            for (const name of localNames) {
                const localPath = path.join(opts.localFolder, name);
                this.pendingLocalChanges.add(localPath);
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            opts.onActivity({ time: Date.now(), direction: 'error', message: `Full sync failed: ${message}` });
            throw error;
        }
    }

    private async syncFolderRecursive(remoteFolder: NodeEntity, localPath: string, opts: SyncOptions): Promise<void> {
        const localEntries = await fs.readdir(localPath, { withFileTypes: true }).catch(() => []);
        const localNames = new Set(localEntries.map((e) => e.name));

        for await (const maybeChild of this.sdk.iterateFolderChildren(remoteFolder)) {
            if ('missingUid' in maybeChild) {
                continue;
            }
            const child = maybeChild as NodeEntity;
            const name = child.name.ok ? child.name.value : null;
            if (!name) {
                continue;
            }
            const childPath = path.join(localPath, name);
            const stat = await fs.stat(childPath).catch(() => null);
            if (child.type === NodeType.File && !stat) {
                await this.downloadFile(child, childPath);
            } else if (child.type === NodeType.Folder && !stat) {
                this.applyRemoteByUs.add(childPath);
                await fs.mkdir(childPath, { recursive: true });
                this.applyRemoteByUs.delete(childPath);
                await this.syncFolderRecursive(child, childPath, opts);
            }
            localNames.delete(name);
        }
    }

    private async downloadFile(node: NodeEntity, localPath: string): Promise<void> {
        const opts = this.options!;
        const downloader = await this.sdk.getFileDownloader(node.uid);
        this.applyRemoteByUs.add(localPath);
        try {
            const chunks: Buffer[] = [];
            const writable = new WritableStream({
                write(chunk: Uint8Array) {
                    chunks.push(Buffer.from(chunk));
                },
            });
            const controller = downloader.downloadToStream(writable as any);
            await controller.completion();
            await fs.writeFile(localPath, Buffer.concat(chunks));
            const mtime = node.activeRevision?.claimedModificationTime;
            if (mtime) {
                await fs.utimes(localPath, mtime, mtime);
            }
            opts.onActivity({ time: Date.now(), direction: 'down', message: `Downloaded ${node.name.ok ? node.name.value : node.uid}` });
        } finally {
            setTimeout(() => this.applyRemoteByUs.delete(localPath), 5000);
        }
    }

    private async uploadLocalPath(localPath: string, opts: SyncOptions): Promise<void> {
        if (this.isDownloadByUs(localPath)) {
            return;
        }
        const stat = await fs.stat(localPath).catch(() => null);
        if (!stat) {
            await this.deleteRemote(localPath, opts);
            return;
        }
        if (stat.isDirectory()) {
            await this.ensureRemoteFolder(localPath, opts);
        } else if (stat.isFile()) {
            await this.uploadFile(localPath, opts);
        }
    }

    private async resolveRemoteFolder(localPath: string, opts: SyncOptions, create = true): Promise<NodeEntity | null> {
        const relative = path.relative(opts.localFolder, localPath);
        const parts = relative.split(path.sep).filter((p) => p.length > 0);
        let node = await this.sdk.getNode(opts.remoteFolderUid);
        if (parts.length === 0) {
            return node;
        }
        for (const part of parts) {
            let found: NodeEntity | null = null;
            for await (const maybeChild of this.sdk.iterateFolderChildren(node)) {
                if ('missingUid' in maybeChild) {
                    continue;
                }
                const child = maybeChild as NodeEntity;
                if (child.name.ok && child.name.value === part) {
                    found = child;
                    break;
                }
            }
            if (!found) {
                if (!create) {
                    return null;
                }
                found = await this.sdk.createFolder(node, part);
            }
            if (found.type !== NodeType.Folder) {
                return null;
            }
            node = found;
        }
        return node;
    }

    private async ensureRemoteFolder(localPath: string, opts: SyncOptions): Promise<void> {
        const stat = await fs.stat(localPath).catch(() => null);
        if (!stat) {
            return;
        }
        await this.resolveRemoteFolder(localPath, opts);
        const entries = await fs.readdir(localPath, { withFileTypes: true });
        for (const entry of entries) {
            const childPath = path.join(localPath, entry.name);
            if (entry.isDirectory()) {
                await this.ensureRemoteFolder(childPath, opts);
            } else if (entry.isFile()) {
                await this.uploadFile(childPath, opts);
            }
        }
    }

    private async uploadFile(localPath: string, opts: SyncOptions): Promise<void> {
        const stat = await fs.stat(localPath).catch(() => null);
        if (!stat) {
            return;
        }
        const name = path.basename(localPath);
        const parentFolder = await this.resolveRemoteFolder(path.dirname(localPath), opts);
        if (!parentFolder) {
            opts.onActivity({ time: Date.now(), direction: 'error', message: `Cannot find parent folder for ${name}` });
            return;
        }

        const expectedSha1 = await sha1File(localPath);
        const metadata: UploadMetadata = {
            mediaType: guessMediaType(name),
            expectedSize: stat.size,
            expectedSha1,
            modificationTime: stat.mtime,
        };

        let currentName = name;
        let newRevisionForNodeUid: string | undefined;
        while (true) {
            try {
                const stream = createReadStream(localPath) as unknown as ReadableStream;
                const uploader = newRevisionForNodeUid
                    ? await this.sdk.getFileRevisionUploader(newRevisionForNodeUid, metadata)
                    : await this.sdk.getFileUploader(parentFolder, currentName, metadata);
                const controller = await uploader.uploadFromStream(stream, []);
                await controller.completion();
                opts.onActivity({ time: Date.now(), direction: 'up', message: `Uploaded ${currentName}` });
                return;
            } catch (error: unknown) {
                if (!(error instanceof NodeWithSameNameExistsValidationError)) {
                    throw error;
                }
                const existingNodeUid = error.existingNodeUid;
                if (!existingNodeUid) {
                    throw error;
                }
                const existingNode = await this.sdk.getNode(existingNodeUid);
                const existingSha1 = existingNode.activeRevision?.claimedDigests?.sha1;
                if (existingSha1 === expectedSha1) {
                    return;
                }
                if (existingNode.type !== NodeType.File) {
                    throw error;
                }
                if (opts.conflictStrategy === 'rename') {
                    currentName = conflictName(currentName);
                    continue;
                }
                const remoteMtime = existingNode.activeRevision?.claimedModificationTime?.getTime() ?? 0;
                if (stat.mtimeMs >= remoteMtime) {
                    newRevisionForNodeUid = existingNodeUid;
                    continue;
                }
                const conflictPath = conflictName(path.join(path.dirname(localPath), currentName));
                await this.downloadFile(existingNode, conflictPath);
                opts.onActivity({
                    time: Date.now(),
                    direction: 'info',
                    message: `Conflict on ${currentName}: remote is newer, local saved as ${path.basename(conflictPath)}`,
                });
                this.pendingLocalChanges.add(conflictPath);
                return;
            }
        }
    }

    private async deleteRemote(localPath: string, opts: SyncOptions): Promise<void> {
        const node = await this.resolveRemoteFolder(localPath, opts, false);
        if (!node) {
            return;
        }
        const name = node.name.ok ? node.name.value : node.uid;
        await this.sdk.trashNodes([node.uid]).next();
        opts.onActivity({ time: Date.now(), direction: 'up', message: `Moved to trash (remote): ${name}` });
    }
}

async function sha1File(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = createHash('sha1');
        const stream = createReadStream(filePath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

function conflictName(filePath: string): string {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const dot = base.lastIndexOf('.');
    const suffix = ` (conflict ${new Date().toISOString().replace(/[:.]/g, '-')})`;
    const renamed = dot > 0 ? `${base.slice(0, dot)}${suffix}${base.slice(dot)}` : `${base}${suffix}`;
    return path.join(dir, renamed);
}

function guessMediaType(name: string): string {
    const ext = path.extname(name).toLowerCase();
    const types: Record<string, string> = {
        '.txt': 'text/plain',
        '.md': 'text/markdown',
        '.pdf': 'application/pdf',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.mp3': 'audio/mpeg',
        '.mp4': 'video/mp4',
        '.mkv': 'video/x-matroska',
        '.zip': 'application/zip',
        '.tar': 'application/x-tar',
        '.gz': 'application/gzip',
        '.json': 'application/json',
        '.csv': 'text/csv',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.odt': 'application/vnd.oasis.opendocument.text',
        '.html': 'text/html',
    };
    return types[ext] ?? 'application/octet-stream';
}
