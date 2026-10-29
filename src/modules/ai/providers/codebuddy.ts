/**
 * CodeBuddy 通道：经 CodebuddyClient（默认直连 @tencent-ai/agent-sdk）的 V2 Session 驱动随包分发的 CLI 完成一次生成。
 * 复用约定：请求与增量结构由 ../provider 定义；SDK 调用统一走 ./codebuddyClient 的可注入接口，本层不直接 import SDK；
 * SDK 自带 CLI（cli/bin/codebuddy），无需用户单独安装；
 * 站点经 ./codebuddySite 统一映射，保证与登录命令落在同一站点；凭证优先取 SecretStorage 的 API Key。
 * 关键约束：内置工具一律禁用（tools: []）并限制单轮，避免纯文本生成去读工作区；
 * 首轮无会话号时把本地历史拼成单轮提示词，拿到会话号后改为 resume 续接，历史由通道维护；
 * 上下文预算经 set_config 下发（SDK 未提供专用选项，键名为 CLI 侧契约，缺失时静默降级），
 * 档位由 ./codebuddyModels 按模型能力裁决；
 * 上下文占用只认 message_start 的单次请求输入量（输入 + 缓存读 + 缓存写），
 * 不用 result.usage 代替 —— 续接会话时它是累计值，会把上下文用量算成整段历史的总和；
 * 单轮用量同样从流事件拼出（输入取 message_start、输出取 message_delta），不读 CLI 会话记录，
 * result.usage 仅作首轮兜底，并以 isRoundUsage 告知上层该值能否直接记账；
 * 窗口只认官方模型清单（getAvailableModelsRaw 的 contextWindow），不探测 SDK 类型未声明的字段。
 */
import { tmpdir } from 'node:os'
import { getZhaiConfig } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import type { SecretsService } from '@modules/common/secrets'
import { sdkCodebuddyClient } from './codebuddyClient'
import { classifyResultFailure, CodebuddyError, toReadableCodebuddyError } from './codebuddyError'
import {
    getSelectedCodebuddyModel,
    getSelectedEffort,
    readModelContextWindow,
    resolveCodebuddyModel,
    resolveContextWindow,
} from './codebuddyModels'
import { buildCodebuddyEnv } from './codebuddySite'
import type {
    AiChatMessage,
    AiProvider,
    AiProviderId,
    AiProviderStatus,
    AiStreamChunk,
    AiStreamRequest,
    AiUsageMeta,
} from '../provider'
import type { CodebuddyClient } from './codebuddyClient'
import type { SessionOptions } from '@tencent-ai/agent-sdk'

/**
 * 上下文预算的配置键：SDK 未提供专用选项，只能经通用的 setConfig 下发，
 * 键名由 CLI 侧约定 —— 升级 CLI 后若改名，这里会静默失效并按模型默认档位继续。
 */
const CONTEXT_WINDOW_CONFIG_KEY = 'contextWindow'

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

export class CodeBuddyProvider implements AiProvider {
    public readonly id: AiProviderId = 'codebuddy'

    public constructor(
        private readonly secrets: SecretsService,
        private readonly client: CodebuddyClient = sdkCodebuddyClient,
    ) {}

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
            // 推理强度：null 表示跟随模型默认，不下发该字段
            effort: getSelectedEffort() ?? undefined,
            // 工作目录指向临时目录，与用户项目隔离
            cwd: tmpdir(),
            env: buildCodebuddyEnv(cfg.aiCodebuddySite, apiKey),
            // 关键约束：不得改为 persistSession: false —— 关闭 transcript 后 CLI 不再写会话记录，
            // 而积分（credit）只有该记录里有（SDK 只回 total_cost_usd，且在本项目实测恒为 0），
            // 用量页的积分列与周期徽标会整体失去数据来源。
        }
        const session = isResume
            ? this.client.resumeSession(request.sessionId ?? '', sessionOptions)
            : this.client.createSession(sessionOptions)
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
        /** 本轮输入 token（不含缓存读写）：与 result.usage 同口径，供用量记账 */
        let roundInputTokens = 0
        /** 本轮输出 token：message_delta 上报的是本条消息的累计输出，取最后一次即本轮值 */
        let roundOutputTokens = 0
        try {
            await session.connect()
            // 档位需在首条消息前生效；CLI 未支持该键时只记日志，不阻断生成
            if (contextWindow > 0) {
                try {
                    await session.setConfig({ [CONTEXT_WINDOW_CONFIG_KEY]: contextWindow })
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
                    // 压缩是旁路事件：compacting 在开始时下发，compact_boundary 标记完成
                    if (message.subtype === 'compact_boundary') {
                        yield { content: '', reasoning: '', notice: 'compacted' }
                    } else if (message.subtype === 'status' && message.status === 'compacting') {
                        yield { content: '', reasoning: '', notice: 'compacting' }
                    }
                    continue
                }
                if (message.type === 'stream_event') {
                    const { event } = message
                    if (event.type === 'message_start') {
                        // 本次请求真正带上的上下文规模：系统提示、历史与引用的合计，与输出无关
                        contextTokens = sumContextTokens(event.message.usage)
                        roundInputTokens = event.message.usage.input_tokens
                        if (contextTokens === 0) {
                            // 部分模型在流开头不上报输入用量，这里必须留证据，否则只能靠猜
                            logger.warn(`message_start 未带输入用量：${JSON.stringify(event.message.usage)}`)
                        }
                    } else if (event.type === 'message_delta') {
                        // 本轮输出用量：续接会话时 result.usage 是累计值，只有这里给的是单条消息值
                        if (event.usage !== undefined) {
                            roundOutputTokens = event.usage.output_tokens
                            if (roundInputTokens === 0) {
                                roundInputTokens = event.usage.input_tokens
                            }
                        }
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
                        // 失败先归到分类码：subtype 能分辨的（轮次 / 额度）不再依赖文案匹配
                        throw new CodebuddyError(classifyResultFailure(message.subtype, message.errors), detail)
                    }
                    // 单轮用量优先由流事件拼出：message_start 的输入 + message_delta 的输出。
                    // 续接会话时 result.usage 是整段会话的累计，只在流事件缺失时退回它（首轮仍是单轮值）
                    const hasStreamedUsage = roundInputTokens > 0 && roundOutputTokens > 0
                    const isRoundUsage = hasStreamedUsage || !isResume
                    const promptTokens = hasStreamedUsage ? roundInputTokens : message.usage.input_tokens
                    const completionTokens = hasStreamedUsage ? roundOutputTokens : message.usage.output_tokens
                    usage = {
                        promptTokens,
                        completionTokens,
                        reasoningTokens: 0,
                        totalTokens: promptTokens + completionTokens,
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
                    // 兜底：流开头没给输入用量时，首轮可直接用 result 的输入三项
                    // （续接不行 —— 此时的 result.usage 是整段会话的累计，会把上下文算成历史总和）
                    if (contextTokens === 0 && !isResume) {
                        contextTokens = sumContextTokens(message.usage)
                    }
                    if (contextTokens === 0) {
                        logger.warn('上下文用量未取到：message_start 与 result 均无输入用量')
                    }
                    // 窗口只认官方模型清单：getAvailableModelsRaw 下发 defaultLength / supportedLengths / maxInputTokens，
                    // 清单尚未拉取或平台未下发时留 0，由展示层不显示占比，不猜档位
                    const contextWindow = readModelContextWindow(resolveCodebuddyModel(getSelectedCodebuddyModel()) ?? '')
                    if (contextWindow === 0) {
                        logger.warn('上下文窗口未取到：模型清单尚未拉取或平台未下发档位')
                    }
                    const context =
                        contextTokens > 0 ? { usedTokens: contextTokens, windowTokens: contextWindow } : undefined
                    yield { content: '', reasoning: '', usage, meta, context, isRoundUsage }
                    // V2 Session 的流是常驻的，本轮 result 之后必须主动结束，否则会一直等下一轮
                    break
                }
            }
        } catch (error) {
            throw toReadableCodebuddyError(error, getSelectedCodebuddyModel())
        } finally {
            request.signal.removeEventListener('abort', forwardAbort)
            session.close()
        }
    }
}
