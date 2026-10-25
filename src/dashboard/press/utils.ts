/**
 * 写作管理页共享的展示层工具：加载状态类型与作品元信息格式化。
 * 供作品列表与作品详情两组 hook/组件复用，避免各页重复定义状态机与文案口径。
 * 关键约束：元信息固定为「章节数 · 字数 · 最近更新」三段并过滤空值，列表与详情页必须同源，
 * 任一侧新增字段都应改这里而不是就地拼接；错误提示统一取 webview 公共 utils 的 toastError。
 */
import type { PressProjectSummary } from '@shared/types/press'
import { formatRelativeTime } from '@shared/utils/format'
import { formatWordCount } from '../utils'

/** 数据加载状态：ready 表示已拿到快照，error 表示最近一次拉取失败 */
export type PressStatus = 'loading' | 'ready' | 'error'

/** 作品元信息行：章节数 · 字数 · 最近更新 */
export function formatProjectMeta(project: PressProjectSummary): string {
    return [`${project.chapterCount} 章`, `${formatWordCount(project.wordCount)} 字`, formatRelativeTime(project.mtime)]
        .filter((part) => part.length > 0)
        .join(' · ')
}
