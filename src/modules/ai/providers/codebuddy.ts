/**
 * CodeBuddy 通道：经 @tencent-ai/agent-sdk 的 V2 Session 驱动随包分发的 CLI 完成一次生成。
 * 复用约定：请求与增量结构由 ../provider 定义；SDK 自带 CLI（cli/bin/codebuddy），无需用户单独安装；
 * 站点经 ./codebuddySite 统一映射，保证与登录命令落在同一站点；凭证优先取 SecretStorage 的 API Key。
 * 关键约束：内置工具一律禁用（tools: []）并限制单轮，避免纯文本生成去读工作区；
 * 首轮无会话号时把本地历史拼成单轮提示词，拿到会话号后改为 resume 续接，历史由通道维护；
 * 上下文预算经 set_config 的 contextWindow 在首轮下发，档位由 ./codebuddyModels 按模型能力裁决；
 * 上下文占用只认 message_start 的单次请求输入量（输入 + 缓存读 + 缓存写），
 * 不用 result.usage 代替 —— 续接会话时它是累计值，会把上下文用量算成整段历史的总和。
 */
import { tmpdir } from 'node:os'
import { unstable_v2_createSession, unstable_v2_resumeSession } from '@tencent-ai/agent-sdk'
import { getZhaiConfig } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import type { SecretsService } from '@modules/common/secrets'
import {
    getSelectedCodebuddyModel,
    readModelContextWindow,
    resolveCodebuddyModel,
    resolveContextWindow,
} from './codebuddyModels'
import { buildCodebuddyEnv, CODEBUDDY_SITE_LABELS } from './codebuddySite'
import type {
    AiChatMessage,
    AiProvider,
    AiProviderId,
    AiProviderStatus,
    AiStreamChunk,
    AiStreamRequest,
    AiUsageMeta,
} from '../provider'
import type { ResultMessage, SessionOptions } from '@tencent-ai/agent-sdk'

/** 提示词拆分结果：system 内容与单轮输入 */
interface PreparedPrompt {
    systemPrompt: string | undefined
    prompt: string
}

/** 把消息数组拆成 system 与单轮提示词：多轮历史拼为对话记录，末条作为本轮输入 */
function preparePrompt(messages: AiChatMessage[], isResume: boolean): PreparedPrompt {
    const lastUser = [...messages].reverse().find((item) => item.role === 'user')
    if (!lastUser) {
        throw new Error('生成请求缺少用户消息')
    }
    // 续接会话时历史与系统提示由通道维护，本轮只提交最新一条用户输入
    if (isResume) {
        return { systemPrompt: undefined, prompt: lastUser.content }
    }
    const systemParts = messages.filter((item) => item.role === 'system').map((item) => item.content.trim())
    const dialogue = messages.filter((item) => item.role !== 'system')
    const last = dialogue[dialogue.length - 1]
    if (!last) {
        throw new Error('生成请求缺少用户消息')
    }
    const systemPrompt = systemParts.filter((part) => part.length > 0).join('\n\n')
    const history = dialogue.slice(0, -1)
    if (history.length === 0) {
        return { systemPrompt: systemPrompt.length > 0 ? systemPrompt : undefined, prompt: last.content }
    }
    const lines = history.map((item) => `${item.role === 'user' ? '用户' : '助手'}：${item.content}`)
    return {
        systemPrompt: systemPrompt.length > 0 ? systemPrompt : undefined,
        prompt: `以下是此前的对话记录：\n\n${lines.join('\n\n')}\n\n用户：${last.content}`,
    }
}

/**
 * 单次请求的上下文用量：输入、缓存读、缓存写三项相加。
 * 三者是互不重叠的计费口径，只取 input_tokens 会把命中缓存的历史整体漏掉。
 */
function sumContextTokens(usage: {
    input_tokens: number
    cache_read_input_tokens?: number | null
    cache_creation_input_tokens?: number | null
}): number {
    return usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
}

/**
 * 从 result.modelUsage 读本轮实际生效的上下文窗口：该字段未写进 SDK 类型声明，只能按运行时结构探测。
 * 关键约束：逐层校验形状，取不到数字返回 0 表示未知，不得依据模型 id 猜一个档位。
 */
function readResultContextWindow(message: ResultMessage): number {
    if (!('modelUsage' in message)) {
        return 0
    }
    const { modelUsage } = message as ResultMessage & { modelUsage?: unknown }
    if (typeof modelUsage !== 'object' || modelUsage === null) {
        return 0
    }
    for (const entry of Object.values(modelUsage)) {
        if (typeof entry !== 'object' || entry === null) {
            continue
        }
        const window = (entry as { contextWindow?: unknown }).contextWindow
        if (typeof window === 'number' && Number.isFinite(window) && window > 0) {
            return window
        }
    }
    return 0
}

/** 把 SDK 的原始错误转成可执行提示：未登录与模型不可用是最常见的两类 */
function toReadableError(error: unknown, model?: string): Error {
    const message = error instanceof Error ? error.message : String(error)
    if (/authentication required|please (use|run) \/login/i.test(message)) {
        const site = CODEBUDDY_SITE_LABELS[getZhaiConfig().aiCodebuddySite]
        return new Error(`尚未登录 CodeBuddy（${site}）：请执行「宅写作：登录 CodeBuddy」后重试`, { cause: error })
    }
    if (/service info not found|supported models for your account/i.test(message)) {
        const label = model !== undefined && model.length > 0 ? `「${model}」` : '当前模型'
        return new Error(
            `CodeBuddy 模型不可用：${label}不在当前账号的可用列表，请在 AI 面板的模型菜单中重新选择（或打开「自动」）`,
            { cause: error },
        )
    }
    return error instanceof Error ? error : new Error(message)
}

export class CodeBuddyProvider implements AiProvider {
    public readonly id: AiProviderId = 'codebuddy'

    public constructor(private readonly secrets: SecretsService) {}

    /**
     * 凭证由 CLI 的配置目录维护（登录一次即可），此处不主动探测：
     * 探测需要拉起子进程，代价高且会干扰用户当前会话；缺登录在请求阶段给出可读错误。
     */
    public checkReady(): Promise<AiProviderStatus> {
        return Promise.resolve({ ready: true })
    }

    public async *stream(request: AiStreamRequest): AsyncGenerator<AiStreamChunk> {
        const isResume = typeof request.sessionId === 'string' && request.sessionId.length > 0
        const { systemPrompt, prompt } = preparePrompt(request.messages, isResume)
        const cfg = getZhaiConfig()
        const apiKey = await this.secrets.get('codebuddyApiKey')
        // 模型来自面板菜单的当前选择（globalState），允许自定义模型 id
        const model = resolveCodebuddyModel(getSelectedCodebuddyModel())
        /** 上下文预算：0 表示跟随模型默认档位，交由 CLI 自行裁决 */
        const contextWindow = resolveContextWindow(model ?? '')
        const sessionOptions: SessionOptions = {
            // 纯文本生成：禁用全部内置工具，避免读工作区文件与多轮 Agent 循环
            tools: [],
            maxTurns: 1,
            permissionMode: 'default',
            includePartialMessages: true,
            systemPrompt,
            model,
            // 工作目录指向临时目录，与用户项目隔离
            cwd: tmpdir(),
            env: buildCodebuddyEnv(cfg.aiCodebuddySite, apiKey),
        }
        const session = isResume
            ? unstable_v2_resumeSession(request.sessionId ?? '', sessionOptions)
            : unstable_v2_createSession(sessionOptions)
        // V2 Session 没有 abortController 选项，中断统一交给 interrupt()
        const forwardAbort = (): void => {
            void session.interrupt()
        }
        if (request.signal.aborted) {
            forwardAbort()
        } else {
            request.signal.addEventListener('abort', forwardAbort, { once: true })
        }
        let hasStreamed = false
        let usage: AiStreamChunk['usage']
        /** 逻辑轮次标识：SDK 在每条消息上回传，任一条拿到即可，供用量日志与 CLI 侧对账 */
        let requestId: string | null = null
        /** 最近一次请求的上下文用量：每出现一个 message_start 覆盖一次，取最后一轮即当前占用 */
        let contextTokens = 0
        try {
            await session.connect()
            // 档位需在首条消息前生效；CLI 未支持该键时只记日志，不阻断生成
            if (contextWindow > 0) {
                try {
                    await session.setConfig({ contextWindow })
                } catch (error) {
                    logger.warn(`上下文窗口设置失败（${contextWindow}），按模型默认档位继续：${String(error)}`)
                }
            }
            await session.send(prompt)
            for await (const message of session.stream()) {
                requestId = message._requestId ?? requestId
                if (message.type === 'system') {
                    // init 消息携带会话号：首轮回写，后续轮次据此 resume
                    if (message.subtype === 'init' && request.onSessionId) {
                        request.onSessionId(message.session_id)
                    }
                    continue
                }
                if (message.type === 'stream_event') {
                    const { event } = message
                    if (event.type === 'message_start') {
                        // 本次请求真正带上的上下文规模：系统提示、历史与引用的合计，与输出无关
                        contextTokens = sumContextTokens(event.message.usage)
                    } else if (event.type === 'content_block_delta') {
                        if (event.delta.type === 'text_delta') {
                            hasStreamed = true
                            yield { content: event.delta.text, reasoning: '' }
                        } else if (event.delta.type === 'thinking_delta') {
                            yield { content: '', reasoning: event.delta.thinking }
                        }
                    }
                    continue
                }
                if (message.type === 'assistant') {
                    // 兜底：未收到增量（旧版 CLI 不推送 stream_event）时按整段正文输出一次
                    if (!hasStreamed) {
                        const text = message.message.content
                            .filter((block) => block.type === 'text')
                            .map((block) => block.text)
                            .join('')
                        if (text.length > 0) {
                            hasStreamed = true
                            yield { content: text, reasoning: '' }
                        }
                    }
                    continue
                }
                if (message.type === 'result') {
                    if (message.subtype !== 'success') {
                        const detail = message.errors?.join('；') ?? message.subtype
                        throw new Error(`CodeBuddy 生成失败：${detail}`)
                    }
                    usage = {
                        promptTokens: message.usage.input_tokens,
                        completionTokens: message.usage.output_tokens,
                        reasoningTokens: 0,
                        totalTokens: message.usage.input_tokens + message.usage.output_tokens,
                    }
                    const meta: AiUsageMeta = {
                        requestId,
                        messageId: message._messageId ?? message.uuid,
                        costUsd: message.total_cost_usd,
                        durationMs: message.duration_ms,
                        durationApiMs: message.duration_api_ms,
                        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
                        cacheCreationTokens: message.usage.cache_creation_input_tokens ?? 0,
                    }
                    // 窗口以本轮实际生效值为准，退回模型清单档位；都拿不到时留 0，由展示层不显示占比
                    const contextWindow =
                        readResultContextWindow(message) ||
                        readModelContextWindow(resolveCodebuddyModel(getSelectedCodebuddyModel()) ?? '')
                    const context =
                        contextTokens > 0 ? { usedTokens: contextTokens, windowTokens: contextWindow } : undefined
                    yield { content: '', reasoning: '', usage, meta, context }
                    // V2 Session 的流是常驻的，本轮 result 之后必须主动结束，否则会一直等下一轮
                    break
                }
            }
        } catch (error) {
            throw toReadableError(error, getSelectedCodebuddyModel())
        } finally {
            request.signal.removeEventListener('abort', forwardAbort)
            session.close()
        }
    }
}
