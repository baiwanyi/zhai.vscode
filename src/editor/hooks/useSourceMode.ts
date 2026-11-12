/**
 * 源码模式：把原文全文交给纯文本编辑框，保存时整篇替换 TextDocument。
 * 复用约定：协议走 bridge 的 request，类型取 @shared/types/editor；保存成功后由调用方重载富文本快照。
 * 关键约束：进入前先 flush 未提交的编辑（否则最后 500ms 的输入会被漏掉）；
 * 保存前版本不一致就报 stale 并重新载入，绝不用旧原文覆盖其它编辑器的修改；
 * 退出必须保存成功，失败时留在源码模式，避免用户的改动被静默丢弃。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditorSourceResult, EditorSourceSaveResult } from '@shared/types/editor'
import { request } from '@shared/utils/bridge'

/** 快捷键：与 VSCode 常见「切换视图」习惯一致，Ctrl/Cmd + Shift + M */
const TOGGLE_KEY = 'm'

export interface UseSourceModeResult {
    isSourceMode: boolean
    content: string
    isSaving: boolean
    error: string | null
    enter: () => Promise<void>
    /** 保存并退出：保存失败或 stale 时保持源码模式 */
    exit: () => Promise<void>
    update: (content: string) => void
}

export function useSourceMode(
    path: string,
    onSaved: () => Promise<void>,
    flush: () => Promise<void>,
): UseSourceModeResult {
    const [isSourceMode, setIsSourceMode] = useState(false)
    const [content, setContent] = useState('')
    const [isSaving, setIsSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const versionRef = useRef(0)
    const isDirtyRef = useRef(false)

    const enter = useCallback(async (): Promise<void> => {
        if (path.length === 0) {
            return
        }
        try {
            await flush()
            const result = await request<EditorSourceResult>('editor/source')
            setContent(result.content)
            versionRef.current = result.version
            isDirtyRef.current = false
            setError(null)
            setIsSourceMode(true)
        } catch {
            setError('无法读取原文')
        }
    }, [flush, path])

    const save = useCallback(async (): Promise<boolean> => {
        if (!isDirtyRef.current) {
            return true
        }
        setIsSaving(true)
        try {
            const result = await request<EditorSourceSaveResult>('editor/source/save', {
                path,
                version: versionRef.current,
                content,
            })
            if (result.stale) {
                // 外部已修改：重拉最新原文，本次改动放弃写入（用户可重新编辑）
                await enter()
                setError('文件已被其它编辑器修改，已重新载入')
                return false
            }
            if (!result.saved) {
                setError('保存失败，请改用文本编辑器确认')
                return false
            }
            versionRef.current = result.version
            isDirtyRef.current = false
            await onSaved()
            return true
        } catch {
            setError('保存失败，请改用文本编辑器确认')
            return false
        } finally {
            setIsSaving(false)
        }
    }, [content, enter, onSaved, path])

    const exit = useCallback(async (): Promise<void> => {
        const isOk = await save()
        if (isOk) {
            setIsSourceMode(false)
            setError(null)
        }
    }, [save])

    const update = useCallback((next: string): void => {
        setContent(next)
        isDirtyRef.current = true
    }, [])

    // 快捷键在 webview 内监听：富文本与源码模式都能触发
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent): void => {
            const isTrigger =
                (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === TOGGLE_KEY
            if (!isTrigger) {
                return
            }
            event.preventDefault()
            if (isSourceMode) {
                void exit()
                return
            }
            void enter()
        }
        window.addEventListener('keydown', handleKeyDown)
        return (): void => {
            window.removeEventListener('keydown', handleKeyDown)
        }
    }, [enter, exit, isSourceMode])

    return { isSourceMode, content, isSaving, error, enter, exit, update }
}
