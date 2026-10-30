/**
 * 活跃笔记上下文：定义共享选中态的 Context 与读取 hook，Provider 与各页面都从这里取。
 * 与 Provider 拆成两个文件，使各自只导出一种成员（非组件 / 组件），避免 fast refresh 失效。
 * 关键约束：Context 缺省值为 null，Provider 缺位时 useActiveNote 显式抛错而不静默回退——
 * 静默新建一份状态会让同一页出现两个选中态事实源，页面回填与路由归属就此分叉。
 */
import { createContext, use } from 'react'

export interface ActiveNoteState {
    activeId: string | null
    /** 是否存在文本编辑器：false 时表示焦点不在编辑器，归属判定应保持当前页而不是回首页 */
    hasEditor: boolean
    setActiveId: (path: string | null) => void
}

/** 共享活跃笔记状态：只由 ActiveNoteProvider 提供，消费方一律走 useActiveNote */
export const ActiveNoteContext = createContext<ActiveNoteState | null>(null)

/** 读取共享活跃笔记状态：必须在 ActiveNoteProvider 内使用 */
export function useActiveNote(): ActiveNoteState {
    const state = use(ActiveNoteContext)
    if (state === null) {
        throw new Error('useActiveNote 必须在 ActiveNoteProvider 内使用')
    }
    return state
}
