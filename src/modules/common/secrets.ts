/**
 * 密钥管理：API Key / OAuth Token 统一存 VSCode SecretStorage（系统级加密）。
 * 安全约束：密钥禁止明文写入 settings.json 或仓库，读取方负责前端脱敏展示。
 */
import * as vscode from 'vscode'

/** 各密钥在 SecretStorage 中的命名空间键名 */
const SECRET_KEYS = {
    deepseekApiKey: 'zhai.deepseek.apiKey',
    weiboAccessToken: 'zhai.weibo.accessToken',
    wechatAccessToken: 'zhai.wechat.accessToken',
} as const

export type SecretKey = keyof typeof SECRET_KEYS

/** 密钥读写服务，每个扩展上下文创建一个实例 */
export class SecretsService {
    public constructor(private readonly secrets: vscode.SecretStorage) {}

    /** 读取密钥，不存在时返回 undefined */
    public async get(key: SecretKey): Promise<string | undefined> {
        return this.secrets.get(SECRET_KEYS[key])
    }

    /** 写入密钥（已存在则覆盖） */
    public async set(key: SecretKey, value: string): Promise<void> {
        await this.secrets.store(SECRET_KEYS[key], value)
    }

    /** 删除密钥 */
    public async remove(key: SecretKey): Promise<void> {
        await this.secrets.delete(SECRET_KEYS[key])
    }

    /** 脱敏展示：仅保留末 4 位，其余以 • 代替 */
    public static mask(value: string | undefined): string {
        if (!value || value.length <= 4) {
            return '••••••••'
        }
        return `••••••••${value.slice(-4)}`
    }
}
