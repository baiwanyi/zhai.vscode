/**
 * 标注路由：工作流「标注」总览页的列表、统计、跳转与删除。
 * 复用约定：查询走 annotationSearch，写入走 annotationRepository，路径构造与校验复用 common/storagePath；
 * 跳转沿用校对定位的范式（打开文档 + 选中区间），不新写一套定位逻辑。
 * 关键约束：payload 来自 Webview，逐字段收窄后才进查询，非法值一律按「不限」处理而不是抛错；
 * 跳转前必须校验文件存在——文档已删除给 missing-file，定位失效给 orphaned，都不打开空白编辑器。
 */
import * as vscode from 'vscode'
import { buildStorageUri, isPathExisting, toSafeSegments } from '@modules/common/storagePath'
import type {
    AnnotationCursor,
    AnnotationListQuery,
    AnnotationListResult,
    AnnotationStats,
    EditorQueryListResult,
    HighlightColor,
} from '@shared/types/editor'
import { findAnnotation, removeAnnotation, updateAnnotation } from './annotationRepository'
import { listAnnotationDocuments, listAnnotations, statsAnnotations } from './annotationSearch'
import { countQueries, listQueries, removeQueryById } from './queryRepository'
import type { AnnotationDatabase } from './db/connection'

/** 允许的类型与颜色：与库内枚举一致，其余取值按「不限」处理 */
const KINDS: readonly string[] = ['highlight', 'note']
const COLORS: readonly HighlightColor[] = ['coral', 'violet', 'blue', 'emerald', 'amber']

/** 默认分页条数：与查询层的默认值保持一致 */
const DEFAULT_LIMIT = 50

/** AI 解释列表的默认条数：与标注列表同档，首批不做翻页 */
const QUERY_LIST_LIMIT = 50

/** 关键词上限：搜索框输入不该带着整段正文进查询 */
const MAX_KEYWORD_CHARS = 100

export interface AnnotationRoutesDeps {
    /** 标注库连接：按存储根懒打开，调用时才求值 */
    db: () => AnnotationDatabase
    /** 存储根：跳转时把相对路径还原成绝对路径 */
    root: () => vscode.Uri
    /** 文档已在富文本 tab 打开时直接定位；没有实例返回 false，由本类回落文本编辑器 */
    revealInRich?: (uri: vscode.Uri, request: { quote: string; blockIndex: number }) => boolean
}

/** 收窄游标：两端都缺失时视为首页 */
function readCursor(input: unknown): AnnotationCursor | null {
    if (typeof input !== 'object' || input === null) {
        return null
    }
    const value = input as { createdAt?: unknown; id?: unknown }
    if (typeof value.createdAt !== 'string' || typeof value.id !== 'string') {
        return null
    }
    return { createdAt: value.createdAt, id: value.id }
}

/** 收窄列表条件：任何字段非法都退化为「不限」，不让一次脏输入把页面打空 */
function readListQuery(payload: unknown): AnnotationListQuery {
    const source = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
    const kind =
        typeof source.kind === 'string' && KINDS.includes(source.kind) ? (source.kind as 'highlight' | 'note') : null
    const color =
        typeof source.color === 'string' && (COLORS as readonly string[]).includes(source.color)
            ? (source.color as HighlightColor)
            : null
    return {
        cursor: readCursor(source.cursor),
        limit: typeof source.limit === 'number' ? source.limit : DEFAULT_LIMIT,
        kind,
        color,
        docPath: typeof source.docPath === 'string' ? source.docPath : null,
        orphanedOnly: source.orphanedOnly === true,
        keyword: typeof source.keyword === 'string' ? source.keyword : '',
    }
}

/** 收窄 AI 解释列表条件：关键词截断，limit 由仓储夹到上限 */
function readQueryListOptions(payload: unknown): { keyword: string; limit: number } {
    const source = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
    return {
        keyword: typeof source.keyword === 'string' ? source.keyword.slice(0, MAX_KEYWORD_CHARS) : '',
        limit: typeof source.limit === 'number' ? source.limit : QUERY_LIST_LIMIT,
    }
}

/** 收窄 id：缺失直接抛错，由上层转成 error 回执 */
function readId(payload: unknown): string {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('标注参数非法：缺少 id')
    }
    const value = (payload as { id?: unknown }).id
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error('标注参数非法：缺少 id')
    }
    return value
}

export class AnnotationRoutes {
    public constructor(private readonly deps: AnnotationRoutesDeps) {}

    /** 分发标注方法：未知方法直接抛错，由面板转成 error 回执 */
    public async handle(method: string, payload: unknown): Promise<unknown> {
        switch (method) {
            case 'annotation/list':
                return this.list(payload)
            case 'annotation/stats':
                return this.stats(payload)
            case 'annotation/reveal':
                return this.reveal(payload)
            case 'annotation/remove':
                return this.remove(payload)
            case 'annotation/documents':
                return { items: listAnnotationDocuments(this.deps.db().db) }
            case 'annotation/update':
                return this.update(payload)
            case 'annotation/queries':
                return this.listQueries(payload)
            case 'annotation/query/remove':
                return { removed: removeQueryById(this.deps.db().db, readId(payload)) }
            default:
                throw new Error(`未知的标注方法：${method}`)
        }
    }

    private list(payload: unknown): AnnotationListResult {
        return listAnnotations(this.deps.db().db, readListQuery(payload))
    }

    private stats(payload: unknown): AnnotationStats {
        const source = typeof payload === 'object' && payload !== null ? (payload as { docPath?: unknown }) : {}
        const docPath = typeof source.docPath === 'string' ? source.docPath : null
        return statsAnnotations(this.deps.db().db, docPath)
    }

    /** 跳转到原文：打开文本编辑器并选中区间，文档缺失与定位失效分开回报 */
    private async reveal(payload: unknown): Promise<{ revealed: boolean; reason?: string; orphaned?: boolean }> {
        const record = findAnnotation(this.deps.db().db, readId(payload))
        if (record === null) {
            return { revealed: false, reason: 'missing' }
        }
        const uri = buildStorageUri(this.deps.root(), toSafeSegments(record.docPath, '标注'))
        if (!(await isPathExisting(uri))) {
            return { revealed: false, reason: 'missing-file' }
        }
        // 已在富文本打开时直接定位：既不打断用户的编辑态，也不会多出一个文本 tab
        const isRevealedInRich =
            this.deps.revealInRich?.(uri, { quote: record.quote, blockIndex: record.blockIndex }) ?? false
        if (isRevealedInRich) {
            return { revealed: true, orphaned: record.orphaned }
        }
        const document = await vscode.workspace.openTextDocument(uri)
        const length = document.getText().length
        const start = Math.min(Math.max(record.startOffset, 0), length)
        const end = Math.min(Math.max(record.endOffset, start), length)
        await vscode.window.showTextDocument(document, {
            selection: new vscode.Range(document.positionAt(start), document.positionAt(end)),
            preserveFocus: false,
        })
        return { revealed: true, orphaned: record.orphaned }
    }

    private remove(payload: unknown): { removed: boolean } {
        return { removed: removeAnnotation(this.deps.db().db, readId(payload)) }
    }

    /** 改色：只接受枚举色值，其余按未提供处理（清除颜色） */
    private update(payload: unknown): { updated: boolean } {
        const source = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
        const color =
            typeof source.color === 'string' && (COLORS as readonly string[]).includes(source.color)
                ? (source.color as HighlightColor)
                : null
        return { updated: updateAnnotation(this.deps.db().db, readId(payload), { color }) }
    }

    /** AI 解释列表：只按文本聚合，关键词同时匹配原文、问题与答案 */
    private listQueries(payload: unknown): EditorQueryListResult {
        const options = readQueryListOptions(payload)
        const db = this.deps.db().db
        return { items: listQueries(db, options), total: countQueries(db, options.keyword) }
    }
}
