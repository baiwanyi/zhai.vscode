/**
 * 活跃笔记 Provider：仪表盘外壳挂一次，概览页的列表选中态与路由跟随的归属判定共享同一份。
 * 复用 @shared/utils/bridge 的请求与状态订阅：挂载时拉一次快照，随后跟随宿主 note 通道广播。
 * 关键约束：选中态由宿主权威下发，页面点击打开时先经本层回填再等宿主收敛，避免打开瞬间高亮丢失；
 * 非 note 通道或形态非法的载荷一律忽略，不覆盖已有选中态；请求与订阅只在本层发起一次，
 * 消费方一律走 useActiveNote 读取，避免重复打开通道与多份状态分叉；
 * hasEditor 只跟宿主动事实走，本地回填不改它，否则「焦点在面板上」会被误判成编辑器里有文档。
 */
import { useCallback, useEffect, useState } from 'react'
import type { NoteActiveState } from '@shared/types/note'
import { isNoteActiveState } from '@shared/types/note'
import { onState, request } from '@shared/utils/bridge'
import { ActiveNoteContext } from './useActiveNote'
import type { JSX, ReactNode } from 'react'

interface ActiveNoteProviderProps {
    children: ReactNode
}

export function ActiveNoteProvider({ children }: ActiveNoteProviderProps): JSX.Element {
    const [activeId, setActiveId] = useState<string | null>(null)
    const [hasEditor, setHasEditor] = useState(false)

    useEffect(() => {
        let isDisposed = false
        const applySnapshot = (snapshot: NoteActiveState): void => {
            setActiveId(snapshot.activePath)
            setHasEditor(snapshot.hasEditor)
        }
        const loadActiveNote = async (): Promise<void> => {
            try {
                const snapshot = await request<NoteActiveState>('note/active')
                if (!isDisposed) {
                    applySnapshot(snapshot)
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
            applySnapshot(message.payload)
        })
        return (): void => {
            isDisposed = true
            unsubscribe()
        }
    }, [])

    const updateActiveId = useCallback((path: string | null): void => {
        setActiveId(path)
    }, [])

    return (
        <ActiveNoteContext value={{ activeId, hasEditor, setActiveId: updateActiveId }}>{children}</ActiveNoteContext>
    )
}
