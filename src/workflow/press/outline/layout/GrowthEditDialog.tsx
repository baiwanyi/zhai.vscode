/**
 * 成长节点编辑对话框：编辑轨道、卷章位置、成长值与备注，作为 AI 回填后的兜底修正入口。
 * 复用约定：骨架取 @webview/components/Dialog，字段取 @components/ui/field，下拉取 components/OptionSelect；
 * 卷章选项由调用方传入的卷章树按卷序展开，卷序口径复用 utils 的 readOutlineVolumeOrder。
 * 关键约束：编辑期只改本地草稿，确认后一次性回传；成长值必填，为空时禁用确认；
 * 切换卷位后若原章序不在新卷内，自动回落为卷级节点，避免写入不存在的章序。
 */
import { useState } from 'react'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { Textarea } from '@components/ui/textarea'
import { Dialog } from '@webview/components/Dialog'
import { OptionSelect } from '@webview/components/OptionSelect'
import type { GrowthPoint, GrowthTrack, OutlineVolume } from '../../types'
import type { JSX } from 'react'
import { GROWTH_TRACK_META, GROWTH_TRACK_OPTIONS, GROWTH_TRACK_ORDER } from '../../constants'
import { readOutlineVolumeOrder, stripChapterOrderPrefix, toOptionValue, volumeTitleLabel } from '../../utils'

/** 章位下拉的空值哨兵：受控 Select 不收空串 */
const CHAPTER_NONE = 'none'

interface GrowthEditDialogProps {
    isOpen: boolean
    onOpenChange: (isOpen: boolean) => void
    point: GrowthPoint
    volumes: readonly OutlineVolume[]
    onSave: (point: GrowthPoint) => void
}

/** 成长节点编辑：本地草稿与列表隔离，确认后一次性回传 */
export function GrowthEditDialog({ isOpen, onOpenChange, point, volumes, onSave }: GrowthEditDialogProps): JSX.Element {
    const [draft, setDraft] = useState<GrowthPoint>(point)
    const volumeChoices = volumes.map((volume, index) => ({
        volume,
        order: readOutlineVolumeOrder(volume.name, index),
        label: volumeTitleLabel(volume.name, index),
    }))
    const currentVolume = volumeChoices.find((item) => item.order === draft.volumeOrder)
    const chapterOptions = [
        { value: CHAPTER_NONE, label: '未定（只记到卷）' },
        ...(currentVolume?.volume.chapters ?? []).map((chapter) => ({
            value: String(chapter.order),
            label: `第${String(chapter.order)}章 ${stripChapterOrderPrefix(chapter.title)}`,
        })),
    ]

    const patch = (changes: Partial<GrowthPoint>): void => {
        setDraft((current) => ({ ...current, ...changes }))
    }

    const handleConfirm = (): void => {
        if (draft.value.trim().length === 0) {
            return
        }
        onSave({ ...draft, value: draft.value.trim(), note: draft.note.trim() })
        onOpenChange(false)
    }

    return (
        <Dialog
            open={isOpen}
            onOpenChange={onOpenChange}
            title="编辑成长节点"
            description="记录第几卷第几章到了哪一级；值保持自由文本"
            isDisabled={draft.value.trim().length === 0}
            onConfirm={handleConfirm}
        >
            <FieldGroup>
                <Field>
                    <FieldLabel>轨道</FieldLabel>
                    <OptionSelect
                        value={draft.track}
                        options={GROWTH_TRACK_OPTIONS}
                        label="成长轨道"
                        onChange={(value) => {
                            const track = toOptionValue<GrowthTrack>(GROWTH_TRACK_ORDER, value)
                            if (track !== null) {
                                patch({ track })
                            }
                        }}
                    />
                    <FieldDescription>{GROWTH_TRACK_META[draft.track].label}：主角自身或金手指的成长</FieldDescription>
                </Field>
                <div className="grid grid-cols-2 gap-2.5">
                    <Field>
                        <FieldLabel>卷位</FieldLabel>
                        <OptionSelect
                            value={String(draft.volumeOrder)}
                            options={volumeChoices.map((item) => ({ value: String(item.order), label: item.label }))}
                            label="成长节点所在卷"
                            onChange={(value) => {
                                const order = Number.parseInt(value, 10)
                                if (Number.isNaN(order)) {
                                    return
                                }
                                const target = volumeChoices.find((item) => item.order === order)
                                const hasChapterKept =
                                    draft.chapterOrder !== null &&
                                    (target?.volume.chapters.some((chapter) => chapter.order === draft.chapterOrder) ??
                                        false)
                                patch({ volumeOrder: order, chapterOrder: hasChapterKept ? draft.chapterOrder : null })
                            }}
                        />
                    </Field>
                    <Field>
                        <FieldLabel>章位</FieldLabel>
                        <OptionSelect
                            value={draft.chapterOrder === null ? CHAPTER_NONE : String(draft.chapterOrder)}
                            options={chapterOptions}
                            label="成长节点所在章"
                            onChange={(value) => {
                                patch({
                                    chapterOrder: value === CHAPTER_NONE ? null : Number.parseInt(value, 10),
                                })
                            }}
                        />
                    </Field>
                </div>
                <Field>
                    <FieldLabel htmlFor="outline-growth-value">成长值</FieldLabel>
                    <Input
                        id="outline-growth-value"
                        value={draft.value}
                        placeholder="筑基成功 / 战力 1000 / +100"
                        onChange={(event): void => patch({ value: event.target.value })}
                    />
                </Field>
                <Field>
                    <FieldLabel htmlFor="outline-growth-note">备注</FieldLabel>
                    <Textarea
                        id="outline-growth-note"
                        rows={3}
                        value={draft.note}
                        placeholder="这次突破的代价、触发条件或遗留问题"
                        onChange={(event): void => patch({ note: event.target.value })}
                    />
                </Field>
            </FieldGroup>
        </Dialog>
    )
}
