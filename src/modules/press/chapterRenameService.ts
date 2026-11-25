/**
 * 作品章节重命名：保存时让章节文件名跟随正文一级标题，并保留原有序号前缀。
 * 复用约定：标题走 common/db/fileMeta 的 parseTitle，文件名合法化沿用 noteFactory 的 toNoteFileName，
 * 序号解析与文件名构造复用 projectFactory，索引收敛走 IndexService 的 removeFile + indexFile。
 * 关键约束：只处理 press/{作品}/Chapters|Chapter/ 下的 Markdown；目标名被占用时顺延序号，绝不覆盖；
 * 改名后同步索引与活跃编辑器，避免列表残留旧路径、编辑区停在失效 Uri；同一文件连续保存只处理一次。
 */
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { parseTitle } from '@modules/common/db/fileMeta'
import { logger } from '@modules/common/logger'
import { PRESS_MODULE_DIR } from '@modules/common/projectPath'
import { buildStorageUri, isPathExisting } from '@modules/common/storagePath'
import { getActiveDocument, reportTextDocument } from '@modules/editor/activeDocument'
import { openStorageDocument } from '@modules/editor/openDocument'
import { toNoteFileName } from '@modules/note/noteFactory'
import { buildOrderedChapterFileName, CHAPTER_DIR_NAMES, readOrderPrefix } from './projectFactory'

/** 目标名被占用时的最大顺延次数，超出即放弃本次重命名 */
const MAX_RENAME_ATTEMPTS = 50

/** 重命名所需的最小索引能力：仅声明用到的方法，便于解耦与替身注入 */
export interface PressChapterRenameIndexer {
    toRelativePath: (uri: vscode.Uri) => string
    indexFile: (uri: vscode.Uri) => Promise<void>
    removeFile: (relativePath: string) => void
}

/** 判定是否作品章节：只认 press/{作品}/Chapters|Chapter/ 下的 Markdown，兼容未迁移的旧目录 */
export function isPressChapterPath(relativePath: string): boolean {
    if (!relativePath.toLowerCase().endsWith('.md')) {
        return false
    }
    const segments = relativePath.split('/')
    return segments.length >= 4 && segments[0] === PRESS_MODULE_DIR && CHAPTER_DIR_NAMES.includes(segments[2] ?? '')
}

/** 把异常收敛成单行文案：日志只关心原因本身 */
function toCauseMessage(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause)
}

export class PressChapterRenameService {
    /** 正在处理中的相对路径：保存事件可能连发，同一文件在处理期间再次触发一律丢弃 */
    private readonly pending = new Set<string>()

    public constructor(
        private readonly indexer: PressChapterRenameIndexer,
        /** 重命名完成且该文档正是活跃编辑器时回调，供宿主把列表选中态重播到新路径 */
        private readonly onActiveRenamed: (relativePath: string) => void,
    ) {}

    /** 保存钩子：标题变了就同步文件名与索引，失败只记日志，不打断保存 */
    public async handleSave(document: vscode.TextDocument): Promise<void> {
        if (document.isUntitled || document.uri.scheme !== 'file') {
            return
        }
        const relativePath = this.indexer.toRelativePath(document.uri)
        if (!isPressChapterPath(relativePath) || this.pending.has(relativePath)) {
            return
        }
        const title = parseTitle(document.getText()).trim()
        if (title.length === 0) {
            return
        }
        this.pending.add(relativePath)
        try {
            const nextPath = await this.renameToTitle(relativePath, title)
            if (nextPath === null) {
                return
            }
            this.indexer.removeFile(relativePath)
            await this.indexer.indexFile(buildStorageUri(resolveStorageRoot(), nextPath.split('/')))
            this.onActiveRenamed(nextPath)
            await this.focusIfActive(relativePath, nextPath)
            logger.info(`作品章节已按标题重命名：${relativePath} → ${nextPath}`)
        } catch (cause) {
            logger.warn(`作品章节重命名失败：${relativePath}（${toCauseMessage(cause)}）`)
        } finally {
            this.pending.delete(relativePath)
        }
    }

    /** 算出目标路径并改名：序号取自原文件名，文件名已一致时返回 null */
    private async renameToTitle(relativePath: string, title: string): Promise<string | null> {
        const segments = relativePath.split('/')
        const currentName = segments[segments.length - 1] ?? ''
        const order = readOrderPrefix(currentName) ?? 1
        const base = toNoteFileName(title).replace(/\.md$/iu, '')
        for (let index = 1; index <= MAX_RENAME_ATTEMPTS; index += 1) {
            const displayName = index === 1 ? base : `${base} ${String(index)}`
            const fileName = buildOrderedChapterFileName(order, displayName)
            if (fileName.toLowerCase() === currentName.toLowerCase()) {
                return null
            }
            const nextSegments = [...segments.slice(0, -1), fileName]
            const nextUri = buildStorageUri(resolveStorageRoot(), nextSegments)
            if (await isPathExisting(nextUri)) {
                continue
            }
            const currentUri = buildStorageUri(resolveStorageRoot(), segments)
            await vscode.workspace.fs.rename(currentUri, nextUri, { overwrite: false })
            return nextSegments.join('/')
        }
        logger.warn(`作品章节重命名放弃：${base} 已连续 ${String(MAX_RENAME_ATTEMPTS)} 次被占用`)
        return null
    }

    /** 改的正是活跃文档时切到新文件：旧 tab 保持到最后再关，避免中间态把工作流面板带偏 */
    private async focusIfActive(previousPath: string, nextPath: string): Promise<void> {
        const active = getActiveDocument()
        const previousUri = buildStorageUri(resolveStorageRoot(), previousPath.split('/'))
        if (active === null || active.uri.toString() !== previousUri.toString()) {
            return
        }
        const oldTab = vscode.window.tabGroups.all
            .flatMap((group) => group.tabs)
            .find((tab) => {
                const input = tab.input
                return (
                    (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom) &&
                    input.uri.toString() === previousUri.toString()
                )
            })
        const nextUri = buildStorageUri(resolveStorageRoot(), nextPath.split('/'))
        await openStorageDocument(nextUri)
        reportTextDocument(nextUri)
        if (oldTab !== undefined) {
            await vscode.window.tabGroups.close(oldTab)
        }
    }
}
