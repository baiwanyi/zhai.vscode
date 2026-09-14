/**
 * AI 对话服务：会话编排、流式生成、取消与用量记录。
 * 设计源：docs/modules/ai-chat.md 第 4.2 节状态机；落地 A6 对话、A8 消息历史、A9 流式、A11 取消。
 * 约束：上下文按字符数粗估截断（AC-4 的降级实现），预算护栏达上限时拒绝发送（A17）。
 */
import { randomUUID } from 'node:crypto'
import * as vscode from 'vscode'
import { FIRST_TOKEN_TIMEOUT_MS, streamChat } from './client'
import {
    getConversation,
    getLatestConversation,
    insertConversation,
    insertMessage,
    insertUsageLog,
    listMessages,
    sumTokensSince,
    touchConversation,
    updateConversationTitle,
    updateMessage,
} from './db/chatRepository'
import type { ChatMessage, ChatUsage } from './client'
import type { ConversationRow, MessageRow } from './db/chatRepository'
import type {
    AiConversation,
    AiMessage,
    AiRuntimeInfo,
    AiSendResult,
    AiSessionSnapshot,
} from '../../shared/types/aiChat'
import type { StreamMessage } from '../../shared/types/messages'
import type { ZhaiConfig } from '../common/config'
import type Database from 'better-sqlite3'
import { getZhaiConfig } from '../common/config'
import { logger } from '../common/logger'
import { SecretsService } from '../common/secrets'

/** 默认会话标题，首条用户消息会覆盖它 */
const DEFAULT_TITLE = '新的对话'
/** 会话标题截断长度 */
const TITLE_MAX_LENGTH = 20
/** 单次生成上限，防止费用失控 */
const MAX_COMPLETION_TOKENS = 2048
/** 中文场景 1 token ≈ 1.6 字符（设计文档第 5 节的降级方案） */
const CHARS_PER_TOKEN = 1.6
/** 流式增量合并窗口，避免高频 postMessage */
const STREAM_FLUSH_MS = 60
/** 系统提示：约束回答风格，不承诺未实现的写作能力 */
const SYSTEM_PROMPT = '你是「Zhai 宅桌面」的写作助手，回答简洁准确；涉及写作建议时给出可直接落笔的表述。'

export class AiChatService implements vscode.Disposable {
    private readonly streamEmitter = new vscode.EventEmitter<StreamMessage>()
    private readonly runtimeEmitter = new vscode.EventEmitter<void>()
    /** 进行中的生成请求，用于 A11 取消 */
    private activeRequest: { reqId: string; controller: AbortController } | null = null

    /** 流式增量事件：由 Provider 订阅并转发到 Webview */
    public readonly onStream: vscode.Event<StreamMessage> = this.streamEmitter.event

    /** 运行时信息变更（密钥增删）：由 Provider 转发给前端刷新 */
    public readonly onRuntimeChanged: vscode.Event<void> = this.runtimeEmitter.event

    public constructor(
        private readonly db: Database.Database,
        private readonly secrets: SecretsService,
    ) {}

    /** 运行时信息：密钥状态、模型参数与当日用量 */
    public async getRuntimeInfo(): Promise<AiRuntimeInfo> {
        const cfg = getZhaiConfig()
        const apiKey = await this.secrets.get('deepseekApiKey')
        return {
            hasApiKey: typeof apiKey === 'string' && apiKey.length > 0,
            maskedApiKey: SecretsService.mask(apiKey),
            model: cfg.aiModel,
            temperature: cfg.aiTemperature,
            maxContextTokens: cfg.aiMaxContextTokens,
            dailyTokenBudget: cfg.aiDailyTokenBudget,
            usedTokensToday: sumTokensSince(this.db, todayStartIso()),
        }
    }

    /** 通知运行时信息已变更（密钥增删后由命令层调用） */
    public notifyRuntimeChanged(): void {
        this.runtimeEmitter.fire()
    }

    /** 取最近会话，不存在则新建（AC-9：重启窗口后会话与消息恢复） */
    public getOrCreateSession(): AiSessionSnapshot {
        const latest = getLatestConversation(this.db)
        if (!latest) {
            return this.createSession()
        }
        return {
            conversation: toConversation(latest),
            messages: listMessages(this.db, latest.id).map(toMessage),
        }
    }

    /** 新建会话 */
    public createSession(title: string = DEFAULT_TITLE): AiSessionSnapshot {
        const now = new Date().toISOString()
        const row: ConversationRow = {
            id: randomUUID(),
            title,
            mode: 'chat',
            filePath: null,
            model: getZhaiConfig().aiModel,
            createdAt: now,
            updatedAt: now,
        }
        insertConversation(this.db, row)
        logger.info(`AI 会话已创建：${row.id}`)
        return { conversation: toConversation(row), messages: [] }
    }

    /**
     * 发送用户消息并启动流式生成。
     * 落库用户消息与占位的助手消息后立即返回，正文经 onStream 增量推送。
     */
    public async send(reqId: string, conversationId: string, content: string): Promise<AiSendResult> {
        if (this.activeRequest) {
            throw new Error('已有生成中的回复，请先停止后再发送')
        }
        const input = content.trim()
        if (input.length === 0) {
            throw new Error('消息内容不能为空')
        }
        const apiKey = await this.secrets.get('deepseekApiKey')
        if (!apiKey) {
            throw new Error('未配置 DeepSeek API Key，请先点击「设置 API Key」')
        }
        const cfg = getZhaiConfig()
        const usedTokens = sumTokensSince(this.db, todayStartIso())
        if (usedTokens >= cfg.aiDailyTokenBudget) {
            throw new Error(
                `已达当日 Token 预算（${usedTokens} / ${cfg.aiDailyTokenBudget}），请明日再试或调整 zhai.ai.dailyTokenBudget`,
            )
        }
        const conversation = getConversation(this.db, conversationId)
        if (!conversation) {
            throw new Error('会话不存在或已被删除')
        }

        const now = new Date().toISOString()
        const userMessage: MessageRow = {
            id: randomUUID(),
            conversationId,
            role: 'user',
            content: input,
            reasoning: null,
            status: 'completed',
            finishReason: null,
            error: null,
            createdAt: now,
        }
        insertMessage(this.db, userMessage)
        const assistantMessage: MessageRow = {
            id: randomUUID(),
            conversationId,
            role: 'assistant',
            content: '',
            reasoning: null,
            status: 'pending',
            finishReason: null,
            error: null,
            createdAt: new Date().toISOString(),
        }
        insertMessage(this.db, assistantMessage)
        // 只会话前两条消息时用首条输入命名会话，之后保持稳定
        if (listMessages(this.db, conversationId).length <= 2) {
            updateConversationTitle(this.db, conversationId, summarizeTitle(input))
        }
        touchConversation(this.db, conversationId, now)

        void this.generate(reqId, assistantMessage.id, conversationId, input, apiKey, cfg)

        return {
            conversationId,
            userMessage: toMessage(userMessage),
            assistantMessage: toMessage(assistantMessage),
        }
    }

    /** 取消当前生成（AC-2：立即断开连接，避免继续计费） */
    public abort(): boolean {
        if (!this.activeRequest) {
            return false
        }
        this.activeRequest.controller.abort()
        return true
    }

    public dispose(): void {
        this.abort()
        this.streamEmitter.dispose()
        this.runtimeEmitter.dispose()
    }

    private async generate(
        reqId: string,
        assistantMessageId: string,
        conversationId: string,
        input: string,
        apiKey: string,
        cfg: ZhaiConfig,
    ): Promise<void> {
        const controller = new AbortController()
        this.activeRequest = { reqId, controller }
        const startedAt = Date.now()
        let answer = ''
        let reasoning = ''
        let pending = ''
        let lastEmitAt = 0
        let usage: ChatUsage | null = null
        let isFirstToken = true
        let isTimedOut = false
        const firstTokenTimer = setTimeout(() => {
            isTimedOut = true
            controller.abort()
        }, FIRST_TOKEN_TIMEOUT_MS)

        /** 按窗口合并增量，done 时强制冲刷 */
        const flush = (force: boolean): void => {
            if (pending.length === 0) {
                return
            }
            const now = Date.now()
            if (!force && now - lastEmitAt < STREAM_FLUSH_MS) {
                return
            }
            this.streamEmitter.fire({ type: 'stream', reqId, delta: pending, done: false, channel: 'content' })
            pending = ''
            lastEmitAt = now
        }

        try {
            const messages = this.buildChatMessages(conversationId, input)
            const stream = streamChat({
                apiKey,
                model: cfg.aiModel,
                temperature: cfg.aiTemperature,
                maxTokens: MAX_COMPLETION_TOKENS,
                messages,
                signal: controller.signal,
            })
            for await (const chunk of stream) {
                if (isFirstToken && (chunk.content.length > 0 || chunk.reasoning.length > 0)) {
                    isFirstToken = false
                    clearTimeout(firstTokenTimer)
                }
                answer += chunk.content
                reasoning += chunk.reasoning
                pending += chunk.content
                flush(false)
                if (chunk.usage) {
                    usage = chunk.usage
                }
            }
            clearTimeout(firstTokenTimer)
            flush(true)
            updateMessage(this.db, assistantMessageId, {
                content: answer,
                reasoning: reasoning.length > 0 ? reasoning : null,
                status: 'completed',
                finishReason: 'stop',
                error: null,
            })
            this.recordUsage(conversationId, cfg.aiModel, startedAt, usage, answer, controller.signal.aborted)
            this.streamEmitter.fire({
                type: 'stream',
                reqId,
                delta: '',
                done: true,
                status: 'completed',
                content: answer,
            })
        } catch (error) {
            clearTimeout(firstTokenTimer)
            flush(true)
            const isCancelled = controller.signal.aborted
            const status = isCancelled ? 'cancelled' : 'failed'
            const message = isTimedOut
                ? `首字等待超过 ${FIRST_TOKEN_TIMEOUT_MS / 1000} 秒，已自动中断`
                : toErrorMessage(error)
            updateMessage(this.db, assistantMessageId, {
                content: answer,
                reasoning: reasoning.length > 0 ? reasoning : null,
                status,
                finishReason: isCancelled ? 'cancelled' : 'error',
                error: message,
            })
            if (!isCancelled) {
                logger.error(`AI 生成失败：${message}`, error)
            }
            this.streamEmitter.fire({
                type: 'stream',
                reqId,
                delta: '',
                done: true,
                status,
                content: answer,
                error: isCancelled ? undefined : message,
            })
        } finally {
            if (this.activeRequest?.reqId === reqId) {
                this.activeRequest = null
            }
        }
    }

    /** 组装发往模型的 messages：system + 预算内的历史 + 当前输入（AC-4 的降级实现） */
    private buildChatMessages(conversationId: string, input: string): ChatMessage[] {
        const budget = Math.max(getZhaiConfig().aiMaxContextTokens, 0) * CHARS_PER_TOKEN
        const history = listMessages(this.db, conversationId).filter(
            (row) =>
                (row.role === 'user' || row.role === 'assistant') &&
                row.status === 'completed' &&
                row.content.length > 0,
        )
        const selected: ChatMessage[] = []
        let used = input.length
        for (let index = history.length - 1; index >= 0; index -= 1) {
            const row = history[index]
            if (!row) {
                continue
            }
            used += row.content.length
            if (used > budget && selected.length > 0) {
                break
            }
            selected.unshift({ role: row.role === 'assistant' ? 'assistant' : 'user', content: row.content })
        }
        return [{ role: 'system', content: SYSTEM_PROMPT }, ...selected, { role: 'user', content: input }]
    }

    /** 记录用量：服务端未返回时按字符数粗估兜底（日志表不存提示词正文） */
    private recordUsage(
        conversationId: string,
        model: string,
        startedAt: number,
        usage: ChatUsage | null,
        answer: string,
        isCancelled: boolean,
    ): void {
        const completionTokens = usage?.completionTokens ?? Math.ceil(answer.length / CHARS_PER_TOKEN)
        insertUsageLog(this.db, {
            id: randomUUID(),
            conversationId,
            project: 'ai-chat',
            model,
            promptTokens: usage?.promptTokens ?? 0,
            completionTokens,
            reasoningTokens: usage?.reasoningTokens ?? 0,
            totalTokens: usage?.totalTokens ?? completionTokens,
            estimatedCost: 0,
            latencyMs: Date.now() - startedAt,
            createdAt: new Date().toISOString(),
        })
        if (isCancelled) {
            logger.info('AI 生成被取消，已按已产生内容记录用量')
        }
    }
}

/** 当日 0 点（本地时区）的 ISO 时间戳 */
function todayStartIso(): string {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
}

/** 用首条输入生成会话标题 */
function summarizeTitle(text: string): string {
    const firstLine = text.split('\n')[0]?.trim() ?? text
    return firstLine.length > TITLE_MAX_LENGTH ? `${firstLine.slice(0, TITLE_MAX_LENGTH)}…` : firstLine
}

function toConversation(row: ConversationRow): AiConversation {
    return {
        id: row.id,
        title: row.title,
        mode: row.mode === 'write' ? 'write' : 'chat',
        filePath: row.filePath,
        model: row.model,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function toMessage(row: MessageRow): AiMessage {
    return {
        id: row.id,
        conversationId: row.conversationId,
        role: row.role === 'assistant' || row.role === 'system' ? row.role : 'user',
        content: row.content,
        reasoning: row.reasoning,
        status: toStatus(row.status),
        finishReason: row.finishReason,
        error: row.error,
        createdAt: row.createdAt,
    }
}

function toStatus(value: string): AiMessage['status'] {
    switch (value) {
        case 'pending':
        case 'streaming':
        case 'completed':
        case 'failed':
        case 'cancelled':
            return value
        default:
            return 'completed'
    }
}

function toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
