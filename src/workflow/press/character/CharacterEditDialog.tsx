/**
 * 人物编辑弹窗：把人物卡编辑器装进 dialog，编辑过程只改本地草稿，点保存后立即写入角色设定.md。
 * 复用约定：弹层复用 ui/dialog（含 DialogTitle / DialogDescription 的无障碍结构），表单体复用 CharacterEditPanel，
 * 作品层上下文由调用方传入，供外貌生成与角色形象生成使用。
 * 关键约束：草稿只在本次打开期间存在，调用方须以人物 id 作为 key 重建组件，否则会带上上一个人物的输入；
 * 关闭或取消一律丢弃草稿，不回写任何字段；例外是删除角色形象后的封面回退——删除不可撤销，
 * 由面板经 onPersist 立即落盘并同步进草稿；弹窗高度取视口高上下各留 2rem，切换标签页时只滚动内容区，
 * 整窗不随内容高度跳动，也不出现外层滚动。
 */
import { useState } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@components/ui/dialog'
import { Button } from '@webview/components/Button'
import { CharacterEditPanel } from './CharacterEditPanel'
import type { CharacterWorkspace } from './CharacterEditPanel'
import type { CharacterCard } from '../types'
import type { JSX } from 'react'

interface CharacterEditDialogProps {
    character: CharacterCard
    /** 作品层上下文：外貌生成的时代题材与角色设定图的读取目录 */
    workspace: CharacterWorkspace
    onSave: (id: string, patch: Partial<CharacterCard>) => void
    onCancel: () => void
}

export function CharacterEditDialog({ character, workspace, onSave, onCancel }: CharacterEditDialogProps): JSX.Element {
    const [draft, setDraft] = useState<CharacterCard>(character)

    const handleSave = (): void => {
        onSave(draft.id, draft)
        onCancel()
    }

    /** 立即落盘：删除角色形象后的封面回退不能等保存，结果同时同步进草稿，避免弹窗内仍停在旧指针 */
    const handlePersist = (patch: Partial<CharacterCard>): void => {
        setDraft((previous) => ({ ...previous, ...patch }))
        onSave(draft.id, patch)
    }

    return (
        <Dialog
            open
            onOpenChange={(isOpen) => {
                if (!isOpen) {
                    onCancel()
                }
            }}
        >
            <DialogContent className="flex h-[calc(100vh-4rem)] flex-col gap-3 sm:max-w-[calc(100vw-4rem)]">
                <DialogHeader>
                    <DialogTitle className="text-lg">
                        编辑人物 · {draft.name.length > 0 ? draft.name : '未命名'}
                    </DialogTitle>
                </DialogHeader>
                <CharacterEditPanel
                    character={draft}
                    workspace={workspace}
                    onChange={(patch) => setDraft((previous) => ({ ...previous, ...patch }))}
                    onPersist={handlePersist}
                />
                <DialogFooter>
                    <Button variant="outline" onClick={onCancel}>
                        取消
                    </Button>
                    <Button onClick={handleSave}>保存</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
