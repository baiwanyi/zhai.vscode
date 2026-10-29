/**
 * 用量记账：把各 AI 入口的 tokens、请求标识与提示词写入用量库，供「AI 使用量」页展示。
 * 复用约定：模块键取自 shared/types/aiUsage；提示词由调用方传消息数组，拼接成可读文本后截断入库。
 * 关键约束：记账是旁路，任何写库异常只记日志、不得中断生成；提示词字数随行落库，
 * 供 usageRepository.readCharsPerToken 反算本机真实比值（替代写死的 1.6），字数不参与展示；积分一律留空，
 * 由用量查询从 CodeBuddy 会话记录按请求 id 回填（`rawUsage.credit` 与工具调用 credit 之和），
 * 此处不得按倍率估算；提示词按 PROMPT_MAX_LENGTH 截断并标记，保留期清理由用量服务负责。
 */
import { randomUUID } from 'node:crypto'
import { logger } from '@modules/common/logger'
import type { AiUsageModule, AiUsageStatus } from '@shared/types/aiUsage'
import { insertUsageLog, upsertPrompt } from './db/usageRepository'
import type { AiChatMessage, AiUsage, AiUsageMeta } from './provider'
import type Database from 'better-sqlite3'

/** 提示词入库上限：单轮消息含引用原文时可能较长，超出部分不再保留 */
const PROMPT_MAX_LENGTH = 20_000

/** 记账入参：usage 与 meta 由通道流末块回传，缺失时按 0 兜底但不伪造成本 */
export interface UsageRecordInput {
    module: AiUsageModule
    /** 模型 id；空串表示交给 CLI 的默认模型，此时积分未知 */
    model: string
    usage: AiUsage | null
    meta?: AiUsageMeta | null
    conversationId?: string | null
    /** 本轮实际提交给模型的内容（含系统提示），用于点击请求 id 时回看 */
    prompt?: string | null
    /** 请求开始时间戳：通道未回传耗时时的兜底 */
    startedAt?: number
    status?: AiUsageStatus
}

export class UsageRecorder {
    public constructor(private readonly db: Database.Database) {}

    /** 记录一次用量：写库失败只记日志，不影响生成结果 */
    public record(input: UsageRecordInput): void {
        try {
            const logId = randomUUID()
            const meta = input.meta ?? null
            const usage = input.usage
            const totalTokens = usage?.totalTokens ?? 0
            const createdAt = new Date().toISOString()
            const prompt = input.prompt?.trim() ?? ''
            const requestId = meta?.requestId ?? logId
            insertUsageLog(this.db, {
                id: logId,
                conversationId: input.conversationId ?? null,
                module: input.module,
                model: input.model,
                requestId: meta?.requestId ?? null,
                sdkMessageId: meta?.messageId ?? null,
                promptTokens: usage?.promptTokens ?? 0,
                // 记原始字数（不 trim）：与实际提交量同口径，供按真实 token 反算字符/token 比值
                promptChars: input.prompt?.length ?? 0,
                completionTokens: usage?.completionTokens ?? 0,
                reasoningTokens: usage?.reasoningTokens ?? 0,
                totalTokens,
                credits: null,
                costUsd: meta?.costUsd ?? 0,
                cacheReadTokens: meta?.cacheReadTokens ?? 0,
                cacheCreationTokens: meta?.cacheCreationTokens ?? 0,
                latencyMs: meta?.durationMs ?? (input.startedAt === undefined ? 0 : Date.now() - input.startedAt),
                status: input.status ?? 'completed',
                createdAt,
            })
            if (prompt.length > 0) {
                upsertPrompt(this.db, {
                    requestId,
                    content: prompt.slice(0, PROMPT_MAX_LENGTH),
                    isTruncated: prompt.length > PROMPT_MAX_LENGTH,
                    createdAt,
                })
            }
        } catch (error) {
            logger.error('AI 用量记账失败', error)
        }
    }
}

/** 角色标签：弹窗里直接用中文区分系统提示、用户输入与助手回复 */
const ROLE_LABELS: Readonly<Record<AiChatMessage['role'], string>> = {
    system: '系统',
    user: '用户',
    assistant: '助手',
}

/** 把消息数组拼成可读提示词：保留角色标签，便于在弹窗里区分系统提示与本轮输入 */
export function summarizeMessages(messages: AiChatMessage[]): string {
    return messages.map((item) => `【${ROLE_LABELS[item.role]}】\n${item.content}`).join('\n\n')
}
