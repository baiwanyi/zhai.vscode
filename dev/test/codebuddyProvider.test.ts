/**
 * CodeBuddy 通道链路测试：注入假 client 驱动流事件解析、单轮用量标记与出图产物解析。
 * 复用约定：client 替身只产出预设消息，不触网、不起子进程；密钥由测试桩提供，配置读默认值。
 * 关键约束：断言聚焦「通道对 SDK 消息的解读口径」，不断言提示词措辞；真实 CLI 行为仍由宿主内手工验证。
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSecretStorage } from './stubs/vscode'
import type { AiStreamChunk, AiStreamRequest } from '../../src/modules/ai/provider'
import type { CodebuddyClient, CodebuddySession } from '../../src/modules/ai/providers/codebuddyClient'
import type { ContentBlock, Message, RawMessageStreamEvent, SessionOptions } from '@tencent-ai/agent-sdk'
import { CodeBuddyProvider } from '../../src/modules/ai/providers/codebuddy'
import { SecretsService } from '../../src/modules/common/secrets'
import { CodeBuddyImageProvider } from '../../src/modules/imagegen/ai/codebuddyImageProvider'

/** 最小 PNG 头：通道只按魔数判格式，不需要完整图片 */
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01])

let tempDir: string

/** 系统初始化消息：通道据此回写会话号 */
function initMessage(sessionId: string): Message {
    return {
        type: 'system',
        subtype: 'init',
        uuid: 'sys-1',
        session_id: sessionId,
        tools: [],
        model: 'deepseek-chat',
        permissionMode: 'default',
    }
}

/** 流事件包装 */
function streamEvent(event: RawMessageStreamEvent): Message {
    return { type: 'stream_event', event, parent_tool_use_id: null, uuid: 'partial-1', session_id: 's1' }
}

/** 带用量的流开头：input 100、缓存读 20 */
function messageStart(): Message {
    return streamEvent({
        type: 'message_start',
        message: {
            id: 'm1',
            type: 'message',
            role: 'assistant',
            model: 'deepseek-chat',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 20 },
        },
    })
}

/** 流结束时的输出用量 */
function messageDelta(): Message {
    return streamEvent({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { input_tokens: 100, output_tokens: 40 },
    })
}

/** 正文与思维链增量 */
function textDelta(text: string): Message {
    return streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
}

function thinkingDelta(thinking: string): Message {
    return streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking } })
}

/** 成功结果 */
function successResult(): Message {
    return {
        type: 'result',
        subtype: 'success',
        uuid: 'r1',
        session_id: 's1',
        duration_ms: 100,
        duration_api_ms: 80,
        is_error: false,
        num_turns: 1,
        result: '你好',
        total_cost_usd: 0,
        usage: { input_tokens: 100, output_tokens: 40 },
        permission_denials: [],
    }
}

/** 失败结果：轮次用尽 */
function maxTurnsResult(): Message {
    return {
        type: 'result',
        subtype: 'error_max_turns',
        uuid: 'r2',
        session_id: 's1',
        duration_ms: 100,
        duration_api_ms: 80,
        is_error: true,
        num_turns: 5,
        total_cost_usd: 0,
        usage: { input_tokens: 100, output_tokens: 40 },
        permission_denials: [],
        errors: ['max turns reached'],
    }
}

/** 带图片块的助手消息：用于验证产物回落 */
function assistantWithImage(bytes: Uint8Array): Message {
    const block: ContentBlock = {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: Buffer.from(bytes).toString('base64') },
    }
    return {
        type: 'assistant',
        uuid: 'a1',
        session_id: 's1',
        parent_tool_use_id: null,
        message: {
            id: 'm1',
            type: 'message',
            role: 'assistant',
            model: 'deepseek-chat',
            content: [block],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 5 },
        },
    }
}

/** 助手发起一次工具调用：整条消息到达时才有完整入参 */
function assistantToolUse(id: string, name: string, input: Record<string, unknown>): Message {
    return {
        type: 'assistant',
        uuid: `a-${id}`,
        session_id: 's1',
        parent_tool_use_id: null,
        message: {
            id: 'm1',
            type: 'message',
            role: 'assistant',
            model: 'deepseek-chat',
            content: [{ type: 'tool_use', id, name, input }],
            stop_reason: 'tool_use',
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 5 },
        },
    }
}

/** 工具执行进度：累计耗时以秒上报 */
function toolProgress(id: string, name: string, seconds: number): Message {
    return {
        type: 'tool_progress',
        tool_use_id: id,
        tool_name: name,
        parent_tool_use_id: null,
        elapsed_time_seconds: seconds,
        uuid: `p-${id}`,
        session_id: 's1',
    }
}

/** 工具结果回灌：done / error 的唯一权威来源 */
function toolResult(id: string, content: string, isError = false): Message {
    return {
        type: 'user',
        uuid: `u-${id}`,
        session_id: 's1',
        parent_tool_use_id: null,
        message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }],
        },
    }
}

/** 文本通道替身：每次会话按工厂产出消息，并记录建会话时下发的选项 */
function createTextClient(
    factory: () => Message[],
    captured: { options: SessionOptions[]; resumed: string[] } = { options: [], resumed: [] },
): { client: CodebuddyClient; captured: { options: SessionOptions[]; resumed: string[] } } {
    const makeSession = (options: SessionOptions): CodebuddySession => {
        captured.options.push(options)
        return {
            connect: (): Promise<void> => Promise.resolve(),
            send: (): Promise<void> => Promise.resolve(),
            stream: async function* stream(): AsyncGenerator<Message, void> {
                // 让出一次微任务，贴近真实流的异步节奏
                await Promise.resolve()
                for (const message of factory()) {
                    yield message
                }
            },
            interrupt: (): Promise<void> => Promise.resolve(),
            setConfig: (): Promise<void> => Promise.resolve(),
            close: (): void => undefined,
        }
    }
    return {
        captured,
        client: {
            createSession: makeSession,
            resumeSession: (sessionId: string, options: SessionOptions): CodebuddySession => {
                captured.resumed.push(sessionId)
                return makeSession(options)
            },
        },
    }
}

/** 出图替身：新建会话直接产出预设消息，续接一律视为误用 */
function createImageClient(messages: Message[]): CodebuddyClient {
    const makeSession = (): CodebuddySession => ({
        connect: (): Promise<void> => Promise.resolve(),
        send: (): Promise<void> => Promise.resolve(),
        stream: async function* stream(): AsyncGenerator<Message, void> {
            await Promise.resolve()
            for (const message of messages) {
                yield message
            }
        },
        interrupt: (): Promise<void> => Promise.resolve(),
        setConfig: (): Promise<void> => Promise.resolve(),
        close: (): void => undefined,
    })
    return {
        createSession: makeSession,
        resumeSession: (): CodebuddySession => {
            throw new Error('出图通道不应续接会话')
        },
    }
}

/** 收集一次文本生成的全部增量 */
async function collect(provider: CodeBuddyProvider, request: Partial<AiStreamRequest>): Promise<AiStreamChunk[]> {
    const chunks: AiStreamChunk[] = []
    for await (const chunk of provider.stream({
        model: '',
        maxTokens: 100,
        messages: [{ role: 'user', content: '你好' }],
        signal: new AbortController().signal,
        ...request,
    })) {
        chunks.push(chunk)
    }
    return chunks
}

beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhai-codebuddy-provider-'))
})

afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('文本通道的流解析', () => {
    it('正文与思维链分通道产出，用量取单轮值并标记 isRoundUsage', async () => {
        const { client } = createTextClient(() => [
            initMessage('s1'),
            messageStart(),
            thinkingDelta('思考'),
            textDelta('你好'),
            messageDelta(),
            successResult(),
        ])
        const provider = new CodeBuddyProvider(new SecretsService(createSecretStorage()), client)

        const chunks = await collect(provider, {})
        expect(chunks.filter((chunk) => chunk.content === '你好')).toHaveLength(1)
        expect(chunks.filter((chunk) => chunk.reasoning === '思考')).toHaveLength(1)

        const last = chunks.at(-1)
        // 输出取 message_delta，而不是 result 的累计口径
        expect(last?.usage?.promptTokens).toBe(100)
        expect(last?.usage?.completionTokens).toBe(40)
        expect(last?.isRoundUsage).toBe(true)
        // 上下文占用含缓存读：100 + 20
        expect(last?.context?.usedTokens).toBe(120)
    })

    it('续接会话且没有流事件时，不把累计用量标成本轮值', async () => {
        const { client, captured } = createTextClient(() => [initMessage('s1'), successResult()])
        const provider = new CodeBuddyProvider(new SecretsService(createSecretStorage()), client)

        const chunks = await collect(provider, { sessionId: 'sdk-session-1' })
        expect(captured.resumed).toEqual(['sdk-session-1'])
        expect(chunks.at(-1)?.isRoundUsage).toBe(false)
    })

    it('轮次用尽时抛出可执行的分类提示', async () => {
        const { client } = createTextClient(() => [initMessage('s1'), maxTurnsResult()])
        const provider = new CodeBuddyProvider(new SecretsService(createSecretStorage()), client)

        await expect(collect(provider, {})).rejects.toThrow('工具轮次已用尽')
    })
})

describe('执行步骤的解析', () => {
    /** 只取带步骤的增量，便于按 id 比对状态序列 */
    function pickSteps(chunks: AiStreamChunk[]): NonNullable<AiStreamChunk['step']>[] {
        return chunks.flatMap((chunk) => (chunk.step === undefined ? [] : [chunk.step]))
    }

    it('工具调用按排队 → 执行中 → 完成三次下发，路径只保留末段', async () => {
        const { client } = createTextClient(() => [
            initMessage('s1'),
            assistantToolUse('tu-1', 'Read', { file_path: 'D:/press/剑来/Chapters/c1.md' }),
            toolProgress('tu-1', 'Read', 1.5),
            toolResult('tu-1', '章节正文'),
            successResult(),
        ])
        const provider = new CodeBuddyProvider(new SecretsService(createSecretStorage()), client)

        const steps = pickSteps(await collect(provider, {}))
        const states = steps.filter((step) => step.id === 'tu-1').map((step) => step.status)
        expect(states).toEqual(['pending', 'running', 'done'])
        // 绝对路径只留文件名：本机目录结构不该落库，也不该出现在界面
        expect(steps[0]?.detail).toBe('c1.md')
        expect(steps[1]?.elapsedMs).toBe(1500)
        expect(steps[1]?.status).toBe('running')
    })

    it('工具失败时标记 error 并带上失败原因', async () => {
        const { client } = createTextClient(() => [
            initMessage('s1'),
            assistantToolUse('tu-2', 'Edit', { file_path: 'D:/press/a.md' }),
            toolResult('tu-2', '文件不在允许写入的范围内', true),
            successResult(),
        ])
        const provider = new CodeBuddyProvider(new SecretsService(createSecretStorage()), client)

        // 同一 id 会多次下发，终态以最后一次为准
        const failed = pickSteps(await collect(provider, {}))
            .filter((step) => step.id === 'tu-2')
            .at(-1)
        expect(failed?.status).toBe('error')
        expect(failed?.error).toContain('不在允许写入')
    })

    it('流末把未拿到终态的步骤收口为已完成', async () => {
        const { client } = createTextClient(() => [
            initMessage('s1'),
            assistantToolUse('tu-3', 'Grep', { pattern: '剑来' }),
            successResult(),
        ])
        const provider = new CodeBuddyProvider(new SecretsService(createSecretStorage()), client)

        const steps = pickSteps(await collect(provider, {}))
        expect(steps.at(-1)?.id).toBe('tu-3')
        expect(steps.at(-1)?.status).toBe('done')
        expect(steps.at(-1)?.detail).toBe('剑来')
    })
})

describe('出图通道的产物解析', () => {
    it('图片内容块可直接落成产物', async () => {
        const client = createImageClient([initMessage('s1'), assistantWithImage(PNG_BYTES), successResult()])
        const provider = new CodeBuddyImageProvider(new SecretsService(createSecretStorage()), client)

        const artifact = await provider.generate({
            prompt: '一只猫',
            size: '768x1024',
            signal: new AbortController().signal,
        })
        expect(artifact.extension).toBe('png')
        expect(artifact.bytes.byteLength).toBe(PNG_BYTES.byteLength)
    })

    it('通道失败时抛出分类提示', async () => {
        const client = createImageClient([initMessage('s1'), maxTurnsResult()])
        const provider = new CodeBuddyImageProvider(new SecretsService(createSecretStorage()), client)

        await expect(
            provider.generate({ prompt: '一只猫', size: '768x1024', signal: new AbortController().signal }),
        ).rejects.toThrow('工具轮次已用尽')
    })
})
