/**
 * 作品工作台文档读取：按作品目录读取 README.md、设定.md、角色设定.md、大纲.md 原文，
 * 以及设定页按标签页拆分的世界观.md、金手指.md，供写作管理页解析成视图模型。
 * 复用 common/config 的存储根解析与 common/storagePath 的路径构造、片段校验；本模块只读，不写盘也不触碰索引。
 * 关键约束：dirPath 必须是 press/{作品名} 两段，不接受章节等更深路径与上跳片段；
 * 文件缺失、目录为空或读取失败一律按空串返回，保证单个文件异常不会让整页打不开，格式兼容由 Webview 解析层承担；
 * 读取前先迁移旧章节目录（`Chapter` → `Chapters`），工作台是用户最常进入的入口，在此收敛最省事。
 */
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { PRESS_MODULE_DIR } from '@modules/common/projectPath'
import { buildStorageUri, toSafeSegments } from '@modules/common/storagePath'
import type { PressWorkspaceDocument, PressWorkspaceFiles } from '@shared/types/press'
import {
    PROJECT_FACTION_DOC_NAME,
    PROJECT_ITEM_DOC_NAME,
    PROJECT_PLACE_DOC_NAME,
    PROJECT_POWER_DOC_NAME,
    PROJECT_README_NAME,
    PROJECT_WORLD_DOC_NAME,
} from './projectFactory'
import { migrateLegacyChapterDirectory } from './projectService'

/** 工作台文档与文件名的对应关系：与 projectFactory 的骨架命名保持一致 */
const WORKSPACE_FILE_NAMES: Readonly<Record<keyof PressWorkspaceFiles, string>> = {
    readme: PROJECT_README_NAME,
    setting: '设定.md',
    characters: '角色设定.md',
    outline: '大纲.md',
}

/** 作品目录的段数：press/{作品名} */
const PROJECT_DIR_DEPTH = 2

/** 读取单份文档：文件不存在或解码失败时按空串返回，避免单个文件缺失导致整页不可用 */
async function readTextFile(uri: vscode.Uri): Promise<string> {
    try {
        const content = await vscode.workspace.fs.readFile(uri)
        return new TextDecoder('utf-8').decode(content)
    } catch {
        return ''
    }
}

/**
 * 读取作品工作台所需的文档原文：四份主文档 + 设定页的两份字段分组文档 + 三份条目文档。
 * 安全约束：路径先经片段校验（拒绝上跳、盘符与反斜杠）并限定为 press/ 下的两段，再由存储根拼装绝对 Uri。
 */
export async function readProjectWorkspace(dirPath: string): Promise<PressWorkspaceDocument> {
    const segments = toSafeSegments(dirPath, '作品')
    if (segments.length !== PROJECT_DIR_DEPTH || segments[0] !== PRESS_MODULE_DIR) {
        throw new Error(`作品目录非法：${dirPath}`)
    }
    await migrateLegacyChapterDirectory(dirPath)
    const name = segments[1] ?? ''
    const root = resolveStorageRoot()
    const toUri = (fileName: string): vscode.Uri => buildStorageUri(root, [PRESS_MODULE_DIR, name, fileName])
    const [readme, setting, characters, outline, world, power, faction, place, item] = await Promise.all([
        readTextFile(toUri(WORKSPACE_FILE_NAMES.readme)),
        readTextFile(toUri(WORKSPACE_FILE_NAMES.setting)),
        readTextFile(toUri(WORKSPACE_FILE_NAMES.characters)),
        readTextFile(toUri(WORKSPACE_FILE_NAMES.outline)),
        readTextFile(toUri(PROJECT_WORLD_DOC_NAME)),
        readTextFile(toUri(PROJECT_POWER_DOC_NAME)),
        readTextFile(toUri(PROJECT_FACTION_DOC_NAME)),
        readTextFile(toUri(PROJECT_PLACE_DOC_NAME)),
        readTextFile(toUri(PROJECT_ITEM_DOC_NAME)),
    ])
    return {
        dirPath,
        name,
        files: { readme, setting, characters, outline },
        settingSections: { world, power, faction, place, item },
    }
}
