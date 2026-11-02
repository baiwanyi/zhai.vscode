/**
 * 密钥设置弹窗：只维护 AppID 与 AppSecret，账号资料在独立的账号设置弹窗里。
 * 复用约定：骨架取 FormDialog，输入控件取 @components/ui/input，状态取 useTrimmedInput；
 * 提交后由宿主立即鉴权，结果通过列表状态与 toast 回显。
 * 关键约束：编辑态 AppSecret 留空表示沿用已存密钥，占位文案给出尾号提示；
 * 首次配置（还没有任何密钥）时 AppSecret 必填，否则宿主拒绝保存半个凭据；
 * 密钥只写入系统级加密存储，列表与日志只显示尾号，本弹窗不回显明文；
 * 表单重置由页面在每次打开时更换组件 key 完成，本组件不在 effect 中写状态。
 */
import { Field, FieldDescription, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import type { WechatAccountSummary } from '@shared/types/wechat'
import { FormDialog } from '@webview/components/FormDialog'
import { useTrimmedInput } from '@webview/hooks/useTrimmedInput'
import type { WechatAccountCredentialsInput } from '../hooks/useWechatAccounts'
import type { JSX } from 'react'

interface WechatAccountSecretDialogProps {
    open: boolean
    account: WechatAccountSummary
    isSubmitting: boolean
    onOpenChange: (open: boolean) => void
    onSubmit: (input: Omit<WechatAccountCredentialsInput, 'id'>) => Promise<boolean>
}

export function WechatAccountSecretDialog({
    open,
    account,
    isSubmitting,
    onOpenChange,
    onSubmit,
}: WechatAccountSecretDialogProps): JSX.Element {
    const appId = useTrimmedInput(account.appId)
    const appSecret = useTrimmedInput()
    // 已配置过密钥时允许留空沿用；首次配置必须同时给出 AppSecret
    const isSecretRequired = !account.hasSecret
    const isSubmitDisabled = appId.isBlank || (isSecretRequired && appSecret.isBlank)

    const handleSubmit = (): void => {
        if (isSubmitDisabled) {
            return
        }
        void onSubmit({ appId: appId.value, appSecret: appSecret.value })
    }

    return (
        <FormDialog
            open={open}
            title="密钥设置"
            description="填写公众号后台「设置与开发 → 基本配置」里的 AppID 与 AppSecret，保存后立即验证连接。"
            submitLabel="保存并验证"
            isSubmitting={isSubmitting}
            isSubmitDisabled={isSubmitDisabled}
            onOpenChange={onOpenChange}
            onSubmit={handleSubmit}
        >
            <Field>
                <FieldLabel htmlFor="wechat-account-appid">AppID</FieldLabel>
                <Input
                    id="wechat-account-appid"
                    value={appId.value}
                    placeholder="wx 开头的开发者 ID"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={isSubmitting}
                    onChange={(event) => appId.setValue(event.target.value)}
                />
                <FieldDescription>非敏感信息，会显示在账号列表里；改它会让旧 Token 失效并重新鉴权。</FieldDescription>
            </Field>
            <Field>
                <FieldLabel htmlFor="wechat-account-secret">AppSecret</FieldLabel>
                <Input
                    id="wechat-account-secret"
                    type="password"
                    value={appSecret.value}
                    placeholder={
                        account.hasSecret
                            ? `留空沿用已存密钥 ${account.secretHint ?? ''}`.trim()
                            : '公众号后台的开发者密码'
                    }
                    autoComplete="off"
                    spellCheck={false}
                    disabled={isSubmitting}
                    onChange={(event) => appSecret.setValue(event.target.value)}
                />
                <FieldDescription>
                    密钥只写入系统级加密存储，列表与日志只显示尾号，不会写入数据库；未配置 AppID 时无法新建批次。
                </FieldDescription>
            </Field>
        </FormDialog>
    )
}
