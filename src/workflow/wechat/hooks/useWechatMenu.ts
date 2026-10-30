/**
 * 自定义菜单数据与编辑操作：读取平台菜单、在内存里编辑结构、整棵保存。
 * 复用约定：读取走 wechat/menu/get，保存走 wechat/menu/save；结构上限常量取 shared/types/wechat，
 * 与宿主侧 readWechatMenuButtons 共用同一份限制，界面不另写一套数字。
 * 关键约束：编辑态只存在于本 hook（页面是纯展示），避免「页面存一份、hook 存一份」的漂移；
 * 一级与二级的增删都在这里做边界收敛（≤3、≤5），按钮组不自行判断；
 * 保存前不裁剪用户输入，交给宿主统一校验并给出整段提示，避免两处口径不一致。
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
    WECHAT_MENU_SUB_LIMIT,
    WECHAT_MENU_TOP_LIMIT,
    type WechatMenuButton,
    type WechatMenuRequest,
    type WechatMenuResult,
    type WechatMenuSaveRequest,
    type WechatMenuSaveResult,
    type WechatMenuType,
} from '@shared/types/wechat'
import { request } from '@shared/utils/bridge'
import { toErrorText, toastError } from '@shared/utils/error'

/** 新建一级的默认形态：发送消息，key 前缀便于区分 */
const DEFAULT_TOP_BUTTON: WechatMenuButton = { name: '新菜单', type: 'click', key: 'MENU_KEY' }

/** 转为目录时补的默认二级 */
const DEFAULT_SUB_BUTTON: WechatMenuButton = { name: '子菜单', type: 'click', key: 'SUB_KEY' }

export interface WechatMenuState {
    buttons: WechatMenuButton[]
    status: 'loading' | 'ready' | 'error'
    error: string | null
    isSaving: boolean
    reload: () => Promise<void>
    setButton: (index: number, patch: Partial<WechatMenuButton>) => void
    addButton: () => void
    removeButton: (index: number) => void
    /** 叶子 ↔ 目录 互转：转目录补一个默认二级，转叶子丢掉二级 */
    toggleGroup: (index: number) => void
    addSub: (index: number) => void
    setSub: (index: number, subIndex: number, patch: Partial<WechatMenuButton>) => void
    removeSub: (index: number, subIndex: number) => void
    save: () => Promise<boolean>
}

export function useWechatMenu(accountId: string): WechatMenuState {
    const [buttons, setButtons] = useState<WechatMenuButton[]>([])
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
    const [error, setError] = useState<string | null>(null)
    const [isSaving, setIsSaving] = useState(false)

    const reload = useCallback(async (): Promise<void> => {
        const payload: WechatMenuRequest = { accountId }
        try {
            const result = await request<WechatMenuResult>('wechat/menu/get', payload, 30_000)
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

    const setButton = useCallback((index: number, patch: Partial<WechatMenuButton>): void => {
        setButtons((previous) =>
            previous.map((button, position) => {
                if (position !== index) {
                    return button
                }
                const next = { ...button, ...patch }
                // 切换动作类型时清掉上一类型的专属字段，避免保存时带着无关字段
                if (patch.type !== undefined && patch.type !== button.type) {
                    delete next.key
                    delete next.url
                    delete next.appid
                    delete next.pagepath
                }
                return next
            }),
        )
    }, [])

    const addButton = useCallback((): void => {
        setButtons((previous) =>
            previous.length >= WECHAT_MENU_TOP_LIMIT ? previous : [...previous, { ...DEFAULT_TOP_BUTTON }],
        )
    }, [])

    const removeButton = useCallback((index: number): void => {
        setButtons((previous) => previous.filter((_, position) => position !== index))
    }, [])

    const toggleGroup = useCallback((index: number): void => {
        setButtons((previous) =>
            previous.map((button, position) => {
                if (position !== index) {
                    return button
                }
                if (button.subButton !== undefined) {
                    // 去掉二级后按发送消息补默认字段，避免留下一个没有动作的叶子节点
                    return { name: button.name, type: 'click', key: 'MENU_KEY' }
                }
                return { name: button.name, subButton: [{ ...DEFAULT_SUB_BUTTON }] }
            }),
        )
    }, [])

    const addSub = useCallback((index: number): void => {
        setButtons((previous) =>
            previous.map((button, position) => {
                if (position !== index || button.subButton === undefined) {
                    return button
                }
                if (button.subButton.length >= WECHAT_MENU_SUB_LIMIT) {
                    return button
                }
                return { ...button, subButton: [...button.subButton, { ...DEFAULT_SUB_BUTTON }] }
            }),
        )
    }, [])

    const setSub = useCallback((index: number, subIndex: number, patch: Partial<WechatMenuButton>): void => {
        setButtons((previous) =>
            previous.map((button, position) => {
                if (position !== index || button.subButton === undefined) {
                    return button
                }
                const subButton = button.subButton.map((child, childPosition) => {
                    if (childPosition !== subIndex) {
                        return child
                    }
                    const next = { ...child, ...patch }
                    if (patch.type !== undefined && patch.type !== child.type) {
                        delete next.key
                        delete next.url
                        delete next.appid
                        delete next.pagepath
                    }
                    return next
                })
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
                // 二级全删掉时退回叶子，避免留下一个空目录（平台会拒绝）
                return subButton.length === 0
                    ? { name: button.name, type: 'click', key: 'MENU_KEY' }
                    : { ...button, subButton }
            }),
        )
    }, [])

    const save = useCallback(async (): Promise<boolean> => {
        if (buttons.length === 0) {
            toast.error('至少需要一个一级菜单')
            return false
        }
        setIsSaving(true)
        const payload: WechatMenuSaveRequest = { accountId, buttons }
        try {
            await request<WechatMenuSaveResult>('wechat/menu/save', payload, 60_000)
            await reload()
            toast.success('菜单已发布到公众号')
            return true
        } catch (cause) {
            toastError(cause)
            return false
        } finally {
            setIsSaving(false)
        }
    }, [accountId, buttons, reload])

    return {
        buttons,
        status,
        error,
        isSaving,
        reload,
        setButton,
        addButton,
        removeButton,
        toggleGroup,
        addSub,
        setSub,
        removeSub,
        save,
    }
}

/** 动作类型选项：与 shared 的 WECHAT_MENU_TYPES 同源，界面只做展示 */
export const WECHAT_MENU_TYPE_OPTIONS: readonly { value: WechatMenuType; label: string }[] = [
    { value: 'click', label: '发送消息' },
    { value: 'view', label: '跳转网页' },
    { value: 'miniprogram', label: '跳转小程序' },
]
