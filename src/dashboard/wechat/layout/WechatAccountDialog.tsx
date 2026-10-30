/**
 * 账号弹窗：新建与编辑共用一套字段（名称、类型、AppID、AppSecret），提交后由页面层调用宿主。
 * 复用约定：骨架取 FormDialog，账号类型取 SegmentedRail + shared/types/wechat 的枚举与文案，
 * 文本状态与 trim 判定取 useTrimmedInput，输入控件取 @components/ui/input。
 * 关键约束：编辑态下 AppSecret 留空表示沿用已存密钥，占位文案给出已有密钥的尾号提示；
 * 表单重置由页面在每次打开时更换组件 key 完成（重挂载即回到当前账号的值），本组件不在 effect 中写状态；
 * 前端只判空与长度，AppID/AppSecret 的形态校验由宿主的收窄函数最终裁定。
 */
import { useState } from 'react'
import { Field, FieldDescription, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import {
    readWechatAccountType,
    WECHAT_ACCOUNT_NAME_MAX,
    WECHAT_ACCOUNT_TYPE_LABELS,
    WECHAT_ACCOUNT_TYPES,
    type WechatAccountSummary,
    type WechatAccountType,
} from '@shared/types/wechat'
import { FormDialog } from '@webview/components/FormDialog'
import { SegmentedRail } from '@webview/components/SegmentedRail'
import { useTrimmedInput } from '@webview/hooks/useTrimmedInput'
import type { WechatAccountFormInput } from '../hooks/useWechatAccounts'
import type { JSX } from 'react'

interface WechatAccountDialogProps {
    open: boolean
    /** 编辑目标：null 表示新建 */
    account: WechatAccountSummary | null
    isSubmitting: boolean
    onOpenChange: (open: boolean) => void
    onSubmit: (input: WechatAccountFormInput) => Promise<boolean>
}

export function WechatAccountDialog({
    open,
    account,
    isSubmitting,
    onOpenChange,
    onSubmit,
}: WechatAccountDialogProps): JSX.Element {
    const isEditing = account !== null
    const name = useTrimmedInput(account?.name ?? '')
    const appId = useTrimmedInput(account?.appId ?? '')
    const appSecret = useTrimmedInput()
    // 初始值只取一次：编辑态回填当前账号类型，新建态回落订阅号
    const [accountType, setAccountType] = useState<WechatAccountType>(() => readWechatAccountType(account?.accountType))

    const isSecretRequired = !isEditing
    const isSubmitDisabled = name.isBlank || appId.isBlank || (isSecretRequired && appSecret.isBlank)

    const handleSubmit = (): void => {
        if (isSubmitDisabled) {
            return
        }
        void onSubmit({
            name: name.value,
            accountType,
            appId: appId.value,
            appSecret: appSecret.value,
        })
    }

    return (
        <FormDialog
            open={open}
            title={isEditing ? '账号设置' : '添加公众号'}
            description={
                isEditing
                    ? '修改名称与 AppID 后会自动重新鉴权；密钥留空表示沿用已保存的密钥。'
                    : '填写公众号后台「设置与开发 → 基本配置」里的 AppID 与 AppSecret，保存后立即验证连接。'
            }
            submitLabel={isEditing ? '保存' : '添加并验证'}
            isSubmitting={isSubmitting}
            isSubmitDisabled={isSubmitDisabled}
            onOpenChange={onOpenChange}
            onSubmit={handleSubmit}
        >
            <Field>
                <FieldLabel htmlFor="wechat-account-name">账号名称</FieldLabel>
                <Input
                    id="wechat-account-name"
                    value={name.value}
                    maxLength={WECHAT_ACCOUNT_NAME_MAX}
                    placeholder="例如：宅写作笔记"
                    disabled={isSubmitting}
                    onChange={(event) => name.setValue(event.target.value)}
                />
            </Field>
            <Field>
                <FieldLabel>账号类型</FieldLabel>
                <SegmentedRail
                    items={WECHAT_ACCOUNT_TYPES.map((item) => ({
                        value: item,
                        label: WECHAT_ACCOUNT_TYPE_LABELS[item],
                    }))}
                    value={accountType}
                    onChange={(value) => setAccountType(readWechatAccountType(value))}
                    ariaLabel="账号类型"
                    variant="outline"
                    size="lg"
                    isDisabled={isSubmitting}
                />
            </Field>
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
            </Field>
            <Field>
                <FieldLabel htmlFor="wechat-account-secret">AppSecret</FieldLabel>
                <Input
                    id="wechat-account-secret"
                    type="password"
                    value={appSecret.value}
                    placeholder={
                        isEditing ? `留空沿用已存密钥 ${account.secretHint ?? ''}`.trim() : '公众号后台的开发者密码'
                    }
                    autoComplete="off"
                    spellCheck={false}
                    disabled={isSubmitting}
                    onChange={(event) => appSecret.setValue(event.target.value)}
                />
                <FieldDescription>密钥只写入系统级加密存储，列表与日志只显示尾号，不会写入数据库。</FieldDescription>
            </Field>
        </FormDialog>
    )
}
