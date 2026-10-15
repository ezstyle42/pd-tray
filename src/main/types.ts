import type { SessionInfo } from 'proton-drive-sdk-account';

export type { SessionInfo };

export type Credentials = {
    userKeyPassword: string;
    session: SessionInfo;
    telemetryEnabled?: boolean;
    cachePassword?: string;
};

export interface CredentialsStore {
    load(): Promise<Credentials | null>;
    save(snapshot: Credentials): Promise<void>;
    remove(): Promise<void>;
}
