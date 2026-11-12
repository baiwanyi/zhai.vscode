/**
 * 插入目标解析：把当前活动编辑器折算成「可插入 + 文档归属」，页面提示与插入流程共用。
 * 复用约定：编辑器回落顺序与媒体库的插入口径一致（活动编辑器 → 最近可见的 file + markdown 编辑器），
 * 归属判定看存储根一级目录，与工作流的 ContentScope 同源。
 * 关键约束：图片统一落 unsplash/，归属只写进索引元数据、不参与路径生成，因此公众号批次定位失败不再是阻断项；
 * 非 file scheme（untitled 等）与未保存文档一律拒绝，避免写进一个没有落盘位置的缓冲区。
 */
import * as path from 'node:path'
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { getActiveDocument } from '@modules/editor/activeDocument'
import type { MediaScope } from '@shared/types/media'
import { formatMonthDir } from './stockNaming'

/** 插入目标：编辑器与展示信息 */
export interface StockInsertTarget {
    /** 文本编辑器目标：富文本 tab 下为 undefined，写正文改走富文本插入注册点 */
    editor: vscode.TextEditor | undefined
    /** 目标文档 uri：两种目标都有，富文本写回据此定位 */
    uri: vscode.Uri
    /** 文档的存储根相对路径：存储根外的文档为 null（仍允许插入，只是归属记 general） */
    documentRelative: string | null
    /** 文档归属：只用于索引元数据与页头提示 */
    scope: MediaScope
    /** 展示用文档标签：首个一级标题，缺省取文件名 */
    label: string
    /** 展示用目标目录：unsplash/202611 */
    dirPath: string
}

/** 目标解析结果：失败原因是插入回执里要透传的四态 */
export type StockTargetOutcome =
    { ok: true; target: StockInsertTarget } | { ok: false; reason: 'no-editor' | 'unsaved' | 'not-markdown' }

/** 存储根外的文档：前缀判断一律按正斜杠相对路径 */
function toStorageRelative(fsPath: string): string | null {
    const rootPath = resolveStorageRoot().fsPath
    const relative = path.relative(path.resolve(rootPath), path.resolve(fsPath))
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return null
    }
    return relative.split(path.sep).join('/')
}

/** 归属判定：笔记 / 公众号 / 作品看一级目录，其余按通用处理 */
function readScope(documentRelative: string | null): MediaScope {
    if (documentRelative === null) {
        return 'general'
    }
    if (documentRelative.startsWith('notes/')) {
        return 'note'
    }
    if (documentRelative.startsWith('wechat/')) {
        return 'wechat'
    }
    if (documentRelative.startsWith('press/')) {
        return 'press'
    }
    return 'general'
}

/** 文档标签：首个一级标题优先，缺省去扩展名的文件名 */
function readDocumentLabel(document: vscode.TextDocument): string {
    const heading = /^#\s+(.+)$/mu.exec(document.getText())
    if (heading !== null) {
        const title = heading[1]?.trim() ?? ''
        if (title.length > 0) {
            return title
        }
    }
    return path.basename(document.fileName).replace(/\.md$/iu, '')
}

/** 取插入用的编辑器：活动编辑器优先，其次最近可见的 Markdown 文件编辑器 */
export function resolveInsertEditor(): vscode.TextEditor | undefined {
    const active = vscode.window.activeTextEditor
    if (active !== undefined) {
        return active
    }
    return [...vscode.window.visibleTextEditors]
        .reverse()
        .find((item) => item.document.languageId === 'markdown' && item.document.uri.scheme === 'file')
}

/**
 * 解析当前插入目标。
 * 关键约束：只读不写——解析过程不得移动光标或切换编辑器，失败时由调用方给出提示。
 */
export function resolveStockTarget(at: Date = new Date()): StockTargetOutcome {
    // 富文本 tab 优先：它没有 TextEditor，但活跃文档就是插入目标。
    // 必须先判，否则 resolveInsertEditor 会回落到「最近可见的文本编辑器」，把图插进别的文件。
    const active = getActiveDocument()
    if (active !== null && active.kind === 'rich') {
        if (active.uri.scheme !== 'file') {
            return { ok: false, reason: 'unsaved' }
        }
        if (!active.uri.fsPath.toLowerCase().endsWith('.md')) {
            return { ok: false, reason: 'not-markdown' }
        }
        const richRelative = toStorageRelative(active.uri.fsPath)
        return {
            ok: true,
            target: {
                editor: undefined,
                uri: active.uri,
                documentRelative: richRelative,
                scope: readScope(richRelative),
                // 富文本下不便同步读一级标题，用文件名：标签仅用于页头提示与索引元数据
                label: path.basename(active.uri.fsPath).replace(/\.md$/iu, ''),
                dirPath: `unsplash/${formatMonthDir(at)}`,
            },
        }
    }
    const editor = resolveInsertEditor()
    if (editor === undefined) {
        return { ok: false, reason: 'no-editor' }
    }
    const document = editor.document
    if (document.uri.scheme !== 'file') {
        return { ok: false, reason: 'unsaved' }
    }
    if (document.languageId !== 'markdown') {
        return { ok: false, reason: 'not-markdown' }
    }
    const documentRelative = toStorageRelative(document.uri.fsPath)
    return {
        ok: true,
        target: {
            editor,
            uri: document.uri,
            documentRelative,
            scope: readScope(documentRelative),
            label: readDocumentLabel(document),
            dirPath: `unsplash/${formatMonthDir(at)}`,
        },
    }
}
