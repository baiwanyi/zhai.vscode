/**
 * 参考图服务：为生图输入挑选本地图片，并在出图时按登记路径读取为多模态输入。
 * 复用约定：文件对话框口径与作品导入一致（显式给 defaultUri，避免工作区根被当成 URI 解析）；
 * 预览地址由调用方注入 toWebviewUri 转换，与图库共用同一 webview 资源口径；
 * 图片类型按文件头嗅探，扩展名只用于选择框过滤与读取前的粗筛。
 * 关键约束：前端回传的路径一律不可信——只有本服务 pick 过的路径才允许读取，
 * 且每次读取都重新校验绝对路径、常规文件、非符号链接与体积上限；
 * 登记表有容量上限，超出按先后淘汰，避免长时间挂着的 webview 无界增长；
 * 参考图只是辅助上下文，单张读取失败时跳过并记日志，不阻断出图。
 */
import { lstat, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute } from 'node:path'
import * as vscode from 'vscode'
import { logger } from '@modules/common/logger'
import type { ImageReferencePickResult } from '@shared/types/imagegen'
import type { ImageReferenceInput, ImageReferenceMimeType } from './ai/imageProvider'

/** 参考图扩展名白名单：与图像通道支持的图片格式一致 */
const REFERENCE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif']

/** 单张参考图体积上限：与出图产物上限同量级，超出视为异常选择 */
const MAX_REFERENCE_BYTES = 12 * 1024 * 1024

/** 单次出图参考图数量上限：超出部分直接丢弃 */
const MAX_REFERENCE_COUNT = 3

/** 路径长度上限 */
const MAX_PATH_LENGTH = 320

/** 登记表容量：远超单次会话可能用到的张数，只作无界增长兜底 */
const MAX_TRACKED_PATHS = 32

/** 按文件头判定图片类型：扩展名可以伪造，真实类型一律由文件魔数决定 */
function sniffMimeType(bytes: Uint8Array): ImageReferenceMimeType | null {
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
        return 'image/png'
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return 'image/jpeg'
    }
    if (
        bytes.length >= 12 &&
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
    ) {
        return 'image/webp'
    }
    if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
        return 'image/gif'
    }
    return null
}

/** 扩展名白名单：不区分大小写，只认最后一段 */
function hasReferenceExtension(path: string): boolean {
    const index = path.lastIndexOf('.')
    if (index < 0) {
        return false
    }
    return REFERENCE_EXTENSIONS.includes(path.slice(index + 1).toLowerCase())
}

export class ReferenceImageService {
    /** 已由选择流程登记的路径：前端只能回传这里出现过的值 */
    private readonly tracked = new Set<string>()

    /**
     * 选择参考图：弹系统文件选择框，校验后把路径登记并回传预览地址。
     * 安全约束：只接受常规图片文件（拒绝目录与符号链接），扩展名白名单 + 体积上限 + 文件头嗅探三重校验，
     * 用户取消时返回 null 而不抛错。
     */
    public async pick(toWebviewUri: (uri: vscode.Uri) => string): Promise<ImageReferencePickResult> {
        const selected = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            openLabel: '作为参考图',
            filters: { 图片: REFERENCE_EXTENSIONS },
            defaultUri: vscode.Uri.file(homedir()),
        })
        const uri = selected?.[0]
        if (uri === undefined) {
            return { reference: null }
        }
        const stats = await lstat(uri.fsPath)
        if (!stats.isFile() || stats.isSymbolicLink()) {
            throw new Error('请选择一张图片文件，不支持文件夹或快捷方式')
        }
        if (stats.size === 0) {
            throw new Error('图片内容为空')
        }
        if (stats.size > MAX_REFERENCE_BYTES) {
            throw new Error(`图片超过 ${String(MAX_REFERENCE_BYTES / 1024 / 1024)} MB 上限`)
        }
        const bytes = new Uint8Array(await readFile(uri.fsPath))
        const mimeType = sniffMimeType(bytes)
        if (mimeType === null) {
            throw new Error('无法识别的图片格式，请选择 PNG / JPEG / WebP / GIF')
        }
        this.track(uri.fsPath)
        logger.info(`参考图已选择：${uri.fsPath}（${mimeType}）`)
        return {
            reference: { path: uri.fsPath, name: basename(uri.fsPath), url: toWebviewUri(uri) },
        }
    }

    /**
     * 出图取图：按登记路径读取字节与真实类型，返回多模态输入。
     * 安全约束：未登记路径直接拒绝（防止 webview 借参考图通道读取任意文件）；
     * 读取前重新校验，文件已被删除、被替换或体积超限时跳过该张，不阻断出图。
     */
    public async readForPrompt(paths: readonly string[]): Promise<ImageReferenceInput[]> {
        const result: ImageReferenceInput[] = []
        for (const path of paths.slice(0, MAX_REFERENCE_COUNT)) {
            if (!this.tracked.has(path)) {
                throw new Error('参考图未经过选择流程，请重新添加')
            }
            const input = await this.readOne(path)
            if (input !== null) {
                result.push(input)
            }
        }
        return result
    }

    /** 单个路径的读取与校验：任一条件不满足即返回 null，由调用方跳过 */
    private async readOne(path: string): Promise<ImageReferenceInput | null> {
        if (path.length > MAX_PATH_LENGTH || !isAbsolute(path) || !hasReferenceExtension(path)) {
            logger.warn(`参考图路径非法，已跳过：${path}`)
            return null
        }
        try {
            const stats = await lstat(path)
            if (!stats.isFile() || stats.isSymbolicLink() || stats.size === 0 || stats.size > MAX_REFERENCE_BYTES) {
                logger.warn(`参考图不满足条件，已跳过：${path}`)
                return null
            }
            const bytes = new Uint8Array(await readFile(path))
            const mimeType = sniffMimeType(bytes)
            if (mimeType === null) {
                logger.warn(`参考图格式无法识别，已跳过：${path}`)
                return null
            }
            return { bytes, mimeType }
        } catch (error) {
            logger.error(`参考图读取失败，已跳过：${path}`, error)
            return null
        }
    }

    /** 登记路径：容量满时淘汰最早的一条，保证长时间挂着的 webview 不会无限累积 */
    private track(path: string): void {
        if (!this.tracked.has(path) && this.tracked.size >= MAX_TRACKED_PATHS) {
            const oldest = this.tracked.values().next().value
            if (oldest !== undefined) {
                this.tracked.delete(oldest)
            }
        }
        this.tracked.add(path)
    }
}
