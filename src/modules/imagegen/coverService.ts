/**
 * 作品封面服务：从媒体索引取该作品出处下的普通图作为封面候选，供设定页基本信息只读展示。
 * 复用约定：查询走 @modules/media/mediaRepository，封面指针走 @modules/media/pressCoverStore，
 * 作品目录归一复用 ./portraitService 的校验，URL 转换由调用方注入。
 * 关键约束：只读、不改封面指针——设封面唯一入口是媒体页图片详情；
 * 候选只取 kind 为 photo / unknown 的图，角色图与条目图不进候选；
 * 按出版时间降序截断到上限并回传总数，界面据此提示「仅显示最新 N 张」。
 */
import { resolveStorageRoot } from '@modules/common/config'
import { buildStorageUri } from '@modules/common/storagePath'
import type { MediaDatabase } from '@modules/media/db/connection'
import { countProjectPhotos, listProjectPhotos } from '@modules/media/mediaRepository'
import { readImageIdFromPath } from '@modules/media/pressCoverStore'
import type { PressCoverStore } from '@modules/media/pressCoverStore'
import type { CoverListResult, PressCover } from '@shared/types/press'
import { readProjectDirPath } from './portraitService'
import type * as vscode from 'vscode'

/** 候选上限：图库图可能很多，只取最新一批，避免一次性渲染上百张 */
const MAX_COVER_CANDIDATES = 60

/** 依赖：数据库按当前存储根懒打开，封面指针与仪表盘共用同一份 */
interface CoverServiceDeps {
    openDatabase: () => MediaDatabase
    coverStore: PressCoverStore
}

export class PressCoverService {
    public constructor(private readonly deps: CoverServiceDeps) {}

    /**
     * 列举封面候选：该作品出处下的普通图，按时间降序返回（最新在前）。
     * 磁盘是唯一事实来源，因此媒体页新生成的图片同样能被读回。
     */
    public list(payload: unknown, toWebviewUri: (uri: vscode.Uri) => string): CoverListResult {
        const dirPath = readProjectDirPath(payload, 'pressAi/listCover')
        const { db } = this.deps.openDatabase()
        const selected = this.deps.coverStore.read(dirPath)
        const root = resolveStorageRoot()
        const covers: PressCover[] = listProjectPhotos(db, dirPath, MAX_COVER_CANDIDATES).map((row) => ({
            id: row.id,
            path: row.path,
            url: toWebviewUri(buildStorageUri(root, row.path.split('/'))),
            createdAt: row.createdAt,
        }))
        return {
            covers,
            selectedId: selected === null ? null : readImageIdFromPath(selected),
            total: countProjectPhotos(db, dirPath),
        }
    }
}
