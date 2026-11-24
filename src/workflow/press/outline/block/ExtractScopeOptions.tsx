/**
 * 提取范围模式单选：全篇 / 章节范围 / 指定章节，每项带一句覆盖范围说明。
 * 复用约定：选项表与取值守卫来自 ../constants，单选组取 ui/radio-group，行外壳取 ui/label；
 * 选中态只用语义底色，不写原始色值。
 * 关键约束：说明文案必须写清是否会覆盖整棵大纲树——全篇是破坏性操作，文案是唯一的事前提示。
 */
import { cn } from 'cn'
import { Label } from '@components/ui/label'
import { RadioGroup, RadioGroupItem } from '@components/ui/radio-group'
import type { ExtractScope } from '../../constants'
import type { JSX } from 'react'
import { EXTRACT_SCOPE_OPTIONS } from '../../constants'

interface ExtractScopeOptionsProps {
    value: ExtractScope
    onChange: (value: string) => void
}

export function ExtractScopeOptions({ value, onChange }: ExtractScopeOptionsProps): JSX.Element {
    return (
        <RadioGroup value={value} aria-label="提取范围" className="gap-1" onValueChange={onChange}>
            {EXTRACT_SCOPE_OPTIONS.map((option) => (
                <Label
                    key={option.value}
                    className={cn(
                        'flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1.5',
                        value === option.value ? 'bg-secondary' : 'hover:bg-muted/60',
                    )}
                >
                    <RadioGroupItem value={option.value} className="mt-0.5" />
                    <span className="min-w-0 flex-1">
                        <span className="block">{option.label}</span>
                        <span className="block text-muted-foreground text-xs leading-4">{option.description}</span>
                    </span>
                </Label>
            ))}
        </RadioGroup>
    )
}
