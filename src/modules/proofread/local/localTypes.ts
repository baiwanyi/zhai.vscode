/**
 * 本地校对规则的公共契约：所有规则函数只负责产出命中，不做白名单过滤、去重与排序。
 * 复用约定：类别与严重度取自共享契约，规则函数统一签名 (text) => LocalHit[]，由 localChecker 统一聚合。
 * 关键约束：命中偏移一律相对传入文本；replacement 为空表示该条只能提示、不可一键写回。
 */
import type { ProofreadCategory, ProofreadSeverity } from '@shared/types/proofread'

/** 单条规则命中：聚合前的中间结构，不带 id 与段落号 */
export interface LocalHit {
    category: ProofreadCategory
    severity: ProofreadSeverity
    start: number
    end: number
    /** 原文片段：写回前由宿主回查 */
    quote: string
    /** 建议替换文本；null 表示仅提示 */
    replacement: string | null
    reason: string
    /** 规则标识：便于排查误报来源 */
    ruleId: string
}
