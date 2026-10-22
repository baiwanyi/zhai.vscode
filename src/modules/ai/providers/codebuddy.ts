/**
 * CodeBuddy 通道：经 @tencent-ai/agent-sdk 的 query() 驱动随包分发的 CLI 完成一次生成。
 * 复用约定：请求与增量结构由 ../provider 定义；SDK 自带 CLI（cli/bin/codebuddy），无需用户单独安装；
 * 站点经 ./codebuddySite 统一映射，保证与登录命令落在同一站点；凭证优先取 SecretStorage 的 API Key。
 * 关键约束：内置工具一律禁用（tools: []）并限制单轮，避免纯文本生成去读工作区；
 * 首轮无会话号时把本地历史拼成单轮提示词，拿到会话号后改为 resume 续接，历史由通道维护。
 */
import { tmpdir } from 'node:os'
import { query } from '@tencent-ai/agent-sdk'
import { buildCodebuddyEnv, CODEBUDDY_SITE_LABELS } from './codebuddySite'
import type { SecretsService } from '../../common/secrets'
import type {
    AiChatMessage,
    AiProvider,
    AiProviderId,
    AiProviderStatus,
    AiStreamChunk,
    AiStreamRequest,
} from '../provider'
import { getZhaiConfig } from '../../common/config'

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

/** 判断模型名是否由本通道管理：DeepSeek 专有模型名传给 CLI 会报错，交回 CLI 默认模型 */
function toCodebuddyModel(model: string): string | undefined {
    return model.startsWith('deepseek-') ? undefined : model
}

/** 把 SDK 的原始错误转成可执行提示：未登录是最常见的一类，直接给出下一步动作 */
function toReadableError(error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error)
    if (/authentication required|please (use|run) \/login/i.test(message)) {
        const site = CODEBUDDY_SITE_LABELS[getZhaiConfig().aiCodebuddySite]
        return new Error(`尚未登录 CodeBuddy（${site}）：请执行「宅写作：登录 CodeBuddy」后重试`, { cause: error })
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
        const apiKey = await this.secrets.get('codebuddyApiKey')
        const controller = new AbortController()
        const forwardAbort = (): void => controller.abort()
        if (request.signal.aborted) {
            controller.abort()
        } else {
            request.signal.addEventListener('abort', forwardAbort, { once: true })
        }
        const session = query({
            prompt,
            options: {
                abortController: controller,
                // 纯文本生成：禁用全部内置工具，避免读工作区文件与多轮 Agent 循环
                tools: [],
                maxTurns: 1,
                permissionMode: 'default',
                includePartialMessages: true,
                systemPrompt,
                resume: isResume ? request.sessionId : undefined,
                model: toCodebuddyModel(request.model),
                // 工作目录指向临时目录，与用户项目隔离
                cwd: tmpdir(),
                env: buildCodebuddyEnv(getZhaiConfig().aiCodebuddySite, apiKey),
            },
        })
        let hasStreamed = false
        let usage: AiStreamChunk['usage']
        try {
            for await (const message of session) {
                if (message.type === 'system') {
                    // init 消息携带会话号：首轮回写，后续轮次据此 resume
                    if (message.subtype === 'init' && request.onSessionId) {
                        request.onSessionId(message.session_id)
                    }
                    continue
                }
                if (message.type === 'stream_event') {
                    const { event } = message
                    if (event.type === 'content_block_delta') {
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
                    yield { content: '', reasoning: '', usage }
                }
            }
        } catch (error) {
            throw toReadableError(error)
        } finally {
            request.signal.removeEventListener('abort', forwardAbort)
            if (!controller.signal.aborted) {
                controller.abort()
            }
        }
    }
}
