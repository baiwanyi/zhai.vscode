/**
 * 作品设定字段组：按作品信息（封面、作品名、笔名、篇幅、章节字数、目标读者）、
 * 题材定位（时间、地点、标签、结局倾向）、写作风格（叙事视角、叙事结构、语言风格、参考作品、规避内容）
 * 与故事内核（简介、一句话梗概、开篇灵感、核心冲突、补充信息）四段排列。
 * 复用约定：段容器取 @components/ui 的 field 之 FieldSet + FieldLegend，字段网格取 FieldGroup，
 * 单字段控件取 input / textarea / select；标签与规避内容都取 TagPicker（分组弹层 + 自定义输入），
 * 其余单选走 SegmentedRail（选项带悬停说明）；封面由 CoverFigure 只读展示，选项与标签库统一来自
 * ./settingOptions；带 AI 生成的五个字段统一取 @webview/components/AiTextareaField
 * （输入组 + 生成按钮 + 生成态光晕），故事内核四项由 STORY_FIELDS 数据驱动渲染；
 * 时间 / 地点与写作风格三组选择，分别收在同文件的 PlainSelectField 与 ChipChoiceField 里。
 * 关键约束：作品名与目录名一一对应；多行字段写入文档时统一折成单行；篇幅 0 表示不限；
 * 封面只读，出图与换设都在生图页完成；故事内核四个字段的字数上限取 SETTING_FIELD_MAX_LENGTH，
 * 输入与 AI 生成结果共用同一份口径；标签按目标读者取库，切换受众只换候选；
 * 题材标签与规避内容各自独立计上限，互不占用额度；忙碌字段由页面持有，本组件只按字段渲染按钮状态。
 */
import {
    Field,
    FieldDescription,
    FieldGroup,
    FieldLabel,
    FieldLegend,
    FieldSeparator,
    FieldSet,
    FieldTitle,
} from '@components/ui/field'
import { Input } from '@components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import { Textarea } from '@components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@components/ui/toggle-group'
import type { SettingFieldKey } from '@shared/types/press'
import { AiTextareaField } from '@webview/components/AiTextareaField'
import { CoverFigure } from '@webview/components/CoverFigure'
import { SegmentedRail } from '@webview/components/SegmentedRail'
import type { SegmentedRailItem } from '@webview/components/SegmentedRail'
import {
    AUDIENCE_OPTIONS,
    AUDIENCE_TAG_GROUPS,
    BANNED_GROUPS,
    BANNED_MAX_COUNT,
    ENDING_OPTIONS,
    LENGTH_OPTIONS,
    NARRATIVE_STRUCTURE_OPTIONS,
    PERIOD_OPTIONS,
    PERSPECTIVE_OPTIONS,
    PLACE_OPTIONS,
    TAG_MAX_COUNT,
    TONE_OPTIONS,
} from './settingOptions'
import { TagPicker } from './TagPicker'
import { useSettingCover } from './useSettingCover'
import type { SettingFieldsProps } from './sections'
import type { Audience } from '../types'
import type { JSX } from 'react'
import { DEFAULT_CHAPTER_WORD_GOAL, SETTING_FIELD_MAX_LENGTH } from '../constants'
import { toSettingTextPatch } from '../utils'

/** 字段级 AI 生成状态：忙碌字段与触发回调由页面持有，切分组不会打断在途请求 */
export interface SettingFieldAi {
    /** 正在生成的字段：null 表示空闲 */
    generatingField: SettingFieldKey | null
    onGenerate: (field: SettingFieldKey) => void
}

interface SettingBasicFieldsProps extends SettingFieldsProps {
    fieldAi: SettingFieldAi
}

/** 故事内核里带 AI 生成的四个字段：key 同时是设定字段名与宿主生成字段键 */
type StoryFieldKey = Extract<SettingFieldKey, 'summary' | 'logline' | 'opening' | 'conflict'>

interface StoryFieldMeta {
    key: StoryFieldKey
    label: string
    placeholder: string
}

/** 故事内核的字段顺序与文案：篇幅上限统一取 SETTING_FIELD_MAX_LENGTH */
const STORY_FIELDS: readonly StoryFieldMeta[] = [
    { key: 'summary', label: '简介', placeholder: '故事的核心看点：主角是谁、要做什么、好看在哪里' },
    { key: 'logline', label: '一句话梗概', placeholder: '谁，在什么处境下，要做什么，代价是什么' },
    { key: 'opening', label: '开篇灵感', placeholder: '第一章从哪个画面或事件切入，最好带一个钩子' },
    { key: 'conflict', label: '核心冲突', placeholder: '主角要什么、谁在阻拦、失败会失去什么' },
]

/** 写作风格三组选择的标题：比普通字段名更轻，避免与段标题抢层级 */
const CHOICE_TITLE_CLASS = 'text-muted-foreground text-xs font-light'

export function PressSettingBasicFields({ setting, dirPath, onChange, fieldAi }: SettingBasicFieldsProps): JSX.Element {
    const { generatingField, onGenerate } = fieldAi
    /** 任一字段在生成时按钮全部禁用：一次只跑一项，避免并发请求 */
    const isBusy = generatingField !== null
    /** 历史作品的字数可能不在档位内：下拉补一项原值，避免改版后显示空白 */
    const isCustomLength = setting.wordGoal > 0 && !LENGTH_OPTIONS.some((option) => option.value === setting.wordGoal)

    const handleAudienceChange = (value: string): void => {
        if (value.length === 0) {
            return
        }
        const next: Audience | undefined = AUDIENCE_OPTIONS.find((option) => option.value === value)?.value
        if (next) {
            onChange({ audience: next })
        }
    }

    /** 篇幅选「不限」时落 0，与 isSettingFieldMissing 的数字判定口径一致 */
    const handleLengthChange = (value: string): void => {
        const parsed = Number(value)
        onChange({ wordGoal: Number.isFinite(parsed) && parsed > 0 ? parsed : 0 })
    }

    const handleChapterWordGoalChange = (value: string): void => {
        const parsed = Number(value)
        onChange({
            chapterWordGoal: Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : DEFAULT_CHAPTER_WORD_GOAL,
        })
    }

    return (
        <FieldGroup className="gap-7">
            <FieldSet>
                <FieldGroup className="grid grid-cols-1 items-start gap-5 @md:grid-cols-3">
                    <Field>
                        <FieldTitle>作品封面</FieldTitle>
                        <SettingCoverFigure dirPath={dirPath} title={setting.title} />
                    </Field>
                    <FieldGroup className="gap-3 @md:col-span-2">
                        <AiTextareaField
                            id="setting-title"
                            label="作品名"
                            value={setting.title}
                            isGenerating={generatingField === 'title'}
                            isDisabled={isBusy}
                            generateLabel="AI 生成作品名"
                            onChange={(title) => onChange({ title })}
                            onGenerate={() => onGenerate('title')}
                        />
                        <Field>
                            <FieldLabel htmlFor="setting-pen-name">笔名</FieldLabel>
                            <Input
                                id="setting-pen-name"
                                value={setting.penName}
                                onChange={(event) => onChange({ penName: event.target.value })}
                            />
                        </Field>
                        <FieldGroup className="grid grid-cols-2 gap-3">
                            <Field>
                                <FieldLabel htmlFor="setting-length">篇幅</FieldLabel>
                                <Select value={String(setting.wordGoal)} onValueChange={handleLengthChange}>
                                    <SelectTrigger id="setting-length">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {isCustomLength ? (
                                                <SelectItem value={String(setting.wordGoal)}>
                                                    {`${String(setting.wordGoal)} 字`}
                                                </SelectItem>
                                            ) : null}
                                            {LENGTH_OPTIONS.map((option) => (
                                                <SelectItem key={option.value} value={String(option.value)}>
                                                    {option.label}
                                                </SelectItem>
                                            ))}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            </Field>
                            <Field>
                                <FieldLabel htmlFor="setting-chapter-words">章节字数</FieldLabel>
                                <Input
                                    id="setting-chapter-words"
                                    type="number"
                                    min={0}
                                    step={500}
                                    value={setting.chapterWordGoal > 0 ? setting.chapterWordGoal : ''}
                                    className="tabular-nums"
                                    onChange={(event) => handleChapterWordGoalChange(event.target.value)}
                                />
                            </Field>
                        </FieldGroup>
                        <Field>
                            <FieldTitle id="setting-audience-label">目标读者</FieldTitle>
                            <ToggleGroup
                                type="single"
                                variant="outline"
                                size="sm"
                                spacing={0}
                                value={setting.audience}
                                aria-labelledby="setting-audience-label"
                                onValueChange={handleAudienceChange}
                            >
                                {AUDIENCE_OPTIONS.map((option) => (
                                    <ToggleGroupItem key={option.value} value={option.value} className="flex-1">
                                        {option.label}
                                    </ToggleGroupItem>
                                ))}
                            </ToggleGroup>
                        </Field>
                    </FieldGroup>
                </FieldGroup>
            </FieldSet>

            <FieldSeparator />

            <FieldSet>
                <FieldLegend variant="label">题材定位</FieldLegend>
                <FieldGroup className="grid grid-cols-1 gap-5 @md:grid-cols-2">
                    <PlainSelectField
                        id="setting-period"
                        label="时间"
                        value={setting.period}
                        options={PERIOD_OPTIONS}
                        onChange={(period) => onChange({ period })}
                    />
                    <PlainSelectField
                        id="setting-place"
                        label="地点"
                        value={setting.place}
                        options={PLACE_OPTIONS}
                        onChange={(place) => onChange({ place })}
                    />
                    <Field className="@md:col-span-2">
                        <FieldTitle>标签</FieldTitle>
                        <TagPicker
                            groups={AUDIENCE_TAG_GROUPS[setting.audience]}
                            value={setting.genres}
                            placeholder="点击选择标签，支持自定义"
                            max={TAG_MAX_COUNT}
                            onChange={(genres) => onChange({ genres })}
                        />
                        <FieldDescription>
                            标注作品题材，候选随目标读者切换；换受众只换候选，已选标签保留
                        </FieldDescription>
                    </Field>
                    <Field className="@md:col-span-2">
                        <FieldTitle>结局倾向</FieldTitle>
                        <SegmentedRail
                            items={ENDING_OPTIONS}
                            value={setting.ending}
                            onChange={(ending) => onChange({ ending })}
                            ariaLabel="结局倾向"
                            variant="chip"
                            size="sm"
                        />
                    </Field>
                </FieldGroup>
            </FieldSet>

            <FieldSeparator />

            <FieldSet>
                <FieldLegend variant="label">写作风格</FieldLegend>
                <FieldGroup className="grid grid-cols-1 gap-5 @md:grid-cols-2">
                    <ChipChoiceField
                        label="叙事视角"
                        items={PERSPECTIVE_OPTIONS}
                        value={setting.perspective}
                        onChange={(perspective) => onChange({ perspective })}
                    />
                    <ChipChoiceField
                        label="叙事结构"
                        items={NARRATIVE_STRUCTURE_OPTIONS}
                        value={setting.narrative}
                        onChange={(narrative) => onChange({ narrative })}
                    />
                    <ChipChoiceField
                        label="语言风格"
                        items={TONE_OPTIONS}
                        value={setting.tone}
                        onChange={(tone) => onChange({ tone })}
                    />
                    <Field className="@md:col-span-2">
                        <FieldTitle>规避内容</FieldTitle>
                        <TagPicker
                            groups={BANNED_GROUPS}
                            value={setting.banned}
                            placeholder="点击选择毒点，支持自定义"
                            max={BANNED_MAX_COUNT}
                            onChange={(banned) => onChange({ banned })}
                        />
                    </Field>
                    <Field className="@md:col-span-2">
                        <FieldLabel htmlFor="setting-references">参考作品</FieldLabel>
                        <Input
                            id="setting-references"
                            value={setting.references}
                            onChange={(event) => onChange({ references: event.target.value })}
                        />
                    </Field>
                </FieldGroup>
            </FieldSet>

            <FieldSeparator />

            <FieldSet>
                <FieldLegend variant="label">故事内核</FieldLegend>
                <FieldGroup className="grid grid-cols-1 gap-5 @md:grid-cols-2 mb-6">
                    {STORY_FIELDS.map((field) => (
                        <AiTextareaField
                            key={field.key}
                            className="@md:col-span-2"
                            id={`setting-${field.key}`}
                            label={field.label}
                            value={setting[field.key]}
                            placeholder={field.placeholder}
                            maxLength={SETTING_FIELD_MAX_LENGTH[field.key]}
                            isGenerating={generatingField === field.key}
                            isDisabled={isBusy}
                            generateLabel={`AI 生成${field.label}`}
                            onChange={(value) => onChange(toSettingTextPatch(field.key, value))}
                            onGenerate={() => onGenerate(field.key)}
                        />
                    ))}
                    <Field className="@md:col-span-2">
                        <FieldLabel htmlFor="setting-extra">补充信息</FieldLabel>
                        <Textarea
                            id="setting-extra"
                            value={setting.extra}
                            placeholder="未归入以上字段的设定、灵感与备注"
                            onChange={(event) => onChange({ extra: event.target.value })}
                        />
                    </Field>
                </FieldGroup>
            </FieldSet>
        </FieldGroup>
    )
}

interface PlainSelectFieldProps<T extends string> {
    id: string
    label: string
    value: T
    options: readonly T[]
    onChange: (value: T) => void
}

/** 纯文本下拉：选项本身即取值与文案，回传前先按候选收窄，非法值不写回设定 */
function PlainSelectField<T extends string>({
    id,
    label,
    value,
    options,
    onChange,
}: PlainSelectFieldProps<T>): JSX.Element {
    const handleValueChange = (next: string): void => {
        const picked = options.find((option) => option === next)
        if (picked !== undefined) {
            onChange(picked)
        }
    }
    return (
        <Field>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            <Select value={value} onValueChange={handleValueChange}>
                <SelectTrigger id={id}>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        {options.map((option) => (
                            <SelectItem key={option} value={option}>
                                {option}
                            </SelectItem>
                        ))}
                    </SelectGroup>
                </SelectContent>
            </Select>
        </Field>
    )
}

interface ChipChoiceFieldProps<T extends string> {
    label: string
    items: readonly SegmentedRailItem<T>[]
    value: T
    onChange: (value: T) => void
}

/** 写作风格的选择行：标题样式统一走 CHOICE_TITLE_CLASS，选项带悬停说明 */
function ChipChoiceField<T extends string>({ label, items, value, onChange }: ChipChoiceFieldProps<T>): JSX.Element {
    return (
        <Field className="@md:col-span-2">
            <FieldTitle className={CHOICE_TITLE_CLASS}>{label}</FieldTitle>
            <SegmentedRail items={items} value={value} onChange={onChange} ariaLabel={label} variant="chip" size="sm" />
        </Field>
    )
}

interface SettingCoverFigureProps {
    /** 当前作品目录：封面从该作品的 Images 目录回读 */
    dirPath: string
    /** 作品名：用于封面替代文本 */
    title: string
}

/**
 * 作品封面：取当前选中封面，未设封面时退回最新一张。
 * 回读由 useSettingCover 承担，出图、设为封面与删除都在生图页完成，三态展示交给 CoverFigure。
 */
function SettingCoverFigure({ dirPath, title }: SettingCoverFigureProps): JSX.Element {
    const { cover, isLoading } = useSettingCover(dirPath)
    return (
        <CoverFigure
            src={cover?.url ?? null}
            isLoading={isLoading}
            alt={`《${title}》的封面`}
            emptyTitle="还没有作品封面"
            emptyDescription="在生图页为作品生成封面后，这里显示封面图"
        />
    )
}
