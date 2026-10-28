/**
 * AI 使用量页常量：模块与时间筛选项、页大小与「全部」占位值。
 * 复用约定：模块与范围的中文标签直接取 shared/types/aiUsage 的映射表，宿主记账与前端展示同源；
 * 「全部」只是筛选控件的占位值，不属于任何数据模块键，回传宿主前必须还原成 null。
 * 关键约束：页大小只提供此处列出的档位，宿主会再次夹紧；新增模块时本文件与宿主记账处需同步。
 */
import { AI_USAGE_MODULE_LABELS, AI_USAGE_RANGE_LABELS } from '@shared/types/aiUsage'
import type { AiUsageModule, AiUsageRange } from '@shared/types/aiUsage'

/** 模块筛选项 */
export interface UsageModuleOption {
    value: AiUsageModule
    label: string
}

/** 时间筛选项 */
export interface UsageRangeOption {
    value: AiUsageRange
    label: string
}

/** 模块下拉：顺序与用量来源的常见程度一致，对话排首位 */
export const MODULE_OPTIONS: readonly UsageModuleOption[] = [
    { value: 'chat', label: AI_USAGE_MODULE_LABELS.chat },
    { value: 'naming', label: AI_USAGE_MODULE_LABELS.naming },
    { value: 'appearance', label: AI_USAGE_MODULE_LABELS.appearance },
    { value: 'setting', label: AI_USAGE_MODULE_LABELS.setting },
    { value: 'semantic', label: AI_USAGE_MODULE_LABELS.semantic },
    { value: 'scene', label: AI_USAGE_MODULE_LABELS.scene },
    { value: 'image', label: AI_USAGE_MODULE_LABELS.image },
    { value: 'proofread', label: AI_USAGE_MODULE_LABELS.proofread },
    { value: 'external', label: AI_USAGE_MODULE_LABELS.external },
]

/** 时间下拉：默认近 7 天，避免首次进入就拉全量 */
export const RANGE_OPTIONS: readonly UsageRangeOption[] = [
    { value: 'today', label: AI_USAGE_RANGE_LABELS.today },
    { value: '7d', label: AI_USAGE_RANGE_LABELS['7d'] },
    { value: '30d', label: AI_USAGE_RANGE_LABELS['30d'] },
    { value: 'all', label: AI_USAGE_RANGE_LABELS.all },
]

/** 筛选控件的「全部模块」占位值 */
export const ALL_MODULES_VALUE = 'all'

/** 默认时间范围 */
export const DEFAULT_RANGE: AiUsageRange = '7d'

/** 页大小：列表默认 20 条，避免一次渲染过多行 */
export const DEFAULT_PAGE_SIZE = 20

/** 静默同步间隔：页面可见时每 30 秒补一次 CLI 积分，离开页面不产生请求 */
export const POLL_INTERVAL_MS = 30_000

/** 模块展示名：表格与弹窗共用 */
export const MODULE_LABELS = AI_USAGE_MODULE_LABELS
