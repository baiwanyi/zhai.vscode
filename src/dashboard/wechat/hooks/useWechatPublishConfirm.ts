/**
 * 群发确认：目标批次、额度说明、确认文案与提交动作。
 * 复用约定：额度查询与群发动作由页面注入（loadQuota 来自 useWechatIssues），
 * 确认文案由 ../utils 的 buildPublishDescription 统一拼装，本层不写文案细节。
 * 关键约束：额度回包带请求序号，只接受本次打开的回包——连续点不同批次时，
 * 先发后到的额度说明不能覆盖当前目标；确认后先关弹窗再提交，
 * 结果由宿主的 toast 与列表状态呈现，不在本层重复提示。
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import type { WechatIssueSummary, WechatPublishQuotaResult } from '@shared/types/wechat'
import { buildPublishDescription } from '../utils'

export interface WechatPublishConfirmDeps {
    /** 当前账号名：只用于确认文案，缺失时留空 */
    accountName: string
    loadQuota: () => Promise<WechatPublishQuotaResult | null>
    publish: (issueId: string) => Promise<boolean>
}

export interface WechatPublishConfirmState {
    /** 待群发批次：非 null 即打开确认弹窗 */
    target: WechatIssueSummary | null
    description: string
    request: (issue: WechatIssueSummary) => void
    close: () => void
    confirm: () => void
}

export function useWechatPublishConfirm(deps: WechatPublishConfirmDeps): WechatPublishConfirmState {
    const { accountName, loadQuota, publish } = deps
    const [target, setTarget] = useState<WechatIssueSummary | null>(null)
    const [quotaReason, setQuotaReason] = useState('')
    /** 额度请求序号：只接受与当前确认目标同一批发起的回包 */
    const quotaSeqRef = useRef(0)

    const request = useCallback(
        (issue: WechatIssueSummary): void => {
            const seq = quotaSeqRef.current + 1
            quotaSeqRef.current = seq
            setTarget(issue)
            setQuotaReason('')
            void loadQuota().then((quota) => {
                if (quota !== null && quotaSeqRef.current === seq) {
                    setQuotaReason(quota.reason)
                }
            })
        },
        [loadQuota],
    )

    const close = useCallback((): void => {
        setTarget(null)
    }, [])

    const confirm = useCallback((): void => {
        if (target === null) {
            return
        }
        const issue = target
        setTarget(null)
        void publish(issue.id)
    }, [publish, target])

    const description = useMemo(
        () => (target === null ? '' : buildPublishDescription(accountName, target, quotaReason)),
        [accountName, quotaReason, target],
    )

    return { target, description, request, close, confirm }
}
