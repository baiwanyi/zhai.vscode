/**
 * 生图参数服务：按作品读写生成参数，并向调用方回报本作品覆盖了哪些键。
 * 复用约定：默认值取自 shared/types/imagegen 的 DEFAULT_IMAGE_SETTINGS（前端同一份），
 * 作品覆盖落 press/{作品名}/.zhai/image.json，随作品目录一起迁移与备份；
 * 作品目录归一复用 ../common/projectPath，写入前先建目录，读取失败一律回落默认值。
 * 关键约束：只保存「与默认不同」的键，值为 null 表示取消覆盖；
 * 非法值不写入并以保存后的真实状态回给前端，避免前端按请求值渲染出与实际不符的界面；
 * 配额与超时不在本文件管辖范围，它们是全局护栏，不接受作品级覆盖。
 */
import * as vscode from 'vscode'
import { readProjectDirPath } from './portraitService'
import {
    DEFAULT_IMAGE_SETTINGS,
    isImageRatio,
    type ImageSettings,
    type ImageSettingsResult,
} from '../../shared/types/imagegen'
import { PORTRAIT_STYLES, type PortraitStyle } from '../../shared/types/press'
import { resolveStorageRoot } from '../common/config'
import { logger } from '../common/logger'
import { readProjectSegments } from '../common/projectPath'
import { buildStorageUri } from '../common/storagePath'

/** 作品级配置目录：隐藏目录，不参与作品文档索引 */
const SETTINGS_DIR = '.zhai'
/** 参数文件名 */
const SETTINGS_FILE = 'image.json'
/** 文本类参数长度上限 */
const MAX_TEXT_LENGTH = 200

/** 可覆盖的键全集：保存时按此顺序处理，读取时按此顺序校验 */
const SETTING_KEYS: ReadonlyArray<keyof ImageSettings> = [
    'defaultRatio',
    'portraitStyle',
    'coverStyle',
    'promptSuffix',
    'negative',
]

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
    const coverStyle = toStyle(source.coverStyle)
    if (coverStyle !== null) {
        result.coverStyle = coverStyle
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
    /** 读取参数：作品覆盖优先，缺省项回落到默认值，并回报覆盖键 */
    public async get(payload: unknown): Promise<ImageSettingsResult> {
        const dirPath = readProjectDirPath(payload, 'pressAi/getImageSettings')
        const overrides = await this.readOverrides(dirPath)
        return {
            settings: { ...DEFAULT_IMAGE_SETTINGS, ...overrides },
            overrides: Object.keys(overrides) as Array<keyof ImageSettings>,
        }
    }

    /**
     * 保存参数：只处理请求里出现的键，null 表示取消覆盖。
     * @returns 保存后的真实状态（非法值被忽略，前端据此回显）
     */
    public async save(payload: unknown): Promise<ImageSettingsResult> {
        const dirPath = readProjectDirPath(payload, 'pressAi/saveImageSettings')
        const record = payload as { settings?: unknown } | null
        const incoming = record?.settings
        if (typeof incoming !== 'object' || incoming === null) {
            throw new Error('pressAi/saveImageSettings 缺少参数')
        }
        const patch = incoming as Record<string, unknown>
        const merged: Record<string, unknown> = { ...(await this.readOverrides(dirPath)) }
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
        await this.writeOverrides(dirPath, toOverrides(merged))
        logger.info(`图片参数已保存：${dirPath}`)
        return this.get(payload)
    }

    /** 读取作品覆盖：文件缺失或损坏一律视为无覆盖 */
    private async readOverrides(dirPath: string): Promise<Partial<ImageSettings>> {
        const uri = this.settingsUri(dirPath)
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
            logger.warn(`图片参数文件解析失败，已回落默认值：${dirPath}`)
            return {}
        }
    }

    /** 写入作品覆盖：目录不存在时先创建，空对象直接写空文件保持可读 */
    private async writeOverrides(dirPath: string, overrides: Partial<ImageSettings>): Promise<void> {
        const root = resolveStorageRoot()
        const dirSegments = [...readProjectSegments(dirPath), SETTINGS_DIR]
        await vscode.workspace.fs.createDirectory(buildStorageUri(root, dirSegments))
        const content = Buffer.from(JSON.stringify(overrides, null, 4), 'utf8')
        await vscode.workspace.fs.writeFile(buildStorageUri(root, [...dirSegments, SETTINGS_FILE]), content)
    }

    /** 参数文件位置：press/{作品名}/.zhai/image.json */
    private settingsUri(dirPath: string): vscode.Uri {
        const root = resolveStorageRoot()
        return buildStorageUri(root, [...readProjectSegments(dirPath), SETTINGS_DIR, SETTINGS_FILE])
    }
}
