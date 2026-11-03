/**
 * 生图参数存储：每张图的出图参数按月目录聚合为 images/{YYYYMM}/settings.json，键为媒体 id。
 * 复用约定：路径一律经 common/storagePath 构造，年月目录由媒体相对路径推导，不另算时钟；
 * 比例与画风沿用 @shared/types 的白名单收窄，读取时逐项校验，非法条目整条丢弃。
 * 关键约束：索引库不再保存 prompt / ratio / style / enhancedFrom 四项，本文件是唯一来源；
 * 写入采用「读整份 → 改单键 → 临时文件 + 覆盖改名」，任何时刻读到的都是完整对象；
 * 旧文件解析失败时先改名留档再重建，绝不在无法解析的内容上直接覆盖。
 */
import * as vscode from 'vscode'
import { logger } from '@modules/common/logger'
import { buildStorageUri } from '@modules/common/storagePath'
import { isImageRatio, type MediaParameters } from '@shared/types/imagegen'
import { MEDIA_DIR, readMediaIdFromPath } from '@shared/types/media'
import { PORTRAIT_STYLES, type PortraitStyle } from '@shared/types/press'

/** 参数文件名：与图片同目录，键为媒体 id */
const SETTINGS_FILE = 'settings.json'
/** 年月目录：6 位数字 */
const MONTH_DIR_PATTERN = /^\d{6}$/u

/** 由媒体相对路径取年月目录：images/{YYYYMM}/{文件}；形态不符返回 null */
export function toMonthDir(mediaPath: string): string | null {
    const segments = mediaPath.split('/')
    if (segments.length !== 3 || segments[0] !== MEDIA_DIR) {
        return null
    }
    const monthDir = segments[1] ?? ''
    return MONTH_DIR_PATTERN.test(monthDir) ? monthDir : null
}

/** 画风收窄：只接受白名单值 */
function toStyle(value: unknown): PortraitStyle | null {
    return PORTRAIT_STYLES.some((item) => item === value) ? (value as PortraitStyle) : null
}

/** 单条参数收窄：任一必填字段不合法即整条丢弃，避免把脏数据写回界面 */
function toParameters(value: unknown): MediaParameters | null {
    if (typeof value !== 'object' || value === null) {
        return null
    }
    const record = value as Record<string, unknown>
    if (typeof record.prompt !== 'string' || !isImageRatio(record.ratio)) {
        return null
    }
    const style = toStyle(record.style)
    if (style === null) {
        return null
    }
    return {
        prompt: record.prompt,
        ratio: record.ratio,
        style,
        enhancedFrom: typeof record.enhancedFrom === 'string' ? record.enhancedFrom : null,
    }
}

/** 整份收窄：非法条目丢弃，保留合法键 */
function toParametersMap(raw: Record<string, unknown>): Record<string, MediaParameters> {
    const result: Record<string, MediaParameters> = {}
    for (const [id, value] of Object.entries(raw)) {
        const params = toParameters(value)
        if (params !== null) {
            result[id] = params
        }
    }
    return result
}

/**
 * 读取整份参数文件。
 * 文件不存在返回空对象；解析失败先改名留档再返回空对象，避免覆盖掉用户手改的内容。
 */
async function readParametersFile(uri: vscode.Uri): Promise<Record<string, MediaParameters>> {
    let bytes: Uint8Array
    try {
        bytes = await vscode.workspace.fs.readFile(uri)
    } catch {
        return {}
    }
    try {
        const parsed: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'))
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new Error('参数文件不是对象')
        }
        return toParametersMap(parsed as Record<string, unknown>)
    } catch (error) {
        const dirUri = vscode.Uri.joinPath(uri, '..')
        const backup = vscode.Uri.joinPath(dirUri, `${SETTINGS_FILE}.bak-${String(Date.now())}`)
        try {
            await vscode.workspace.fs.rename(uri, backup, { overwrite: true })
        } catch (renameError) {
            logger.error(`生图参数文件留档失败：${uri.fsPath}`, renameError)
        }
        logger.error(`生图参数文件解析失败，已重建：${uri.fsPath}`, error)
        return {}
    }
}

/** 原子写整份参数文件：先写临时文件再覆盖改名，读到半截文件的窗口为零 */
async function writeParametersFile(
    root: vscode.Uri,
    monthDir: string,
    value: Record<string, MediaParameters>,
): Promise<void> {
    const dirUri = buildStorageUri(root, [MEDIA_DIR, monthDir])
    await vscode.workspace.fs.createDirectory(dirUri)
    const target = vscode.Uri.joinPath(dirUri, SETTINGS_FILE)
    const temp = vscode.Uri.joinPath(dirUri, `${SETTINGS_FILE}.tmp-${String(Date.now())}`)
    const content = Buffer.from(JSON.stringify(value, null, 4), 'utf8')
    await vscode.workspace.fs.writeFile(temp, content)
    await vscode.workspace.fs.rename(temp, target, { overwrite: true })
}

/** 读取某个年月目录的全部参数：键为媒体 id，非法条目已剔除 */
export async function readMonthParameters(
    root: vscode.Uri,
    monthDir: string,
): Promise<Record<string, MediaParameters>> {
    return readParametersFile(vscode.Uri.joinPath(buildStorageUri(root, [MEDIA_DIR, monthDir]), SETTINGS_FILE))
}

/** 读取单张图片的参数：路径不合规或没有对应键时返回 null */
export async function readMediaParameters(root: vscode.Uri, mediaPath: string): Promise<MediaParameters | null> {
    const monthDir = toMonthDir(mediaPath)
    if (monthDir === null) {
        return null
    }
    const all = await readMonthParameters(root, monthDir)
    return all[readMediaIdFromPath(mediaPath)] ?? null
}

/** 写入单张图片的参数：读整份后替换单个键，其余图片的记录原样保留 */
export async function writeMediaParameters(
    root: vscode.Uri,
    mediaPath: string,
    params: MediaParameters,
): Promise<void> {
    const monthDir = toMonthDir(mediaPath)
    if (monthDir === null) {
        throw new Error(`媒体路径不合法，无法写入生图参数：${mediaPath}`)
    }
    const all = await readMonthParameters(root, monthDir)
    await writeParametersFile(root, monthDir, { ...all, [readMediaIdFromPath(mediaPath)]: params })
}

/** 删除单张图片的参数：整份重写，目标键移除；文件里已无其它记录时保留空对象 */
export async function removeMediaParameters(root: vscode.Uri, mediaPath: string): Promise<void> {
    const monthDir = toMonthDir(mediaPath)
    if (monthDir === null) {
        return
    }
    const all = await readMonthParameters(root, monthDir)
    const id = readMediaIdFromPath(mediaPath)
    if (!(id in all)) {
        return
    }
    const next = { ...all }
    delete next[id]
    await writeParametersFile(root, monthDir, next)
}

/** 合并写入整月参数：迁移旧数据时按月份批量落盘，已有键保持被新值覆盖的语义 */
export async function mergeMonthParameters(
    root: vscode.Uri,
    monthDir: string,
    entries: Record<string, MediaParameters>,
): Promise<void> {
    const all = await readMonthParameters(root, monthDir)
    await writeParametersFile(root, monthDir, { ...all, ...entries })
}
