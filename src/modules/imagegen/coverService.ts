/**
 * 作品封面服务：管理封面画廊的候选图——合成保存、选择与删除。
 * 复用约定：目录名取自 ./constants，封面指针走 ./db/coverRepository，作品目录归一复用 ./portraitService 的校验，
 * 路径一律经 common/storagePath，URL 转换由调用方注入。
 * 关键约束：AI 出图已统一到 pressAi/generateImage 的 cover 模式，本服务不再调用图像通道、不计出图额度；
 * 画廊候选两处：合成封面落 Cover/cover-{年月日时分秒}，生图页产物取 Images 下的 photo-*（角色图不进画廊）；
 * 列举以磁盘为准、按修改时间降序截断到上限并回传总数；删除只接受该作品目录下的白名单路径，
 * 删掉当前封面时回退到剩余最新一张；Images 来源的候选带同名侧车，删除时一并清理。
 */
import * as vscode from 'vscode'
import { COVER_DIR, IMAGES_DIR } from './constants'
import { PressCoverStore, isProjectImagePath } from './db/coverRepository'
import { listImageFiles } from './imageDirScan'
import { deleteSidecarOf } from './imageSidecar'
import { readProjectDirPath } from './portraitService'
import type {
    CoverDeleteResult,
    CoverGenerateResult,
    CoverListResult,
    CoverSelectResult,
    PressCover,
} from '../../shared/types/press'
import type Database from 'better-sqlite3'
import { parseImageKind } from '../../shared/types/imagegen'
import { isPressCoverId } from '../../shared/types/press'
import { resolveStorageRoot } from '../common/config'
import { logger } from '../common/logger'
import { readProjectSegments } from '../common/projectPath'
import { readText } from '../common/readInput'
import { buildStorageUri, deleteResource, toSafeSegments } from '../common/storagePath'

/** 画廊候选目录：合成封面在 Cover，生图页产物在 Images */
const CANDIDATE_DIR_NAMES: ReadonlyArray<string> = [COVER_DIR, IMAGES_DIR]
/** 候选上限：图库图可能很多，画廊只取最新一批，避免一次性渲染上百张 */
const MAX_COVER_CANDIDATES = 60
/** 相对路径长度上限：作品名叠加目录名后仍留出余量 */
const MAX_PATH_LENGTH = 320
/** 合成封面的 data URL 前缀：只接受 PNG，避免二次压缩损失文字边缘 */
const COVER_DATA_URL_PREFIX = 'data:image/png;base64,'
/** 合成封面的扩展名：前端画布固定输出 PNG */
const SAVED_COVER_EXTENSION = 'png'
/** 合成封面的负载上限：远超 768×1024 PNG 的常见体积，超出视为异常请求 */
const MAX_COVER_DATA_URL_LENGTH = 24_000_000

export class PressCoverService {
    /** 封面选择记录：与作品列表共用同一份 */
    private readonly store: PressCoverStore

    public constructor(db: Database.Database) {
        this.store = new PressCoverStore(db)
    }

    /**
     * 列举画廊候选：合成封面与生图页产物合并，按修改时间降序返回（最新在前）。
     * 磁盘是唯一事实来源，因此关闭面板期间完成的生成同样能被读回。
     */
    public async list(payload: unknown, toWebviewUri: (uri: vscode.Uri) => string): Promise<CoverListResult> {
        const dirPath = readProjectDirPath(payload, 'pressAi/listCover')
        const selected = this.store.read(dirPath)
        const candidates = await this.readCandidates(readProjectSegments(dirPath), toWebviewUri)
        return {
            covers: candidates.slice(0, MAX_COVER_CANDIDATES),
            selectedId: selected === null ? null : readCoverId(selected),
            total: candidates.length,
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
     * 关键约束：只接受该作品图片目录（Cover / Images 等白名单）下的文件，前端传来的任意路径不得写库。
     */
    public async select(payload: unknown): Promise<CoverSelectResult> {
        const dirPath = readProjectDirPath(payload, 'pressAi/selectCover')
        const path = readCoverPath(payload, 'pressAi/selectCover')
        if (!isProjectImagePath(dirPath, path)) {
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
        if (!isProjectImagePath(dirPath, path)) {
            throw new Error(`封面路径非法：${path}`)
        }
        const selected = this.store.read(dirPath)
        const target = buildStorageUri(resolveStorageRoot(), toSafeSegments(path, '封面'))
        try {
            await deleteResource(target, false)
        } catch {
            return { removed: false, selectedId: selected === null ? null : readCoverId(selected) }
        }
        // Images 来源的候选带侧车，随图删除；合成的 cover-* 没有侧车，跳过即可
        await deleteSidecarOf(target)
        if (selected !== path) {
            return { removed: true, selectedId: selected === null ? null : readCoverId(selected) }
        }
        // 删掉的是当前封面：按磁盘重新挑一张（回退只关心路径，URL 交给下次列举）
        const rest = await this.readCandidates(readProjectSegments(dirPath), () => '')
        const next = rest[0]?.path ?? null
        this.store.write(dirPath, next)
        return { removed: true, selectedId: next === null ? null : readCoverId(next) }
    }

    /**
     * 扫描画廊候选：Cover 与 Images 两个目录合并，按修改时间降序。
     * 关键约束：不抛错——目录不存在或单张读取失败只影响自身，不能让整次列举失败；
     * 只认 cover-{时间戳} 与 photo-{…} 两类命名，角色图与手工放入的其它图片不进画廊。
     */
    private async readCandidates(
        projectSegments: string[],
        toWebviewUri: (uri: vscode.Uri) => string,
    ): Promise<PressCover[]> {
        const covers: PressCover[] = []
        for (const file of await listImageFiles(projectSegments, CANDIDATE_DIR_NAMES)) {
            const id = file.name.replace(/\.[^.]+$/, '')
            if (!isPressCoverId(id) && parseImageKind(id) !== 'photo') {
                continue
            }
            try {
                const stat = await vscode.workspace.fs.stat(file.uri)
                covers.push({
                    id,
                    path: file.segments.join('/'),
                    url: toWebviewUri(file.uri),
                    createdAt: new Date(stat.mtime).toISOString(),
                })
            } catch {
                // 并发删除时文件可能已消失，跳过而不是让整次扫描失败
            }
        }
        covers.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        return covers
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
