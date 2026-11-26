/**
 * 章纲编辑面板的字段纯函数：正文字数进度与阶段下拉选项的装配。
 * 复用约定：阶段名取结构纲 acts 与本章已有值，按文档口径去空去重；不持有状态、不触碰写盘。
 * 关键约束：wordCount 先收窄为非负有限数再参与除法，避免解析异常时进度条显示 NaN；
 * 空串阶段不进下拉，保留历史自定义阶段以免切换后显示空白。
 */
export interface ChapterProgress {
    /** 收窄后的正文字数，供展示与进度共用同一口径 */
    writtenWords: number
    /** 0-100 的进度百分比 */
    progress: number
}

/** 正文字数与目标字数的进度：目标非正时进度归零 */
export function computeChapterProgress(wordCount: number, wordGoal: number): ChapterProgress {
    const writtenWords = Number.isFinite(wordCount) ? Math.max(0, wordCount) : 0
    const progress = wordGoal > 0 ? Math.min(100, Math.round((writtenWords / wordGoal) * 100)) : 0
    return { writtenWords, progress }
}

/** 阶段选项：结构纲阶段名 + 本章自定义值，去空去重 */
export function buildStageOptions(stageNames: readonly string[], currentStage: string): string[] {
    return [...new Set([...stageNames, currentStage])].filter((name) => name.length > 0)
}
