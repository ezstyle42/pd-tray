import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { Credentials, CredentialsStore } from './types';

const FILE = 'session.json';

function sessionPath(): string {
    return path.join(app.getPath('userData'), FILE);
}

export class FileCredentialsStore implements CredentialsStore {
    async load(): Promise<Credentials | null> {
        try {
            const raw = fs.readFileSync(sessionPath(), 'utf8');
            const parsed = JSON.parse(raw);
            if (!parsed.session?.uid || !parsed.session?.accessToken || !parsed.userKeyPassword) {
                return null;
            }
            return parsed as Credentials;
        } catch {
            return null;
        }
    }

    async save(snapshot: Credentials): Promise<void> {
        fs.mkdirSync(path.dirname(sessionPath()), { recursive: true });
        fs.writeFileSync(sessionPath(), JSON.stringify(snapshot), { mode: 0o600 });
    }

    async remove(): Promise<void> {
        try {
            fs.unlinkSync(sessionPath());
        } catch {
            // ignore missing file
        }
    }
}
