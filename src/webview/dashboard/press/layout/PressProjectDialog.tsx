/**
 * 添加作品弹窗：收集作品名与目标读者（男频/女频），提交后由页面层调用宿主创建作品。
 * 复用约定：骨架取业务公共层的 FormDialog（标题/说明/字段区/取消与提交），分段选择取 SegmentedRail，
 * 作品名取 @components/ui/textarea，文本状态与 trim 判定取 useTrimmedInput；
 * 选项与取值取自 shared/types/press，不重复定义。
 * 关键约束：目标读者为必选项，SegmentedRail 判空后回调，空串不会写回；表单重置由页面在每次打开时
 * 更换组件 key 完成（重挂载即回到初始值），本组件不在 effect 中同步写状态；
 * 前端只做 trim 与空值判定，完整名称白名单由宿主校验。
 */
import { useState } from 'react'
import { Field, FieldLabel } from '@components/ui/field'
import { Textarea } from '@components/ui/textarea'
import type { PressAudience } from '@shared/types/press'
import { DEFAULT_PRESS_AUDIENCE, PRESS_AUDIENCES, readPressAudience } from '@shared/types/press'
import { FormDialog } from '@webview/components/FormDialog'
import { SegmentedRail } from '@webview/components/SegmentedRail'
import { useTrimmedInput } from '@webview/hooks/useTrimmedInput'
import type { JSX } from 'react'

interface PressProjectDialogProps {
    open: boolean
    isSubmitting: boolean
    onOpenChange: (open: boolean) => void
    onSubmit: (name: string, audience: PressAudience) => Promise<boolean>
}

export function PressProjectDialog({
    open,
    isSubmitting,
    onOpenChange,
    onSubmit,
}: PressProjectDialogProps): JSX.Element {
    const name = useTrimmedInput()
    const [audience, setAudience] = useState<PressAudience>(DEFAULT_PRESS_AUDIENCE)

    const handleSubmit = (): void => {
        // 作品名按单行语义提交：textarea 里的换行与连续空白折叠成一个空格，避免带进目录名
        const normalizedName = name.value.replace(/\s+/g, ' ').trim()
        if (normalizedName.length === 0) {
            return
        }
        void onSubmit(normalizedName, audience)
    }

    return (
        <FormDialog
            open={open}
            title="添加作品"
            description="生成作品目录，并附带背景、大纲、角色设定与设定文档。"
            submitLabel="创建"
            isSubmitting={isSubmitting}
            isSubmitDisabled={name.isBlank}
            onOpenChange={onOpenChange}
            onSubmit={handleSubmit}
        >
            <Field>
                <FieldLabel htmlFor="press-project-name">作品名</FieldLabel>
                <Textarea
                    id="press-project-name"
                    value={name.value}
                    rows={2}
                    maxLength={60}
                    placeholder="例如：凡人修仙传"
                    disabled={isSubmitting}
                    onChange={(event) => name.setValue(event.target.value)}
                    onKeyDown={(event) => {
                        // Enter 提交由弹窗接管，避免换行混入作品名；输入法组合中的 Enter 交给输入法处理
                        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                            event.preventDefault()
                            handleSubmit()
                        }
                    }}
                />
            </Field>
            <Field>
                <FieldLabel>目标读者</FieldLabel>
                <SegmentedRail
                    items={PRESS_AUDIENCES.map((item) => ({ value: item, label: item }))}
                    value={audience}
                    onChange={(value) => setAudience(readPressAudience(value))}
                    ariaLabel="目标读者"
                    variant="outline"
                    size="lg"
                    isDisabled={isSubmitting}
                />
            </Field>
        </FormDialog>
    )
}
