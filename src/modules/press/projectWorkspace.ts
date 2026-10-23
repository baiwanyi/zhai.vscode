/**
 * 作品工作台文档读取：按作品目录读取 README.md、设定.md、角色设定.md、大纲.md 原文，供写作管理页解析成视图模型。
 * 复用 common/config 的存储根解析与 common/storagePath 的路径构造、片段校验；本模块只读，不写盘也不触碰索引。
 * 关键约束：dirPath 必须是 press/{作品名} 两段，不接受章节等更深路径与上跳片段；
 * 文件缺失、目录为空或读取失败一律按空串返回，保证单个文件异常不会让整页打不开，格式兼容由 Webview 解析层承担。
 */
import * as vscode from 'vscode'
import { PROJECT_README_NAME, PRESS_MODULE_DIR } from './projectFactory'
import type { PressWorkspaceDocument, PressWorkspaceFiles } from '../../shared/types/press'
import { resolveStorageRoot } from '../common/config'
import { buildStorageUri, toSafeSegments } from '../common/storagePath'

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
 * 读取作品工作台所需的四份文档原文。
 * 安全约束：路径先经片段校验（拒绝上跳、盘符与反斜杠）并限定为 press/ 下的两段，再由存储根拼装绝对 Uri。
 */
export async function readProjectWorkspace(dirPath: string): Promise<PressWorkspaceDocument> {
    const segments = toSafeSegments(dirPath, '作品')
    if (segments.length !== PROJECT_DIR_DEPTH || segments[0] !== PRESS_MODULE_DIR) {
        throw new Error(`作品目录非法：${dirPath}`)
    }
    const name = segments[1] ?? ''
    const root = resolveStorageRoot()
    const toUri = (key: keyof PressWorkspaceFiles): vscode.Uri =>
        buildStorageUri(root, [PRESS_MODULE_DIR, name, WORKSPACE_FILE_NAMES[key]])
    const [readme, setting, characters, outline] = await Promise.all([
        readTextFile(toUri('readme')),
        readTextFile(toUri('setting')),
        readTextFile(toUri('characters')),
        readTextFile(toUri('outline')),
    ])
    return {
        dirPath,
        name,
        files: { readme, setting, characters, outline },
    }
}
