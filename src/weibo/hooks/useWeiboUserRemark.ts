/**
 * 关注备注：读取初值由调用方（主页资料）传入，保存走 weibo/user/remark。
 * 复用约定：错误文案走 @shared/utils/error，成功回执由弹窗统一给出；
 * 载荷只含 uid 与备注文本，长度由协议层收窄（0-15 字，空串即清除）。
 * 关键约束：写操作 ref 单飞，保存中不接受第二次提交；
 * 备注以上游回包为准回写本地，避免清空失败却显示已清空。
 */
import { useCallback, useRef, useState } from 'react'
import type { WeiboUserRemarkResult } from '@shared/types/weibo'
import { WEIBO_METHODS } from '@shared/types/weiboMethods'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

export interface WeiboUserRemarkController {
    /** 当前生效的备注：初值来自主页资料，保存成功后更新 */
    remark: string
    isSaving: boolean
    /** 保存备注：空串表示清除，成功返回 true */
    save: (next: string) => Promise<boolean>
}

export function useWeiboUserRemark(uid: string, initialRemark: string): WeiboUserRemarkController {
    const [remark, setRemark] = useState(initialRemark)
    const [isSaving, setIsSaving] = useState(false)
    /** 单飞标记：保存中再次点击不重复提交 */
    const isSavingRef = useRef(false)

    const save = useCallback(
        async (next: string): Promise<boolean> => {
            if (isSavingRef.current || uid.length === 0) {
                return false
            }
            isSavingRef.current = true
            setIsSaving(true)
            try {
                const result = await request<WeiboUserRemarkResult>(WEIBO_METHODS.userRemark, {
                    uid,
                    remark: next,
                })
                setRemark(result.remark)
                return true
            } catch (cause) {
                toastError(cause)
                return false
            } finally {
                isSavingRef.current = false
                setIsSaving(false)
            }
        },
        [uid],
    )

    return { remark, isSaving, save }
}
