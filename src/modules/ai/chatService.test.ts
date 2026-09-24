/**
 * chatService 单元测试：聚焦发送阶段的上下文注入与预算裁剪——待发送引用是否随消息注入、
 * 失效引用是否跳过、发送后是否清空、引用是否优先于历史保留。
 * 复用约定：openai SDK 的 streamChat 由 vi.mock 替换为记录型假流；DB 用临时目录真实库；密钥用 SecretStorage 桩。
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    createSecretStorage,
    createUri,
    resetWorkspaceState,
    setConfigValue,
    setFileContent,
} from '@/tests/stubs/vscode'
import { AiChatService } from './chatService'
import { listMessages } from './db/chatRepository'
import { openAiDatabase } from './db/connection'
import { ensureAiSchema } from './db/schema'
import type { ChatMessage, ChatStreamChunk, ChatStreamRequest } from './client'
import type { HostContextRef } from './contextRefs'
import type Database from 'better-sqlite3'
import { SecretsService } from '../common/secrets'

const FILE_PATH = 'd:/notes/ch01.md'
const API_KEY_STORAGE_KEY = 'zhai.deepseek.apiKey'

/** 记录每次流式请求的入参（vi.mock 提升到模块顶部，故用 vi.hoisted 持有） */
const captured = vi.hoisted(() => ({ requests: [] as ChatStreamRequest[] }))

vi.mock('./client', () => ({
    FIRST_TOKEN_TIMEOUT_MS: 30_000,
    streamChat: (request: ChatStreamRequest): AsyncGenerator<ChatStreamChunk> => {
        captured.requests.push(request)
        return (async function* generate(): AsyncGenerator<ChatStreamChunk> {
            // 先让出一次微任务，贴近真实流的异步节奏
            await Promise.resolve()
            yield { content: '回答', reasoning: '', usage: undefined }
        })()
    },
}))

let db: Database.Database
let service: AiChatService
let tempDir: string
let conversationId: string

function makeRef(overrides: Partial<HostContextRef> = {}): HostContextRef {
    return {
        id: `ref-${Math.random().toString(36).slice(2, 8)}`,
        kind: 'selection',
        label: 'ch01.md:2-3',
        displayPath: 'ch01.md',
        startLine: 2,
        endLine: 3,
        charCount: 0,
        isTruncated: false,
        uri: FILE_PATH,
        ...overrides,
    }
}

/** 发送并等待流式终态（generate 为 fire-and-forget，测试需同步到 done 再断言） */
async function sendAndWait(content: string): Promise<{ skippedContexts: string[] }> {
    let finish: (() => void) | undefined
    const finished = new Promise<void>((resolve) => {
        finish = resolve
        const subscription = service.onStream((message) => {
            if (message.done) {
                subscription.dispose()
                resolve()
            }
        })
    })
    const timer = setTimeout(() => finish?.(), 3000)
    const result = await service.send(`req-${Date.now()}`, conversationId, content)
    await finished
    clearTimeout(timer)
    return result
}

/** 取最近一次流式请求的消息数组 */
function latestMessages(): ChatMessage[] {
    const request = captured.requests[captured.requests.length - 1]
    return request?.messages ?? []
}

/** 取最近一次流式请求的末条（本轮用户输入所在）消息 */
function latestUserMessage(): string {
    const messages = latestMessages()
    return messages[messages.length - 1]?.content ?? ''
}

beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhai-chat-service-'))
    db = openAiDatabase(createUri(tempDir))
    ensureAiSchema(db)
    service = new AiChatService(db, new SecretsService(createSecretStorage({ [API_KEY_STORAGE_KEY]: 'sk-test' })))
    conversationId = service.getOrCreateSession().conversation.id
})

afterAll(() => {
    service.dispose()
    db.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
})

beforeEach(() => {
    resetWorkspaceState()
    captured.requests.length = 0
    service.clearContexts()
})

describe('发送阶段的上下文注入', () => {
    it('待发送引用随消息注入并携带行范围', async () => {
        setFileContent(FILE_PATH, '第一行\n第二行\n第三行')
        service.addContexts([makeRef()])
        await sendAndWait('请改写这段')

        const content = latestUserMessage()
        expect(content).toContain('【引用上下文】')
        expect(content).toContain('lines="2-3"')
        expect(content).toContain('第二行')
        expect(content).toContain('第三行')
        expect(content).toContain('请改写这段')
    })

    it('无引用时只发送用户输入', async () => {
        await sendAndWait('你好')
        expect(latestUserMessage()).toBe('你好')
    })

    it('引用失效时跳过并回传标签', async () => {
        service.addContexts([makeRef({ label: 'ch01.md:2-3' })])
        const result = await sendAndWait('这段还在吗')
        expect(result.skippedContexts).toContain('ch01.md:2-3')
        expect(latestUserMessage()).not.toContain('<context')
    })

    it('发送后清空待发送清单并写入消息 refs 列', async () => {
        setFileContent(FILE_PATH, '第一行\n第二行\n第三行')
        service.addContexts([makeRef()])
        await sendAndWait('请改写这段')

        expect(service.getContexts(conversationId)).toEqual([])
        const rows = listMessages(db, conversationId)
        const userRow = rows.filter((row) => row.role === 'user').at(-1)
        expect(userRow?.refs).toContain('ch01.md:2-3')
    })

    it('预算不足时保留引用、裁剪历史', async () => {
        setFileContent(FILE_PATH, '第一行\n第二行\n第三行')
        await sendAndWait('旧问题')

        setConfigValue('ai.maxContextTokens', 10)
        service.addContexts([makeRef()])
        await sendAndWait('新问题')

        const messages = latestMessages()
        const tail = latestUserMessage()
        expect(tail).toContain('<context')
        expect(tail).toContain('新问题')
        expect(messages.some((message) => message.content.includes('旧问题'))).toBe(false)
    })
})
