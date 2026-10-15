import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('pdSync', {
    getState: (): Promise<any> => ipcRenderer.invoke('app:getState'),
    login: (): Promise<any> => ipcRenderer.invoke('auth:login'),
    logout: (): Promise<any> => ipcRenderer.invoke('auth:logout'),
    listFolders: (): Promise<any> => ipcRenderer.invoke('drive:listFolders'),
    listChildren: (nodeUid: string): Promise<any> => ipcRenderer.invoke('drive:listChildren', nodeUid),
    pickLocalFolder: (): Promise<any> => ipcRenderer.invoke('settings:pickLocalFolder'),
    saveSettings: (settings: any): Promise<any> => ipcRenderer.invoke('settings:save', settings),
    triggerSync: (): Promise<any> => ipcRenderer.invoke('sync:trigger'),
    on: (channel: string, callback: (payload: any) => void) => {
        const allowed = ['activity', 'status', 'auth:signInUrl', 'auth:loggedIn', 'auth:error'];
        if (!allowed.includes(channel)) {
            return () => {};
        }
        const listener = (_event: unknown, payload: any) => callback(payload);
        ipcRenderer.on(channel, listener);
        return () => ipcRenderer.removeListener(channel, listener);
    },
});
