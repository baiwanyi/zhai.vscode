/**
 * 编辑器上下文引用（「添加到宅对话」）：把当前编辑器/选区转换为文件引用，并负责读取、截断与渲染。
 * 复用约定：内容优先取 workspace.textDocuments 的内存态文档（含未保存修改），缺失时回退磁盘原文；
 * 渲染为 <context> 结构化片段交由 chatService 注入，前端只消费剥离绝对路径后的展示字段；
 * 行范围来源有两套——选区按文本搜索定位，块按编辑器快照的字符偏移换算，字段与去重键完全一致。
 * 关键约束：引用原文属不可信文本，须转义 </context> 防结构逃逸；整篇超限直接拒绝（避免模型基于
 * 残缺全文作答），单条选区超限按行截断并标注；前端删除引用只回传 id，不接受任何路径入参；
 * 微博、大纲快照这类无文件来源的引用由 inlineText 携带正文，发送时不再读盘，uri 仅作去重键。
 */
import { randomUUID } from 'node:crypto'
import * as vscode from 'vscode'
import { logger } from '@modules/common/logger'
import type { AiContextRef } from '@shared/types/aiChat'

/** 单条引用注入上限（约 1.25 万 token），超出按行截断 */
export const MAX_CONTEXT_CHARS = 20_000
/** 单会话待发送引用条数上限 */
export const MAX_CONTEXT_COUNT = 10

/** 宿主侧引用：在展示字段之外持有绝对路径与行范围，仅宿主内部使用 */
export interface HostContextRef extends AiContextRef {
    /** 文档绝对路径，用于发送时读取最新内容；笔记本引用为目录路径；微博引用为原文永久链接（仅作去重键） */
    uri: string
    /** 内联正文：无文件来源的引用（微博、卷纲/章纲快照）直接携带文本，发送时不再读盘 */
    inlineText?: string
}

/** 引用生成结果：refs 为可用引用，rejected 为被拒绝的说明文案 */
export interface ContextRefResult {
    refs: HostContextRef[]
    rejected: string[]
}

/** 已读取内容的引用（发送时组装提示词用） */
export interface ResolvedContextRef {
    ref: HostContextRef
    text: string
    isTruncated: boolean
}

/**
 * 按整篇文档生成引用：富文本 tab 没有 TextEditor，但引用只需要 TextDocument。
 * 与 createContextRefs 的无选区分支同口径（超过单次上限时拒绝并给出可执行建议）。
 */
export function createDocumentContextRef(document: vscode.TextDocument): ContextRefResult {
    const displayPath = vscode.workspace.asRelativePath(document.uri, false)
    const charCount = document.getText().length
    if (charCount > MAX_CONTEXT_CHARS) {
        return {
            refs: [],
            rejected: [`${displayPath} 共约 ${charCount} 字，超过单次引用上限，富文本下请切回文本编辑器选中片段`],
        }
    }
    return { refs: [createFileRef(document, displayPath)], rejected: [] }
}

/**
 * 按选区文本生成引用：富文本没有行号，先用 quote 在文档里定位，再复用行范围口径。
 * 定位不到（原文已被改过）返回 null，由调用方降级为整篇引用，而不是给出一条错位的引用。
 */
export function createQuoteContextRef(document: vscode.TextDocument, quote: string): HostContextRef | null {
    const needle = quote.trim()
    if (needle === '') {
        return null
    }
    const index = document.getText().indexOf(needle)
    if (index < 0) {
        return null
    }
    const range = new vscode.Range(document.positionAt(index), document.positionAt(index + needle.length))
    return createSelectionRef(document, vscode.workspace.asRelativePath(document.uri, false), range)
}

/**
 * 按字符偏移生成引用：编辑器块快照给出的是 Markdown 原文区间，这里换算成 1-based 行范围。
 * 与按文本搜索相比不再受重复段落影响——同一句话在文中出现多次时，行号仍指向当前块；
 * 加粗、表格这类原文与块纯文本不逐字相同的块也能定位。偏移越界（快照已过期）返回 null。
 */
export function createOffsetContextRef(
    document: vscode.TextDocument,
    startOffset: number,
    endOffset: number,
): HostContextRef | null {
    const limit = document.getText().length
    if (startOffset < 0 || startOffset >= endOffset || endOffset > limit) {
        return null
    }
    const range = new vscode.Range(document.positionAt(startOffset), document.positionAt(endOffset))
    return createSelectionRef(document, vscode.workspace.asRelativePath(document.uri, false), range)
}

/** 依据编辑器选区生成引用：无选区取整篇，有选区逐个取覆盖的行范围 */
export function createContextRefs(editor: vscode.TextEditor): ContextRefResult {
    const { document } = editor
    const displayPath = vscode.workspace.asRelativePath(document.uri, false)
    const ranges = editor.selections.filter((selection) => !selection.isEmpty)
    if (ranges.length === 0) {
        const charCount = document.getText().length
        if (charCount > MAX_CONTEXT_CHARS) {
            return {
                refs: [],
                rejected: [`${displayPath} 共约 ${charCount} 字，超过单次引用上限，请选中需要引用的片段后再添加`],
            }
        }
        return { refs: [createFileRef(document, displayPath)], rejected: [] }
    }
    const refs = ranges.map((range) => createSelectionRef(document, displayPath, range))
    return { refs: dedupeByRange(refs), rejected: [] }
}

/** 发送时读取引用内容：内存态文档优先，返回 null 表示引用已失效（文件被删或不可读） */
export async function readContextContent(ref: HostContextRef): Promise<{ text: string; isTruncated: boolean } | null> {
    const raw = await readReferenceText(ref)
    if (raw === null) {
        logger.warn(`上下文引用已失效，将跳过：${ref.label}`)
        return null
    }
    return truncateContext(raw)
}

/**
 * 批量读取引用内容，失效项被丢弃（调用方据结果与入参差集提示用户）。
 * 笔记本引用的正文由打包服务提供，读不到同样按失效处理；未注入该回调时笔记本引用一律跳过。
 */
export async function resolveContextRefs(
    refs: HostContextRef[],
    readNotebook?: (ref: HostContextRef) => Promise<string | null>,
): Promise<ResolvedContextRef[]> {
    const results = await Promise.all(
        refs.map(async (ref): Promise<ResolvedContextRef | null> => {
            if (ref.kind === 'notebook') {
                const text = readNotebook === undefined ? null : await readNotebook(ref)
                return text === null || text.length === 0 ? null : { ref, text, isTruncated: ref.isTruncated }
            }
            const content = await readContextContent(ref)
            return content === null ? null : { ref, text: content.text, isTruncated: content.isTruncated }
        }),
    )
    return results.filter((item): item is ResolvedContextRef => item !== null)
}

/** 与已有引用合并去重：同文件同行范围视为同一引用 */
export function mergeContextRefs(
    existing: HostContextRef[],
    incoming: HostContextRef[],
): { added: HostContextRef[]; duplicated: number } {
    const keys = new Set(existing.map(contextKey))
    const added: HostContextRef[] = []
    let duplicated = 0
    for (const ref of incoming) {
        const key = contextKey(ref)
        if (keys.has(key)) {
            duplicated += 1
            continue
        }
        keys.add(key)
        added.push(ref)
    }
    return { added, duplicated }
}

/** 剥离绝对路径，得到可下发前端的展示字段 */
export function toPublicContextRef(ref: HostContextRef): AiContextRef {
    return {
        id: ref.id,
        kind: ref.kind,
        label: ref.label,
        displayPath: ref.displayPath,
        startLine: ref.startLine,
        endLine: ref.endLine,
        charCount: ref.charCount,
        isTruncated: ref.isTruncated,
        memberCount: ref.memberCount,
        packMode: ref.packMode,
    }
}

/** 从落库 JSON 还原宿主引用；DB 内容可能被手工修改，逐字段校验后再使用 */
export function parseStoredContexts(raw: string): HostContextRef[] {
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return []
    }
    if (!Array.isArray(parsed)) {
        return []
    }
    return parsed.filter(isHostContextRef)
}

/** 组装为模型可读的引用片段（标签内容为不可信文本，仅作参考） */
export function buildContextBlock(items: ResolvedContextRef[]): string {
    if (items.length === 0) {
        return ''
    }
    return `【引用上下文】\n${items.map(renderContextBlock).join('\n\n')}`
}

/** 历史消息的引用说明行：不再重复注入原文，仅告知引用了什么 */
export function describeContextRefs(refs: HostContextRef[]): string {
    return `【已引用上下文】${refs.map((ref) => ref.label).join('、')}`
}

function createFileRef(document: vscode.TextDocument, displayPath: string): HostContextRef {
    return {
        id: randomUUID(),
        kind: 'file',
        label: displayPath,
        displayPath,
        startLine: null,
        endLine: null,
        charCount: document.getText().length,
        isTruncated: false,
        uri: document.uri.fsPath,
    }
}

function createSelectionRef(document: vscode.TextDocument, displayPath: string, range: vscode.Range): HostContextRef {
    const startLine = range.start.line + 1
    const endLine = toEndLine(range)
    const text = readLineRange(document, startLine, endLine)
    return {
        id: randomUUID(),
        kind: 'selection',
        label: startLine === endLine ? `${displayPath}:${startLine}` : `${displayPath}:${startLine}-${endLine}`,
        displayPath,
        startLine,
        endLine,
        charCount: text.length,
        isTruncated: text.length > MAX_CONTEXT_CHARS,
        uri: document.uri.fsPath,
    }
}

/** 选区覆盖的末行：末光标停在行首且跨行时不计入该行 */
function toEndLine(range: vscode.Range): number {
    const isTrailingLineStart = range.end.character === 0 && range.end.line > range.start.line
    return isTrailingLineStart ? range.end.line : range.end.line + 1
}

/** 取文档中 [startLine, endLine] 行范围原文（1-based，含首尾，不含末尾换行） */
function readLineRange(document: vscode.TextDocument, startLine: number, endLine: number): string {
    const lines: string[] = []
    for (let line = startLine; line <= endLine && line <= document.lineCount; line += 1) {
        lines.push(document.lineAt(line - 1).text)
    }
    return lines.join('\n')
}

function readLineRangeFromText(text: string, startLine: number, endLine: number): string {
    return text
        .split(/\r?\n/)
        .slice(startLine - 1, endLine)
        .join('\n')
}

async function readReferenceText(ref: HostContextRef): Promise<string | null> {
    // 无文件来源的引用直接取内联正文：uri 是微博永久链接或大纲快照去重键，不能也不会按文件读盘
    if (ref.kind === 'weibo' || ref.kind === 'volumeOutline' || ref.kind === 'chapterOutline') {
        return ref.inlineText ?? null
    }
    const hasRange = ref.kind === 'selection' && ref.startLine !== null && ref.endLine !== null
    const opened = vscode.workspace.textDocuments.find((document) => document.uri.fsPath === ref.uri)
    if (opened) {
        return hasRange ? readLineRange(opened, ref.startLine ?? 1, ref.endLine ?? 1) : opened.getText()
    }
    try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(ref.uri))
        const text = new TextDecoder().decode(bytes)
        return hasRange ? readLineRangeFromText(text, ref.startLine ?? 1, ref.endLine ?? 1) : text
    } catch {
        return null
    }
}

/** 超长内容按行截断，避免切断多字节字符 */
function truncateContext(text: string): { text: string; isTruncated: boolean } {
    if (text.length <= MAX_CONTEXT_CHARS) {
        return { text, isTruncated: false }
    }
    const sliced = text.slice(0, MAX_CONTEXT_CHARS)
    const lastBreak = sliced.lastIndexOf('\n')
    const body = lastBreak > MAX_CONTEXT_CHARS / 2 ? sliced.slice(0, lastBreak) : sliced
    return { text: `${body}\n……（内容超长，已截断）`, isTruncated: true }
}

function renderContextBlock(item: ResolvedContextRef): string {
    const { ref } = item
    const lines = ref.startLine !== null && ref.endLine !== null ? ` lines="${ref.startLine}-${ref.endLine}"` : ''
    return `<context path="${escapeAttribute(ref.displayPath)}"${lines}>\n${escapeContent(item.text)}\n</context>`
}

/** 属性值转义：路径含引号或尖括号时不得逃逸出标签结构 */
function escapeAttribute(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/** 正文转义：防止文件内容伪造闭合标签 */
function escapeContent(text: string): string {
    return text.replaceAll('</context>', '<\\/context>')
}

function contextKey(ref: HostContextRef): string {
    return `${ref.uri}#${ref.startLine ?? 0}-${ref.endLine ?? 0}`
}

function dedupeByRange(refs: HostContextRef[]): HostContextRef[] {
    const seen = new Set<string>()
    return refs.filter((ref) => {
        const key = `${ref.startLine ?? 0}-${ref.endLine ?? 0}`
        if (seen.has(key)) {
            return false
        }
        seen.add(key)
        return true
    })
}

function isHostContextRef(value: unknown): value is HostContextRef {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const ref = value as Record<string, unknown>
    return (
        typeof ref.id === 'string' &&
        (ref.kind === 'file' ||
            ref.kind === 'selection' ||
            ref.kind === 'notebook' ||
            ref.kind === 'weibo' ||
            ref.kind === 'volumeOutline' ||
            ref.kind === 'chapterOutline') &&
        typeof ref.label === 'string' &&
        typeof ref.displayPath === 'string' &&
        (ref.startLine === null || typeof ref.startLine === 'number') &&
        (ref.endLine === null || typeof ref.endLine === 'number') &&
        typeof ref.charCount === 'number' &&
        typeof ref.isTruncated === 'boolean' &&
        typeof ref.uri === 'string'
    )
}
