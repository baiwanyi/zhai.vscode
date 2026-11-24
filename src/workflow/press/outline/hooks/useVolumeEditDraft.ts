/**
 * 卷纲编辑草稿 Hook：持有六个字段的局部草稿，并内聚 AI 生成的并发、改动与卸载三重保护。
 * 复用约定：AI 传输交给 useVolumeFieldGenerate，草稿归一交给 outline/utils/volumeEditDraft；
 * 生成结果未覆盖时经 onNotice 上报，Hook 自身不依赖具体提示渠道。
 * 关键约束：同一时刻只跑一项生成，生成期间用户改过该字段则结果不覆盖；卸载后的结果不再写回；
 * 调用方须用「卷 id + 打开状态」绑定组件 key，草稿才不会串到上一卷或上一次编辑。
 */
import { useEffect, useRef, useState } from 'react'
import type { VolumeFieldKey } from '@shared/types/press'
import { useVolumeFieldGenerate } from './useVolumeFieldGenerate'
import type { CharacterCard, OutlineVolume, ProjectSetting } from '../../types'
import type { EditablePlotItem, VolumeEditDraft } from '../utils/volumeEditDraft'
import { createVolumeEditPatch, toEditableItems, toTextList } from '../utils/volumeEditDraft'

export interface VolumeEditDraftOptions {
    volume: OutlineVolume | null
    setting: ProjectSetting
    characters: readonly CharacterCard[]
    /** 生成结果因用户已改动而未覆盖时的提示，由调用方决定呈现渠道 */
    onNotice: (message: string) => void
}

export interface VolumeEditDraftState {
    draft: VolumeEditDraft
    setName: (value: string) => void
    setExpectedChapters: (value: string) => void
    setCoreEvent: (value: string) => void
    setMainPlot: (value: EditablePlotItem[]) => void
    setTurningPoints: (value: EditablePlotItem[]) => void
    setResult: (value: string) => void
    generatingField: VolumeFieldKey | null
    isGenerating: boolean
    generate: (field: VolumeFieldKey) => Promise<void>
    /** 归一出保存补丁；没有卷时返回 null，由调用方决定如何提示 */
    buildPatch: () => Partial<OutlineVolume> | null
}

export function useVolumeEditDraft({
    volume,
    setting,
    characters,
    onNotice,
}: VolumeEditDraftOptions): VolumeEditDraftState {
    const [name, setName] = useState(volume?.name ?? '')
    const [expectedChapters, setExpectedChapters] = useState(
        volume !== null && volume.expectedChapters > 0 ? String(volume.expectedChapters) : '',
    )
    const [coreEvent, setCoreEventState] = useState(volume?.coreEvent ?? '')
    const [mainPlot, setMainPlot] = useState<EditablePlotItem[]>(() => toEditableItems(volume?.mainPlot ?? []))
    const [turningPoints, setTurningPoints] = useState<EditablePlotItem[]>(() =>
        toEditableItems(volume?.turningPoints ?? []),
    )
    const [result, setResultState] = useState(volume?.result ?? '')

    const { generatingField, generate: generateField } = useVolumeFieldGenerate()
    const isGenerating = generatingField !== null
    /** 弹窗关闭后 AI 结果即使返回也不再写回已卸载的草稿状态 */
    const isMountedRef = useRef(true)
    useEffect(() => {
        isMountedRef.current = true
        return (): void => {
            isMountedRef.current = false
        }
    }, [])
    /** 生成期间该字段是否被手动改过：改过就不让 AI 结果覆盖，避免吞掉用户输入 */
    const wasEditedDuringGenerateRef = useRef(false)

    const setCoreEvent = (value: string): void => {
        if (generatingField === 'coreEvent') {
            wasEditedDuringGenerateRef.current = true
        }
        setCoreEventState(value)
    }

    const setResult = (value: string): void => {
        if (generatingField === 'result') {
            wasEditedDuringGenerateRef.current = true
        }
        setResultState(value)
    }

    /** 单字段生成：草稿整段作为上下文，结果按字段写回；生成期间的手动改动优先 */
    const generate = async (field: VolumeFieldKey): Promise<void> => {
        if (volume === null) {
            return
        }
        wasEditedDuringGenerateRef.current = false
        const content = await generateField({
            field,
            volume,
            draft: { coreEvent, mainPlot: toTextList(mainPlot), turningPoints: toTextList(turningPoints), result },
            setting,
            characters,
        })
        if (content === null || !isMountedRef.current) {
            return
        }
        if (wasEditedDuringGenerateRef.current) {
            onNotice('AI 内容已生成，但你在等待期间修改了这个字段，已保留手写内容')
            return
        }
        // 写回走原始 setter：此时 generatingField 的旧闭包仍指向本字段，经包装函数会被误记为手动改动
        if (field === 'coreEvent') {
            setCoreEventState(content)
            return
        }
        setResultState(content)
    }

    const buildPatch = (): Partial<OutlineVolume> | null =>
        volume === null
            ? null
            : createVolumeEditPatch(volume, { name, expectedChapters, coreEvent, mainPlot, turningPoints, result })

    return {
        draft: { name, expectedChapters, coreEvent, mainPlot, turningPoints, result },
        setName,
        setExpectedChapters,
        setCoreEvent,
        setMainPlot,
        setTurningPoints,
        setResult,
        generatingField,
        isGenerating,
        generate,
        buildPatch,
    }
}
