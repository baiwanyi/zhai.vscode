/**
 * 凭证门：未配置 Cookie 时的统一占位，覆盖「探测中 / 探测失败 / 未配置」三态。
 * 复用约定：骨架取 @webview/blocks/StateEmpty，操作按钮取 @webview/components/Button；
 * 文案只在本文件维护，信息流区域与首页列表空态共用同一份，避免多套措辞。
 * 关键约束：credential 为 null 时不得断言「没有配置」，须按 errorCode 区分探测中与探测失败；
 * 已配置时返回 null，调用方只在需要占位时使用，本组件不承担权限判断。
 */
import { Inbox } from 'lucide-react'
import type { WeiboCredentialState } from '@shared/types/weibo'
import { StateEmpty } from '@webview/blocks/StateEmpty'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'
import { WEIBO_UI_TEXT } from '../utils/weiboUiText'

interface CredentialGateProps {
    /** 凭证状态：null 表示探测尚未返回 */
    credential: WeiboCredentialState | null
    /** 探测失败的错误码：非空即视为探测失败 */
    errorCode: string | null
    errorMessage: string | null
    onOpenSettings: () => void
    /** panel：带「去设置」按钮；hint：只给一句说明，用于列表空态 */
    variant?: 'panel' | 'hint'
}

/** 未配置凭证时的占位：探测中给加载态，探测失败给失败态，其余给获取步骤 */
export function CredentialGate({
    credential,
    errorCode,
    errorMessage,
    onOpenSettings,
    variant = 'panel',
}: CredentialGateProps): JSX.Element | null {
    if (credential === null) {
        if (errorCode === null) {
            return <StateEmpty className="py-8" title={WEIBO_UI_TEXT.loading.credential} isLoading />
        }
        return (
            <StateEmpty
                className="py-8"
                icon={Inbox}
                title={WEIBO_UI_TEXT.error.credential}
                description={errorMessage ?? '读取本机保存的 Cookie 时出错：稍后重试，或重新保存一次 Cookie。'}
            >
                <Button size="sm" variant="outline" onClick={onOpenSettings}>
                    {WEIBO_UI_TEXT.action.openSettings}
                </Button>
            </StateEmpty>
        )
    }
    if (credential.isConfigured) {
        return null
    }
    if (variant === 'hint') {
        return (
            <StateEmpty
                className="py-8"
                icon={Inbox}
                title={WEIBO_UI_TEXT.empty.credential}
                description="按上方步骤复制登录后的 Cookie 并保存，即可读取关注时间线。"
            />
        )
    }
    return (
        <StateEmpty
            className="py-8"
            icon={Inbox}
            title={WEIBO_UI_TEXT.empty.credential}
            description="在「设置」里保存登录后的 Cookie 即可读取信息流：先登录 weibo.com，再复制任意 ajax 请求头里的完整 Cookie。"
        >
            <Button size="sm" variant="outline" onClick={onOpenSettings}>
                {WEIBO_UI_TEXT.action.openSettings}
            </Button>
        </StateEmpty>
    )
}
