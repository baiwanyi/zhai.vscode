/**
 * 关注备注：读取初值由调用方（主页资料）传入，保存走 weibo/user/remark。
 * 复用约定：错误文案走 @shared/utils/error，成功回执由弹窗统一给出；
 * 载荷只含 uid 与备注文本，长度由协议层收窄（0-15 字，空串即清除）。
 * 关键约束：写操作 ref 单飞，保存中不接受第二次提交；
 * 备注以上游回包为准回写本地，避免清空失败却显示已清空；
 * 卸载后不再回写状态、不再弹提示——保存中切页，提示不该落在别的页面上。
 */
import { useCallback, useRef, useState } from 'react'
import type { WeiboUserRemarkResult } from '@shared/types/weibo'
import { WEIBO_METHODS } from '@shared/types/weiboMethods'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import { useIsMounted } from '@webview/hooks/useIsMounted'

export interface WeiboUserRemarkController {
    /** 当前生效的备注：初值来自主页资料，保存成功后更新 */
    remark: string
    isSaving: boolean
    /** 保存备注：空串表示清除，成功返回回包备注（可能被上游裁剪），失败返回 null */
    save: (next: string) => Promise<string | null>
}

export function useWeiboUserRemark(uid: string, initialRemark: string): WeiboUserRemarkController {
    const [remark, setRemark] = useState(initialRemark)
    const [isSaving, setIsSaving] = useState(false)
    /** 单飞标记：保存中再次点击不重复提交 */
    const isSavingRef = useRef(false)
    /** 卸载标记：列表与主页会整块替换，回包到货时组件可能已卸载，不再写状态、不再弹提示 */
    const isMountedRef = useIsMounted()

    const save = useCallback(
        async (next: string): Promise<string | null> => {
            if (isSavingRef.current || uid.length === 0) {
                return null
            }
            isSavingRef.current = true
            setIsSaving(true)
            try {
                const result = await request<WeiboUserRemarkResult>(WEIBO_METHODS.userRemark, {
                    uid,
                    remark: next,
                })
                if (!isMountedRef.current) {
                    return null
                }
                setRemark(result.remark)
                return result.remark
            } catch (cause) {
                if (isMountedRef.current) {
                    toastError(cause)
                }
                return null
            } finally {
                isSavingRef.current = false
                if (isMountedRef.current) {
                    setIsSaving(false)
                }
            }
        },
        [uid],
    )

    return { remark, isSaving, save }
}
