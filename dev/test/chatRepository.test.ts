/**
 * chatRepository 单元测试：以临时目录上的真实 SQLite 库验证会话与消息的读写、refs 与 steps 列往返、
 * 会话按作用域隔离、级联删除与用量统计（与生产同基座 openAiDatabase，含 foreign_keys 开启）。
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createUri } from './stubs/vscode'
import type { ConversationRow, MessageRow } from '../../src/modules/ai/db/chatRepository'
import {
    deleteConversation,
    getConversation,
    getLatestConversation,
    insertConversation,
    insertMessage,
    listConversations,
    listMessages,
    sumTokensSince,
    updateConversationContextUsage,
    updateMessage,
} from '../../src/modules/ai/db/chatRepository'
import { openAiDatabase } from '../../src/modules/ai/db/connection'
import { ensureAiSchema } from '../../src/modules/ai/db/schema'
import {
    getPrompt,
    insertUsageLog,
    listAllUsageLogs,
    prunePrompts,
    upsertPrompt,
} from '../../src/modules/ai/db/usageRepository'

let db: Database.Database
let tempDir: string

function makeConversation(overrides: Partial<ConversationRow> = {}): ConversationRow {
    return {
        id: 'conv-1',
        title: '测试会话',
        mode: 'chat',
        projectDir: null,
        model: 'codebuddy-default',
        provider: 'codebuddy',
        sdkSessionId: null,
        contextUsedTokens: 0,
        contextWindowTokens: 0,
        writeGrant: 'project',
        createdAt: '2026-09-25T10:00:00.000Z',
        updatedAt: '2026-09-25T10:00:00.000Z',
        ...overrides,
    }
}

function makeMessage(overrides: Partial<MessageRow> = {}): MessageRow {
    return {
        id: 'msg-1',
        conversationId: 'conv-1',
        role: 'user',
        content: '正文',
        reasoning: null,
        steps: '[]',
        status: 'completed',
        finishReason: null,
        refs: '[]',
        error: null,
        totalTokens: 0,
        durationMs: 0,
        tokensEstimated: 0,
        credits: null,
        requestId: null,
        createdAt: '2026-09-25T10:00:00.000Z',
        ...overrides,
    }
}

/** 读取表的实际列名：迁移用例据此断言旧列已删除、补列仍在 */
function readColumns(database: Database.Database, table: string): string[] {
    const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    return rows.map((item) => item.name)
}

beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhai-ai-db-'))
    db = openAiDatabase(createUri(tempDir))
    ensureAiSchema(db)
})

afterAll(() => {
    db.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('conversations', () => {
    it('写入后可读回全部字段', () => {
        insertConversation(db, makeConversation({ id: 'conv-read', projectDir: 'press/read' }))
        const row = getConversation(db, 'conv-read')
        expect(row?.title).toBe('测试会话')
        expect(row?.projectDir).toBe('press/read')
        expect(row?.mode).toBe('chat')
    })

    it('上下文占用写入后可读回，且不刷新更新时间', () => {
        insertConversation(db, makeConversation({ id: 'conv-context', updatedAt: '2026-09-01T00:00:00.000Z' }))
        updateConversationContextUsage(db, 'conv-context', 71_000, 300_000)
        const row = getConversation(db, 'conv-context')
        expect(row?.contextUsedTokens).toBe(71_000)
        expect(row?.contextWindowTokens).toBe(300_000)
        expect(row?.updatedAt).toBe('2026-09-01T00:00:00.000Z')
    })

    it('上下文占用写入时负数归零，避免脏值进入占比计算', () => {
        insertConversation(db, makeConversation({ id: 'conv-context-negative' }))
        updateConversationContextUsage(db, 'conv-context-negative', -5, Number.NaN)
        const row = getConversation(db, 'conv-context-negative')
        expect(row?.contextUsedTokens).toBe(0)
        expect(row?.contextWindowTokens).toBe(0)
    })

    it('列表按最后活跃时间倒序', () => {
        insertConversation(db, makeConversation({ id: 'conv-old', updatedAt: '2026-09-01T00:00:00.000Z' }))
        insertConversation(db, makeConversation({ id: 'conv-new', updatedAt: '2026-09-20T00:00:00.000Z' }))
        const rows = listConversations(db, 50, null)
        const indexOfNew = rows.findIndex((row) => row.id === 'conv-new')
        const indexOfOld = rows.findIndex((row) => row.id === 'conv-old')
        expect(indexOfNew).toBeGreaterThanOrEqual(0)
        expect(indexOfNew).toBeLessThan(indexOfOld)
    })

    it('列表条数受 limit 限制', () => {
        const rows = listConversations(db, 1, null)
        expect(rows).toHaveLength(1)
    })

    it('历史列表只含同作用域的会话', () => {
        insertConversation(
            db,
            makeConversation({ id: 'conv-scope-a', projectDir: 'press/A', updatedAt: '2026-09-22T00:00:00.000Z' }),
        )
        insertConversation(
            db,
            makeConversation({ id: 'conv-scope-b', projectDir: 'press/B', updatedAt: '2026-09-23T00:00:00.000Z' }),
        )
        const scopedIds = listConversations(db, 50, 'press/A').map((row) => row.id)
        expect(scopedIds).toContain('conv-scope-a')
        expect(scopedIds).not.toContain('conv-scope-b')
        expect(scopedIds).not.toContain('conv-new')
        const generalIds = listConversations(db, 50, null).map((row) => row.id)
        expect(generalIds).toContain('conv-new')
        expect(generalIds).not.toContain('conv-scope-a')
    })

    it('取最近会话按作用域过滤', () => {
        insertConversation(
            db,
            makeConversation({
                id: 'conv-scope-old',
                projectDir: 'press/latest',
                updatedAt: '2026-09-10T00:00:00.000Z',
            }),
        )
        insertConversation(
            db,
            makeConversation({
                id: 'conv-scope-new',
                projectDir: 'press/latest',
                updatedAt: '2026-09-11T00:00:00.000Z',
            }),
        )
        expect(getLatestConversation(db, 'press/latest')?.id).toBe('conv-scope-new')
        expect(getLatestConversation(db, 'press/empty')).toBeUndefined()
    })

    it('旧库补齐 provider 与 sdk_session_id 列', () => {
        const legacy = new Database(':memory:')
        legacy.exec(`CREATE TABLE conversations (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, mode TEXT NOT NULL, file_path TEXT,
            model TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        )`)
        legacy
            .prepare(
                `INSERT INTO conversations (id, title, mode, file_path, model, created_at, updated_at)
                 VALUES ('conv-legacy', '旧会话', 'chat', NULL, 'codebuddy-default', '2026-09-01T00:00:00.000Z',
                    '2026-09-01T00:00:00.000Z')`,
            )
            .run()
        ensureAiSchema(legacy)
        const row = legacy
            .prepare('SELECT provider, sdk_session_id AS sdkSessionId FROM conversations WHERE id = ?')
            .get('conv-legacy') as { provider: string; sdkSessionId: string | null }
        expect(row).toEqual({ provider: 'codebuddy', sdkSessionId: null })
        legacy.close()
    })

    it('旧库清理已废弃的 file_path / project / estimated_cost 列', () => {
        const legacy = new Database(':memory:')
        legacy.exec(`CREATE TABLE conversations (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, mode TEXT NOT NULL, file_path TEXT,
            model TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        )`)
        legacy.exec('CREATE INDEX idx_conv_file ON conversations(file_path)')
        legacy.exec(`CREATE TABLE ai_usage_logs (
            id TEXT PRIMARY KEY, conversation_id TEXT, project TEXT NOT NULL, model TEXT NOT NULL,
            prompt_tokens INTEGER NOT NULL DEFAULT 0, completion_tokens INTEGER NOT NULL DEFAULT 0,
            reasoning_tokens INTEGER NOT NULL DEFAULT 0, total_tokens INTEGER NOT NULL DEFAULT 0,
            estimated_cost REAL NOT NULL DEFAULT 0, latency_ms INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        )`)
        ensureAiSchema(legacy)
        expect(readColumns(legacy, 'conversations')).not.toContain('file_path')
        expect(readColumns(legacy, 'ai_usage_logs')).not.toContain('project')
        expect(readColumns(legacy, 'ai_usage_logs')).not.toContain('estimated_cost')
        // 只删遗留列，补列与重建索引不受影响
        expect(readColumns(legacy, 'ai_usage_logs')).toContain('credits')
        const indexes = (legacy.prepare("PRAGMA index_list('conversations')").all() as Array<{ name: string }>).map(
            (item) => item.name,
        )
        expect(indexes).not.toContain('idx_conv_file')
        expect(indexes).toContain('idx_conv_project')
        legacy.close()
    })
})

describe('messages', () => {
    it('refs 列完整往返', () => {
        const refs = JSON.stringify([{ id: 'r1', label: 'notes/a.md:11-19', uri: 'd:/notes/a.md' }])
        insertMessage(db, makeMessage({ id: 'msg-refs', conversationId: 'conv-read', refs }))
        const rows = listMessages(db, 'conv-read')
        const target = rows.find((row) => row.id === 'msg-refs')
        expect(target?.refs).toBe(refs)
    })

    it('steps 列按 JSON 文本往返，更新时整体覆盖', () => {
        insertConversation(db, makeConversation({ id: 'conv-steps' }))
        const steps = JSON.stringify([
            {
                id: 'tu-1',
                kind: 'tool',
                name: 'Read',
                detail: 'c1.md',
                status: 'running',
                error: null,
                parentId: null,
                elapsedMs: 800,
            },
        ])
        insertMessage(db, makeMessage({ id: 'msg-steps', conversationId: 'conv-steps', steps }))
        expect(listMessages(db, 'conv-steps').find((row) => row.id === 'msg-steps')?.steps).toBe(steps)

        updateMessage(db, 'msg-steps', {
            content: '正文',
            reasoning: null,
            steps: '[]',
            status: 'completed',
            finishReason: 'stop',
            error: null,
            totalTokens: 1,
            durationMs: 1,
            tokensEstimated: 0,
            credits: null,
            requestId: null,
        })
        expect(listMessages(db, 'conv-steps').find((row) => row.id === 'msg-steps')?.steps).toBe('[]')
    })

    it('按创建时间升序返回', () => {
        insertConversation(db, makeConversation({ id: 'conv-order' }))
        insertMessage(
            db,
            makeMessage({ id: 'msg-b', conversationId: 'conv-order', createdAt: '2026-09-25T10:02:00.000Z' }),
        )
        insertMessage(
            db,
            makeMessage({ id: 'msg-a', conversationId: 'conv-order', createdAt: '2026-09-25T10:01:00.000Z' }),
        )
        const ids = listMessages(db, 'conv-order').map((row) => row.id)
        expect(ids).toEqual(['msg-a', 'msg-b'])
    })

    it('删除会话时其消息被级联清理', () => {
        const rowsBefore = listMessages(db, 'conv-order')
        expect(rowsBefore.length).toBeGreaterThan(0)
        deleteConversation(db, 'conv-order')
        expect(getConversation(db, 'conv-order')).toBeUndefined()
        expect(listMessages(db, 'conv-order')).toEqual([])
    })
})

describe('usage logs', () => {
    it('按起始时间累计 token', () => {
        insertUsageLog(db, {
            id: 'u1',
            conversationId: 'conv-read',
            module: 'chat',
            model: 'deepseek-chat',
            requestId: 'req-u1',
            sdkMessageId: null,
            promptTokens: 10,
            promptChars: 16,
            completionTokens: 20,
            reasoningTokens: 0,
            totalTokens: 30,
            credits: 0.02,
            costUsd: 0.001,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            latencyMs: 100,
            status: 'completed',
            createdAt: '2026-09-25T00:00:00.000Z',
        })
        insertUsageLog(db, {
            id: 'u2',
            conversationId: null,
            module: 'naming',
            model: 'deepseek-chat',
            requestId: 'req-u2',
            sdkMessageId: null,
            promptTokens: 5,
            promptChars: 8,
            completionTokens: 5,
            reasoningTokens: 0,
            totalTokens: 10,
            credits: null,
            costUsd: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            latencyMs: 50,
            status: 'completed',
            createdAt: '2026-09-26T00:00:00.000Z',
        })
        expect(sumTokensSince(db, '2026-09-25T00:00:00.000Z')).toBe(40)
        expect(sumTokensSince(db, '2026-09-26T00:00:00.000Z')).toBe(10)
        // 明细读取按时间倒序，模块字段随行落库
        expect(listAllUsageLogs(db, 10).map((row) => row.id)).toEqual(['u2', 'u1'])
    })

    it('提示词按请求 id 往返并能按时间清理', () => {
        upsertPrompt(db, {
            requestId: 'req-u1',
            content: '【user】你好',
            isTruncated: false,
            createdAt: '2026-09-25T00:00:00.000Z',
        })
        expect(getPrompt(db, 'req-u1')?.content).toBe('【user】你好')
        expect(getPrompt(db, 'req-missing')).toBeUndefined()
        expect(prunePrompts(db, '2026-09-26T00:00:00.000Z')).toBe(1)
        expect(getPrompt(db, 'req-u1')).toBeUndefined()
    })
})
