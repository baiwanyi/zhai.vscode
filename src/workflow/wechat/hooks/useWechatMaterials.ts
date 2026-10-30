/**
 * 素材数据：当前账号已上传的永久素材列表与「从本地导入」动作。
 * 复用约定：列表读 wechat/material/list，导入读 wechat/material/import（宿主弹选择器，前端不传路径）；
 * 展示与错误提示交给页面，本层只做取数、状态与导入后的重拉。
 * 关键约束：导入是用户显式动作，进行中置 isImporting 阻止重复点击；
 * 用户取消选择时宿主返回 imported: false，视为正常结束、不提示也不重拉。
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type {
    WechatMaterialImportRequest,
    WechatMaterialImportResult,
    WechatMaterialListRequest,
    WechatMaterialRemoveRequest,
    WechatMaterialSummary,
} from '@shared/types/wechat'
import { request } from '@shared/utils/bridge'
import { toErrorText, toastError } from '@shared/utils/error'

export interface WechatMaterialsState {
    materials: WechatMaterialSummary[]
    status: 'loading' | 'ready' | 'error'
    error: string | null
    isImporting: boolean
    /** 正在删除的素材 id：据此只禁用那一行，不冻结整个列表 */
    removingId: string | null
    reload: () => Promise<void>
    importImage: () => Promise<void>
    removeMaterial: (id: string) => Promise<boolean>
}

export function useWechatMaterials(accountId: string): WechatMaterialsState {
    const [materials, setMaterials] = useState<WechatMaterialSummary[]>([])
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
    const [error, setError] = useState<string | null>(null)
    const [isImporting, setIsImporting] = useState(false)
    const [removingId, setRemovingId] = useState<string | null>(null)

    const reload = useCallback(async (): Promise<void> => {
        const payload: WechatMaterialListRequest = { accountId }
        try {
            const next = await request<WechatMaterialSummary[]>('wechat/material/list', payload)
            setMaterials(Array.isArray(next) ? next : [])
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

    const importImage = useCallback(async (): Promise<void> => {
        setIsImporting(true)
        const payload: WechatMaterialImportRequest = { accountId }
        try {
            const result = await request<WechatMaterialImportResult>('wechat/material/import', payload, 120_000)
            if (!result.imported) {
                return
            }
            await reload()
            toast.success(`已上传素材：${result.material?.name ?? '图片'}`)
        } catch (cause) {
            toastError(cause)
        } finally {
            setIsImporting(false)
        }
    }, [accountId, reload])

    /**
     * 删除素材：平台侧与本地映射一起清。
     * 关键约束：不可撤销——已发布文章里引用这张图的正文会失效，页面负责二次确认。
     */
    const removeMaterial = useCallback(
        async (id: string): Promise<boolean> => {
            setRemovingId(id)
            const payload: WechatMaterialRemoveRequest = { accountId, id }
            try {
                await request('wechat/material/remove', payload, 60_000)
                await reload()
                toast.success('素材已删除')
                return true
            } catch (cause) {
                toastError(cause)
                return false
            } finally {
                setRemovingId(null)
            }
        },
        [accountId, reload],
    )

    return { materials, status, error, isImporting, removingId, reload, importImage, removeMaterial }
}
