/**
 * 菜单编辑草稿：名称与内容双 state，输入即时写回父级 patch，切换编辑对象由调用方换 key 重挂载。
 * 复用约定：内容转平台字段走 menu/utils/menuContent，目录判定走 menu/utils/menuTree；
 * 关键约束：目录只更新本地内容草稿、不写回下发字段；初始化只在挂载时取一次快照。
 */
import { useState } from 'react'
import type { WechatMenuButton, WechatMenuContent } from '@shared/types/wechat'
import { createMenuContent, toMenuPlatformPatch } from '../menu/utils/menuContent'
import { isMenuGroup } from '../menu/utils/menuTree'

export interface MenuEditDraft {
    draftName: string
    draftContent: WechatMenuContent
    handleNameChange: (value: string) => void
    handleContentChange: (content: WechatMenuContent) => void
}

export function useMenuEditDraft(
    button: WechatMenuButton,
    onChange: (patch: Partial<WechatMenuButton>) => void,
): MenuEditDraft {
    const [draftName, setDraftName] = useState(() => button.name)
    const [draftContent, setDraftContent] = useState<WechatMenuContent>(
        () => button.content ?? createMenuContent('image'),
    )
    const isGroup = isMenuGroup(button)

    const handleNameChange = (value: string): void => {
        setDraftName(value)
        onChange({ name: value })
    }

    const handleContentChange = (content: WechatMenuContent): void => {
        setDraftContent(content)
        if (isGroup) {
            return
        }
        onChange({ ...toMenuPlatformPatch(content), content })
    }

    return { draftName, draftContent, handleNameChange, handleContentChange }
}
