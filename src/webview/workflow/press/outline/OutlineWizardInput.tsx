/**
 * 生成大纲向导第一步：确认已就绪的设定摘要，并收窄卷数、章数与节奏等生成参数。
 * 复用约定：摘要项复用 ui/item（标签用 ItemDescription、值用 ItemTitle），参数行复用 ui/field 与语义令牌；
 * 节奏用 ui/toggle-group 单选，结构模板用 ui/select，数字参数用 ui/input 的紧凑尺寸。
 * 关键约束：数字参数必须自行钳制到合理区间，清空时回退为默认值而不是 0；
 * 缺失一句话梗概时不阻断生成，只用提示条说明「梗概为空会导致章纲雷同」。
 */
import { Alert, AlertDescription } from '@components/ui/alert'
import { Field, FieldDescription, FieldLabel, FieldTitle } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { Item, ItemContent, ItemDescription, ItemTitle } from '@components/ui/item'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import { SegmentedRail } from '@webview/components/SegmentedRail'
import type { CharacterCard, ProjectSetting } from '../types'
import type { OutlineDraftOptions } from '../utils'
import type { JSX } from 'react'
import { PACING_OPTIONS, STRUCTURE_OPTIONS } from '../constants'
import { formatWordCount } from '../utils'

interface OutlineWizardInputProps {
    setting: ProjectSetting
    characters: CharacterCard[]
    options: OutlineDraftOptions
    onChangeOptions: (patch: Partial<OutlineDraftOptions>) => void
}

/** 数字参数的安全区间：避免一次生成上千章把树撑爆 */
const LIMITS = {
    volumeCount: { min: 1, max: 8 },
    chaptersPerVolume: { min: 3, max: 40 },
    chapterWordGoal: { min: 1000, max: 6000 },
} as const

function clamp(value: number, min: number, max: number, fallback: number): number {
    if (!Number.isFinite(value)) {
        return fallback
    }
    return Math.min(max, Math.max(min, Math.round(value)))
}

export function OutlineWizardInput({
    setting,
    characters,
    options,
    onChangeOptions,
}: OutlineWizardInputProps): JSX.Element {
    const protagonist = characters.find((character) => character.role === 'protagonist')
    const totalChapters = options.volumeCount * options.chaptersPerVolume

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
                <FieldTitle>已就绪的设定</FieldTitle>
                <div className="grid grid-cols-1 gap-1.5 @md:grid-cols-2">
                    <Item size="xs" variant="outline" className="flex-col items-start gap-0 bg-muted/30">
                        <ItemContent className="gap-0.5">
                            <ItemDescription>题材 / 受众</ItemDescription>
                            <ItemTitle className="max-w-full">
                                {setting.genres.length > 0 ? setting.genres.join('、') : '未填写'} · {setting.audience}
                            </ItemTitle>
                        </ItemContent>
                    </Item>
                    <Item size="xs" variant="outline" className="flex-col items-start gap-0 bg-muted/30">
                        <ItemContent className="gap-0.5">
                            <ItemDescription>预计篇幅</ItemDescription>
                            <ItemTitle className="max-w-full tabular-nums">
                                {formatWordCount(setting.wordGoal)} 字
                            </ItemTitle>
                        </ItemContent>
                    </Item>
                    <Item size="xs" variant="outline" className="flex-col items-start gap-0 bg-muted/30">
                        <ItemContent className="gap-0.5">
                            <ItemDescription>主角</ItemDescription>
                            <ItemTitle className="max-w-full">{protagonist?.name ?? '尚未创建主角'}</ItemTitle>
                        </ItemContent>
                    </Item>
                    <Item size="xs" variant="outline" className="flex-col items-start gap-0 bg-muted/30">
                        <ItemContent className="gap-0.5">
                            <ItemDescription>金手指</ItemDescription>
                            <ItemTitle className="max-w-full">{setting.goldenFingerType || '未填写'}</ItemTitle>
                        </ItemContent>
                    </Item>
                    <Item size="xs" variant="outline" className="flex-col items-start gap-0 bg-muted/30 @md:col-span-2">
                        <ItemContent className="gap-0.5">
                            <ItemDescription>一句话梗概</ItemDescription>
                            <ItemTitle className="max-w-full">
                                {setting.logline.length > 0 ? setting.logline : '未填写'}
                            </ItemTitle>
                        </ItemContent>
                    </Item>
                </div>
                {setting.logline.trim().length === 0 ? (
                    <Alert>
                        <AlertDescription>梗概为空时，各章推进描述会趋于雷同，建议先补一句话梗概。</AlertDescription>
                    </Alert>
                ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
                <FieldTitle>生成参数</FieldTitle>
                <div className="grid grid-cols-1 gap-3 @md:grid-cols-3">
                    <Field>
                        <FieldLabel htmlFor="wizard-volume-count">卷数</FieldLabel>
                        <Input
                            id="wizard-volume-count"
                            type="number"
                            min={LIMITS.volumeCount.min}
                            max={LIMITS.volumeCount.max}
                            value={options.volumeCount}
                            className="h-7 tabular-nums"
                            onChange={(event) =>
                                onChangeOptions({
                                    volumeCount: clamp(
                                        Number(event.target.value),
                                        LIMITS.volumeCount.min,
                                        LIMITS.volumeCount.max,
                                        options.volumeCount,
                                    ),
                                })
                            }
                        />
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="wizard-chapters-per-volume">每卷章节数</FieldLabel>
                        <Input
                            id="wizard-chapters-per-volume"
                            type="number"
                            min={LIMITS.chaptersPerVolume.min}
                            max={LIMITS.chaptersPerVolume.max}
                            value={options.chaptersPerVolume}
                            className="h-7 tabular-nums"
                            onChange={(event) =>
                                onChangeOptions({
                                    chaptersPerVolume: clamp(
                                        Number(event.target.value),
                                        LIMITS.chaptersPerVolume.min,
                                        LIMITS.chaptersPerVolume.max,
                                        options.chaptersPerVolume,
                                    ),
                                })
                            }
                        />
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="wizard-chapter-word-goal">单章字数</FieldLabel>
                        <Input
                            id="wizard-chapter-word-goal"
                            type="number"
                            min={LIMITS.chapterWordGoal.min}
                            max={LIMITS.chapterWordGoal.max}
                            step={500}
                            value={options.chapterWordGoal}
                            className="h-7 tabular-nums"
                            onChange={(event) =>
                                onChangeOptions({
                                    chapterWordGoal: clamp(
                                        Number(event.target.value),
                                        LIMITS.chapterWordGoal.min,
                                        LIMITS.chapterWordGoal.max,
                                        options.chapterWordGoal,
                                    ),
                                })
                            }
                        />
                    </Field>
                </div>
                <Field>
                    <FieldLabel htmlFor="wizard-structure">结构模板</FieldLabel>
                    <Select
                        value={options.structure}
                        onValueChange={(value) => {
                            if (value.length > 0) {
                                onChangeOptions({ structure: value })
                            }
                        }}
                    >
                        <SelectTrigger id="wizard-structure" className="h-7 w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {STRUCTURE_OPTIONS.map((structure) => (
                                    <SelectItem key={structure} value={structure}>
                                        {structure}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                    <FieldDescription>模板只决定各卷的阶段命名与节奏分布，不生成具体情节</FieldDescription>
                </Field>
                <Field>
                    <FieldLabel htmlFor="wizard-pacing">节奏偏好</FieldLabel>
                    <SegmentedRail
                        items={PACING_OPTIONS}
                        value={options.pacing}
                        onChange={(pacing) => {
                            const next = PACING_OPTIONS.find((option) => option.value === pacing)
                            if (next) {
                                onChangeOptions({ pacing: next.value })
                            }
                        }}
                        ariaLabel="节奏偏好"
                        variant="chip"
                    />
                    <FieldDescription className="tabular-nums">
                        将展开 {options.volumeCount} 卷、共 {totalChapters} 章，约{' '}
                        {formatWordCount(totalChapters * options.chapterWordGoal)} 字
                    </FieldDescription>
                </Field>
            </div>
        </div>
    )
}
