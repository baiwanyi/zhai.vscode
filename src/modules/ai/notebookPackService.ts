/**
 * 笔记本打包服务：按笔记本读索引取篇目、读盘取正文，打包结果按笔记本缓存。
 * 复用约定：篇目列表取 statsRepository 的 listNotesByNotebook，打包算法在 notebookPack 内，
 * 路径校验取 common/storagePath，本层只负责 IO 与缓存。
 * 关键约束：缓存以「篇数 + 最新 mtime + 总字数」为指纹，笔记增删改后自动失效重打包；
 * 芯片展示的字数与发送时注入的文本同源，不会出现「显示 5.8k 实际注入 3k」；
 * 篇数上限内截断，超出部分按最近更新优先保留，不在本层做分页。
 */
import * as path from 'node:path'
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { listNotesByNotebook, NOTE_PATH_PREFIX } from '@modules/common/db/statsRepository'
import { toSafeSegments } from '@modules/common/storagePath'
import type { AiNotebookPackMode } from '@shared/types/aiChat'
import { packNotebook } from './notebookPack'
import type Database from 'better-sqlite3'

/** 单次打包的篇数上限：整本引用的极端场景，超过按最近更新截断 */
const MEMBER_LIMIT = 200
/** 缓存条目上限：笔记本不会很多，超出按插入顺序淘汰最旧的 */
const MAX_CACHE_ENTRIES = 20

/** 打包结果与指纹：text 即待注入文本 */
export interface NotebookPackEntry {
    text: string
    charCount: number
    packMode: AiNotebookPackMode
    memberCount: number
    /** 篇数 + 最新 mtime + 总字数，用于判断缓存是否仍然有效 */
    fingerprint: string
}

/** 读取存储根内的文本：路径来自索引，仍按片段校验后拼绝对路径，读失败按空串处理 */
async function readStorageText(relativePath: string): Promise<string> {
    try {
        const segments = toSafeSegments(relativePath, '笔记')
        const uri = vscode.Uri.joinPath(resolveStorageRoot(), ...segments)
        const bytes = await vscode.workspace.fs.readFile(uri)
        return new TextDecoder('utf-8').decode(bytes)
    } catch {
        return ''
    }
}

export class NotebookPackService {
    private readonly cache = new Map<string, NotebookPackEntry>()

    public constructor(private readonly db: Database.Database) {}

    /**
     * 打包并缓存一本笔记本：缓存指纹一致则直接复用，否则重新读盘打包。
     * 返回 null 表示该笔记本没有笔记，由调用方给出可执行提示。
     */
    public async pack(notebookId: string): Promise<NotebookPackEntry | null> {
        const rows = listNotesByNotebook(this.db, notebookId, MEMBER_LIMIT)
        if (rows.length === 0) {
            return null
        }
        const totalWords = rows.reduce((sum, row) => sum + row.wordCount, 0)
        const latest = rows[0]?.mtime ?? ''
        const fingerprint = `${String(rows.length)}-${latest}-${String(totalWords)}`
        const cached = this.cache.get(notebookId)
        if (cached !== undefined && cached.fingerprint === fingerprint) {
            return cached
        }
        const notes = await Promise.all(
            rows.map(async (row) => ({
                title: row.title.length > 0 ? row.title : path.basename(row.path).replace(/\.md$/u, ''),
                content: await readStorageText(row.path),
            })),
        )
        const name = notebookId.startsWith(NOTE_PATH_PREFIX) ? notebookId.slice(NOTE_PATH_PREFIX.length) : notebookId
        const packed = packNotebook(name, notes)
        const entry: NotebookPackEntry = { ...packed, fingerprint }
        this.writeCache(notebookId, entry)
        return entry
    }

    /** 发送时取文本：缓存命中直接用，失效则重打包 */
    public async read(notebookId: string): Promise<string | null> {
        const entry = await this.pack(notebookId)
        return entry === null ? null : entry.text
    }

    /**
     * 覆盖为模型压缩后的文本：指纹保持原值，笔记增删改后仍会随指纹变化重新打包。
     * 返回覆盖后的条目，缓存未命中时返回 null（调用方应先 pack 一次）。
     */
    public override(notebookId: string, text: string): NotebookPackEntry | null {
        const cached = this.cache.get(notebookId)
        if (cached === undefined) {
            return null
        }
        const entry: NotebookPackEntry = {
            ...cached,
            text,
            charCount: text.length,
            packMode: 'compressed',
        }
        this.cache.set(notebookId, entry)
        return entry
    }

    /** 引用被移除时清掉对应缓存，避免用户以为笔记内容还在注入 */
    public forget(notebookId: string): void {
        this.cache.delete(notebookId)
    }

    /** 清空上下文或切换会话时整体失效 */
    public clear(): void {
        this.cache.clear()
    }

    private writeCache(notebookId: string, entry: NotebookPackEntry): void {
        if (this.cache.size >= MAX_CACHE_ENTRIES && !this.cache.has(notebookId)) {
            const oldest = this.cache.keys().next()
            if (oldest.done !== true) {
                this.cache.delete(oldest.value)
            }
        }
        this.cache.set(notebookId, entry)
    }
}
