/**
 * 菜单编辑对话框：名称与内容在同一弹窗内完成，形态由有无子菜单自动判定，每次输入即时写回菜单状态。
 * 复用约定：外壳取 webview/Dialog，字段用 ui/field + input，内容配置交给 layout/ContentEditor；
 * 删除入口取 blocks/DeleteConfirmButton（图标按钮 + 二次确认）；
 * 草稿状态与写回交给 useMenuEditDraft，文案与下发字段分别取 menu/utils 的纯函数；
 * Alert 提示旧跳转动作将被替换。
 * 关键约束：编辑实时缓存到菜单树，确认后由 hook 防抖落本地草稿；取消或切换编辑对象不丢已输入内容；新建态不显示删除入口与删除按钮；
 * 新建一级菜单只填名称，内容留到编辑态配置且确认校验跳过内容，其余仍需名称与内容完整，口径同宿主 readWechatMenuButtons；
 * 目录不在此管理子项，添加与编辑统一走手机预览的下拉菜单。
 */
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import {
    WECHAT_MENU_SUB_NAME_BYTES,
    WECHAT_MENU_TOP_NAME_BYTES,
    readByteLength,
    type WechatMenuButton,
} from '@shared/types/wechat'
import { DeleteConfirmButton } from '@webview/blocks/DeleteConfirmButton'
import { Alert } from '@webview/components/Alert'
import { Dialog } from '@webview/components/Dialog'
import { ContentEditor } from './ContentEditor'
import type { JSX } from 'react'
import { useMenuEditDraft } from '../../hooks/useMenuEditDraft'
import { isMenuContentComplete } from '../utils/menuContent'
import { readMenuDialogText } from '../utils/menuDialogText'
import { isMenuGroup, isMenuNameValid } from '../utils/menuTree'

interface MenuEditDialogActions {
    change: (patch: Partial<WechatMenuButton>) => void
    delete: () => void
    confirm: () => void
    close: () => void
}

interface MenuEditDialogProps {
    open: boolean
    accountId: string
    button: WechatMenuButton
    isTop: boolean
    /** 新建态：不提供删除入口，标题也按新建展示 */
    isNew: boolean
    actions: MenuEditDialogActions
}

export function MenuEditDialog({ open, accountId, button, isTop, isNew, actions }: MenuEditDialogProps): JSX.Element {
    const isGroup = isMenuGroup(button)
    const isNewTop = isNew && isTop
    const { draftName, draftContent, handleNameChange, handleContentChange } = useMenuEditDraft(button, actions.change)

    const isLegacyAction = !isGroup && button.type === undefined && button.content === undefined
    const nameBytes = readByteLength(draftName.trim())
    const nameLimit = isTop ? WECHAT_MENU_TOP_NAME_BYTES : WECHAT_MENU_SUB_NAME_BYTES
    const isNameOverLimit = nameBytes > nameLimit
    const isComplete = isMenuNameValid(draftName, isTop) && (isGroup || isNewTop || isMenuContentComplete(draftContent))
    const { title, description } = readMenuDialogText(isNew, isTop, isGroup)

    const handleConfirm = (): void => {
        actions.confirm()
        actions.close()
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen) {
                    actions.close()
                }
            }}
            title={title}
            description={description}
            onConfirm={handleConfirm}
            isDisabled={!isComplete}
        >
            <div className="flex flex-col gap-4">
                <FieldGroup className="gap-3">
                    <Field>
                        <FieldLabel htmlFor="wechat-menu-edit-name">菜单名称</FieldLabel>
                        <div className="flex items-center gap-2">
                            <Input
                                id="wechat-menu-edit-name"
                                value={draftName}
                                maxLength={isTop ? 16 : 30}
                                placeholder="菜单名称"
                                className="min-w-0 flex-1"
                                onChange={(event) => handleNameChange(event.target.value)}
                            />
                            {!isNew && (
                                <DeleteConfirmButton
                                    tooltip="删除菜单"
                                    title="删除这个菜单？"
                                    description={`${isTop ? '该一级菜单及其子菜单会一并移除' : '该二级菜单会从所属一级菜单中移除'}，删除后不可恢复。`}
                                    className="opacity-100"
                                    onConfirm={actions.delete}
                                />
                            )}
                        </div>
                        <FieldDescription className={isNameOverLimit ? 'text-destructive' : undefined}>
                            {isNameOverLimit
                                ? `${String(nameBytes)}/${String(nameLimit)} 字节，超出上限`
                                : `${isTop ? '一级' : '二级'}上限 ${String(nameLimit)} 字节（约 ${isTop ? '4' : '8'} 个汉字，当前 ${String(nameBytes)}）`}
                        </FieldDescription>
                    </Field>
                </FieldGroup>

                {!isGroup && !isNewTop && (
                    <div className="flex flex-col gap-2">
                        {isLegacyAction && (
                            <Alert
                                title="旧动作"
                                description="保存后改为平台下发，原设置将被替换。"
                            />
                        )}
                        <p className="text-sm font-medium">菜单内容</p>
                        <ContentEditor accountId={accountId} value={draftContent} onChange={handleContentChange} />
                    </div>
                )}
            </div>
        </Dialog>
    )
}
