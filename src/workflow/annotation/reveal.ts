/**
 * 跳转结果判定：把宿主回执折算成「提示条文案 / 追加 toast / 是否刷新统计」三件事。
 * 复用约定：入参只声明判定需要的最小结构，不反向依赖 hooks 模块；文案集中在此，页面只负责应用。
 * 关键约束：missing-file 表示原文缺失且宿主已把整篇置失效，必须刷新页头统计；
 * 其余未揭示原因一律按「记录已不存在」处理，避免把未知原因说成文件缺失；
 * 跳转成功但定位失效（orphaned）才提示「原文已修改」，正常跳转必须清空旧提示。
 */

/** 宿主回执中判定所需的最小字段：与 RevealOutcome 结构兼容，避免纯函数依赖 hook 模块 */
export interface RevealOutcomeLike {
    revealed: boolean
    reason?: string
    orphaned?: boolean
}

/** 文案：跳转失败与成功定位不到时的提示 */
const NOTICE_MISSING_FILE = '原文不可用，无法跳转；该文档的标注已标记为失效'
const NOTICE_ORPHANED = '原文已修改，无法精确定位；已打开文档供你手动查找'
const NOTICE_NOT_FOUND = '这条标注已不存在'

/** 宿主判定「原文缺失」的原因值：出现即意味着整篇标注已被置失效 */
const REASON_MISSING_FILE = 'missing-file'

export interface RevealResolution {
    /** 顶部提示条文案：null 表示清空 */
    notice: string | null
    /** 需要额外 toast 的文案（列表滚动后顶部提示不可见）：null 表示不弹 */
    toastText: string | null
    /** 是否需要刷新页头统计：宿主刚把整篇置失效，失效数要跟着变 */
    shouldRefreshStats: boolean
}

export function resolveRevealOutcome(outcome: RevealOutcomeLike): RevealResolution {
    if (!outcome.revealed) {
        const isMissingFile = outcome.reason === REASON_MISSING_FILE
        const message = isMissingFile ? NOTICE_MISSING_FILE : NOTICE_NOT_FOUND
        // 列表可能已滚到中间，顶部提示条看不见：跳转失败一律再补一条 toast
        return { notice: message, toastText: message, shouldRefreshStats: isMissingFile }
    }

    return {
        notice: outcome.orphaned === true ? NOTICE_ORPHANED : null,
        toastText: null,
        shouldRefreshStats: false,
    }
}
