/**
 * 词库控制：读取词库状态与内容、打开编辑弹窗、保存词库，并提供「在编辑器中打开 JSON」的次要入口。
 * 复用约定：请求走 @shared/utils/bridge，错误经 sonner 提示；保存成功后由调用方决定是否重跑校对。
 * 关键约束：弹窗打开时才拉取完整词库，避免页面首屏为一个低频功能多付一次请求；
 * 保存失败不关闭弹窗，用户编辑内容不会因网络或校验失败而丢失。
 */
import { useCallback, useEffect, useState } from 'react'
import type { ProofreadLexicon, ProofreadLexiconEntry, ProofreadLexiconState } from '@shared/types/proofread'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

/** 打开词库文件的等待上限：需要创建目录与文件，比普通请求放宽 */
const OPEN_TIMEOUT_MS = 15_000

/** 保存请求的等待上限：写入走临时文件 + rename，通常很快 */
const SAVE_TIMEOUT_MS = 15_000

export interface ProofreadLexiconInput {
    entries: ProofreadLexiconEntry[]
    ignores: string[]
}

export interface ProofreadLexiconController {
    /** 入口旁的一行摘要 */
    label: string
    isOpen: boolean
    isSaving: boolean
    /** 弹窗编辑用的完整词库：未加载完成时为空库 */
    lexicon: ProofreadLexicon | null
    /** 每次打开自增：弹窗以它作 key 重建草稿，避免用 effect 回写本地编辑状态 */
    sessionKey: number
    openDialog: () => Promise<void>
    closeDialog: () => void
    /** 保存成功返回 true，失败返回 false（弹窗保持打开） */
    save: (input: ProofreadLexiconInput) => Promise<boolean>
    /** 在编辑器中直接打开 JSON 文件 */
    openFile: () => Promise<void>
}

/** 摘要文案：未创建、空词库与已有词条三种口径 */
function readLabel(state: ProofreadLexiconState | null): string {
    if (state === null) {
        return '词库读取中…'
    }
    if (!state.exists) {
        return '尚未创建词库'
    }
    if (state.entries === 0) {
        return '词库为空'
    }
    return `${String(state.entries)} 条词条 · ${String(state.ignores)} 个忽略词`
}

export function useProofreadLexicon(): ProofreadLexiconController {
    const [state, setState] = useState<ProofreadLexiconState | null>(null)
    const [lexicon, setLexicon] = useState<ProofreadLexicon | null>(null)
    const [isOpen, setIsOpen] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const [sessionKey, setSessionKey] = useState(0)

    useEffect(() => {
        let isCancelled = false
        const load = async (): Promise<void> => {
            try {
                const result = await request<ProofreadLexiconState>('proofread/lexicon')
                if (!isCancelled) {
                    setState(result)
                }
            } catch (cause) {
                if (!isCancelled) {
                    toastError(cause)
                }
            }
        }
        void load()
        return (): void => {
            isCancelled = true
        }
    }, [])

    const openDialog = useCallback(async (): Promise<void> => {
        try {
            const content = await request<ProofreadLexicon>('proofread/lexicon/read')
            setLexicon(content)
            setSessionKey((current) => current + 1)
            setIsOpen(true)
        } catch (cause) {
            toastError(cause)
        }
    }, [])

    const closeDialog = useCallback((): void => {
        setIsOpen(false)
    }, [])

    const save = useCallback(async (input: ProofreadLexiconInput): Promise<boolean> => {
        setIsSaving(true)
        try {
            const next = await request<ProofreadLexiconState>(
                'proofread/lexicon/save',
                { entries: input.entries, ignores: input.ignores },
                SAVE_TIMEOUT_MS,
            )
            setState(next)
            setLexicon({ version: 1, entries: input.entries, ignores: input.ignores })
            setIsOpen(false)
            return true
        } catch (cause) {
            toastError(cause)
            return false
        } finally {
            setIsSaving(false)
        }
    }, [])

    const openFile = useCallback(async (): Promise<void> => {
        try {
            const result = await request<ProofreadLexiconState>('proofread/lexicon/open', undefined, OPEN_TIMEOUT_MS)
            setState(result)
        } catch (cause) {
            toastError(cause)
        }
    }, [])

    return {
        label: readLabel(state),
        isOpen,
        isSaving,
        lexicon,
        sessionKey,
        openDialog,
        closeDialog,
        save,
        openFile,
    }
}
