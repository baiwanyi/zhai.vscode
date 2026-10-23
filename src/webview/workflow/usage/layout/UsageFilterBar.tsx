/**
 * 筛选栏：模块与时间范围两个下拉，改动后回到第一页由调用方处理。
 * 复用约定：下拉复用 @components/ui/select；选项与「全部」占位值来自 ../constants，标签与宿主记账同源。
 * 关键约束：模块的「全部」用占位值表示，回传前必须还原成 null，不能把占位值当成模块键下发；
 * 时间范围只接受常量里的枚举，不接受自由输入。
 */
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import { isAiUsageModule, isAiUsageRange } from '@shared/types/aiUsage'
import type { AiUsageModule, AiUsageRange } from '@shared/types/aiUsage'
import type { JSX } from 'react'
import { ALL_MODULES_VALUE, MODULE_OPTIONS, RANGE_OPTIONS } from '../constants'

interface UsageFilterBarProps {
    module: AiUsageModule | null
    range: AiUsageRange
    onChangeModule: (module: AiUsageModule | null) => void
    onChangeRange: (range: AiUsageRange) => void
}

export function UsageFilterBar({ module, range, onChangeModule, onChangeRange }: UsageFilterBarProps): JSX.Element {
    /** 占位值还原成 null，其余值经白名单收窄后才下发 */
    const handleModuleChange = (value: string): void => {
        onChangeModule(isAiUsageModule(value) ? value : null)
    }

    /** 时间范围同样只放行枚举内的值，非法值直接忽略 */
    const handleRangeChange = (value: string): void => {
        if (isAiUsageRange(value)) {
            onChangeRange(value)
        }
    }

    return (
        <div className="flex flex-wrap items-center gap-2">
            <Select value={module ?? ALL_MODULES_VALUE} onValueChange={handleModuleChange}>
                <SelectTrigger size="sm" aria-label="模块筛选">
                    <SelectValue placeholder="模块筛选" />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        <SelectItem value={ALL_MODULES_VALUE}>全部模块</SelectItem>
                        {MODULE_OPTIONS.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                                {item.label}
                            </SelectItem>
                        ))}
                    </SelectGroup>
                </SelectContent>
            </Select>
            <Select value={range} onValueChange={handleRangeChange}>
                <SelectTrigger size="sm" aria-label="时间筛选">
                    <SelectValue placeholder="时间筛选" />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        {RANGE_OPTIONS.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                                {item.label}
                            </SelectItem>
                        ))}
                    </SelectGroup>
                </SelectContent>
            </Select>
        </div>
    )
}
