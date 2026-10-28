/**
 * 带 AI 生成按钮的文本域字段：字段名 + 输入组 + 右下角生成按钮，生成期间输入组外挂一圈光晕。
 * 复用约定：容器取 @components/ui 的 Field / FieldLabel / FieldDescription，输入取 ui/input-group，
 * 光晕取同目录 ComposerGlow（与对话、生图输入卡片共用）；外层列跨度由调用方以固定类名传入。
 * 关键约束：光晕必须挂在输入组的兄弟层、父级 isolate，底衬要压在光晕之上并 pointer-events-none，
 * 否则背光会透过半透明的输入底色把正文染成紫色；isGenerating 只驱动本字段的转圈，
 * 任一字段在生成时调用方需把 isDisabled 置为 true，避免并发请求；
 * 传了 maxLength 时按钮左侧显示剩余字数，超长输入由 textarea 原生 maxLength 直接拦下。
 */
import { Sparkles } from 'lucide-react'
import { Field, FieldDescription, FieldLabel } from '@components/ui/field'
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupText,
    InputGroupTextarea,
} from '@components/ui/input-group'
import { Spinner } from '@components/ui/spinner'
import { ComposerGlow } from './ComposerGlow'
import type { JSX, ReactNode } from 'react'

/**
 * 光晕在输入组上的落法：子层圆角对齐 InputGroup（rounded-lg）；
 * 背光比描边再外扩、再糊一层——默认只在边框外留 2px，看不出雾状扩散。
 */
const GLOW_CLASS = '[&>div]:rounded-lg [&>.composer-glow-halo]:-inset-2 [&>.composer-glow-halo]:blur-md'

interface AiTextareaFieldProps {
    /** 输入框 id：同时作为字段名的 for，同一页面内必须唯一 */
    id: string
    label: string
    value: string
    placeholder?: string
    /** 本字段是否在生成：驱动光晕与按钮转圈 */
    isGenerating: boolean
    /** 按钮是否禁用：默认跟随 isGenerating，任一字段在生成时调用方传 true */
    isDisabled?: boolean
    maxLength?: number
    /** 字段下方说明：省略时不渲染 */
    description?: ReactNode
    /** 按钮的无障碍文案：界面上只有图标 */
    generateLabel: string
    /** 外层 Field 的额外类名，如 @md:col-span-2 */
    className?: string
    onChange: (value: string) => void
    onGenerate: () => void
}

export function AiTextareaField({
    id,
    label,
    value,
    placeholder,
    isGenerating,
    isDisabled,
    maxLength,
    description,
    generateLabel,
    className,
    onChange,
    onGenerate,
}: AiTextareaFieldProps): JSX.Element {
    return (
        <Field className={className}>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            <div className="relative isolate rounded-lg">
                <ComposerGlow isGenerating={isGenerating} className={GLOW_CLASS} />
                {/* 不透明底衬压在光晕之上：光只从输入组边缘溢出，不会把正文染成紫色 */}
                <div aria-hidden className="pointer-events-none absolute inset-0 rounded-lg bg-background" />
                <InputGroup>
                    <InputGroupTextarea
                        id={id}
                        value={value}
                        placeholder={placeholder}
                        maxLength={maxLength}
                        onChange={(event) => onChange(event.target.value)}
                    />
                    <InputGroupAddon align="block-end">
                        {maxLength === undefined ? null : (
                            <InputGroupText className="text-xs tabular-nums">
                                还可输入 {Math.max(0, maxLength - value.length)} 字
                            </InputGroupText>
                        )}
                        <InputGroupButton
                            disabled={isDisabled ?? isGenerating}
                            aria-label={generateLabel}
                            tooltip={generateLabel}
                            onClick={onGenerate}
                            className="ml-auto"
                        >
                            {isGenerating ? <Spinner /> : <Sparkles />}
                        </InputGroupButton>
                    </InputGroupAddon>
                </InputGroup>
            </div>
            {description === undefined ? null : <FieldDescription>{description}</FieldDescription>}
        </Field>
    )
}
