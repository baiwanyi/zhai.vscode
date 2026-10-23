/**
 * 作品导入服务：把用户选中的 TXT 做安全检查、编码探测与分章解析，再按作品目录规范逐章落盘并纳入索引。
 * 复用约定：骨架与章节模板取自 projectFactory，分章与清洗委托 importParser，
 * 路径构造与存在性判定复用 common/storagePath，索引走 ProjectIndexer 抽象；
 * 源文件绝对路径不下发 Webview，改由本服务签发 token 暂存，杜绝前端伪造路径读取任意文件。
 * 关键约束：落盘一律不覆盖已存在文件（重跑只补缺失章节），单章失败不中断整批，
 * 取消在章节边界生效且已写章节保留；目标为 50 MB 以内纯文本，读取上限即内存上限。
 */

import { lstat, readFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as vscode from 'vscode'
import { parseNovel, sanitizeSegment } from './importParser'
import {
    PROJECT_CHAPTER_DIR,
    PRESS_MODULE_DIR,
    buildChapterDocument,
    buildProjectDocuments,
    validateProjectName,
} from './projectFactory'
import type { ParsedNovel } from './importParser'
import type { ProjectIndexer } from './projectService'
import type {
    PressAudience,
    PressImportCandidate,
    PressImportEncoding,
    PressImportErrorCode,
    PressImportProgress,
} from '../../shared/types/press'
import type { Buffer } from 'node:buffer'
import { resolveStorageRoot } from '../common/config'
import { logger } from '../common/logger'
import { buildStorageUri, isPathExisting } from '../common/storagePath'

/** 导入文件大小上限：约 50 MB，相当于一千六百万字，足以覆盖任何单本小说且不至于读入内存过大 */
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024

/** 二进制判定取样长度：文件头部足够区分纯文本与伪装扩展名的二进制 */
const BINARY_SAMPLE_BYTES = 8192

/** 不可打印字节占比阈值：超过即视为二进制 */
const BINARY_RATIO_LIMIT = 0.3

/** 单章字数超过该值时，若全文只有一章则提示章节标记可能不规范 */
const SINGLE_CHAPTER_CHAR_LIMIT = 50_000

/** 进度推送节流：按时间与百分比双条件，避免逐章刷爆消息通道 */
const PROGRESS_INTERVAL_MS = 200
const PROGRESS_STEP_PERCENT = 5

/** 一次导入任务的最终结果 */
export interface ImportOutcome {
    status: 'completed' | 'failed' | 'cancelled'
    done: number
    total: number
    writtenChars: number
    failedChapters: number
    dirPath: string
    code?: PressImportErrorCode
    message: string
}

/** 导入失败：携带原因码，由上层转成用户可读文案 */
export class ImportError extends Error {
    public constructor(
        public readonly code: PressImportErrorCode,
        message: string,
    ) {
        super(message)
        this.name = 'ImportError'
    }
}

/** 暂存的待导入文件：token 只在本进程内有效，start 用后即清 */
interface PendingSource {
    token: string
    uri: vscode.Uri
    fileName: string
}

/** 编解码结果：编码名与解码后的全文 */
interface DecodedText {
    encoding: PressImportEncoding
    text: string
}

/** 判断字节是否为纯文本可打印字符：允许制表、换行、回车与可打印 ASCII/UTF-8 高位 */
function isPrintableByte(byte: number): boolean {
    return byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte !== 0x7f)
}

/** 二进制检测：含 NUL 字节或不可打印占比过高即判定为非纯文本 */
function looksBinary(sample: Buffer): boolean {
    if (sample.includes(0x00)) {
        return true
    }
    let unprintable = 0
    for (const byte of sample) {
        if (!isPrintableByte(byte)) {
            unprintable += 1
        }
    }
    return sample.length > 0 && unprintable / sample.length > BINARY_RATIO_LIMIT
}

/** 按 BOM 与可解码性探测编码：UTF-8 必须严格解码通过，否则回落到 GB18030 */
function detectEncoding(buffer: Buffer): DecodedText | null {
    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
        return { encoding: 'utf-8-bom', text: new TextDecoder('utf-8').decode(buffer) }
    }
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
        return { encoding: 'utf-16le', text: new TextDecoder('utf-16le').decode(buffer) }
    }
    if (looksBinary(buffer.subarray(0, BINARY_SAMPLE_BYTES))) {
        return null
    }
    try {
        return { encoding: 'utf-8', text: new TextDecoder('utf-8', { fatal: true }).decode(buffer) }
    } catch {
        // UTF-8 严格解码失败：按简体中文环境最常见的 GB18030 再试一次
    }
    try {
        return { encoding: 'gb18030', text: new TextDecoder('gb18030').decode(buffer) }
    } catch {
        return null
    }
}

/** 生成建议作品名：清洗后必须通过作品名白名单，否则回落到通用名称 */
function toSuggestedName(fileName: string): string {
    const base = fileName.replace(/\.txt$/iu, '')
    const cleaned = sanitizeSegment(base, 60)
    if (cleaned.length > 0 && validateProjectName(cleaned) === null) {
        return cleaned
    }
    return '导入作品'
}

/** 章节文件名：两位序号 + 清洗后的标题，与新建章节的命名规则保持一致 */
function toChapterFileName(order: number, title: string): string {
    const safeTitle = sanitizeSegment(title, 40)
    const label = safeTitle.length > 0 ? safeTitle : '未命名章节'
    return `${String(order).padStart(2, '0')}-${label}.md`
}

/** 写入一个文件并纳入索引 */
async function writeAndIndex(indexer: ProjectIndexer, uri: vscode.Uri, content: string): Promise<void> {
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content))
    await indexer.indexFile(uri)
}

/**
 * 作品导入服务：一次只允许一个任务，pick 与 start 通过 token 串联。
 * 取消在章节边界生效，已写章节不回滚，便于用户修正问题后重跑补齐。
 */
export class PressImportService {
    private pending: PendingSource | null = null
    private controller: AbortController | null = null
    private activeJobId = ''

    public constructor(private readonly indexer: ProjectIndexer) {}

    /**
     * 选择文件并完成安全校验与试解析：返回候选信息供用户确认，用户取消时返回 null。
     * 安全约束：只接受常规文件（拒绝目录与符号链接），扩展名限 .txt，大小不超过上限，
     * 内容须为可解码的纯文本，否则按原因码拒绝。
     * 关键约束：必须显式给 defaultUri——不传时宿主按工作区根推断初始目录，
     * 工作区为盘符路径时会被当作 URI 解析（scheme 变成盘符），抛「文件系统提供程序不可用」。
     */
    public async pick(): Promise<PressImportCandidate | null> {
        let selected: vscode.Uri[] | undefined
        try {
            selected = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                openLabel: '导入',
                filters: { 文本文件: ['txt'] },
                defaultUri: vscode.Uri.file(os.homedir()),
            })
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            logger.error('打开导入文件选择框失败', error)
            throw new ImportError('internal', `无法打开文件选择框：${message}`)
        }
        const uri = selected?.[0]
        if (uri === undefined) {
            return null
        }
        const fileName = uri.path.split('/').pop() ?? ''
        if (!/\.txt$/iu.test(fileName)) {
            throw new ImportError('bad-extension', '仅支持 .txt 纯文本文件')
        }
        const stats = await lstat(uri.fsPath)
        if (!stats.isFile() || stats.isSymbolicLink()) {
            throw new ImportError('not-file', '请选择一个 .txt 文件，不支持文件夹或快捷方式')
        }
        if (stats.size === 0) {
            throw new ImportError('empty', '文件内容为空')
        }
        if (stats.size > MAX_IMPORT_BYTES) {
            const sizeInMb = (stats.size / 1024 / 1024).toFixed(1)
            throw new ImportError('too-large', `文件 ${sizeInMb} MB，超过 50 MB 上限`)
        }
        const bytes = await readFile(uri.fsPath)
        const decoded = detectEncoding(bytes)
        if (decoded === null) {
            throw new ImportError('bad-encoding', '无法识别文件编码（已尝试 UTF-8 / GB18030），请另存为 UTF-8 后重试')
        }
        const parsed = parseNovel(decoded.text)
        this.assertParsed(parsed)
        const token = `import-${String(Date.now())}-${Math.random().toString(36).slice(2, 10)}`
        this.pending = { token, uri, fileName }
        const chapters = parsed.chapters
        logger.info(`导入预检通过：${fileName}，编码 ${decoded.encoding}，${String(chapters.length)} 章`)
        return {
            token,
            fileName,
            suggestedName: toSuggestedName(fileName),
            byteSize: stats.size,
            encoding: decoded.encoding,
            chapterCount: chapters.length,
            volumeCount: parsed.volumeDirs.length,
            charCount: parsed.totalChars,
            firstChapterTitle: chapters[0]?.title ?? '',
            lastChapterTitle: chapters[chapters.length - 1]?.title ?? '',
            warnings: parsed.warnings,
        }
    }

    /**
     * 启动导入任务：校验 token 与作品名后，重新读取并解析源文件，逐章落盘。
     * jobId 由调用方生成并立即回传前端，使取消与进度过滤能在任务结束前就可用。
     * 关键约束：目标作品目录已存在即拒绝，绝不覆盖；单章写入失败只累计计数不中断；
     * 进度按节流回调，终态由调用方广播。
     */
    public async start(
        jobId: string,
        token: string,
        name: string,
        audience: PressAudience,
        onProgress: (progress: PressImportProgress) => void,
    ): Promise<ImportOutcome> {
        if (this.controller !== null) {
            throw new ImportError('internal', '已有导入任务在进行中，请等待完成或取消')
        }
        const pending = this.pending
        if (pending === null || pending.token !== token) {
            throw new ImportError('internal', '导入会话已失效，请重新选择文件')
        }
        const trimmedName = name.trim()
        const invalidReason = validateProjectName(trimmedName)
        if (invalidReason !== null) {
            throw new ImportError('bad-project-name', invalidReason)
        }
        const root = resolveStorageRoot()
        const directory = buildStorageUri(root, [PRESS_MODULE_DIR, trimmedName])
        if (await isPathExisting(directory)) {
            throw new ImportError('project-exists', `已存在同名作品「${trimmedName}」，请修改作品名`)
        }
        const controller = new AbortController()
        this.controller = controller
        this.activeJobId = jobId
        this.pending = null
        const dirPath = `${PRESS_MODULE_DIR}/${trimmedName}`
        const baseProgress: PressImportProgress = {
            jobId,
            status: 'running',
            done: 0,
            total: 0,
            writtenChars: 0,
            failedChapters: 0,
            dirPath,
            message: '正在读取源文件…',
        }
        try {
            const bytes = await readFile(pending.uri.fsPath)
            const decoded = detectEncoding(bytes)
            if (decoded === null) {
                throw new ImportError('bad-encoding', '源文件编码已变化，请重新选择文件')
            }
            const parsed = parseNovel(decoded.text)
            this.assertParsed(parsed)
            return await this.writeProject({
                jobId,
                dirPath,
                name: trimmedName,
                audience,
                parsed,
                controller,
                onProgress,
                baseProgress,
            })
        } catch (error) {
            const code = error instanceof ImportError ? error.code : 'internal'
            const message = error instanceof Error ? error.message : String(error)
            logger.error(`导入失败：${dirPath}`, error)
            return {
                status: 'failed',
                done: 0,
                total: baseProgress.total,
                writtenChars: 0,
                failedChapters: 0,
                dirPath,
                code,
                message,
            }
        } finally {
            this.controller = null
            this.activeJobId = ''
        }
    }

    /** 取消进行中的导入：在下一个章节边界生效，已写章节保留 */
    public cancel(jobId: string): { cancelled: boolean } {
        if (this.controller === null || this.activeJobId !== jobId) {
            return { cancelled: false }
        }
        this.controller.abort()
        return { cancelled: true }
    }

    /** 解析结果兜底校验：无章节或疑似单章全文时按原因码拒绝，避免写出不可用的作品 */
    private assertParsed(parsed: ParsedNovel): void {
        if (parsed.chapters.length === 0) {
            throw new ImportError(
                'no-chapter',
                '未识别到章节标题，请确认正文使用「第N章」等标记后重试',
            )
        }
        const onlyChapter = parsed.chapters[0]
        if (parsed.chapters.length === 1 && onlyChapter !== undefined && onlyChapter.charCount > SINGLE_CHAPTER_CHAR_LIMIT) {
            throw new ImportError(
                'single-chapter',
                '全文被识别为单章，章节标记可能不规范，请检查后重试',
            )
        }
    }

    /**
     * 落盘主体：先建目录与四份作品文档，再逐章写入并索引。
     * 已存在的章节文件一律跳过，使重跑只补缺失章节，不覆盖用户可能已修改的内容。
     */
    private async writeProject(job: {
        jobId: string
        dirPath: string
        name: string
        audience: PressAudience
        parsed: ParsedNovel
        controller: AbortController
        onProgress: (progress: PressImportProgress) => void
        baseProgress: PressImportProgress
    }): Promise<ImportOutcome> {
        const { jobId, dirPath, name, audience, parsed, controller, onProgress } = job
        const root = resolveStorageRoot()
        const segments = job.dirPath.split('/')
        await vscode.workspace.fs.createDirectory(buildStorageUri(root, segments))
        await vscode.workspace.fs.createDirectory(buildStorageUri(root, [...segments, PROJECT_CHAPTER_DIR]))
        for (const document of buildProjectDocuments(name, audience, new Date())) {
            const target = buildStorageUri(root, [...segments, ...document.relativePath.split('/')])
            await writeAndIndex(this.indexer, target, document.content)
        }
        const total = parsed.chapters.length
        let done = 0
        let writtenChars = 0
        let failedChapters = 0
        const createdVolumes = new Set<string>()
        let lastEmitAt = Date.now()
        let lastPercent = 0
        const emit = (force: boolean): void => {
            const percent = total === 0 ? 100 : Math.floor((done / total) * 100)
            const now = Date.now()
            const isDue = now - lastEmitAt >= PROGRESS_INTERVAL_MS || percent - lastPercent >= PROGRESS_STEP_PERCENT
            if (!force && !isDue) {
                return
            }
            lastEmitAt = now
            lastPercent = percent
            onProgress({
                jobId,
                status: 'running',
                done,
                total,
                writtenChars,
                failedChapters,
                dirPath,
                message: `正在导入 ${String(done)}/${String(total)} 章 · ${String(percent)}%`,
            })
        }
        for (const chapter of parsed.chapters) {
            if (controller.signal.aborted) {
                logger.info(`导入已取消：${dirPath}，已完成 ${String(done)}/${String(total)}`)
                return {
                    status: 'cancelled',
                    done,
                    total,
                    writtenChars,
                    failedChapters,
                    dirPath,
                    message: `已取消，已写入 ${String(done)} 章`,
                }
            }
            const chapterSegments = [...segments, PROJECT_CHAPTER_DIR]
            if (chapter.volumeDir.length > 0) {
                if (!createdVolumes.has(chapter.volumeDir)) {
                    await vscode.workspace.fs.createDirectory(
                        buildStorageUri(root, [...chapterSegments, chapter.volumeDir]),
                    )
                    createdVolumes.add(chapter.volumeDir)
                }
                chapterSegments.push(chapter.volumeDir)
            }
            const fileName = toChapterFileName(chapter.order, chapter.title)
            const target = buildStorageUri(root, [...chapterSegments, fileName])
            try {
                if (await isPathExisting(target)) {
                    done += 1
                    emit(false)
                    continue
                }
                await writeAndIndex(this.indexer, target, buildChapterDocument(chapter.title, chapter.body))
                writtenChars += chapter.charCount
            } catch (error) {
                failedChapters += 1
                logger.error(`章节写入失败：${dirPath}/${fileName}`, error)
            }
            done += 1
            emit(false)
        }
        emit(true)
        const isPartiallyFailed = failedChapters > 0
        return {
            status: isPartiallyFailed ? 'failed' : 'completed',
            done,
            total,
            writtenChars,
            failedChapters,
            dirPath,
            code: isPartiallyFailed ? 'partially-failed' : undefined,
            message: isPartiallyFailed
                ? `已导入 ${String(done - failedChapters)} 章，${String(failedChapters)} 章写入失败`
                : `已导入《${name}》共 ${String(total)} 章 ${String(writtenChars)} 字`,
        }
    }
}
