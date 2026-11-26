/**
 * 章纲计划梗概生成：把当前章的章纲卡、本卷卷纲、全书结构与本章伏笔交给宿主 pressAi/aiChapterSummary，
 * 只补「计划梗概」一项，正文事实摘要不进请求。
 * 复用约定：请求经 @shared/utils/bridge，前端超时略大于宿主侧 45s，保证宿主先给出超时错误；
 * 设定快照、结构阶段与章显示名复用 press/utils，钩子与节奏标签取 press/constants。
 * 关键约束：同一时刻只允许一项生成，连点由 ref 拦住；对话框关闭（卸载）时走 abort 接口尽力收口；
 * 生成结果不直接落库，由调用方写回章纲补丁；失败原因统一经 sonner 提示。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChapterSummaryGenerateRequest, ChapterSummaryGenerateResult } from '@shared/types/press'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import type {
    CharacterCard,
    OutlineChapter,
    OutlineChapterRef,
    OutlinePlan,
    OutlineVolume,
    ProjectSetting,
} from '../../types'
import { HOOK_OPTIONS, PACING_META } from '../../constants'
import {
    findCluesByChapterRef,
    sceneTitleLabel,
    stripChapterOrderPrefix,
    toOutlineActContexts,
    toSettingSnapshot,
} from '../../utils'

/** AI 通道前端超时：略大于宿主 45s，避免前端先于宿主超时 */
const AI_REQUEST_TIMEOUT_MS = 60_000

/** 生成参数：本章与所属卷、工作区上下文由调用方按当前选中章传入 */
export interface ChapterSummaryGenerateOptions {
    chapter: OutlineChapter
    volume: OutlineVolume
    chapterRef: OutlineChapterRef
    setting: ProjectSetting
    characters: readonly CharacterCard[]
    plan: OutlinePlan
    prevChapter: OutlineChapter | null
}

export interface ChapterSummaryGenerateState {
    isGenerating: boolean
    /** 生成成功返回正文，失败或取消返回 null（原因已提示） */
    generate: (options: ChapterSummaryGenerateOptions) => Promise<string | null>
}

export function useChapterSummaryGenerate(): ChapterSummaryGenerateState {
    const [isGenerating, setIsGenerating] = useState(false)
    /** 同步标记：setState 生效前的连点会被这里拦住 */
    const busyRef = useRef(false)

    const generate = useCallback(async (options: ChapterSummaryGenerateOptions): Promise<string | null> => {
        if (busyRef.current) {
            return null
        }
        busyRef.current = true
        setIsGenerating(true)
        try {
            const result = await request<ChapterSummaryGenerateResult>(
                'pressAi/aiChapterSummary',
                buildPayload(options),
                AI_REQUEST_TIMEOUT_MS,
            )
            return result.content
        } catch (cause) {
            toastError(cause)
            return null
        } finally {
            busyRef.current = false
            setIsGenerating(false)
        }
    }, [])

    const abort = useCallback(async (): Promise<void> => {
        try {
            await request('pressAi/aiChapterSummary/abort')
        } catch {
            // 取消属于尽力而为：宿主没有在途请求或已结束时忽略错误
        }
    }, [])

    // 对话框卸载（关闭）时取消在途请求，避免结果无人接收却仍消耗配额
    useEffect((): (() => void) => {
        return (): void => {
            void abort()
        }
    }, [abort])

    return { isGenerating, generate }
}

/** 场景概括：标题加三要素，空字段不写占位，按落笔顺序给模型看 */
function buildSceneLines(options: ChapterSummaryGenerateOptions): string[] {
    return options.chapter.scenes.map((scene) => {
        const parts = [scene.desire, scene.obstacle, scene.choice, scene.result, scene.emotion]
            .map((value) => value.trim())
            .filter((value) => value.length > 0)
        const detail = parts.join('；')
        return detail.length > 0 ? `${sceneTitleLabel(scene)}：${detail}` : sceneTitleLabel(scene)
    })
}

/** 请求载荷：章纲卡与卷纲按原文送入，设定与结构只挑约束相关的部分 */
function buildPayload(options: ChapterSummaryGenerateOptions): ChapterSummaryGenerateRequest {
    const { chapter, volume, chapterRef, setting, characters, plan, prevChapter } = options
    const cast = characters.filter((character) => chapter.characterIds.includes(character.id))
    const clues = findCluesByChapterRef(plan.clues, chapterRef)
    const formatRef = (ref: { volumeOrder: number; chapterOrder: number } | null): string =>
        ref === null ? '' : `${String(ref.volumeOrder)}-${String(ref.chapterOrder)}`
    return {
        chapterTitle: stripChapterOrderPrefix(chapter.title),
        volumeName: volume.name,
        stage: chapter.stage,
        pov: chapter.pov,
        goal: chapter.goal,
        obstacle: chapter.obstacle,
        turn: chapter.turn,
        result: chapter.result,
        emotion: chapter.emotion,
        hook: HOOK_OPTIONS.find((option) => option.value === chapter.hook)?.label ?? '无',
        pacing: PACING_META[chapter.pacing].label,
        summary: chapter.summary,
        beats: chapter.beats.map((beat) => beat.text),
        scenes: buildSceneLines(options),
        characters: cast.map((character) => character.name),
        coreEvent: volume.coreEvent,
        mainPlot: [...volume.mainPlot],
        acts: toOutlineActContexts(plan.acts),
        clues: clues.map((clue) => ({
            id: clue.id,
            name: clue.name,
            plant: formatRef(clue.plant),
            payoff: formatRef(clue.payoff),
            note: clue.note,
        })),
        prevSummary: prevChapter?.summary ?? '',
        setting: toSettingSnapshot(setting),
    }
}
