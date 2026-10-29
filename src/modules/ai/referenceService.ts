/**
 * 参考资料：扫描 {存储根}/reference/*.md 语料，按标题切条目，检索后按行范围注入对话上下文。
 * 语料约定：一级标题为分类（缺省用文件名），二级标题为条目名，其下正文即条目内容；
 * 用户直接在目录里增删改文件，插件不写入语料，只读。
 * 关键约束：添加时按 file + startLine 重新解析确认条目仍存在，不采信前端给的行范围；
 * 路径必须落在 reference/ 下且为 .md，避免借协议读取存储根外的文件；
 * 单个文件读失败不阻断其余语料，目录不存在时返回空列表而不是报错。
 */
import { randomUUID } from 'node:crypto'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import type { AiContextRef, AiReferenceEntry } from '@shared/types/aiChat'
import type { AiChatService } from './chatService'
import type { HostContextRef } from './contextRefs'

/** 语料目录名：位于存储根下 */
const REFERENCE_DIR = 'reference'
/** 检索返回上限：候选是选择题，不需要全量条目 */
const MAX_REFERENCE_HITS = 20
/** 摘要长度：够看清是否所需，又不至于把正文搬进列表 */
const MAX_SNIPPET = 100

/** 解析出的条目：与下发契约相比多出 endLine 与正文，供注入与摘要使用 */
interface ParsedEntry {
    file: string
    category: string
    name: string
    startLine: number
    endLine: number
    body: string
}

/** 读全部语料：目录缺失或单文件不可读都按空处理 */
async function readReferenceFiles(): Promise<Array<{ file: string; text: string }>> {
    const dir = vscode.Uri.joinPath(resolveStorageRoot(), REFERENCE_DIR)
    let children: [string, vscode.FileType][]
    try {
        children = await vscode.workspace.fs.readDirectory(dir)
    } catch {
        return []
    }
    const results: Array<{ file: string; text: string }> = []
    for (const [name, type] of children) {
        if (type !== vscode.FileType.File || !name.toLowerCase().endsWith('.md')) {
            continue
        }
        try {
            const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, name))
            results.push({ file: `${REFERENCE_DIR}/${name}`, text: new TextDecoder().decode(bytes) })
        } catch {
            // 单文件读取失败只跳过该文件，不影响其余语料
        }
    }
    return results
}

/** 按标题切条目：二级标题起条，一级标题切换分类；没有二级标题时整篇算一个条目 */
function parseEntries(file: string, text: string): ParsedEntry[] {
    const lines = text.split(/\r?\n/)
    const fallback = path.basename(file, path.extname(file))
    const entries: ParsedEntry[] = []
    let category = fallback
    let current: { name: string; startLine: number; body: string[] } | null = null
    const flush = (endLine: number): void => {
        if (current === null) {
            return
        }
        entries.push({
            file,
            category,
            name: current.name,
            startLine: current.startLine,
            endLine,
            body: current.body.join('\n'),
        })
        current = null
    }
    for (const [index, line] of lines.entries()) {
        const levelTwo = /^##\s+(.+)$/u.exec(line)
        if (levelTwo !== null) {
            // 上一段的结束行是当前行前一行（1 基即 index）
            flush(index)
            current = { name: levelTwo[1]?.trim() ?? '', startLine: index + 1, body: [] }
            continue
        }
        const levelOne = /^#\s+(.+)$/u.exec(line)
        if (levelOne !== null && current === null) {
            category = levelOne[1]?.trim() ?? fallback
            continue
        }
        if (current !== null) {
            current.body.push(line)
        }
    }
    flush(lines.length)
    if (entries.length === 0 && text.trim().length > 0) {
        entries.push({ file, category, name: category, startLine: 1, endLine: lines.length, body: text })
    }
    return entries.filter((entry) => entry.name.length > 0)
}

/** 摘要：优先取命中行，未命中取正文开头，压成单行并截断 */
function readSnippet(body: string, keyword: string): string {
    const lines = body.split(/\r?\n/).filter((line) => line.trim().length > 0)
    const hit = lines.find((line) => line.toLowerCase().includes(keyword)) ?? lines[0] ?? ''
    const compact = hit.replace(/\s+/g, ' ').trim()
    return compact.length > MAX_SNIPPET ? `${compact.slice(0, MAX_SNIPPET)}…` : compact
}

export class ReferenceService {
    public constructor(private readonly chat: AiChatService) {}

    /** 按关键词检索语料：名称命中排在正文命中之前，空关键词返回空列表 */
    public async search(keyword: string): Promise<AiReferenceEntry[]> {
        const trimmed = keyword.trim().toLowerCase()
        if (trimmed.length === 0) {
            return []
        }
        const hits: Array<{ entry: ParsedEntry; snippet: string; isNameHit: boolean }> = []
        for (const file of await readReferenceFiles()) {
            for (const entry of parseEntries(file.file, file.text)) {
                const isNameHit = entry.name.toLowerCase().includes(trimmed)
                if (!isNameHit && !entry.body.toLowerCase().includes(trimmed)) {
                    continue
                }
                hits.push({ entry, snippet: readSnippet(entry.body, trimmed), isNameHit })
            }
        }
        hits.sort((left, right) => {
            if (left.isNameHit !== right.isNameHit) {
                return left.isNameHit ? -1 : 1
            }
            return left.entry.name.localeCompare(right.entry.name)
        })
        return hits.slice(0, MAX_REFERENCE_HITS).map(({ entry, snippet }) => ({
            file: entry.file,
            category: entry.category,
            name: entry.name,
            startLine: entry.startLine,
            snippet,
        }))
    }

    /**
     * 按条目添加引用：重新解析该文件并按起始行定位，拿宿主的行范围构造引用。
     * 关键约束：路径必须在 reference/ 下且为 .md，条目必须仍存在，否则直接拒绝。
     */
    public async add(
        file: string,
        startLine: number,
    ): Promise<{ added: AiContextRef[]; duplicated: number; isFull: boolean }> {
        if (!file.startsWith(`${REFERENCE_DIR}/`) || !file.toLowerCase().endsWith('.md')) {
            throw new Error('参考资料路径不合法')
        }
        const target = (await readReferenceFiles()).find((item) => item.file === file)
        if (target === undefined) {
            throw new Error('语料文件不存在，请检查 reference 目录')
        }
        const entry = parseEntries(target.file, target.text).find((item) => item.startLine === startLine)
        if (entry === undefined) {
            throw new Error('该条目已变更，请重新检索')
        }
        const uri = vscode.Uri.joinPath(resolveStorageRoot(), ...file.split('/')).fsPath
        const ref: HostContextRef = {
            id: randomUUID(),
            kind: 'selection',
            label: `${entry.category} / ${entry.name}`,
            displayPath: `${file}:${String(entry.startLine)}-${String(entry.endLine)}`,
            startLine: entry.startLine,
            endLine: entry.endLine,
            charCount: 0,
            isTruncated: false,
            uri,
        }
        const result = this.chat.addContexts([ref])
        return { added: result.added, duplicated: result.duplicated, isFull: result.isFull }
    }

    /** 打开语料目录：目录不存在时先创建，返回是否成功唤起系统文件管理器 */
    public async openDir(): Promise<{ opened: boolean }> {
        const dir = vscode.Uri.joinPath(resolveStorageRoot(), REFERENCE_DIR)
        await vscode.workspace.fs.createDirectory(dir)
        return { opened: await vscode.env.openExternal(dir) }
    }
}
