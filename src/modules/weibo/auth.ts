/**
 * OAuth2 token 存储。
 * 解耦于 vscode：调用方传入任意满足 SecretStorageLike 的存储
 * （vscode.SecretStorage 直接满足该接口）。
 */

export interface SecretStorageLike {
    get(key: string): Promise<string | undefined>
    store(key: string, value: string): Promise<void>
    delete(key: string): Promise<void>
}

export interface TokenStore {
    get(): Promise<string | undefined>
    set(token: string): Promise<void>
    clear(): Promise<void>
}

const TOKEN_KEY = 'weibo.accessToken'

export function createSecretStorageTokenStore(storage: SecretStorageLike): TokenStore {
    return {
        get: () => storage.get(TOKEN_KEY),
        set: (token: string) => storage.store(TOKEN_KEY, token),
        clear: () => storage.delete(TOKEN_KEY),
    }
}
