/**
 * 章纲元信息：章名、计划梗概与阶段三个顶层字段，独立于章纲卡与细纲。
 * 复用约定：字段取 @components/ui/field，梗概取 blocks/AiTextareaField，阶段下拉取 components/OptionSelect；
 * 阶段选项由调用方用 buildStageOptions 装配，「未分组」哨兵也由调用方作为普通选项传入。
 * 关键约束：改动只经 onChange 回传章纲补丁；阶段空串与哨兵的互转在此收口，其他字段不感知哨兵值。
 */
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { AiTextareaField } from '@webview/blocks/AiTextareaField'
import { OptionSelect } from '@webview/components/OptionSelect'
import type { OptionMeta } from '../../constants'
import type { OutlineChapter } from '../../types'
import type { JSX } from 'react'

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
        </FieldGroup>
    )
}
