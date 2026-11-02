/**
 * 账号设置弹窗：只改账号名称、类型与默认作者，凭据在独立的密钥设置弹窗里维护。
 * 复用约定：骨架取 FormDialog，账号类型取 SegmentedRail + shared/types/wechat 的枚举与文案，
 * 文本状态与 trim 判定取 useTrimmedInput，输入控件取 @components/ui/input。
 * 关键约束：新建时不询问 AppID / AppSecret——先建出账号，再引导去「密钥设置」补凭据；
 * 默认作者与文章作者同一套长度限制，留空表示文章设置不预填；
 * 表单重置由页面在每次打开时更换组件 key 完成（重挂载即回到当前账号的值），本组件不在 effect 中写状态。
 */
import { useState } from 'react'
import { Field, FieldDescription, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import {
    readWechatAccountType,
    WECHAT_ACCOUNT_NAME_MAX,
    WECHAT_ACCOUNT_TYPE_LABELS,
    WECHAT_ACCOUNT_TYPES,
    WECHAT_ARTICLE_AUTHOR_MAX,
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
    const defaultAuthor = useTrimmedInput(account?.defaultAuthor ?? '')
    // 初始值只取一次：编辑态回填当前账号类型，新建态回落订阅号
    const [accountType, setAccountType] = useState<WechatAccountType>(() => readWechatAccountType(account?.accountType))

    const isSubmitDisabled = name.isBlank

    const handleSubmit = (): void => {
        if (isSubmitDisabled) {
            return
        }
        void onSubmit({
            name: name.value,
            accountType,
            defaultAuthor: defaultAuthor.value,
        })
    }

    return (
        <FormDialog
            open={open}
            title={isEditing ? '账号设置' : '添加公众号'}
            description={
                isEditing
                    ? '只改展示用的账号资料；AppID 与 AppSecret 在「密钥设置」里单独维护。'
                    : '先填账号资料即可创建，创建后再到「密钥设置」填写 AppID 与 AppSecret 完成鉴权。'
            }
            submitLabel={isEditing ? '保存' : '创建账号'}
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
                <FieldDescription>只在本机展示，微信没有公开接口可以拉取公众号名称。</FieldDescription>
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
                <FieldDescription>类型决定群发频率：订阅号一天一次，服务号一月四次。</FieldDescription>
            </Field>
            <Field>
                <FieldLabel htmlFor="wechat-account-author">默认作者</FieldLabel>
                <Input
                    id="wechat-account-author"
                    value={defaultAuthor.value}
                    maxLength={WECHAT_ARTICLE_AUTHOR_MAX}
                    placeholder="可留空，等同于文章作者留空"
                    disabled={isSubmitting}
                    onChange={(event) => defaultAuthor.setValue(event.target.value)}
                />
                <FieldDescription>
                    {`最多 ${String(WECHAT_ARTICLE_AUTHOR_MAX)} 字；新建文章设置时会带出这个作者，可按篇改写。`}
                </FieldDescription>
            </Field>
        </FormDialog>
    )
}
