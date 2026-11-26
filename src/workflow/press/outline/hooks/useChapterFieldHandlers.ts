/**
 * 章纲字段交互：把钩子与节奏下拉归一成章纲补丁，统一经 onChange 回传。
 * 复用约定：取值前用 constants 的选项表校验，与 useChapterSceneHandlers 共用同一份补丁回传契约。
 * 关键约束：非法枚举值不产生补丁；人物勾选由 press/layout/CharacterSelectField 统一处理；
 * 目标字数由作品设定统一管理，不在此处改写。
 */
import { useCallback } from 'react'
import type { OutlineChapter } from '../../types'
import { HOOK_OPTIONS, PACING_KIND_ORDER } from '../../constants'

export interface ChapterFieldHandlers {
    handleHookChange: (value: string) => void
    handlePacingChange: (value: string) => void
}

/** 字段 handler 集合：只依赖补丁回调，不含本地状态 */
export function useChapterFieldHandlers(
    onChange: (patch: Partial<OutlineChapter>) => void,
): ChapterFieldHandlers {
    const handleHookChange = useCallback(
        (value: string): void => {
            const next = HOOK_OPTIONS.find((option) => option.value === value)?.value
            if (next !== undefined) {
                onChange({ hook: next })
            }
        },
        [onChange],
    )

    const handlePacingChange = useCallback(
        (value: string): void => {
            const next = PACING_KIND_ORDER.find((kind) => kind === value)
            if (next !== undefined) {
                onChange({ pacing: next })
            }
        },
        [onChange],
    )

    return { handleHookChange, handlePacingChange }
}
