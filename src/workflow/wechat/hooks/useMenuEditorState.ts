/**
 * 菜单编辑坐标机：选中项、编辑目标与新建草稿三态，以及按坐标分发的编辑动作。
 * 复用约定：坐标读取走 menu/utils/menuTree，树变更走 useWechatMenu 传入的方法；
 * 关键约束：索引失效只在渲染时收敛、不回写 state；切换编辑对象由调用方换 key 重挂载。
 */
import { useState } from 'react'
import { WECHAT_MENU_TOP_LIMIT, type WechatMenuButton } from '@shared/types/wechat'
import { applyMenuPatch, createTopButton, type WechatMenuState } from './useWechatMenu'
import { readMenuButton } from '../menu/utils/menuTree'

/** 编辑坐标：subIndex 缺省表示一级菜单，isNew 仅用于新建子菜单 */
export interface MenuEditTarget {
    index: number
    subIndex?: number
    isNew?: boolean
}

export interface MenuEditorSelection {
    activeIndex: number
    editTarget: MenuEditTarget | null
    newDraft: WechatMenuButton | null
    safeIndex: number
    editingButton: WechatMenuButton | undefined
    isEditingTop: boolean
    isEditing: boolean
    dialogKey: string
}

export interface MenuEditorActions {
    selectTop: (index: number) => void
    editTop: (index: number) => void
    editSub: (index: number, subIndex: number) => void
    addTop: () => void
    addSub: (index: number) => void
    change: (patch: Partial<WechatMenuButton>) => void
    remove: () => void
    confirm: () => void
    close: () => void
}

export interface MenuEditorState {
    selection: MenuEditorSelection
    actions: MenuEditorActions
}

type MenuMutations = Pick<
    WechatMenuState,
    'setButton' | 'setSub' | 'removeButton' | 'removeSub' | 'addButtonFrom' | 'addSub'
>

export function useMenuEditorState(buttons: WechatMenuButton[], menu: MenuMutations): MenuEditorState {
    const [activeIndex, setActiveIndex] = useState(0)
    const [editTarget, setEditTarget] = useState<MenuEditTarget | null>(null)
    /** 一级新建草稿：未点「保存更改」前不进入 menu.buttons，手机预览不会立即多出菜单 */
    const [newDraft, setNewDraft] = useState<WechatMenuButton | null>(null)

    // 删除后索引可能越界：按当前长度收敛，不回写 state
    const safeIndex = buttons.length === 0 ? -1 : Math.min(activeIndex, buttons.length - 1)
    const editingButton =
        newDraft ?? (editTarget === null ? undefined : readMenuButton(buttons, editTarget.index, editTarget.subIndex))
    const isEditingTop = newDraft !== null || editTarget?.subIndex === undefined
    const isEditing = newDraft !== null || (editTarget !== null && editingButton !== undefined)
    const editKind = editTarget?.subIndex === undefined ? 'top' : String(editTarget?.subIndex ?? 0)
    const dialogKey = newDraft !== null ? `new-${newDraft.id}-button` : `${String(editTarget?.index ?? 0)}-${editKind}`

    const actions: MenuEditorActions = {
        selectTop: setActiveIndex,
        editTop: (index) => setEditTarget({ index }),
        editSub: (index, subIndex) => setEditTarget({ index, subIndex }),
        addTop: () => {
            if (buttons.length >= WECHAT_MENU_TOP_LIMIT) {
                return
            }
            setNewDraft(createTopButton())
            setEditTarget(null)
        },
        addSub: (index) => {
            const subIndex = menu.addSub(index)
            if (subIndex !== null) {
                setEditTarget({ index, subIndex, isNew: true })
            }
        },
        change: (patch) => {
            if (newDraft !== null) {
                setNewDraft((previous) => (previous === null ? null : applyMenuPatch(previous, patch)))
                return
            }
            if (editTarget === null) {
                return
            }
            if (editTarget.subIndex === undefined) {
                menu.setButton(editTarget.index, patch)
            } else {
                menu.setSub(editTarget.index, editTarget.subIndex, patch)
            }
        },
        remove: () => {
            if (newDraft !== null) {
                setNewDraft(null)
                return
            }
            if (editTarget === null) {
                return
            }
            if (editTarget.subIndex === undefined) {
                menu.removeButton(editTarget.index)
            } else {
                menu.removeSub(editTarget.index, editTarget.subIndex)
            }
            setEditTarget(null)
        },
        confirm: () => {
            if (newDraft !== null) {
                const nextIndex = buttons.length
                menu.addButtonFrom(newDraft)
                setNewDraft(null)
                setActiveIndex(nextIndex)
            }
            setEditTarget(null)
        },
        close: () => {
            setNewDraft(null)
            setEditTarget(null)
        },
    }

    return {
        selection: {
            activeIndex,
            editTarget,
            newDraft,
            safeIndex,
            editingButton,
            isEditingTop,
            isEditing,
            dialogKey,
        },
        actions,
    }
}
