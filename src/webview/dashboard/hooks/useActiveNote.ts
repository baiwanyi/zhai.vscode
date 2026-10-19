/**
 * 活跃笔记同步：列表选中态以编辑器真实焦点为准，而非只记录最后一次点击。
 * 复用 ../../bridge 的请求与状态订阅：挂载时拉一次快照，随后跟随宿主 note 通道广播。
 * 关键约束：选中态由宿主权威下发，页面点击打开时先本地回填再等宿主收敛，避免打开瞬间高亮丢失；
 * 非 note 通道或形态非法的载荷一律忽略，不覆盖已有选中态。
 */
import { useCallback, useEffect, useState } from 'react'
import type { NoteActiveState } from '@shared/types/note'
import { isNoteActiveState } from '@shared/types/note'
import { onState, request } from '../../bridge'

export interface ActiveNoteState {
    activeId: string | null
    setActiveId: (path: string | null) => void
}

export function useActiveNote(): ActiveNoteState {
    const [activeId, setActiveId] = useState<string | null>(null)

    useEffect(() => {
        let isDisposed = false
        const loadActiveNote = async (): Promise<void> => {
            try {
                const snapshot = await request<NoteActiveState>('note/active')
                if (!isDisposed) {
                    setActiveId(snapshot.activePath)
                }
            } catch {
                // 面板刚挂载时宿主可能尚未就绪，失败即保留空选中态，等广播位再回填
            }
        }
        void loadActiveNote()
        const unsubscribe = onState((message) => {
            if (message.channel !== 'note' || !isNoteActiveState(message.payload)) {
                return
            }
            setActiveId(message.payload.activePath)
        })
        return (): void => {
            isDisposed = true
            unsubscribe()
        }
    }, [])

    const updateActiveId = useCallback((path: string | null): void => {
        setActiveId(path)
    }, [])

    return { activeId, setActiveId: updateActiveId }
}
