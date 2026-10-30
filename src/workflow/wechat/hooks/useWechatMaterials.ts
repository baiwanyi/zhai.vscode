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
    WechatMaterialSummary,
} from '@shared/types/wechat'
import { request } from '@shared/utils/bridge'
import { toErrorText, toastError } from '@shared/utils/error'

export interface WechatMaterialsState {
    materials: WechatMaterialSummary[]
    status: 'loading' | 'ready' | 'error'
    error: string | null
    isImporting: boolean
    reload: () => Promise<void>
    importImage: () => Promise<void>
}

export function useWechatMaterials(accountId: string): WechatMaterialsState {
    const [materials, setMaterials] = useState<WechatMaterialSummary[]>([])
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
    const [error, setError] = useState<string | null>(null)
    const [isImporting, setIsImporting] = useState(false)

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

    return { materials, status, error, isImporting, reload, importImage }
}
