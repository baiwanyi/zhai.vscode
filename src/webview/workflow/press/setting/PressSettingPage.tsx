/**
 * 作品设定页：写作流程的第二步，按「基本信息 / 故事内核 / 世界观 / 金手指 / 写作风格」收集作品级输入。
 * 复用约定：表单控件全部取自 @components/ui 的 field、input、textarea、select、toggle 与 progress，
 * 分组卡由 SettingSection 承载，标签型字段由 TagField 承载，完整度与缺项判断来自 ../utils。
 * 关键约束：页面只向上抛出字段补丁，不直接改文件；缺失字段仅以徽标提示、不阻断下一步；
 * 「提取」只把素材归纳结果交给父级合并，是否覆盖已填内容由父级决定；
 * 所有输入控件都必须与 label 建立 id 关联，数字输入在清空时回退为 0 而不是 NaN。
 */
import { ArrowRight, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@components/ui/badge'
import { Button } from '@components/ui/button'
import { Field, FieldDescription, FieldLabel, FieldTitle } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { Progress } from '@components/ui/progress'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import { Textarea } from '@components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@components/ui/toggle-group'
import type { PressExtractedSetting } from '@shared/types/press'
import { SettingSection } from './SettingSection'
import { TagField } from './TagField'
import { useSettingExtract } from './useSettingExtract'
import type { Audience, EndingKind, ProjectSetting } from '../types'
import type { JSX } from 'react'
import {
    AUDIENCE_OPTIONS,
    BANNED_OPTIONS,
    ENDING_OPTIONS,
    GENRE_OPTIONS,
    GOLDEN_FINGER_TYPES,
    PERSPECTIVE_OPTIONS,
} from '../constants'
import { PressFlowSteps } from '../layout/PressFlowSteps'
import { computeSettingCompleteness, isSettingFieldMissing } from '../utils'

/** 分组键：与下方 SECTION_FIELDS 一一对应，决定「补齐缺失项」展开哪一段 */
type SectionKey = 'basic' | 'story' | 'world' | 'power' | 'style'

/** 分组与字段的映射：缺项判断只看这些字段 */
const SECTION_FIELDS: Readonly<Record<SectionKey, readonly (keyof ProjectSetting)[]>> = {
    basic: ['title', 'penName', 'audience', 'wordGoal', 'genres'],
    story: ['logline', 'conflict', 'ending'],
    world: ['worldview', 'geography', 'era', 'factions', 'powerSystem', 'concepts', 'taboo'],
    power: ['goldenFingerType', 'goldenFingerAbility', 'goldenFingerCost'],
    style: ['perspective', 'tone', 'references', 'banned'],
}

const SECTION_ORDER: readonly SectionKey[] = ['basic', 'story', 'world', 'power', 'style']

interface PressSettingPageProps {
    setting: ProjectSetting
    /** 当前作品目录：提取从该作品的 _import 素材读起 */
    dirPath: string
    onChange: (patch: Partial<ProjectSetting>) => void
    onSelectStep: (step: number) => void
    onNext: () => void
    /** 合并提取出的设定草案，返回实际填入的字段数（只填空字段） */
    onExtractSetting: (draft: PressExtractedSetting) => number
}

export function PressSettingPage({
    setting,
    dirPath,
    onChange,
    onSelectStep,
    onNext,
    onExtractSetting,
}: PressSettingPageProps): JSX.Element {
    const [openSections, setOpenSections] = useState<SectionKey[]>(['basic', 'story'])
    const { isExtracting, extract } = useSettingExtract(dirPath)
    const completeness = computeSettingCompleteness(setting)

    const handleExtract = (): void => {
        const run = async (): Promise<void> => {
            const result = await extract()
            if (result === null) {
                return
            }
            if (result.setting === null) {
                toast.info(result.message)
                return
            }
            const filled = onExtractSetting(result.setting)
            if (filled === 0) {
                toast.info('提取到的字段都已填写，未改动现有内容')
                return
            }
            toast.success(`已填入 ${String(filled)} 个空字段，共 ${String(result.setting.clues.length)} 章线索供核对`)
        }
        void run()
    }

    const isSectionIncomplete = (key: SectionKey): boolean =>
        SECTION_FIELDS[key].some((field) => isSettingFieldMissing(setting, field))

    const handleOpenChange = (key: SectionKey, isOpen: boolean): void => {
        setOpenSections((previous) =>
            isOpen ? [...previous.filter((item) => item !== key), key] : previous.filter((item) => item !== key),
        )
    }

    /** 补齐缺失项：只展开第一个缺项分组，不自动填写任何内容，避免替作者做决定 */
    const handleRevealMissing = (): void => {
        const missing = SECTION_ORDER.find((key) => isSectionIncomplete(key))
        if (!missing) {
            return
        }
        setOpenSections((previous) => (previous.includes(missing) ? previous : [...previous, missing]))
    }

    const handleEndingChange = (value: string): void => {
        const next: EndingKind | undefined = ENDING_OPTIONS.find((option) => option.value === value)?.value
        if (next) {
            onChange({ ending: next })
        }
    }

    const handleAudienceChange = (value: string): void => {
        if (value.length === 0) {
            return
        }
        const next: Audience | undefined = AUDIENCE_OPTIONS.find((option) => option.value === value)?.value
        if (next) {
            onChange({ audience: next })
        }
    }

    const handleWordGoalChange = (value: string): void => {
        const parsed = Number(value)
        onChange({ wordGoal: Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0 })
    }

    return (
        <div className="@container flex h-full min-h-0 flex-col gap-2 p-3">
            <header className="flex flex-col gap-1.5">
                <PressFlowSteps current={2} onSelect={onSelectStep} />
                <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                        <h2 className="truncate font-heading font-semibold">作品设定</h2>
                        <p className="truncate text-muted-foreground">题材、梗概与金手指决定后续大纲的生成质量</p>
                    </div>
                    <Badge variant="outline" className="shrink-0 tabular-nums">
                        完整度 {completeness}%
                    </Badge>
                </div>
                <Progress value={completeness} aria-label={`设定完整度 ${completeness}%`} />
            </header>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-0.5">
                <SettingSection
                    title="基本信息"
                    description="作品名、受众与篇幅"
                    isIncomplete={isSectionIncomplete('basic')}
                    isOpen={openSections.includes('basic')}
                    onOpenChange={(isOpen) => handleOpenChange('basic', isOpen)}
                >
                    <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
                        <Field>
                            <FieldLabel htmlFor="setting-title">作品名</FieldLabel>
                            <Input
                                id="setting-title"
                                value={setting.title}
                                className="h-7"
                                onChange={(event) => onChange({ title: event.target.value })}
                            />
                            <FieldDescription>与作品目录名保持一致，重命名需在文件系统完成</FieldDescription>
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="setting-pen-name">笔名</FieldLabel>
                            <Input
                                id="setting-pen-name"
                                value={setting.penName}
                                className="h-7"
                                onChange={(event) => onChange({ penName: event.target.value })}
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="setting-word-goal">预计字数</FieldLabel>
                            <Input
                                id="setting-word-goal"
                                type="number"
                                min={0}
                                step={10000}
                                value={setting.wordGoal > 0 ? setting.wordGoal : ''}
                                className="h-7 tabular-nums"
                                onChange={(event) => handleWordGoalChange(event.target.value)}
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="setting-audience">目标读者</FieldLabel>
                            <Select value={setting.audience} onValueChange={handleAudienceChange}>
                                <SelectTrigger id="setting-audience" className="h-7 w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {AUDIENCE_OPTIONS.map((option) => (
                                            <SelectItem key={option.value} value={option.value}>
                                                {option.label}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </Field>
                        <Field className="@md:col-span-2">
                            <FieldLabel htmlFor="setting-genres">题材类型</FieldLabel>
                            <TagField
                                inputId="setting-genres"
                                value={setting.genres}
                                options={GENRE_OPTIONS}
                                placeholder="自定义题材，回车添加"
                                onChange={(genres) => onChange({ genres })}
                            />
                        </Field>
                    </div>
                </SettingSection>

                <SettingSection
                    title="故事内核"
                    description="一句话说清这本书"
                    isIncomplete={isSectionIncomplete('story')}
                    isOpen={openSections.includes('story')}
                    onOpenChange={(isOpen) => handleOpenChange('story', isOpen)}
                >
                    <Field>
                        <FieldLabel htmlFor="setting-logline">一句话梗概</FieldLabel>
                        <Textarea
                            id="setting-logline"
                            value={setting.logline}
                            placeholder="谁，在什么处境下，要做什么，代价是什么"
                            className="min-h-16"
                            maxLength={120}
                            onChange={(event) => onChange({ logline: event.target.value })}
                        />
                        <FieldDescription className="tabular-nums">
                            还可输入 {120 - setting.logline.length} 字
                        </FieldDescription>
                    </Field>
                    <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
                        <Field>
                            <FieldLabel htmlFor="setting-conflict">核心冲突</FieldLabel>
                            <Input
                                id="setting-conflict"
                                value={setting.conflict}
                                className="h-7"
                                onChange={(event) => onChange({ conflict: event.target.value })}
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="setting-ending">结局倾向</FieldLabel>
                            <Select value={setting.ending} onValueChange={handleEndingChange}>
                                <SelectTrigger id="setting-ending" className="h-7 w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {ENDING_OPTIONS.map((option) => (
                                            <SelectItem key={option.value} value={option.value}>
                                                {option.label}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </Field>
                    </div>
                </SettingSection>

                <SettingSection
                    title="世界观"
                    description="世界形态、地理、势力与规则体系"
                    isIncomplete={isSectionIncomplete('world')}
                    isOpen={openSections.includes('world')}
                    onOpenChange={(isOpen) => handleOpenChange('world', isOpen)}
                >
                    <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
                        <Field className="@md:col-span-2">
                            <FieldLabel htmlFor="setting-worldview">世界观总述</FieldLabel>
                            <Textarea
                                id="setting-worldview"
                                value={setting.worldview}
                                placeholder="世界的形态、历史沿革、种族与文明结构"
                                className="min-h-24"
                                onChange={(event) => onChange({ worldview: event.target.value })}
                            />
                            <FieldDescription>
                                导入作品时会依据设定候选章归纳这一段，续写时的风格注入首先读它
                            </FieldDescription>
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="setting-geography">地理格局</FieldLabel>
                            <Input
                                id="setting-geography"
                                value={setting.geography}
                                placeholder="主要地域、场景与空间关系"
                                className="h-7"
                                onChange={(event) => onChange({ geography: event.target.value })}
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="setting-era">时代舞台</FieldLabel>
                            <Input
                                id="setting-era"
                                value={setting.era}
                                className="h-7"
                                onChange={(event) => onChange({ era: event.target.value })}
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="setting-factions">势力格局</FieldLabel>
                            <Input
                                id="setting-factions"
                                value={setting.factions}
                                className="h-7"
                                onChange={(event) => onChange({ factions: event.target.value })}
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="setting-power-system">力量体系</FieldLabel>
                            <Input
                                id="setting-power-system"
                                value={setting.powerSystem}
                                className="h-7"
                                onChange={(event) => onChange({ powerSystem: event.target.value })}
                            />
                        </Field>
                        <Field className="@md:col-span-2">
                            <FieldLabel htmlFor="setting-concepts">核心概念</FieldLabel>
                            <Textarea
                                id="setting-concepts"
                                value={setting.concepts}
                                placeholder="作品独有的名词与规则，如「灵气：天地间的能量，可被修士吸纳」"
                                className="min-h-20"
                                onChange={(event) => onChange({ concepts: event.target.value })}
                            />
                            <FieldDescription>独有名词是续写时不跑偏的关键，多个概念用分号分隔</FieldDescription>
                        </Field>
                        <Field className="@md:col-span-2">
                            <FieldLabel htmlFor="setting-taboo">禁忌设定</FieldLabel>
                            <Input
                                id="setting-taboo"
                                value={setting.taboo}
                                className="h-7"
                                onChange={(event) => onChange({ taboo: event.target.value })}
                            />
                        </Field>
                    </div>
                </SettingSection>

                <SettingSection
                    title="金手指"
                    description="能力、代价与成长"
                    isIncomplete={isSectionIncomplete('power')}
                    isOpen={openSections.includes('power')}
                    onOpenChange={(isOpen) => handleOpenChange('power', isOpen)}
                >
                    <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
                        <Field>
                            <FieldLabel htmlFor="setting-golden-type">类型</FieldLabel>
                            <Input
                                id="setting-golden-type"
                                value={setting.goldenFingerType}
                                list="golden-finger-types"
                                className="h-7"
                                onChange={(event) => onChange({ goldenFingerType: event.target.value })}
                            />
                            <datalist id="golden-finger-types">
                                {GOLDEN_FINGER_TYPES.map((type) => (
                                    <option key={type} value={type} />
                                ))}
                            </datalist>
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="setting-golden-ability">能力描述</FieldLabel>
                            <Input
                                id="setting-golden-ability"
                                value={setting.goldenFingerAbility}
                                className="h-7"
                                onChange={(event) => onChange({ goldenFingerAbility: event.target.value })}
                            />
                        </Field>
                        <Field className="@md:col-span-2">
                            <FieldLabel htmlFor="setting-golden-cost">代价与限制</FieldLabel>
                            <Input
                                id="setting-golden-cost"
                                value={setting.goldenFingerCost}
                                className="h-7"
                                onChange={(event) => onChange({ goldenFingerCost: event.target.value })}
                            />
                            <FieldDescription>没有代价的金手指会削弱冲突，建议至少写一条限制</FieldDescription>
                        </Field>
                    </div>
                </SettingSection>

                <SettingSection
                    title="写作风格"
                    description="人称、语感与雷点"
                    isIncomplete={isSectionIncomplete('style')}
                    isOpen={openSections.includes('style')}
                    onOpenChange={(isOpen) => handleOpenChange('style', isOpen)}
                >
                    <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
                        <Field>
                            <FieldTitle>叙事人称</FieldTitle>
                            <ToggleGroup
                                type="single"
                                aria-label="叙事人称"
                                value={setting.perspective}
                                className="flex-wrap"
                                onValueChange={(value) => {
                                    if (value.length > 0) {
                                        onChange({ perspective: value })
                                    }
                                }}
                            >
                                {PERSPECTIVE_OPTIONS.map((option) => (
                                    <ToggleGroupItem key={option} value={option} variant="outline">
                                        {option}
                                    </ToggleGroupItem>
                                ))}
                            </ToggleGroup>
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="setting-tone">语言风格</FieldLabel>
                            <Input
                                id="setting-tone"
                                value={setting.tone}
                                className="h-7"
                                onChange={(event) => onChange({ tone: event.target.value })}
                            />
                        </Field>
                        <Field className="@md:col-span-2">
                            <FieldLabel htmlFor="setting-references">参考作品</FieldLabel>
                            <Input
                                id="setting-references"
                                value={setting.references}
                                className="h-7"
                                onChange={(event) => onChange({ references: event.target.value })}
                            />
                        </Field>
                        <Field className="@md:col-span-2">
                            <FieldLabel htmlFor="setting-banned">禁写清单</FieldLabel>
                            <TagField
                                inputId="setting-banned"
                                value={setting.banned}
                                options={BANNED_OPTIONS}
                                placeholder="自定义雷点，回车添加"
                                onChange={(banned) => onChange({ banned })}
                            />
                            <FieldDescription>续写与改写会避开清单内的元素</FieldDescription>
                        </Field>
                    </div>
                </SettingSection>
            </div>
            <footer className="flex items-center gap-2">
                <Button variant="ghost" onClick={handleRevealMissing}>
                    <Sparkles />
                    补齐缺失项
                </Button>
                <Button
                    variant="outline"
                    title="按设定候选章（世界构建与金手指关键词命中章）的摘录与摘要归纳世界观、规则与核心概念（调用 AI），只填空字段"
                    disabled={isExtracting}
                    onClick={handleExtract}
                >
                    <Sparkles />
                    {isExtracting ? '提取中' : '提取'}
                </Button>
                <span className="flex-1" />
                <Button onClick={onNext}>
                    下一步：设定人物
                    <ArrowRight data-icon="inline-end" />
                </Button>
            </footer>
        </div>
    )
}
