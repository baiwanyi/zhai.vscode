/**
 * 提及检索：从全文索引里找笔记与章节，按候选添加为对话上下文引用。
 * 复用约定：检索走 common/db 的 searchFiles（与全局搜索同源），引用构造与去重交给 chatService.addContexts，
 * 本层不复制上下文渲染、截断与去重逻辑。
 * 关键约束：添加时只接受索引库里确实存在的相对路径 —— 先查库再拼绝对路径，
 * 避免 Webview 借协议读取任意文件；字符数与截断标记留空，真实长度在发送时由 resolveContextRefs 判定。
 */
import { randomUUID } from 'node:crypto'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { listIndexedPaths, searchFiles } from '@modules/common/db/indexRepository'
import type { AiContextRef, AiMentionCandidate, AiMentionKind } from '@shared/types/aiChat'
import type { AiChatService } from './chatService'
import type { HostContextRef } from './contextRefs'
import type Database from 'better-sqlite3'

/** 单次检索返回上限：候选是选择题，不需要全量索引 */
const MENTION_LIMIT = 20

/** 按路径前缀归类：只用于展示分组，不参与权限判断 */
function readMentionKind(relativePath: string): AiMentionKind {
    if (relativePath.startsWith('notes/')) {
        return 'note'
    }
    if (relativePath.includes('/Chapters/') || relativePath.startsWith('press/')) {
        return 'chapter'
    }
    return 'other'
}

export class MentionService {
    public constructor(
        private readonly db: Database.Database,
        private readonly chat: AiChatService,
    ) {}

    /** 按关键词检索候选：空关键词返回空列表，不把整个索引倒给前端 */
    public search(keyword: string): AiMentionCandidate[] {
        const trimmed = keyword.trim()
        if (trimmed.length === 0) {
            return []
        }
        return searchFiles(this.db, trimmed, MENTION_LIMIT).map((hit) => ({
            path: hit.path,
            title: hit.title.length > 0 ? hit.title : path.basename(hit.path),
            kind: readMentionKind(hit.path),
        }))
    }

    /**
     * 按候选路径添加引用。
     * 关键约束：路径必须在索引库中存在，否则直接拒绝 —— 索引外路径可能指向存储根之外的文件。
     */
    public add(relativePath: string): { added: AiContextRef[]; duplicated: number; isFull: boolean } {
        if (!listIndexedPaths(this.db).has(relativePath)) {
            throw new Error('该条目不在索引中，请先重建索引后再试')
        }
        const absolutePath = vscode.Uri.joinPath(resolveStorageRoot(), ...relativePath.split('/')).fsPath
        const ref: HostContextRef = {
            id: randomUUID(),
            kind: 'file',
            label: relativePath,
            displayPath: relativePath,
            startLine: null,
            endLine: null,
            charCount: 0,
            isTruncated: false,
            uri: vscode.Uri.file(absolutePath).fsPath,
        }
        return this.chat.addContexts([ref])
    }
}
