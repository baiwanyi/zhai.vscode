/**
 * 基本信息字段组：作品名、笔名、预计字数、目标读者与题材类型。
 * 复用约定：字段组容器取 @components/ui 的 field 之 FieldGroup（两列网格），单字段控件取 input，
 * 少量互斥选项（目标读者）取 toggle-group 的单选形态，标签型题材由 TagField 承载；
 * 左列封面由 useSettingCover 只读回读，三态展示交给 components/CoverFigure；
 * 目标读者与字数在本地完成类型收窄，只向上抛出合法补丁。
 * 关键约束：作品名与目录名一一对应，只能在此修改展示名；数字输入清空时回退为 0 而不是 NaN；
 * 封面只展示不可改，出图、设为封面与删除都在生图页完成。
 */
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSet, FieldTitle } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@components/ui/toggle-group'
import { CoverFigure } from '@webview/components/CoverFigure'
import { TagField } from './TagField'
import { useSettingCover } from './useSettingCover'
import type { SettingFieldsProps } from './sections'
import type { Audience } from '../types'
import type { JSX } from 'react'
import { AUDIENCE_OPTIONS, GENRE_OPTIONS } from '../constants'

export function PressSettingBasicFields({ setting, dirPath, onChange }: SettingFieldsProps): JSX.Element {
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
        <FieldSet className="gap-3">
            <FieldGroup className="grid grid-cols-2 gap-3">
                <SettingCoverFigure dirPath={dirPath} title={setting.title} />
                <FieldGroup className="gap-3">
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
                        <FieldTitle id="setting-audience-label">目标读者</FieldTitle>
                        <ToggleGroup
                            type="single"
                            variant="outline"
                            size="sm"
                            spacing={0}
                            value={setting.audience}
                            aria-labelledby="setting-audience-label"
                            onValueChange={handleAudienceChange}
                            className="w-full"
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
        </FieldSet>
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
