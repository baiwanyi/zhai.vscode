/**
 * 取名页工具：选项查表、随机抽样与错误文案归一化。
 * 复用约定：只做展示层的数据整理，不复制宿主词库；抽样基于宿主下发的后缀 / 姓氏样本。
 * 关键约束：所有查表函数在缺失数据时返回空值而非抛错，避免分类扩展期界面崩溃。
 */
import type {
    NamingCandidate,
    NamingCatalog,
    NamingCategory,
    NamingCategoryMeta,
    NamingSurnameKind,
} from '@shared/types/naming'

/** 数组等概率抽样；空数组返回 null */
export function pickRandom<T>(items: readonly T[]): T | null {
    if (items.length === 0) {
        return null
    }
    return items[Math.floor(Math.random() * items.length)] ?? null
}

/** 取分类元信息 */
export function readCategoryMeta(catalog: NamingCatalog, category: NamingCategory): NamingCategoryMeta | null {
    return catalog.categories.find((item) => item.value === category) ?? null
}

/** 取后缀候选：键为 `${category}:${variant}` */
export function readSuffixSamples(
    catalog: NamingCatalog,
    category: NamingCategory,
    variant: string,
): readonly string[] {
    return catalog.suffixSamples[`${category}:${variant}`] ?? []
}

/** 取姓氏候选：单姓 / 复姓 */
export function readSurnameSamples(catalog: NamingCatalog, kind: NamingSurnameKind): readonly string[] {
    return kind === 'compound' ? catalog.surnameSamples.compound : catalog.surnameSamples.single
}

/** 错误文案归一化 */
export function toErrorText(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause)
}

/** 复制名字：写剪贴板，失败返回 false 由调用方提示 */
export async function copyName(name: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(name)
        return true
    } catch {
        return false
    }
}

/** 结果名字列表转纯文本（供整批复制） */
export function joinNames(items: readonly NamingCandidate[]): string {
    return items.map((item) => item.name).join('\n')
}
