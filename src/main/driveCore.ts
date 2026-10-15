import '@protontech/crypto/polyfill';
import { CryptoProxy } from '@protontech/crypto';
import { Api as CryptoApi } from '@protontech/crypto/proxy/endpoint/api.ts';
import { computeKeyPassword, generateKeySalt, getRandomSrpVerifier, getSrp } from '@protontech/crypto/srp';
import {
    DriveEventType,
    Logger,
    MemoryCache,
    OpenPGPCryptoWithCryptoProxy,
    ProtonDriveClient,
    type DriveEvent,
    type EventSubscription,
    type ProtonDriveAccount,
} from '@protontech/drive-sdk';
import { ApiClient, initAccount, type Auth, type SessionInfo } from 'proton-drive-sdk-account';
import { randomBytes } from 'node:crypto';
import { FileCredentialsStore } from './credentials';
import type { Credentials, CredentialsStore } from './types';

export const APP_VERSION = 'external-drive-pd_tray_sync@0.1.0-alpha';
export const AUTH_CLIENT_ID = 'external-drive';
const BASE_URL = 'drive-api.proton.me';
const ACCOUNT_URL = 'account.proton.me';

export interface DriveCore {
    auth: Auth;
    sdk: ProtonDriveClient;
    credentials: CredentialsStore;
    session: SessionCredentialsAdapter;
    dispose(): Promise<void>;
}

class SessionCredentialsAdapter {
    uid: string | undefined;
    accessToken: string | undefined;
    refreshToken: string | undefined;
    private userKeyPassword: string | undefined;
    private telemetryEnabled = false;
    private listeners: Array<() => void> = [];
    private store: CredentialsStore;

    constructor(store: CredentialsStore) {
        this.store = store;
    }

    on(event: 'sessionInfoChanged', callback: () => void): void {
        if (event === 'sessionInfoChanged') {
            this.listeners.push(callback);
        }
    }

    private emitChange(): void {
        for (const cb of this.listeners) {
            try {
                cb();
            } catch {
                // listener errors must not break session handling
            }
        }
    }

    isLoggedIn(): boolean {
        return !!this.accessToken;
    }

    isTelemetryEnabled(): boolean {
        return this.telemetryEnabled;
    }

    getUserKeyPassword(): string | undefined {
        return this.userKeyPassword;
    }

    async load(): Promise<void> {
        const snapshot = await this.store.load();
        if (!snapshot) {
            return;
        }
        this.uid = snapshot.session.uid;
        this.accessToken = snapshot.session.accessToken;
        this.refreshToken = snapshot.session.refreshToken;
        this.userKeyPassword = snapshot.userKeyPassword;
        this.telemetryEnabled = snapshot.telemetryEnabled ?? false;
    }

    async setUserKeyPassword(userKeyPassword: string): Promise<void> {
        this.userKeyPassword = userKeyPassword;
        await this.persist();
    }

    async setSessionInfo(info: SessionInfo): Promise<void> {
        this.uid = info.uid;
        this.accessToken = info.accessToken;
        this.refreshToken = info.refreshToken;
        await this.persist();
    }

    async setTelemetryEnabled(enabled: boolean): Promise<void> {
        this.telemetryEnabled = enabled;
        await this.persist();
    }

    async signOut(): Promise<void> {
        this.uid = undefined;
        this.accessToken = undefined;
        this.refreshToken = undefined;
        this.userKeyPassword = undefined;
        await this.store.remove();
        this.emitChange();
    }

    async getUserKeyPasswordOrThrow(): Promise<string> {
        if (!this.userKeyPassword) {
            throw new Error('Not signed in');
        }
        return this.userKeyPassword;
    }

    private async persist(): Promise<void> {
        if (!this.accessToken || !this.uid || !this.userKeyPassword) {
            return;
        }
        await this.store.save({
            userKeyPassword: this.userKeyPassword,
            session: {
                uid: this.uid,
                accessToken: this.accessToken,
                refreshToken: this.refreshToken,
            },
            telemetryEnabled: this.telemetryEnabled,
        });
        this.emitChange();
    }
}

class HTTPClient {
    constructor(private readonly apiClient: ApiClient) {}

    async fetchJson(options: any): Promise<Response> {
        return this.apiClient.authenticatedRequest(options.url, {
            method: options.method,
            ...(options.json !== undefined ? { json: options.json } : {}),
            ...(options.body !== undefined && options.json === undefined ? { body: options.body } : {}),
            headers: options.headers,
            timeout: options.timeoutMs,
            signal: options.signal,
            throwHttpErrors: false,
        });
    }

    async fetchBlob(options: any): Promise<Response> {
        return this.apiClient.authenticatedRequest(options.url, {
            method: options.method,
            body: options.body,
            headers: options.headers,
            timeout: options.timeoutMs,
            signal: options.signal,
            throwHttpErrors: false,
        });
    }
}

class AccountAdapter implements ProtonDriveAccount {
    constructor(private readonly addresses: any) {}

    getOwnPrimaryAddress(): Promise<any> {
        return this.addresses.getOwnPrimaryAddress();
    }

    getOwnAddresses(): Promise<any[]> {
        return this.addresses.getOwnAddresses();
    }

    getOwnAddress(emailOrAddressId: string): Promise<any> {
        return this.addresses.getOwnAddress(emailOrAddressId);
    }

    hasProtonAccount(email: string): Promise<boolean> {
        return this.addresses.hasProtonAccount(email);
    }

    getPublicKeys(email: string, forceRefresh?: boolean) {
        return this.addresses.getPublicKeys(email, forceRefresh);
    }
}

class NullLogger {
    debug(...args: any[]): void {}
    info(...args: any[]): void {}
    warn(...args: any[]): void {}
    error(...args: any[]): void {}
    trace(...args: any[]): void {}
    fatal(...args: any[]): void {}
}

class LatestEventIdProvider {
    private ids = new Map<string, string>();

    async getLatestEventId(treeEventScopeId: string): Promise<string | null> {
        return this.ids.get(treeEventScopeId) ?? null;
    }

    setLatestEventId(treeEventScopeId: string, eventId: string): void {
        this.ids.set(treeEventScopeId, eventId);
    }
}

export async function initDriveCore(onEvent?: (event: DriveEvent) => Promise<void>): Promise<DriveCore> {
    const cryptoApi = new CryptoApi();
    CryptoApi.init({});
    CryptoProxy.setEndpoint(cryptoApi, async (endpoint) => {
        endpoint.clearKeyStore();
    });
    const openPGPCryptoModule = new OpenPGPCryptoWithCryptoProxy(CryptoProxy);

    const credentialsStore = new FileCredentialsStore();
    const session = new SessionCredentialsAdapter(credentialsStore);
    await session.load();

    const logger = new NullLogger() as unknown as Logger;

    const apiClient = new ApiClient({
        baseUrl: BASE_URL,
        appVersion: APP_VERSION,
        credentials: session,
        logger,
    } as any);

    const { auth, addresses, srp } = await initAccount({
        authClientId: AUTH_CLIENT_ID,
        apiClient,
        credentials: session,
        cryptoProxy: CryptoProxy,
        srpApi: { computeKeyPassword, generateKeySalt, getRandomSrpVerifier, getSrp },
        logger,
        accountUrl: ACCOUNT_URL,
    } as any);

    const clientUid = randomBytes(16).toString('hex');
    const entitiesCache = new MemoryCache<string>();
    const cryptoCache = new MemoryCache<string>();
    const latestEventIdProvider = new LatestEventIdProvider();

    const sdk = new ProtonDriveClient({
        config: { baseUrl: BASE_URL, clientUid },
        httpClient: new HTTPClient(apiClient) as any,
        entitiesCache,
        cryptoCache: cryptoCache as any,
        account: new AccountAdapter(addresses),
        openPGPCryptoModule,
        srpModule: srp,
        telemetry: undefined,
        latestEventIdProvider,
    } as any);

    let subscription: EventSubscription | null = null;
    if (onEvent) {
        subscription = await sdk.subscribeToDriveEvents(async (event: DriveEvent) => {
            if (
                event.type === DriveEventType.NodeCreated ||
                event.type === DriveEventType.NodeUpdated ||
                event.type === DriveEventType.NodeDeleted ||
                event.type === DriveEventType.FastForward ||
                event.type === DriveEventType.TreeRefresh ||
                event.type === DriveEventType.TreeRemove
            ) {
                await onEvent(event);
            }
        });
    }

    return {
        auth,
        sdk,
        credentials: credentialsStore,
        session,
        dispose: async () => {
            subscription?.dispose();
        },
    };
}

export type { Credentials };
