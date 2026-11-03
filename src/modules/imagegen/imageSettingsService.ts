/**
 * 出图参数服务：读写全局出图配置，并向调用方回报覆盖了哪些键。
 * 复用约定：默认值取自 shared/types/imagegen 的 DEFAULT_IMAGE_SETTINGS（前端同一份），
 * 配置落 {存储根}/imagegen.json，与作品目录无关；写入前确保存储根存在，读取失败一律回落默认值。
 * 关键约束：只保存「与默认不同」的键，值为 null 表示取消覆盖；
 * 非法值不写入并以保存后的真实状态回给前端，避免前端按请求值渲染出与实际不符的界面；
 * 配额与超时不在本文件管辖范围，它们是全局护栏，不接受覆盖。
 */
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import {
    DEFAULT_IMAGE_SETTINGS,
    isImageRatio,
    type ImageSettings,
    type ImageSettingsResult,
} from '@shared/types/imagegen'
import { PORTRAIT_STYLES, type PortraitStyle } from '@shared/types/press'

/** 配置文件：存储根下的单文件，与 images / press 等目录平级 */
const SETTINGS_FILE = 'imagegen.json'
/** 文本类参数长度上限 */
const MAX_TEXT_LENGTH = 200

/** 可覆盖的键全集：保存时按此顺序处理，读取时按此顺序校验 */
const SETTING_KEYS: ReadonlyArray<keyof ImageSettings> = ['defaultRatio', 'portraitStyle', 'promptSuffix', 'negative']

/** 画风收窄：只接受白名单值 */
function toStyle(value: unknown): PortraitStyle | null {
    return PORTRAIT_STYLES.some((item) => item === value) ? (value as PortraitStyle) : null
}

/** 把磁盘或入参的原始对象收窄为合法的覆盖集合：非法字段直接丢弃 */
function toOverrides(source: Record<string, unknown>): Partial<ImageSettings> {
    const result: Partial<ImageSettings> = {}
    if (isImageRatio(source.defaultRatio)) {
        result.defaultRatio = source.defaultRatio
    }
    const portraitStyle = toStyle(source.portraitStyle)
    if (portraitStyle !== null) {
        result.portraitStyle = portraitStyle
    }
    if (typeof source.promptSuffix === 'string') {
        result.promptSuffix = source.promptSuffix.slice(0, MAX_TEXT_LENGTH)
    }
    if (typeof source.negative === 'string') {
        result.negative = source.negative.slice(0, MAX_TEXT_LENGTH)
    }
    return result
}

export class ImageSettingsService {
    /** 读取配置：磁盘覆盖优先，缺省项回落到默认值，并回报覆盖键 */
    public async get(): Promise<ImageSettingsResult> {
        const overrides = await this.readOverrides()
        return {
            settings: { ...DEFAULT_IMAGE_SETTINGS, ...overrides },
            overrides: Object.keys(overrides) as Array<keyof ImageSettings>,
        }
    }

    /**
     * 保存配置：只处理请求里出现的键，null 表示取消覆盖。
     * @returns 保存后的真实状态（非法值被忽略，前端据此回显）
     */
    public async save(payload: unknown): Promise<ImageSettingsResult> {
        const record = payload as { settings?: unknown } | null
        const incoming = record?.settings
        if (typeof incoming !== 'object' || incoming === null) {
            throw new Error('pressAi/saveImageSettings 缺少参数')
        }
        const patch = incoming as Record<string, unknown>
        const merged: Record<string, unknown> = { ...(await this.readOverrides()) }
        for (const key of SETTING_KEYS) {
            if (!(key in patch)) {
                continue
            }
            if (patch[key] === null) {
                delete merged[key]
                continue
            }
            merged[key] = patch[key]
        }
        await this.writeOverrides(toOverrides(merged))
        logger.info('出图参数已保存')
        return this.get()
    }

    /** 读取覆盖项：文件缺失或损坏一律视为无覆盖 */
    private async readOverrides(): Promise<Partial<ImageSettings>> {
        const uri = this.settingsUri()
        let raw: Uint8Array
        try {
            raw = await vscode.workspace.fs.readFile(uri)
        } catch {
            return {}
        }
        try {
            const parsed: unknown = JSON.parse(Buffer.from(raw).toString('utf8'))
            if (typeof parsed !== 'object' || parsed === null) {
                return {}
            }
            return toOverrides(parsed as Record<string, unknown>)
        } catch {
            logger.warn('出图参数文件解析失败，已回落默认值')
            return {}
        }
    }

    /** 写入覆盖项：存储根不存在时先创建，空对象直接写空文件保持可读 */
    private async writeOverrides(overrides: Partial<ImageSettings>): Promise<void> {
        const root = resolveStorageRoot()
        await vscode.workspace.fs.createDirectory(root)
        const content = Buffer.from(JSON.stringify(overrides, null, 4), 'utf8')
        await vscode.workspace.fs.writeFile(this.settingsUri(), content)
    }

    /** 配置文件位置：{存储根}/imagegen.json */
    private settingsUri(): vscode.Uri {
        return vscode.Uri.joinPath(resolveStorageRoot(), SETTINGS_FILE)
    }
}
