/**
 * 校对目标读取：以活跃编辑器为准取待检查正文，支持整篇（剔除 Frontmatter）与选区两种范围。
 * 复用 common/config 的存储根与 common/storagePath 的相对路径归一化、片段校验，前端不参与路径拼装。
 * 关键约束：只接受 file scheme 且位于存储根内的文档，越界路径直接拒绝；
 * 正文取自编辑器内存态（含未保存修改），offsetBase 记录正文在文档全文中的起点，
 * 前端据此把 issue 偏移换算为编辑器偏移，避免整篇与选区两种模式各写一套定位逻辑；
 * mtime 是缓存签名而非展示时间：已保存文档取磁盘时间，脏文档取正文摘要，保证同一正文每次都得到同一签名。
 */
import { createHash } from 'node:crypto'
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { buildStorageUri, toSafeSegments, toStorageRelativePath } from '@modules/common/storagePath'
import type { ProofreadTarget } from '@shared/types/proofread'

/** 读取目标的可选项 */
export interface ReadTargetOptions {
    /** 编辑器存在非空选区时只检查选区 */
    useSelection: boolean
    /** 正文字符上限：超出后截断，只检查前 maxChars 个字符 */
    maxChars: number
}

/** Frontmatter 起始行 */
const FRONTMATTER_FENCE = '---'

/**
 * 计算 Frontmatter 结束位置：返回正文在全文中的起始偏移。
 * 关键约束：首行必须恰好是 `---`，否则按无 Frontmatter 处理；未找到闭合行时同样视为无 Frontmatter，
 * 避免把正常正文开头的分隔线误判成元信息而整篇跳过。
 */
function readFrontmatterEnd(text: string): number {
    if (!text.startsWith(FRONTMATTER_FENCE)) {
        return 0
    }
    const firstLineEnd = text.indexOf('\n')
    if (firstLineEnd < 0) {
        return 0
    }
    const firstLine = text.slice(0, firstLineEnd).replace(/\r$/, '')
    if (firstLine !== FRONTMATTER_FENCE) {
        return 0
    }
    const closing = text.indexOf(`\n${FRONTMATTER_FENCE}`, firstLineEnd)
    if (closing < 0) {
        return 0
    }
    const closingLineEnd = text.indexOf('\n', closing + 1)
    return closingLineEnd < 0 ? text.length : closingLineEnd + 1
}

/** 取文档展示标题：文件名去扩展名 */
function readTitle(relativePath: string): string {
    const segments = relativePath.split('/')
    const fileName = segments[segments.length - 1] ?? ''
    const dotIndex = fileName.lastIndexOf('.')
    return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName
}

/** 读取相对存储根路径：非 file scheme 与越界路径一律拒绝 */
function readRelativePath(document: vscode.TextDocument): string {
    if (document.uri.scheme !== 'file') {
        throw new Error('当前编辑器不是本地文件，无法校对')
    }
    const relativePath = toStorageRelativePath(document.uri.path, '校对')
    const segments = toSafeSegments(relativePath, '校对')
    if (segments.length === 0) {
        throw new Error(`校对路径非法：${relativePath}`)
    }
    return relativePath
}

/** 正文摘要：只取截断后的检查正文，长度与成本都可控，内容不变则摘要稳定 */
function toContentSignature(text: string): string {
    return `digest:${createHash('sha1').update(text).digest('hex').slice(0, 16)}`
}

/**
 * 读取缓存签名：已保存文档取磁盘修改时间，脏文档取正文摘要。
 * 关键约束：脏文档不能取「当前时间」——每次读取都会得到新值，缓存签名永远对不上，结果等于从不保存。
 */
async function readSignature(document: vscode.TextDocument, text: string): Promise<string> {
    if (document.isDirty) {
        return toContentSignature(text)
    }
    try {
        const stat = await vscode.workspace.fs.stat(document.uri)
        return new Date(stat.mtime).toISOString()
    } catch {
        return toContentSignature(text)
    }
}

/** 读取当前校对目标 */
export async function readProofreadTarget(options: ReadTargetOptions): Promise<ProofreadTarget> {
    const editor = vscode.window.activeTextEditor
    if (editor === undefined) {
        throw new Error('请先在编辑器中打开要校对的文档')
    }
    const document = editor.document
    const relativePath = readRelativePath(document)
    const shouldUseSelection = options.useSelection && !editor.selection.isEmpty
    const fullText = document.getText()
    const offsetBase = shouldUseSelection ? document.offsetAt(editor.selection.start) : readFrontmatterEnd(fullText)
    const body = shouldUseSelection ? document.getText(editor.selection) : fullText.slice(offsetBase)
    const isTruncated = body.length > options.maxChars
    const text = isTruncated ? body.slice(0, options.maxChars) : body
    return {
        kind: shouldUseSelection ? 'selection' : 'document',
        path: relativePath,
        title: readTitle(relativePath),
        text,
        wordCount: text.replace(/\s/gu, '').length,
        offsetBase,
        version: document.version,
        mtime: await readSignature(document, text),
        truncated: isTruncated,
    }
}

/** 解析存储根内文档的绝对 Uri：写回与定位共用，路径先经片段校验 */
export function resolveProofreadUri(relativePath: string): vscode.Uri {
    const segments = toSafeSegments(relativePath, '校对')
    return buildStorageUri(resolveStorageRoot(), segments)
}
