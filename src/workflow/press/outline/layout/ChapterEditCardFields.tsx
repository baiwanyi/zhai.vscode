/**
 * 章纲卡表单：章纲六项、钩子/地点/人物、节奏/张力/进度字段与正文事实只读区；POV、场景地点、本章节奏同排展示。
 * 复用约定：字段取 @components/ui 的 Field 体系，卡片取 ui/card 完整组合，下拉取 components/OptionSelect，
 * 章纲五项输入取 ui/input-group 的 InputGroup + InputGroupInput，标签内嵌为 InputGroupAddon + InputGroupText，
 * 人物选择取 press/layout/CharacterSelectField，
 * 场景地点取 SearchCombobox 并列出设定页的地点条目，字数格式化取 press/utils 的 formatWordCount，正文事实提示取 @webview/components/Alert。
 * 关键约束：所有改动只经 onChange 回传章纲补丁；目标字数由作品设定统一管理，本组件仅展示进度；
 * 正文字数用调用方收窄后的 writtenWords 展示；枚举下拉的非法值由传入的 handler 拦截，本组件不自行改写字段值。
 */
import { Info } from 'lucide-react'
import { useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card'
import { Field, FieldContent, FieldGroup, FieldLabel, FieldTitle } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { Progress } from '@components/ui/progress'
import { Slider } from '@components/ui/slider'
import { Alert } from '@webview/components/Alert'
import { InputTextGroup } from '@webview/components/InputTextGroup'
import { OptionSelect } from '@webview/components/OptionSelect'
import { SearchCombobox } from '@webview/components/SearchCombobox'
import type { SearchableGroup } from '@webview/components/SearchCombobox'
import type { CharacterCard, LoreEntry, OutlineChapter, PacingKind } from '../../types'
import type { JSX } from 'react'
import { HOOK_OPTIONS, PACING_KIND_OPTIONS } from '../../constants'
import { CharacterSelectField } from '../../layout/CharacterSelectField'
import { formatWordCount } from '../../utils'

/** 场景地点未指定哨兵：控制字符前缀避免与真实地点同名，回传时折回空串 */
const NO_LOCATION = '\u0000none'

interface ChapterEditCardFieldsProps {
    chapter: OutlineChapter
    characters: readonly CharacterCard[]
    /** 设定页地点条目：场景地点只从其中的 place 分类选取 */
    lore: readonly LoreEntry[]
    tensionLabel: string
    /** 单章目标字数：取自作品设定，用于进度文案 */
    chapterWordGoal: number
    writtenWords: number
    progress: number
    onHookChange: (value: string) => void
    onPacingChange: (value: PacingKind) => void
    onChange: (patch: Partial<OutlineChapter>) => void
}

/** 章纲卡：字段值全部来自 chapter，事件全部回传补丁，不持有本地状态 */
export function ChapterEditCardFields({
    chapter,
    characters,
    lore,
    tensionLabel,
    chapterWordGoal,
    writtenWords,
    progress,
    onHookChange,
    onPacingChange,
    onChange,
}: ChapterEditCardFieldsProps): JSX.Element {
    const locationGroups = useMemo<SearchableGroup[]>(() => {
        const placeNames = new Set(
            lore
                .filter((entry) => entry.kind === 'place' && entry.name.trim().length > 0)
                .map((entry) => entry.name),
        )
        const places = [...placeNames].map((name) => ({ value: name, label: name }))
        return [
            { label: '', options: [{ value: NO_LOCATION, label: '未指定' }] },
            ...(places.length > 0 ? [{ label: '设定地点', options: places }] : []),
        ]
    }, [lore])

    return (
        <Card size="sm">
            <CardHeader className="gap-2">
                <CardTitle>章纲卡</CardTitle>
                <CardDescription className="col-span-full flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                        <span className="text-foreground">正文进度</span>
                        <span className="tabular-nums text-muted-foreground">
                            {formatWordCount(writtenWords)} / {formatWordCount(chapterWordGoal)} 字
                        </span>
                    </div>
                    <Progress value={progress} aria-label={`正文进度 ${progress}%`} />
                </CardDescription>
            </CardHeader>
            <CardContent className="@container flex flex-col gap-3">
                {chapter.actualSummary.length > 0 ? (
                    <Alert title="正文事实" description={chapter.actualSummary} icon={<Info aria-hidden="true" />} />
                ) : null}
                <FieldGroup className="grid grid-cols-1 gap-2 @md:grid-cols-3">
                    <Field>
                        <FieldLabel htmlFor="outline-chapter-pov">POV</FieldLabel>
                        <Input
                            id="outline-chapter-pov"
                            value={chapter.pov}
                            placeholder="本章由谁的视角看"
                            onChange={(event) => onChange({ pov: event.target.value })}
                        />
                    </Field>
                    <Field>
                        <FieldLabel>场景地点</FieldLabel>
                        <SearchCombobox
                            label="场景地点"
                            value={chapter.location.length > 0 ? [chapter.location] : [NO_LOCATION]}
                            groups={locationGroups}
                            placeholder="搜索地点…"
                            emptyText="没有匹配的地点"
                            onChange={(values): void => {
                                const selected = values[values.length - 1]
                                onChange({
                                    location: selected === undefined || selected === NO_LOCATION ? '' : selected,
                                })
                            }}
                        />
                    </Field>
                    <Field>
                        <FieldTitle>本章节奏</FieldTitle>
                        <OptionSelect
                            ariaLabel="本章节奏"
                            value={chapter.pacing}
                            options={PACING_KIND_OPTIONS}
                            onChange={onPacingChange}
                        />
                    </Field>
                </FieldGroup>

                <FieldGroup className="grid grid-cols-1 gap-2 @md:grid-cols-2">
                    <Field>
                        <FieldLabel htmlFor="outline-chapter-hook">章末钩子</FieldLabel>
                        <OptionSelect
                            id="outline-chapter-hook"
                            value={chapter.hook}
                            options={HOOK_OPTIONS}
                            onChange={onHookChange}
                        />
                    </Field>
                    <CharacterSelectField
                        characters={characters}
                        label="出场人物"
                        value={chapter.characterIds}
                        multiple
                        onChange={(characterIds): void => onChange({ characterIds })}
                    />
                </FieldGroup>

                <FieldGroup className="grid grid-cols-1 gap-2">
                    <InputTextGroup
                        id="outline-chapter-goal"
                        value={chapter.goal}
                        label="目标"
                        placeholder="他此刻想得到什么"
                        onChange={(goal) => onChange({ goal })}
                    />
                    <InputTextGroup
                        id="outline-chapter-obstacle"
                        value={chapter.obstacle}
                        label="阻碍"
                        placeholder="谁 / 什么阻止他"
                        onChange={(obstacle) => onChange({ obstacle })}
                    />
                    <InputTextGroup
                        id="outline-chapter-turn"
                        value={chapter.turn}
                        label="转折"
                        placeholder="意料之外但合理的变化"
                        onChange={(turn) => onChange({ turn })}
                    />
                    <InputTextGroup
                        id="outline-chapter-result"
                        value={chapter.result}
                        label="结果"
                        placeholder="达成 / 失败 / 代价"
                        onChange={(result) => onChange({ result })}
                    />
                    <InputTextGroup
                        id="outline-chapter-emotion"
                        value={chapter.emotion}
                        label="情绪"
                        placeholder="紧张 / 爽 / 疑 / 悲"
                        onChange={(emotion) => onChange({ emotion })}
                    />
                </FieldGroup>

                <FieldGroup className="grid grid-cols-1 gap-2">
                    <Field>
                        <FieldTitle className="justify-between">
                            本章张力
                            <span className="shrink-0 text-muted-foreground">
                                {chapter.tension} {tensionLabel}
                            </span>
                        </FieldTitle>
                        <FieldContent>
                            <Slider
                                value={[chapter.tension]}
                                min={1}
                                max={5}
                                step={1}
                                aria-label="本章张力"
                                className="flex-1"
                                onValueChange={(values) => {
                                    const next = values[0]
                                    if (typeof next === 'number') {
                                        onChange({ tension: next })
                                    }
                                }}
                            />
                        </FieldContent>
                    </Field>
                </FieldGroup>
            </CardContent>
        </Card>
    )
}
