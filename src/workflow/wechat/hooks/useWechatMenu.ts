/**
 * 自定义菜单数据与编辑操作：读取本地草稿或平台初始结构、在内存里编辑、防抖存草稿并可发布到平台。
 * 复用约定：读取走 wechat/menu/get，草稿走 wechat/menu/saveDraft，发布走 wechat/menu/save；结构上限与内容类型取 shared/types/wechat，
 * 与宿主侧 readWechatMenuButtons 共用同一份限制，界面不另写一套数字。
 * 关键约束：编辑态只存在于本 hook（页面是纯展示），避免「页面存一份、hook 存一份」的漂移；
 * 每次变更防抖写入本地草稿，重启后直接恢复且不依赖平台 Token；只有点「发布」才同步公众号；
 * 形态由有无 subButton 自动判定，叶子转目录保留原内容，二级删空后原样恢复，平台同步忽略目录内容；
 * 一级与二级的增删都在这里做边界收敛（≤3、≤5），按钮组不自行判断；
 * 三种动作的下发字段与本地内容同源，切换动作时清理旧字段；发布前交给宿主统一校验并给出整段提示。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
    WECHAT_MENU_TOP_LIMIT,
    type WechatMenuButton,
    type WechatMenuContent,
    type WechatMenuRequest,
    type WechatMenuResult,
    type WechatMenuSaveRequest,
    type WechatMenuSaveResult,
    type WechatMenuType,
} from '@shared/types/wechat'
import { WECHAT_METHODS } from '@shared/types/wechatMethods'
import { request } from '@shared/utils/bridge'
import { toErrorText, toastError } from '@shared/utils/error'
import { useDebouncedCallback } from '@webview/hooks/useDebouncedCallback'
import { canAddSubMenu } from '../menu/utils/menuTree'

/** 默认图片内容：新建后留空，由用户在弹窗内选择素材 */
function createDefaultContent(): WechatMenuContent {
    return { kind: 'image', materialId: '', mediaId: '', url: '' }
}

/** 新建一级的默认形态：带稳定 id 与空图片内容，供草稿与 hook 共用 */
export function createTopButton(): WechatMenuButton {
    return { id: crypto.randomUUID(), name: '新菜单', type: 'media_id', content: createDefaultContent() }
}

/** 叶子转目录时补的默认二级：同样带独立 id，供添加子菜单共用 */
export function createSubButton(): WechatMenuButton {
    return { id: crypto.randomUUID(), name: '子菜单', type: 'media_id', content: createDefaultContent() }
}

/**
 * 应用补丁：切换动作类型时只清掉调用方没有同时提供的旧下发字段；
 * 内容变化时由对话框同时提供对应的下发字段，避免界面内容与平台下发脱节。
 */
export function applyMenuPatch(button: WechatMenuButton, patch: Partial<WechatMenuButton>): WechatMenuButton {
    const next = { ...button, ...patch }
    if (patch.type !== undefined && patch.type !== button.type) {
        if (patch.url === undefined) {
            delete next.url
        }
        if (patch.mediaId === undefined) {
            delete next.mediaId
        }
        if (patch.articleId === undefined) {
            delete next.articleId
        }
        if (patch.appid === undefined) {
            delete next.appid
        }
        if (patch.pagepath === undefined) {
            delete next.pagepath
        }
    }
    return next
}

export interface WechatMenuState {
    buttons: WechatMenuButton[]
    status: 'loading' | 'ready' | 'error'
    error: string | null
    isSaving: boolean
    reload: () => Promise<void>
    setButton: (index: number, patch: Partial<WechatMenuButton>) => void
    addButton: () => void
    /** 确认新建草稿后插入菜单树：到上限时静默忽略，与 addButton 同口径 */
    addButtonFrom: (button: WechatMenuButton) => void
    removeButton: (index: number) => void
    /** 添加子菜单：返回新增项索引，叶子转目录返回 0，索引失效或达上限返回 null */
    addSub: (index: number) => number | null
    setSub: (index: number, subIndex: number, patch: Partial<WechatMenuButton>) => void
    removeSub: (index: number, subIndex: number) => void
    /** 立即把当前菜单写入本地草稿：常规编辑由防抖保存兜底，此处供需要同步落盘的调用方使用 */
    saveDraft: () => Promise<void>
    save: () => Promise<boolean>
    /** 删除整棵菜单（含全部个性化菜单），成功后清空本地状态与草稿 */
    remove: () => Promise<boolean>
}

export function useWechatMenu(accountId: string): WechatMenuState {
    const [buttons, setButtons] = useState<WechatMenuButton[]>([])
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
    const [error, setError] = useState<string | null>(null)
    const [isSaving, setIsSaving] = useState(false)

    const reload = useCallback(async (): Promise<void> => {
        const payload: WechatMenuRequest = { accountId }
        try {
            const result = await request<WechatMenuResult>(WECHAT_METHODS.menuGet, payload, 30_000)
            setButtons(Array.isArray(result.buttons) ? result.buttons : [])
            setStatus('ready')
            setError(null)
        } catch (cause) {
            setStatus('error')
            setError(toErrorText(cause))
        }
    }, [accountId])

    useEffect(() => {
        void reload()
    }, [reload])

    const buttonsRef = useRef(buttons)
    buttonsRef.current = buttons
    const persistDraft = useDebouncedCallback((): void => {
        // 空菜单不写草稿：避免把「平台未读到」固化成空草稿，导致下次不再回源平台
        if (buttonsRef.current.length === 0) {
            return
        }
        void request<void>(WECHAT_METHODS.menuSaveDraft, { accountId, buttons: buttonsRef.current }, 15_000).catch(
            toastError,
        )
    }, 300)

    // 编辑态的任何变更都在静默期后落本地草稿；首次加载完成也写一次，把平台初始结构固化成草稿
    useEffect(() => {
        if (status !== 'ready') {
            return
        }
        persistDraft()
    }, [buttons, persistDraft, status])

    const setButton = useCallback((index: number, patch: Partial<WechatMenuButton>): void => {
        setButtons((previous) =>
            previous.map((button, position) => (position === index ? applyMenuPatch(button, patch) : button)),
        )
    }, [])

    const addButtonFrom = useCallback((button: WechatMenuButton): void => {
        setButtons((previous) => (previous.length >= WECHAT_MENU_TOP_LIMIT ? previous : [...previous, button]))
    }, [])

    const addButton = useCallback((): void => {
        addButtonFrom(createTopButton())
    }, [addButtonFrom])

    const removeButton = useCallback((index: number): void => {
        setButtons((previous) => previous.filter((_, position) => position !== index))
    }, [])

    const addSub = useCallback((index: number): number | null => {
        const button = buttonsRef.current[index]
        if (button === undefined) {
            return null
        }
        const append = (): void => {
            setButtons((previous) =>
                previous.map((item, position) =>
                    position === index && item.subButton !== undefined
                        ? { ...item, subButton: [...item.subButton, createSubButton()] }
                        : item,
                ),
            )
        }
        // 叶子转目录时保留原动作与内容：二级删空后能原样退回叶子
        if (button.subButton === undefined) {
            setButtons((previous) =>
                previous.map((item, position) =>
                    position === index ? { ...item, subButton: [createSubButton()] } : item,
                ),
            )
            return 0
        }
        if (!canAddSubMenu(button)) {
            return null
        }
        const nextIndex = button.subButton.length
        append()
        return nextIndex
    }, [])

    const setSub = useCallback((index: number, subIndex: number, patch: Partial<WechatMenuButton>): void => {
        setButtons((previous) =>
            previous.map((button, position) => {
                if (position !== index || button.subButton === undefined) {
                    return button
                }
                const subButton = button.subButton.map((child, childPosition) =>
                    childPosition === subIndex ? applyMenuPatch(child, patch) : child,
                )
                return { ...button, subButton }
            }),
        )
    }, [])

    const removeSub = useCallback((index: number, subIndex: number): void => {
        setButtons((previous) =>
            previous.map((button, position) => {
                if (position !== index || button.subButton === undefined) {
                    return button
                }
                const subButton = button.subButton.filter((_, childPosition) => childPosition !== subIndex)
                // 二级全删掉时退回叶子并恢复转目录前的内容，避免留下空目录或丢失原动作
                if (subButton.length === 0) {
                    // 回到叶子：保留原内容，缺失的动作字段用默认叶子补齐，避免保存校验失败
                    const leaf: WechatMenuButton = { ...createSubButton(), ...button }
                    delete leaf.subButton
                    return leaf
                }
                return { ...button, subButton }
            }),
        )
    }, [])

    const saveDraft = useCallback(async (): Promise<void> => {
        try {
            await request<void>(WECHAT_METHODS.menuSaveDraft, { accountId, buttons: buttonsRef.current }, 15_000)
        } catch (cause) {
            toastError(cause)
        }
    }, [accountId])

    const save = useCallback(async (): Promise<boolean> => {
        if (buttons.length === 0) {
            toast.error('至少需要一个一级菜单')
            return false
        }
        setIsSaving(true)
        const payload: WechatMenuSaveRequest = { accountId, buttons }
        try {
            await request<WechatMenuSaveResult>(WECHAT_METHODS.menuSave, payload, 60_000)
            await reload()
            toast.success('菜单已提交，最多 5 分钟生效')
            return true
        } catch (cause) {
            toastError(cause)
            return false
        } finally {
            setIsSaving(false)
        }
    }, [accountId, buttons, reload])

    const remove = useCallback(async (): Promise<boolean> => {
        try {
            await request<void>(WECHAT_METHODS.menuDelete, { accountId }, 30_000)
            setButtons([])
            toast.success('菜单已删除')
            return true
        } catch (cause) {
            toastError(cause)
            return false
        }
    }, [accountId])

    return {
        buttons,
        status,
        error,
        isSaving,
        reload,
        setButton,
        addButton,
        addButtonFrom,
        removeButton,
        addSub,
        setSub,
        removeSub,
        saveDraft,
        save,
        remove,
    }
}

/** 动作类型选项：与 shared 的 WECHAT_MENU_TYPES 同源，界面只做展示 */
export const WECHAT_MENU_TYPE_OPTIONS: readonly { value: WechatMenuType; label: string }[] = [
    { value: 'media_id', label: '下发图片' },
    { value: 'article_id', label: '下发图文' },
    { value: 'view', label: '跳转网页' },
    { value: 'miniprogram', label: '跳转小程序' },
]
