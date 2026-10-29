/**
 * chatService 单元测试：聚焦发送阶段的上下文注入与预算裁剪——待发送引用是否随消息注入、
 * 失效引用是否跳过、发送后是否清空、引用是否优先于历史保留，本轮用量与耗时的落库与下发，
 * 思维链按 reasoning 通道分流、落库与终态回传，压缩事件的两态处理（瞬时 / 落库系统消息），
 * 以及新建会话的默认写入范围（仅当前文档）。
 * 复用约定：AI 通道由记录型假实现替身注入；DB 用临时目录真实库。
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createUri, resetWorkspaceState, setConfigValue, setFileContent } from './stubs/vscode'
import type { HostContextRef } from '../../src/modules/ai/contextRefs'
import type { AiChatMessage, AiProvider, AiStreamChunk, AiStreamRequest } from '../../src/modules/ai/provider'
import type { StreamMessage } from '../../src/shared/types/messages'
import type Database from 'better-sqlite3'
import { AiChatService } from '../../src/modules/ai/chatService'
import { listMessages, updateConversationSession } from '../../src/modules/ai/db/chatRepository'
import { openAiDatabase } from '../../src/modules/ai/db/connection'
import { ensureAiSchema } from '../../src/modules/ai/db/schema'
import { getPrompt, listAllUsageLogs } from '../../src/modules/ai/db/usageRepository'
import { UsageRecorder } from '../../src/modules/ai/usageRecorder'

const FILE_PATH = 'd:/notes/ch01.md'

/** 记录每次流式请求的入参 */
const captured = { requests: [] as AiStreamRequest[] }
/** 下一条流要产出的增量：由用例按需替换，留空时只产出一段正文 */
let nextChunks: AiStreamChunk[] = []

/** 记录型假通道：替代真实厂商通道，避免测试触网 */
const fakeProvider: AiProvider = {
    id: 'codebuddy',
    checkReady: () => Promise.resolve({ ready: true }),
    stream: (request: AiStreamRequest): AsyncGenerator<AiStreamChunk> => {
        captured.requests.push(request)
        const chunks = nextChunks.length > 0 ? nextChunks : [{ content: '回答', reasoning: '' }]
        return (async function* generate(): AsyncGenerator<AiStreamChunk> {
            // 先让出一次微任务，贴近真实流的异步节奏
            await Promise.resolve()
            for (const chunk of chunks) {
                yield chunk
            }
        })()
    },
}

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
async function sendAndWait(content: string): Promise<{ skippedContexts: string[]; done: StreamMessage | null }> {
    let done: StreamMessage | null = null
    let finish: (() => void) | undefined
    const finished = new Promise<void>((resolve) => {
        finish = resolve
        const subscription = service.onStream((message) => {
            if (message.done) {
                done = message
                subscription.dispose()
                resolve()
            }
        })
    })
    const timer = setTimeout(() => finish?.(), 3000)
    const result = await service.send(`req-${Date.now()}`, conversationId, content, false)
    await finished
    clearTimeout(timer)
    return { ...result, done }
}

/** 发送并收集本轮全部流式消息：思维链与正文按 channel 分流，断言需要逐条比对 */
async function sendAndCollect(content: string): Promise<{ messages: StreamMessage[]; done: StreamMessage | null }> {
    const messages: StreamMessage[] = []
    let done: StreamMessage | null = null
    let finish: (() => void) | undefined
    const finished = new Promise<void>((resolve) => {
        finish = resolve
        const subscription = service.onStream((message) => {
            messages.push(message)
            if (message.done) {
                done = message
                subscription.dispose()
                resolve()
            }
        })
    })
    const timer = setTimeout(() => finish?.(), 3000)
    await service.send(`req-collect-${Date.now()}`, conversationId, content, false)
    await finished
    clearTimeout(timer)
    return { messages, done }
}

/** 取最近一次流式请求的消息数组 */
function latestMessages(): AiChatMessage[] {
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
    service = new AiChatService(db, fakeProvider, new UsageRecorder(db))
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
    nextChunks = []
    // 续接用例会写会话号，逐例复位成首轮，避免后续用例被带入 resume 分支
    updateConversationSession(db, conversationId, 'codebuddy', null)
    service.clearContexts()
    // 用量与提示词按用例清空，避免前一条用例的记账干扰条数断言
    db.prepare('DELETE FROM ai_usage_logs').run()
    db.prepare('DELETE FROM ai_prompts').run()
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

    it('发送后写入一条对话用量与对应提示词', async () => {
        await sendAndWait('记账检查')

        const rows = listAllUsageLogs(db, 10)
        expect(rows).toHaveLength(1)
        expect(rows[0]?.status).toBe('completed')
        const logId = rows[0]?.id ?? ''
        expect(getPrompt(db, logId)?.content).toContain('记账检查')
    })

    it('助手消息落库本轮用量与耗时，并在流末下发同一份数字', async () => {
        const result = await sendAndWait('统计检查')

        const rows = listMessages(db, conversationId)
        const assistantRow = rows.filter((row) => row.role === 'assistant').at(-1)
        expect(assistantRow?.totalTokens).toBeGreaterThan(0)
        // 假通道不回传 usage，故走按回复字数估算的分支并打标；未注入 CLI 索引时积分留空
        expect(assistantRow?.tokensEstimated).toBe(1)
        expect(assistantRow?.credits).toBeNull()
        expect(result.done?.usage?.totalTokens).toBe(assistantRow?.totalTokens)
        expect(result.done?.durationMs).toBe(assistantRow?.durationMs)
        expect(result.done?.tokensEstimated).toBe(true)
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

describe('思维链下发', () => {
    it('思维链走 reasoning 通道，正文通道不混入思考内容', async () => {
        nextChunks = [
            { content: '', reasoning: '先看设定，' },
            { content: '', reasoning: '再写正文。' },
            { content: '正文第一句', reasoning: '' },
        ]
        const { messages, done } = await sendAndCollect('写一段')

        const reasoningDeltas = messages.filter((message) => message.channel === 'reasoning').map((item) => item.delta)
        const contentDeltas = messages.filter((message) => message.channel === 'content').map((item) => item.delta)
        expect(reasoningDeltas.join('')).toBe('先看设定，再写正文。')
        expect(contentDeltas.join('')).toBe('正文第一句')
        expect(done?.reasoning).toBe('先看设定，再写正文。')
        expect(done?.content).toBe('正文第一句')
    })

    it('思维链随助手消息落库，可按快照回显', async () => {
        nextChunks = [
            { content: '', reasoning: '内部推理' },
            { content: '答复', reasoning: '' },
        ]
        await sendAndWait('写一段')

        const assistantRow = listMessages(db, conversationId)
            .filter((row) => row.role === 'assistant')
            .at(-1)
        expect(assistantRow?.reasoning).toBe('内部推理')
    })

    it('无思维链时终态不带该字段，前端保留原值', async () => {
        nextChunks = [{ content: '只有正文', reasoning: '' }]
        const { messages, done } = await sendAndCollect('写一段')

        expect(messages.some((message) => message.channel === 'reasoning')).toBe(false)
        expect(done?.reasoning).toBeUndefined()
    })
})

describe('上下文压缩事件', () => {
    it('压缩完成落成系统消息并随流下发，且不进入下一轮模型上下文', async () => {
        nextChunks = [
            { content: '', reasoning: '', notice: 'compacting' },
            { content: '', reasoning: '', notice: 'compacted' },
            { content: '压缩后的回答', reasoning: '' },
        ]
        const { messages } = await sendAndCollect('压缩检查')

        // 瞬时态只置状态、不带消息；完成态才落库并携带轻量结构
        const compacting = messages.find((message) => message.notice === 'compacting')
        expect(compacting?.noticeMessage).toBeUndefined()

        const compacted = messages.find((message) => message.notice === 'compacted')
        expect(compacted?.noticeMessage?.kind).toBe('compacted')
        expect(compacted?.noticeMessage?.content).toBe('上下文已压缩')

        const rows = listMessages(db, conversationId)
        const systemRow = rows.find((row) => row.role === 'system')
        expect(systemRow?.content).toBe('上下文已压缩')
        expect(systemRow?.finishReason).toBe('compacted')

        // 下一轮组装提示词时系统消息必须被过滤，否则解释性文案会污染上下文
        nextChunks = []
        await sendAndWait('下一轮')
        expect(latestMessages().some((message) => message.content.includes('上下文已压缩'))).toBe(false)
    })
})

describe('执行步骤', () => {
    it('步骤事件随流下发，流末按 id 合并落库', async () => {
        nextChunks = [
            {
                content: '',
                reasoning: '',
                step: {
                    id: 'tu-1',
                    kind: 'tool',
                    name: 'Read',
                    detail: 'c1.md',
                    status: 'pending',
                    error: null,
                    parentId: null,
                    elapsedMs: null,
                },
            },
            {
                content: '',
                reasoning: '',
                step: {
                    id: 'tu-1',
                    kind: 'tool',
                    name: 'Read',
                    detail: 'c1.md',
                    status: 'done',
                    error: null,
                    parentId: null,
                    elapsedMs: 800,
                },
            },
            { content: '读到三行', reasoning: '' },
        ]
        const { messages } = await sendAndCollect('读一下')

        const emitted = messages.flatMap((message) => (message.step === undefined ? [] : [message.step]))
        expect(emitted.map((step) => step.status)).toEqual(['pending', 'done'])

        const assistantRow = listMessages(db, conversationId)
            .filter((row) => row.role === 'assistant')
            .at(-1)
        const stored = JSON.parse(assistantRow?.steps ?? '[]') as Array<{ id: string; status: string }>
        // 同一 id 只留一条，以最后一次快照为准
        expect(stored).toHaveLength(1)
        expect(stored[0]?.status).toBe('done')
    })
})

describe('本轮用量的采纳口径', () => {
    it('通道回传单轮用量时直接采用，不再按字数估算', async () => {
        nextChunks = [
            {
                content: '回答',
                reasoning: '',
                usage: { promptTokens: 12, completionTokens: 8, reasoningTokens: 0, totalTokens: 20 },
                isRoundUsage: true,
            },
        ]
        const result = await sendAndWait('单轮用量')

        const assistantRow = listMessages(db, conversationId)
            .filter((row) => row.role === 'assistant')
            .at(-1)
        expect(assistantRow?.totalTokens).toBe(20)
        expect(assistantRow?.tokensEstimated).toBe(0)
        expect(result.done?.usage?.totalTokens).toBe(20)
        expect(result.done?.tokensEstimated).toBe(false)
    })

    it('续接会话时通道回传的累计用量不被当成本轮值', async () => {
        updateConversationSession(db, conversationId, 'codebuddy', 'sdk-session-1')
        nextChunks = [
            {
                // 续接会话的 result.usage 是整段累计：通道以 isRoundUsage=false 标明，上层必须拒收
                content: '回答',
                reasoning: '',
                usage: { promptTokens: 900, completionTokens: 100, reasoningTokens: 0, totalTokens: 1000 },
                isRoundUsage: false,
            },
        ]
        await sendAndWait('续接检查')

        const assistantRow = listMessages(db, conversationId)
            .filter((row) => row.role === 'assistant')
            .at(-1)
        expect(assistantRow?.totalTokens).toBeLessThan(100)
        expect(assistantRow?.tokensEstimated).toBe(1)
    })
})

describe('会话的默认写入范围', () => {
    it('新建会话默认只授权当前文档', () => {
        // 用独立作用域建新会话，避免命中 beforeAll 里那份已有会话
        const snapshot = service.getOrCreateSession('press/默认范围')
        expect(snapshot.conversation.writeGrant).toBe('document')
    })
})
