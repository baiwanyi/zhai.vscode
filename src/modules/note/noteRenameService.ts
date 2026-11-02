/**
 * 笔记重命名：保存时让文件名跟随笔记标题，维持「文件名 = 标题」这一事实。
 * 复用 fileMeta 的标题提取口径（Frontmatter title 优先、其次首个一级标题），与列表显示同源；
 * 复用 noteFactory 的文件名合法化与 storagePath 的路径构造、IndexService 的单文件索引能力。
 * 关键约束：只处理 notes/ 下的 Markdown；文件名与标题一致（忽略大小写）即跳过，不做大小写改写；
 * 目标名被占用时顺延序号，绝不覆盖既有文件；重命名后先清旧记录再建新记录，并迁移置顶、重播活跃笔记，
 * 否则列表会残留旧路径、置顶丢失、高亮指向已不存在的条目；
 * 同一文件的保存事件可能连续到达，处理期间再次触发一律丢弃。
 */
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { parseTitle, splitFrontmatter } from '@modules/common/db/fileMeta'
import { logger } from '@modules/common/logger'
import { buildStorageUri, isPathExisting } from '@modules/common/storagePath'
import { NOTE_DIR, toNoteFileName } from './noteFactory'

/** 目标名被占用时的最大顺延次数，超出即放弃本次重命名（保持现状比造出一串无意义后缀更安全） */
const MAX_RENAME_ATTEMPTS = 50

/** 重命名所需的最小索引能力：仅声明用到的方法，便于解耦与替身注入 */
export interface NoteRenameIndexer {
    toRelativePath: (uri: vscode.Uri) => string
    indexFile: (uri: vscode.Uri) => Promise<void>
    removeFile: (relativePath: string) => void
}

/** 重命名所需的置顶能力：路径跟着文件走，置顶状态与顺序保持不变 */
export interface NoteRenamePins {
    renamePath: (previousPath: string, nextPath: string) => Promise<void>
}

/** 把异常收敛成单行文案：日志只关心原因本身 */
function toCauseMessage(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause)
}

/** 重命名目标：文件名与已构造好的绝对 Uri */
interface RenameTarget {
    fileName: string
    uri: vscode.Uri
}

export class NoteRenameService {
    /** 正在处理中的相对路径：保存事件可能连发，同一文件在处理期间再次触发一律丢弃 */
    private readonly pending = new Set<string>()

    public constructor(
        private readonly indexer: NoteRenameIndexer,
        private readonly pins: NoteRenamePins,
        /** 重命名完成且该文档正是活跃编辑器时回调，供宿主把列表选中态重播到新路径 */
        private readonly onActiveRenamed: (relativePath: string) => void,
    ) {}

    /** 保存入口：判定是否属于笔记，命中后交给重命名流程；失败只记日志，不打断保存 */
    public async handleSave(document: vscode.TextDocument): Promise<void> {
        if (document.isUntitled || document.uri.scheme !== 'file') {
            return
        }
        const relativePath = this.indexer.toRelativePath(document.uri)
        if (!relativePath.toLowerCase().endsWith('.md')) {
            return
        }
        if (!relativePath.startsWith(`${NOTE_DIR}/`)) {
            return
        }
        if (this.pending.has(relativePath)) {
            return
        }
        this.pending.add(relativePath)
        try {
            await this.renameToMatchTitle(document, relativePath)
        } catch (error) {
            logger.warn(`笔记按标题重命名失败：${relativePath}（${toCauseMessage(error)}）`)
        } finally {
            this.pending.delete(relativePath)
        }
    }

    private async renameToMatchTitle(document: vscode.TextDocument, relativePath: string): Promise<void> {
        const { frontmatter, body } = splitFrontmatter(document.getText())
        const title = parseTitle(body, frontmatter).trim()
        // 没有标题就不猜：保留现有文件名，等用户补上一级标题后下次保存再对齐
        if (title === '') {
            return
        }
        const segments = relativePath.split('/')
        const currentName = segments[segments.length - 1] ?? ''
        const preferredName = toNoteFileName(title)
        if (currentName.toLowerCase() === preferredName.toLowerCase()) {
            return
        }
        const target = await this.findAvailableTarget(segments.slice(0, -1), preferredName, currentName)
        if (target === null) {
            return
        }
        const isActiveDocument = vscode.window.activeTextEditor?.document.uri.toString() === document.uri.toString()
        await vscode.workspace.fs.rename(document.uri, target.uri, { overwrite: false })
        const nextRelativePath = [...segments.slice(0, -1), target.fileName].join('/')
        this.indexer.removeFile(relativePath)
        await this.indexer.indexFile(target.uri)
        await this.pins.renamePath(relativePath, nextRelativePath)
        if (isActiveDocument) {
            this.onActiveRenamed(nextRelativePath)
        }
        logger.info(`笔记已按标题重命名：${relativePath} → ${nextRelativePath}`)
    }

    /**
     * 在目标目录内找一个可用文件名：首选标题本体，被占用则顺延「标题 2」「标题 3」……
     * 关键约束：候选落回当前文件名时返回 null，表示目录里已没有更优解，避免反复改名。
     */
    private async findAvailableTarget(
        directorySegments: string[],
        preferredName: string,
        currentName: string,
    ): Promise<RenameTarget | null> {
        const root = resolveStorageRoot()
        const base = preferredName.replace(/\.md$/iu, '')
        for (let index = 1; index <= MAX_RENAME_ATTEMPTS; index += 1) {
            const fileName = index === 1 ? preferredName : `${base} ${String(index)}.md`
            if (fileName.toLowerCase() === currentName.toLowerCase()) {
                return null
            }
            const candidate = buildStorageUri(root, [...directorySegments, fileName])
            if (!(await isPathExisting(candidate))) {
                return { fileName, uri: candidate }
            }
        }
        logger.warn(`笔记重命名放弃：${preferredName} 已连续 ${MAX_RENAME_ATTEMPTS} 次被占用`)
        return null
    }
}
