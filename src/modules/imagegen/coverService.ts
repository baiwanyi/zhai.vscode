/**
 * 作品封面服务：按作品设定拼封面提示词，经图像通道路由出图，落到 press/{作品名}/Cover 并返回 webview 可用 URL。
 * 复用约定：提示词复用 ./ai/coverPrompt，出图复用 ./ai/imageProvider 的路由入口，目录名与配额键取自 ./constants，
 * 配额读写经 ../common/db/quotaRepository，作品目录归一复用 ../press/projectService 的片段校验，
 * 路径一律经 common/storagePath，URL 转换由调用方注入。
 * 关键约束：同一时刻只允许一个生成请求，避免连点重复扣费；封面平铺在 Cover 目录下，
 * 文件名为 cover-{年月日时分秒}.扩展名；列举以磁盘为准，删除只接受 press/{作品名}/Cover 下的白名单路径。
 */
import * as vscode from 'vscode'
import { buildCoverPrompt } from './ai/coverPrompt'
import { COVER_DIR, IMAGE_QUOTA_KEYS } from './constants'
import { PressCoverStore, isProjectCoverPath } from './db/coverRepository'
import { readProjectDirPath } from './portraitService'
import type { ImageProviderRouter } from './ai/imageProvider'
import type {
    CoverDeleteResult,
    CoverGenerateRequest,
    CoverGenerateResult,
    CoverListResult,
    CoverSelectResult,
    PortraitStyle,
    PressCover,
} from '../../shared/types/press'
import type { UsageRecorder } from '../ai/usageRecorder'
import type Database from 'better-sqlite3'
import { DEFAULT_PORTRAIT_STYLE, PORTRAIT_STYLES, isPressCoverId } from '../../shared/types/press'
import { getSelectedCodebuddyModel } from '../ai/providers/codebuddyModels'
import { getZhaiConfig, resolveStorageRoot } from '../common/config'
import { consumeToday, readUsedToday } from '../common/db/quotaRepository'
import { logger } from '../common/logger'
import { readText, readTextList } from '../common/readInput'
import { buildStorageUri, deleteResource, toSafeSegments } from '../common/storagePath'
import { readProjectSegments } from '../press/projectService'

/** 目录扫描只认图片文件，其余一律忽略 */
const COVER_FILE_PATTERN = /\.(png|jpe?g|webp)$/i
/** 短字段长度上限 */
const MAX_SHORT_TEXT = 64
/** 长字段长度上限 */
const MAX_LONG_TEXT = 400
/** 相对路径长度上限：作品名叠加目录名后仍留出余量 */
const MAX_PATH_LENGTH = 320
/** 合成封面的 data URL 前缀：只接受 PNG，避免二次压缩损失文字边缘 */
const COVER_DATA_URL_PREFIX = 'data:image/png;base64,'
/** 合成封面的扩展名：前端画布固定输出 PNG */
const SAVED_COVER_EXTENSION = 'png'
/** 合成封面的负载上限：远超 768×1024 PNG 的常见体积，超出视为异常请求 */
const MAX_COVER_DATA_URL_LENGTH = 24_000_000

export class PressCoverService {
    /** 进行中的生成请求：封面一次只允许一个，避免连点重复扣费 */
    private activeRequest: AbortController | null = null
    /** 封面选择记录：与作品列表共用同一份，生成成功即自动成为作品封面 */
    private readonly store: PressCoverStore

    public constructor(
        private readonly db: Database.Database,
        private readonly router: ImageProviderRouter,
        private readonly usageRecorder: UsageRecorder,
    ) {
        this.store = new PressCoverStore(db)
    }

    /**
     * 生成一张作品封面并落盘。
     * @param toWebviewUri 把磁盘 Uri 转成 webview 可访问 URL 的转换器
     */
    public async generate(payload: unknown, toWebviewUri: (uri: vscode.Uri) => string): Promise<CoverGenerateResult> {
        if (this.activeRequest) {
            throw new Error('已有生成中的封面请求，请等待完成')
        }
        const request = normalizeCoverRequest(payload)
        const config = getZhaiConfig()
        this.assertQuota()
        const controller = new AbortController()
        this.activeRequest = controller
        const startedAt = Date.now()
        const prompt = buildCoverPrompt(request)
        logger.info(
            `封面生成开始：${request.title.length > 0 ? request.title : request.dirPath}（${config.imageSize}）`,
        )
        try {
            const artifact = await this.router.generate({
                prompt,
                size: config.imageSize,
                signal: controller.signal,
            })
            // 出图按张计费：与其他入口一致，成本按请求 id 从 CLI 会话记录回填
            this.usageRecorder.record({
                module: 'image',
                model: getSelectedCodebuddyModel(),
                usage: artifact.usage ?? null,
                meta: artifact.meta ?? null,
                prompt,
                startedAt: artifact.startedAt ?? startedAt,
            })
            // 落到当前作品目录的 Cover 下，作品删除时随目录一并清理
            const root = resolveStorageRoot()
            const dirSegments = [...readProjectSegments(request.dirPath), COVER_DIR]
            await vscode.workspace.fs.createDirectory(buildStorageUri(root, dirSegments))
            const id = await nextCoverId(root, dirSegments, artifact.extension)
            const segments = [...dirSegments, `${id}.${artifact.extension}`]
            const target = buildStorageUri(root, segments)
            await vscode.workspace.fs.writeFile(target, artifact.bytes)
            consumeToday(this.db, IMAGE_QUOTA_KEYS)
            const coverPath = segments.join('/')
            // 与角色卡一致：新图直接成为封面，仪表盘列表无需额外操作即可看到作品门面
            this.store.write(request.dirPath, coverPath)
            logger.info(`封面生成完成：耗时 ${Date.now() - startedAt}ms，${artifact.bytes.byteLength} 字节`)
            return {
                cover: {
                    id,
                    path: coverPath,
                    url: toWebviewUri(target),
                    createdAt: new Date().toISOString(),
                },
            }
        } catch (error) {
            logger.error(`封面生成失败：耗时 ${Date.now() - startedAt}ms`, error)
            throw error
        } finally {
            this.activeRequest = null
        }
    }

    /**
     * 列举某个作品目录下已落盘的封面：目录不存在视为空，按修改时间降序返回（最新在前）。
     * 磁盘是唯一事实来源，因此关闭面板期间完成的生成同样能被读回。
     */
    public async list(payload: unknown, toWebviewUri: (uri: vscode.Uri) => string): Promise<CoverListResult> {
        const dirPath = readProjectDirPath(payload, 'pressAi/listCover')
        const selected = this.store.read(dirPath)
        return {
            covers: await this.readCovers(readProjectSegments(dirPath), toWebviewUri),
            selectedId: selected === null ? null : readCoverId(selected),
        }
    }

    /**
     * 保存前端合成好的封面（底图 + 书名排版）：只接受 PNG data URL，
     * 落盘为与生成同名的 cover-{时间戳}.png 并自动设为作品封面。
     * 关键约束：排版在前端完成，宿主不解析字体与位置，只校验格式与体积，
     * 避免把非图片内容或超大负载写进作品目录；文件名按秒避让，不覆盖已有封面。
     */
    public async save(payload: unknown, toWebviewUri: (uri: vscode.Uri) => string): Promise<CoverGenerateResult> {
        const dirPath = readProjectDirPath(payload, 'pressAi/saveCover')
        const dataUrl = readCoverDataUrl(payload)
        const bytes = Buffer.from(dataUrl.slice(COVER_DATA_URL_PREFIX.length), 'base64')
        if (bytes.byteLength === 0) {
            throw new Error('封面图片为空，请重新合成')
        }
        const root = resolveStorageRoot()
        const dirSegments = [...readProjectSegments(dirPath), COVER_DIR]
        await vscode.workspace.fs.createDirectory(buildStorageUri(root, dirSegments))
        const id = await nextCoverId(root, dirSegments, SAVED_COVER_EXTENSION)
        const segments = [...dirSegments, `${id}.${SAVED_COVER_EXTENSION}`]
        const target = buildStorageUri(root, segments)
        await vscode.workspace.fs.writeFile(target, bytes)
        const coverPath = segments.join('/')
        this.store.write(dirPath, coverPath)
        logger.info(`封面合成保存完成：${coverPath}（${bytes.byteLength} 字节）`)
        return {
            cover: { id, path: coverPath, url: toWebviewUri(target), createdAt: new Date().toISOString() },
        }
    }

    /**
     * 设为作品封面：先校验路径归属与文件存在，再写入 press.db。
     * 关键约束：只接受该作品 Cover 目录下的封面，前端传来的任意路径不得写库。
     */
    public async select(payload: unknown): Promise<CoverSelectResult> {
        const dirPath = readProjectDirPath(payload, 'pressAi/selectCover')
        const path = readCoverPath(payload, 'pressAi/selectCover')
        if (!isProjectCoverPath(dirPath, path)) {
            throw new Error(`封面路径非法：${path}`)
        }
        const target = buildStorageUri(resolveStorageRoot(), path.split('/'))
        try {
            await vscode.workspace.fs.stat(target)
        } catch {
            throw new Error('封面文件已不存在，请重新生成或刷新列表')
        }
        this.store.write(dirPath, path)
        return { selectedId: readCoverId(path) }
    }

    /**
     * 删除一张已落盘的封面：优先回收站，不支持时退化为直接删除。
     * 删除的是当前封面时自动回退到剩余最新一张，与角色卡的封面回退规则一致。
     */
    public async remove(payload: unknown): Promise<CoverDeleteResult> {
        const dirPath = readProjectDirPath(payload, 'pressAi/deleteCover')
        const path = readCoverPath(payload, 'pressAi/deleteCover')
        if (!isProjectCoverPath(dirPath, path)) {
            throw new Error(`封面路径非法：${path}`)
        }
        const selected = this.store.read(dirPath)
        const target = buildStorageUri(resolveStorageRoot(), toSafeSegments(path, '封面'))
        try {
            await deleteResource(target, false)
        } catch {
            return { removed: false, selectedId: selected === null ? null : readCoverId(selected) }
        }
        if (selected !== path) {
            return { removed: true, selectedId: selected === null ? null : readCoverId(selected) }
        }
        // 删掉的是当前封面：按磁盘重新挑一张（回退只关心路径，URL 交给下次列举）
        const rest = await this.readCovers(readProjectSegments(dirPath), () => '')
        const next = rest[0]?.path ?? null
        this.store.write(dirPath, next)
        return { removed: true, selectedId: next === null ? null : readCoverId(next) }
    }

    /**
     * 扫描封面目录：目录不存在返回空数组，读取失败的文件跳过。
     * 关键约束：不抛错——并发删除或权限问题只影响单张图，不能让整次列举失败；
     * 只有符合 cover-{时间戳} 命名的文件才参与列举，手工放入的其它图片不受影响。
     */
    private async readCovers(
        projectSegments: string[],
        toWebviewUri: (uri: vscode.Uri) => string,
    ): Promise<PressCover[]> {
        const dirSegments = [...projectSegments, COVER_DIR]
        const root = resolveStorageRoot()
        let entries: [string, vscode.FileType][]
        try {
            entries = await vscode.workspace.fs.readDirectory(buildStorageUri(root, dirSegments))
        } catch {
            // 还没生成过封面，目录尚不存在
            return []
        }
        const covers: PressCover[] = []
        for (const [name, type] of entries) {
            if (type !== vscode.FileType.File || !COVER_FILE_PATTERN.test(name)) {
                continue
            }
            const id = name.replace(/\.[^.]+$/, '')
            if (!isPressCoverId(id)) {
                continue
            }
            const uri = buildStorageUri(root, [...dirSegments, name])
            try {
                const stat = await vscode.workspace.fs.stat(uri)
                covers.push({
                    id,
                    path: [...dirSegments, name].join('/'),
                    url: toWebviewUri(uri),
                    createdAt: new Date(stat.mtime).toISOString(),
                })
            } catch {
                // 并发删除时文件可能已消失，跳过而不是让整次扫描失败
            }
        }
        covers.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        return covers
    }

    /** 校验今日次数：限额为 0 或负数时视为不限制（与角色卡共用同一额度） */
    private assertQuota(): void {
        const limit = getZhaiConfig().imageDailyLimit
        if (limit <= 0) {
            return
        }
        const used = readUsedToday(this.db, IMAGE_QUOTA_KEYS)
        if (used >= limit) {
            throw new Error(`今日图片生成次数已用完（${used} / ${limit}），可明日再试或调高 zhai.image.dailyLimit`)
        }
    }
}

/** 入参收窄：作品目录走白名单，文本字段逐个截断，画风只接受白名单值 */
function normalizeCoverRequest(payload: unknown): CoverGenerateRequest {
    const dirPath = readProjectDirPath(payload, 'pressAi/generateCover')
    const value = payload as {
        title?: unknown
        genres?: unknown
        logline?: unknown
        worldview?: unknown
        tone?: unknown
        perspective?: unknown
        style?: unknown
    }
    return {
        dirPath,
        title: readText(value.title, MAX_SHORT_TEXT),
        genres: readTextList(value.genres, 6, 16),
        logline: readText(value.logline, MAX_LONG_TEXT),
        worldview: readText(value.worldview, MAX_LONG_TEXT),
        tone: readText(value.tone, MAX_SHORT_TEXT),
        perspective: readText(value.perspective, MAX_SHORT_TEXT),
        style: readStyle(value.style),
    }
}

/** 读取封面请求里的相对路径：删除与设封面共用同一套入参校验 */
function readCoverPath(payload: unknown, method: string): string {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error(`${method} 缺少参数`)
    }
    const path = readText((payload as { path?: unknown }).path, MAX_PATH_LENGTH)
    if (path.length === 0) {
        throw new Error('缺少封面路径')
    }
    return path
}

/** 从封面相对路径取标识：文件名去掉扩展名 */
function readCoverId(coverPath: string): string {
    const fileName = coverPath.slice(coverPath.lastIndexOf('/') + 1)
    return fileName.replace(/\.[^.]+$/u, '')
}

/** 文件名时间戳：本地时间 YYYYMMDDHHmmss，与封面命名规范一致，按文件名即可排序 */
function formatCoverStamp(date: Date): string {
    const pad = (value: number): string => String(value).padStart(2, '0')
    return [
        String(date.getFullYear()),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds()),
    ].join('')
}

/** 读取合成结果：只接受 PNG data URL，并按体积上限拒绝异常负载 */
function readCoverDataUrl(payload: unknown): string {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('pressAi/saveCover 缺少参数')
    }
    const dataUrl = (payload as { dataUrl?: unknown }).dataUrl
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith(COVER_DATA_URL_PREFIX)) {
        throw new Error('封面图片格式非法：只接受 PNG data URL')
    }
    if (dataUrl.length > MAX_COVER_DATA_URL_LENGTH) {
        throw new Error('封面图片过大，请降低分辨率后重试')
    }
    return dataUrl
}

/**
 * 生成不与磁盘冲突的封面标识：同一秒内连续保存时按秒顺延，
 * 避免覆盖已有封面（生成与合成保存共用同一命名规则）。
 */
async function nextCoverId(root: vscode.Uri, dirSegments: string[], extension: string): Promise<string> {
    const base = Date.now()
    for (let offset = 0; offset < 10; offset += 1) {
        const id = `cover-${formatCoverStamp(new Date(base + offset * 1000))}`
        try {
            await vscode.workspace.fs.stat(buildStorageUri(root, [...dirSegments, `${id}.${extension}`]))
        } catch {
            return id
        }
    }
    throw new Error('同名封面过多，请稍后重试')
}

/** 读取画风：只接受白名单内的值，其余一律回落默认风格 */
function readStyle(value: unknown): PortraitStyle {
    if (typeof value !== 'string') {
        return DEFAULT_PORTRAIT_STYLE
    }
    return PORTRAIT_STYLES.find((item) => item === value) ?? DEFAULT_PORTRAIT_STYLE
}
