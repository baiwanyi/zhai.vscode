/**
 * 活跃笔记 Provider：仪表盘外壳挂一次，概览页的列表选中态与路由跟随的归属判定共享同一份。
 * 复用 @shared/utils/bridge 的请求与状态订阅：挂载时拉一次快照，随后跟随宿主 note 通道广播。
 * 关键约束：选中态由宿主权威下发，页面点击打开时先经本层回填再等宿主收敛，避免打开瞬间高亮丢失；
 * 非 note 通道或形态非法的载荷一律忽略，不覆盖已有选中态；广播优先于初始快照，
 * 收到广播后丢弃后到的快照，防止旧值把新选中态盖回去；请求与订阅只在本层发起一次，
 * 消费方一律走 useActiveNote 读取，避免重复打开通道与多份状态分叉；
 * hasEditor 只跟宿主动事实走，本地回填不改它，否则「焦点在面板上」会被误判成编辑器里有文档；
 * 未复用 useHostChannelState：本层还要对外暴露 setActiveId 做本地乐观覆盖，
 * 即在宿主权威态上叠加写入口，通用 Hook 只承载只读镜像，套用会让选中态出现两个事实源。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NoteActiveState } from '@shared/types/note'
import { isNoteActiveState } from '@shared/types/note'
import { onState, request } from '@shared/utils/bridge'
import { ActiveNoteContext, type ActiveNoteState } from './useActiveNote'
import type { JSX, ReactNode } from 'react'

interface ActiveNoteProviderProps {
    children: ReactNode
}

export function ActiveNoteProvider({ children }: ActiveNoteProviderProps): JSX.Element {
    const [activeId, setActiveId] = useState<string | null>(null)
    const [hasEditor, setHasEditor] = useState(false)
    const [isReady, setIsReady] = useState(false)
    /** 是否已收到广播：广播一定比初始快照新，收到后丢弃后到的快照，避免旧值把新选中态盖回去 */
    const hasBroadcastRef = useRef(false)

    useEffect(() => {
        let isDisposed = false
        hasBroadcastRef.current = false
        const applySnapshot = (snapshot: NoteActiveState): void => {
            setActiveId(snapshot.activePath)
            setHasEditor(snapshot.hasEditor)
            setIsReady(true)
        }
        const loadActiveNote = async (): Promise<void> => {
            try {
                const snapshot = await request<NoteActiveState>('note/active')
                if (!isDisposed && !hasBroadcastRef.current) {
                    applySnapshot(snapshot)
                }
            } catch {
                // 面板刚挂载时宿主可能尚未就绪，失败即保留空选中态，等广播位再回填；
                // 就绪态仍要置位，否则宿主不响应时仪表盘的归属骨架永远撤不掉
                if (!isDisposed) {
                    setIsReady(true)
                }
            }
        }
        void loadActiveNote()
        const unsubscribe = onState((message) => {
            if (message.channel !== 'note' || !isNoteActiveState(message.payload)) {
                return
            }
            hasBroadcastRef.current = true
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

    /** 上下文值按字段缓存：Provider 因父级重渲染而重绘时不连带所有消费方一起更新 */
    const contextValue = useMemo<ActiveNoteState>(
        () => ({ activeId, hasEditor, isReady, setActiveId: updateActiveId }),
        [activeId, hasEditor, isReady, updateActiveId],
    )

    return <ActiveNoteContext value={contextValue}>{children}</ActiveNoteContext>
}
