/**
 * 卷纲编辑对话框：编辑一卷的卷标题、预计章节数、核心事件、主要情节、关键转折与卷末结果。
 * 复用约定：骨架取业务公共层的 Dialog；草稿状态、AI 生成保护与补丁归一取 useVolumeEditDraft；
 * 情节列表取 block/VolumePlotItemFields（内部用 VolumePlotItem），AI 字段取 block/VolumeEditAiField，其余字段取 ui/field 与 ui/input；
 * 保存结果以 sonner 反馈，AI 结果未覆盖时的提示由 onNotice 或 toast.info 承担。
 * 关键约束：编辑期只在本地草稿里改，点「保存」才回传一次补丁，中途取消不写盘；
 * 生成期间禁用提交，结果只在字段未被手动改动时写回，避免长请求吞掉输入或让结果白等；
 * 调用方须用「卷 id + 打开状态」绑定组件 key，草稿才不会串到上一卷或上一次编辑。
 */
import { toast } from 'sonner'
import { Field, FieldGroup, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { Dialog } from '@webview/components/Dialog'
import type { CharacterCard, OutlineVolume, ProjectSetting } from '../../types'
import type { JSX } from 'react'
import { VolumeEditAiField } from '../block/VolumeEditAiField'
import { VolumePlotItemFields } from '../block/VolumePlotItemFields'
import { useVolumeEditDraft } from '../hooks/useVolumeEditDraft'
import { CORE_EVENT_MAX_LENGTH, EXPECTED_CHAPTERS_MAX } from '../utils/volumeEditDraft'

interface VolumeEditDialogProps {
    isOpen: boolean
    onOpenChange: (isOpen: boolean) => void
    volume: OutlineVolume | null
    /** 作品设定：AI 生成核心事件与卷末结果时作为事实输入 */
    setting: ProjectSetting
    /** 人物卡：生成时提供可出场人物名单 */
    characters: CharacterCard[]
    /** 保存当前卷的补丁：只带被编辑的字段 */
    onSave: (volumeId: string, patch: Partial<OutlineVolume>) => void
    /** 生成结果因用户已改动而未覆盖时的提示；省略时走 toast.info */
    onNotice?: (message: string) => void
}

export function VolumeEditDialog({
    isOpen,
    onOpenChange,
    volume,
    setting,
    characters,
    onSave,
    onNotice,
}: VolumeEditDialogProps): JSX.Element {
    const {
        draft,
        setName,
        setExpectedChapters,
        setCoreEvent,
        setMainPlot,
        setTurningPoints,
        setResult,
        generatingField,
        isGenerating,
        generate,
        buildPatch,
    } = useVolumeEditDraft({
        volume,
        setting,
        characters,
        onNotice:
            onNotice ??
            ((message): void => {
                toast.info(message)
            }),
    })

    const handleSubmit = (): void => {
        if (volume === null) {
            return
        }
        const patch = buildPatch()
        if (patch === null) {
            return
        }
        onSave(volume.id, patch)
        toast.success('卷纲已保存')
        onOpenChange(false)
    }

    return (
        <Dialog size="full"
            open={isOpen}
            title="编辑卷纲"
            confirmLabel="保存更改"
            isDisabled={volume === null || isGenerating}
            onOpenChange={onOpenChange}
            onConfirm={handleSubmit}
        >
            <FieldGroup>
                <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2.5">
                    <Field>
                        <FieldLabel htmlFor="outline-volume-edit-name">卷标题</FieldLabel>
                        <Input
                            id="outline-volume-edit-name"
                            value={draft.name}
                            placeholder="断线之始"
                            onChange={(event): void => setName(event.target.value)}
                        />
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="outline-volume-edit-expected">章节数</FieldLabel>
                        <Input
                            id="outline-volume-edit-expected"
                            type="number"
                            min={0}
                            max={EXPECTED_CHAPTERS_MAX}
                            step={1}
                            className="tabular-nums"
                            value={draft.expectedChapters}
                            placeholder="未填"
                            onChange={(event): void => setExpectedChapters(event.target.value)}
                        />
                    </Field>
                </div>

                <VolumeEditAiField
                    field="coreEvent"
                    value={draft.coreEvent}
                    maxLength={CORE_EVENT_MAX_LENGTH}
                    description="写成一段能看清因果的事件，不要在章纲里重复"
                    generatingField={generatingField}
                    onChange={setCoreEvent}
                    onGenerate={(field): void => {
                        void generate(field)
                    }}
                />

                <VolumePlotItemFields
                    label="主要情节"
                    hint="按发生顺序写：先发生什么、再发生什么，一条一件事"
                    addLabel="添加情节"
                    placeholder="情节：谁做了什么，导致什么"
                    items={draft.mainPlot}
                    onChange={setMainPlot}
                />

                <VolumePlotItemFields
                    label="关键转折"
                    hint="写真正改变走向的节点，一到三条即可"
                    addLabel="添加转折"
                    placeholder="转折：意料之外但合理的变化"
                    items={draft.turningPoints}
                    onChange={setTurningPoints}
                />

                <VolumeEditAiField
                    field="result"
                    value={draft.result}
                    description="落在人物处境上：目标达成或失败、付出了什么代价"
                    generatingField={generatingField}
                    onChange={setResult}
                    onGenerate={(field): void => {
                        void generate(field)
                    }}
                />
            </FieldGroup>
        </Dialog>
    )
}
