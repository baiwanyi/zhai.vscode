/**
 * 章纲元信息：章名、计划梗概、阶段与修订标记四个顶层字段，独立于章纲卡与细纲。
 * 复用约定：字段取 @components/ui/field，梗概取 blocks/AiTextareaField，下拉取 components/OptionSelect；
 * 阶段选项由调用方用 buildStageOptions 装配，「未分组」哨兵也由调用方作为普通选项传入；
 * 修订标记选项取 constants 的 CHAPTER_REVISION_OPTIONS，取值收窄复用 utils 的 toOptionValue。
 * 关键约束：改动只经 onChange 回传章纲补丁；阶段空串与哨兵的互转在此收口，其他字段不感知哨兵值；
 * 修订标记只作返工提示，不参与已写 / 待写的进度判定。
 */
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { AiTextareaField } from '@webview/blocks/AiTextareaField'
import { OptionSelect } from '@webview/components/OptionSelect'
import type { OutlineChapter } from '../../types'
import type { JSX } from 'react'
import { CHAPTER_REVISION_OPTIONS, CHAPTER_REVISION_ORDER, type OptionMeta } from '../../constants'
import { toOptionValue } from '../../utils'

interface ChapterEditMetaFieldsProps {
    chapter: OutlineChapter
    stageOptions: readonly OptionMeta<string>[]
    stageNoneValue: string
    isGeneratingSummary: boolean
    onGenerateSummary: () => void
    onChange: (patch: Partial<OutlineChapter>) => void
}

/** 元信息字段：阶段哨兵只在此文件内与空串互转 */
export function ChapterEditMetaFields({
    chapter,
    stageOptions,
    stageNoneValue,
    isGeneratingSummary,
    onGenerateSummary,
    onChange,
}: ChapterEditMetaFieldsProps): JSX.Element {
    return (
        <FieldGroup className="gap-3">
            <Field>
                <FieldLabel htmlFor="outline-chapter-title">章名</FieldLabel>
                <Input
                    id="outline-chapter-title"
                    value={chapter.title}
                    placeholder="章节标题"
                    onChange={(event) => onChange({ title: event.target.value })}
                />
            </Field>

            <AiTextareaField
                id="outline-chapter-summary"
                label="计划梗概"
                value={chapter.summary}
                placeholder="这一章打算写什么：目标、阻碍、结果、留下的钩子"
                maxLength={200}
                description="计划与实际摘要分开记录；生成只写梗概，不碰正文事实"
                isGenerating={isGeneratingSummary}
                generateLabel="AI 生成计划梗概"
                onChange={(summary) => onChange({ summary })}
                onGenerate={onGenerateSummary}
            />

            <Field>
                <FieldLabel htmlFor="outline-chapter-stage">阶段</FieldLabel>
                <OptionSelect
                    id="outline-chapter-stage"
                    value={chapter.stage.length > 0 ? chapter.stage : stageNoneValue}
                    options={stageOptions}
                    onChange={(value) => onChange({ stage: value === stageNoneValue ? '' : value })}
                />
                <FieldDescription>选项来自结构纲阶段；同一阶段的章共用一个名字，改名需同时改该阶段各章</FieldDescription>
            </Field>

            <Field>
                <FieldLabel htmlFor="outline-chapter-revision">修订标记</FieldLabel>
                <OptionSelect
                    id="outline-chapter-revision"
                    value={chapter.revision}
                    options={CHAPTER_REVISION_OPTIONS}
                    onChange={(value) => {
                        const revision = toOptionValue(CHAPTER_REVISION_ORDER, value)
                        if (revision !== null) {
                            onChange({ revision })
                        }
                    }}
                />
                <FieldDescription>只作返工提示，不改变「已写 / 待写」的进度判定</FieldDescription>
            </Field>
        </FieldGroup>
    )
}
