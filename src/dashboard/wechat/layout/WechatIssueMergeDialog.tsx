/**
 * 合并批次弹窗：把所选批次的文章并入一个目标批次。
 * 复用约定：骨架取 FormDialog，目标选择取 ui/select，篇数上限取 shared/types/wechat；
 * 候选目标与源批次由页面计算好后传入，本组件不判断状态是否可合并。
 * 关键约束：合并后总篇数超过一次群发上限时禁用提交并说明原因，不做「先合并再报错」；
 * 目标不可为空——没有草稿批次可并入时，页面不会打开本弹窗，这里仍按空值禁用兜底；
 * 表单初始值只在挂载时取一次，页面每次打开换 key 重置。
 */
import { useState } from 'react'
import { Field, FieldDescription, FieldLabel } from '@components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import { WECHAT_ISSUE_ARTICLE_LIMIT, type WechatIssueSummary } from '@shared/types/wechat'
import { FormDialog } from '@webview/components/FormDialog'
import type { JSX } from 'react'

interface WechatIssueMergeDialogProps {
    open: boolean
    isSubmitting: boolean
    /** 已勾选的源批次：合并后会被删除 */
    sources: WechatIssueSummary[]
    /** 可选的目标批次：草稿状态且不在 sources 内 */
    candidates: WechatIssueSummary[]
    onOpenChange: (open: boolean) => void
    onSubmit: (targetId: string) => Promise<boolean>
}

export function WechatIssueMergeDialog({
    open,
    isSubmitting,
    sources,
    candidates,
    onOpenChange,
    onSubmit,
}: WechatIssueMergeDialogProps): JSX.Element {
    const [targetId, setTargetId] = useState(candidates[0]?.id ?? '')
    const movedCount = sources.reduce((sum, issue) => sum + issue.articleCount, 0)
    const target = candidates.find((issue) => issue.id === targetId)
    const totalCount = (target?.articleCount ?? 0) + movedCount
    const isOverLimit = totalCount > WECHAT_ISSUE_ARTICLE_LIMIT

    const handleSubmit = (): void => {
        if (targetId.length === 0 || isOverLimit) {
            return
        }
        void onSubmit(targetId)
    }

    return (
        <FormDialog
            open={open}
            title="合并到批次"
            description={`将把 ${String(sources.length)} 个批次里的 ${String(movedCount)} 篇文章并入目标批次，源批次随后删除。`}
            submitLabel="合并"
            isSubmitting={isSubmitting}
            isSubmitDisabled={targetId.length === 0 || isOverLimit}
            onOpenChange={onOpenChange}
            onSubmit={handleSubmit}
        >
            <Field>
                <FieldLabel htmlFor="wechat-merge-target">目标批次</FieldLabel>
                <Select value={targetId} onValueChange={setTargetId}>
                    <SelectTrigger id="wechat-merge-target" disabled={isSubmitting}>
                        <SelectValue placeholder="选择草稿批次" />
                    </SelectTrigger>
                    <SelectContent>
                        {candidates.map((issue) => (
                            <SelectItem key={issue.id} value={issue.id}>
                                {`${issue.title}（${String(issue.articleCount)} 篇）`}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <FieldDescription>
                    {isOverLimit
                        ? `合并后共 ${String(totalCount)} 篇，超过单次群发 ${String(WECHAT_ISSUE_ARTICLE_LIMIT)} 篇上限，请减少源批次`
                        : `合并后共 ${String(totalCount)} 篇，未超过 ${String(WECHAT_ISSUE_ARTICLE_LIMIT)} 篇上限`}
                </FieldDescription>
            </Field>
        </FormDialog>
    )
}
