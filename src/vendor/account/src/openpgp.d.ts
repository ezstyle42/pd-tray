declare module 'openpgp' {
    export const enums: any;
    export function readMessage(options: any): Promise<any>;
    export function readKey(options: any): Promise<any>;
}
