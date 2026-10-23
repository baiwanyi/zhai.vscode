/**
 * 素材抽取：请宿主扫描作品章节，重写 Materials/ 下的章节清单、首尾摘录、人名候选与金手指候选章。
 * 复用约定：请求经 webview 公共 bridge，提示统一经 sonner，过程与结果共用同一条 toast id。
 * 关键约束：抽取是本地统计、不调用模型，所以没有进度广播、也不依赖 AI 登录态；
 * 覆盖写入是预期行为，重复抽取得到最新结果。
 */
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import type { PressAnalyzeResult } from '@shared/types/press'
import { request } from '../../../bridge'

/** 过程提示的固定 toast id：同一轮抽取始终更新同一条提示 */
const ANALYZE_TOAST_ID = 'press-analyze'

/** 请求超时：要遍历全部章节并统计人名，长作品需要数十秒 */
const ANALYZE_TIMEOUT_MS = 180_000

export interface PressAnalyzeState {
    isAnalyzing: boolean
    /** 发起抽取：成功返回统计结果，失败返回 null（原因经 sonner 提示） */
    analyze: () => Promise<PressAnalyzeResult | null>
}

export function usePressAnalyze(dirPath: string): PressAnalyzeState {
    const [isAnalyzing, setIsAnalyzing] = useState(false)

    const analyze = useCallback(async (): Promise<PressAnalyzeResult | null> => {
        setIsAnalyzing(true)
        toast.loading('正在抽取素材…', { id: ANALYZE_TOAST_ID })
        try {
            const result = await request<PressAnalyzeResult>('press/analyze', { dirPath }, ANALYZE_TIMEOUT_MS)
            toast.success(
                `素材已更新：${String(result.chapterCount)} 章 · 候选角色 ${String(result.characterCount)} 个 · 金手指线索 ${String(result.goldenFingerHits)} 章 · 设定线索 ${String(result.settingClueCount)} 章`,
                { id: ANALYZE_TOAST_ID },
            )
            return result
        } catch (cause) {
            toast.error(cause instanceof Error ? cause.message : String(cause), { id: ANALYZE_TOAST_ID })
            return null
        } finally {
            setIsAnalyzing(false)
        }
    }, [dirPath])

    return { isAnalyzing, analyze }
}
