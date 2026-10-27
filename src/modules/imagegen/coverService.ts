/**
 * 作品封面服务：列举封面候选，供设定页基本信息展示当前封面。
 * 复用约定：目录名取自 ./constants，封面指针走 ./db/coverRepository，作品目录归一复用 ./portraitService 的校验，
 * URL 转换由调用方注入。
 * 关键约束：出图、设为封面与删除都在生图页完成，本服务只读、不改封面指针；
 * 列举以磁盘为准、按修改时间降序截断到上限并回传总数；
 * 候选是 Cover 下的历史合成封面 + Images 下的 photo-*，角色图不进候选，避免把设定图误当作品封面。
 */
import * as vscode from 'vscode'
import { readProjectSegments } from '@modules/common/projectPath'
import { parseImageKind } from '@shared/types/imagegen'
import type { CoverListResult, PressCover } from '@shared/types/press'
import { isPressCoverId } from '@shared/types/press'
import { COVER_DIR, IMAGES_DIR } from './constants'
import { PressCoverStore } from './db/coverRepository'
import { listImageFiles } from './imageDirScan'
import { readProjectDirPath } from './portraitService'
import type Database from 'better-sqlite3'

/** 候选目录：历史合成封面在 Cover，生图页产物在 Images */
const CANDIDATE_DIR_NAMES: ReadonlyArray<string> = [COVER_DIR, IMAGES_DIR]
/** 候选上限：图库图可能很多，只取最新一批，避免一次性渲染上百张 */
const MAX_COVER_CANDIDATES = 60

export class PressCoverService {
    /** 封面选择记录：与作品列表共用同一份 */
    private readonly store: PressCoverStore

    public constructor(db: Database.Database) {
        this.store = new PressCoverStore(db)
    }

    /**
     * 列举封面候选：历史合成封面与生图页产物合并，按修改时间降序返回（最新在前）。
     * 磁盘是唯一事实来源，因此生图页新生成的封面同样能被读回。
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
     * 扫描封面候选：Cover 与 Images 两个目录合并，按修改时间降序。
     * 关键约束：不抛错——目录不存在或单张读取失败只影响自身，不能让整次列举失败；
     * 只认 cover-{时间戳} 与 photo-{…} 两类命名，角色图与手工放入的其它图片不进候选。
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

/** 从封面相对路径取标识：文件名去掉扩展名 */
function readCoverId(coverPath: string): string {
    const fileName = coverPath.slice(coverPath.lastIndexOf('/') + 1)
    return fileName.replace(/\.[^.]+$/u, '')
}
