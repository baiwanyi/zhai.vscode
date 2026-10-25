/**
 * 章节快照展示格式化：时间、体积与来源徽章文案集中一处，避免组件内重复实现。
 * 复用约定：时间格式化复用 @shared/utils/format 的 formatDateTime（与用量账单同一口径），
 * 本文件只承担「解析失败回退原值」与体积换算两件快照特有的处理。
 * 关键约束：时间解析失败时原样返回入参，避免把非法时间渲染成 Invalid Date；
 * 来源标签与 types 中的 reason 一一对应，新增来源时必须同步补齐。
 */
import type { ChapterSnapshotReason } from '@shared/types/press'
import { formatDateTime } from '@shared/utils/format'

/** 章节正文快照的来源标签：写回前留底要和自动保存区分开，避免用户误删 */
export const CHAPTER_REASON_LABELS: Readonly<Record<ChapterSnapshotReason, string>> = {
    auto: '自动',
    'ai-write': '写回前',
    manual: '手动',
    restore: '恢复前',
}

/** 格式化创建时间：本地时间到分钟；解析失败时原样返回入参 */
export function formatSnapshotTime(value: string): string {
    const formatted = formatDateTime(value)
    return formatted.length > 0 ? formatted : value
}

/** 格式化体积：不足 1KB 显示字节，其余保留一位小数 */
export function formatSize(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`
    }
    return `${(bytes / 1024).toFixed(1)} KB`
}
