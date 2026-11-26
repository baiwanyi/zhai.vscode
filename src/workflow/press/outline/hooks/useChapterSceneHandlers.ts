/**
 * 章纲场景交互：新增、局部改字段与删除场景，统一回传章纲补丁。
 * 复用约定：与 useChapterFieldHandlers 共用 chapter/onChange 契约；新场景用 press/utils 的 createScene 创建。
 * 关键约束：序号取现有场景的最大有限 order 加一，单个坏数据不污染后续序号；
 * 数组一律不可变更新，场景缺失时不误伤其他场景。
 */
import { useCallback } from 'react'
import type { OutlineChapter, OutlineScene } from '../../types'
import { createScene } from '../../utils'

export interface ChapterSceneHandlers {
    handleAddScene: () => void
    handleScenePatch: (sceneId: string, patch: Partial<OutlineScene>) => void
    handleRemoveScene: (sceneId: string) => void
}

/** 场景 handler 集合：只依赖当前场景列表与补丁回调，不含本地状态 */
export function useChapterSceneHandlers(
    scenes: readonly OutlineScene[],
    onChange: (patch: Partial<OutlineChapter>) => void,
): ChapterSceneHandlers {
    const handleAddScene = useCallback((): void => {
        const maxOrder = scenes.reduce(
            (max, scene) => (Number.isFinite(scene.order) ? Math.max(max, scene.order) : max),
            0,
        )
        onChange({ scenes: [...scenes, createScene(Math.max(0, maxOrder) + 1)] })
    }, [scenes, onChange])

    const handleScenePatch = useCallback(
        (sceneId: string, patch: Partial<OutlineScene>): void => {
            onChange({
                scenes: scenes.map((scene) => (scene.id === sceneId ? { ...scene, ...patch } : scene)),
            })
        },
        [scenes, onChange],
    )

    const handleRemoveScene = useCallback(
        (sceneId: string): void => {
            onChange({ scenes: scenes.filter((scene) => scene.id !== sceneId) })
        },
        [scenes, onChange],
    )

    return { handleAddScene, handleScenePatch, handleRemoveScene }
}
