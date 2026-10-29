/**
 * 角色与条目设定图读取：从媒体索引按「出处」查询，供人物卡、条目弹窗与列表封面回读。
 * 复用约定：查询走 @modules/media/mediaRepository，URL 转换由调用方注入；
 * 作品目录归一复用 common/projectPath，路径构造一律经 common/storagePath。
 * 关键约束：图片已全局化（images/{YYYYMM}/），归属靠 press_path + character_id / lore_id 界定，不再解析文件名；
 * 出图、插入、复制与删除统一在媒体页完成，本服务只读不写；
 * 目录缺失、单张读取失败都不抛错——列表封面属于增强信息，不能因此让整页失败。
 */
import { resolveStorageRoot } from '@modules/common/config'
import { readProjectSegments } from '@modules/common/projectPath'
import { readText } from '@modules/common/readInput'
import { buildStorageUri } from '@modules/common/storagePath'
import type { MediaDatabase } from '@modules/media/db/connection'
import {
    listByCharacter,
    listByLore,
    listProjectLoreImages,
    listProjectPortraits,
} from '@modules/media/mediaRepository'
import type { StoredMedia } from '@modules/media/mediaRepository'
import { isPressCharacterId, isPressLoreId } from '@shared/types/press'
import type {
    CharacterPortrait,
    PortraitGalleryItem,
    PortraitGalleryResult,
    PortraitListResult,
} from '@shared/types/press'
import type * as vscode from 'vscode'

/** 短字段长度上限 */
const MAX_SHORT_TEXT = 64
/** 相对路径长度上限：作品名与人物标识相叠加高，留出余量 */
const MAX_PATH_LENGTH = 320

/** 把索引记录转成角色/条目图的展示结构：只带渲染必需的三项 */
function toPortrait(row: StoredMedia, toWebviewUri: (uri: vscode.Uri) => string): CharacterPortrait {
    return {
        id: row.id,
        path: row.path,
        url: toWebviewUri(buildStorageUri(resolveStorageRoot(), row.path.split('/'))),
        createdAt: row.createdAt,
    }
}

/**
 * 读取作品目录：要求 press/{作品名} 两段，返回归一化后的相对路径。
 * 安全约束：越出 press 模块、含上跳或段数不符的路径一律拒绝；
 * 供封面服务与角色图读取共用同一套校验，避免两处各写一份路径白名单。
 */
export function readProjectDirPath(payload: unknown, method: string): string {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error(`${method} 缺少参数`)
    }
    const dirPath = readText((payload as { dirPath?: unknown }).dirPath, MAX_PATH_LENGTH)
    if (dirPath.length === 0) {
        throw new Error(`${method} 缺少作品目录`)
    }
    return readProjectSegments(dirPath).join('/')
}

/** 读取人物标识：只接受安全字符集，避免拼出越界目录；缺失或非法一律拒绝 */
function normalizeCharacterId(payload: unknown, method: string): string {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error(`${method} 缺少参数`)
    }
    const characterId = readText((payload as { characterId?: unknown }).characterId, MAX_SHORT_TEXT)
    if (!isPressCharacterId(characterId)) {
        throw new Error('人物标识非法，无法定位角色卡目录')
    }
    return characterId
}

/** 条目图列举入参：作品目录与条目标识共同定位，缺失任一项都直接拒绝 */
function normalizeLoreListRequest(payload: unknown): { dirPath: string; loreId: string } {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('pressAi/listLoreImages 缺少参数')
    }
    const loreId = readText((payload as { loreId?: unknown }).loreId, MAX_SHORT_TEXT)
    if (!isPressLoreId(loreId)) {
        throw new Error('条目标识非法，无法定位设定图')
    }
    return { dirPath: readProjectDirPath(payload, 'pressAi/listLoreImages'), loreId }
}

/**
 * 条目分类：缺省返回 null（老调用方只带标识），非法值同样按缺省处理。
 * 分类只用于缩小范围，标识本身在作品内唯一，缺失不会串图。
 */
function normalizeLoreKind(payload: unknown): 'faction' | 'place' | 'item' | null {
    const value = (payload as { loreKind?: unknown } | null)?.loreKind
    return value === 'faction' || value === 'place' || value === 'item' ? value : null
}

export class PortraitService {
    public constructor(private readonly openDatabase: () => MediaDatabase) {}

    /**
     * 列举某个角色的全部设定图：按出处查询，最新在前。
     * 磁盘是唯一事实来源：媒体页新生成的图在同一次会话内即可读回。
     */
    public list(payload: unknown, toWebviewUri: (uri: vscode.Uri) => string): PortraitListResult {
        const { dirPath, characterId } = {
            dirPath: readProjectDirPath(payload, 'pressAi/listPortraits'),
            characterId: normalizeCharacterId(payload, 'pressAi/listPortraits'),
        }
        const { db } = this.openDatabase()
        return { portraits: listByCharacter(db, dirPath, characterId).map((row) => toPortrait(row, toWebviewUri)) }
    }

    /**
     * 列举某个条目的全部设定图：条目分类与标识共同定位，避免不同分类的同号条目串图。
     */
    public listLore(payload: unknown, toWebviewUri: (uri: vscode.Uri) => string): PortraitListResult {
        const { dirPath, loreId } = normalizeLoreListRequest(payload)
        const loreKind = normalizeLoreKind(payload)
        const { db } = this.openDatabase()
        return { portraits: listByLore(db, dirPath, loreKind, loreId).map((row) => toPortrait(row, toWebviewUri)) }
    }

    /**
     * 一次性列举作品下全部角色的设定图，供人物列表批量显示封面。
     * 关键约束：一次查询读回全部角色图，调用方不要为每个人物单独发起请求。
     */
    public listGallery(payload: unknown, toWebviewUri: (uri: vscode.Uri) => string): PortraitGalleryResult {
        const dirPath = readProjectDirPath(payload, 'pressAi/listPortraitGallery')
        const { db } = this.openDatabase()
        const galleries: Record<string, PortraitGalleryItem[]> = {}
        for (const row of listProjectPortraits(db, dirPath)) {
            if (row.characterId === null) {
                continue
            }
            const list = galleries[row.characterId] ?? []
            list.push({ id: row.id, url: toWebviewUri(buildStorageUri(resolveStorageRoot(), row.path.split('/'))) })
            galleries[row.characterId] = list
        }
        return { galleries }
    }

    /**
     * 一次性列举作品下全部条目的设定图：同上，供条目列表批量显示封面。
     */
    public listLoreGallery(payload: unknown, toWebviewUri: (uri: vscode.Uri) => string): PortraitGalleryResult {
        const dirPath = readProjectDirPath(payload, 'pressAi/listLoreGallery')
        const { db } = this.openDatabase()
        const galleries: Record<string, PortraitGalleryItem[]> = {}
        for (const row of listProjectLoreImages(db, dirPath)) {
            if (row.loreId === null) {
                continue
            }
            const list = galleries[row.loreId] ?? []
            list.push({ id: row.id, url: toWebviewUri(buildStorageUri(resolveStorageRoot(), row.path.split('/'))) })
            galleries[row.loreId] = list
        }
        return { galleries }
    }
}
