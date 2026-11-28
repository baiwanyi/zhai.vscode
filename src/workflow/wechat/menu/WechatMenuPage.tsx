/**
 * 自定义菜单页：线稿手机预览 + dialog 编辑，发布时整棵覆盖平台菜单。
 * 复用约定：数据、增删与发布全走 hooks/useWechatMenu，编辑坐标与分发走 hooks/useMenuEditorState；
 * 手机预览与加载/错误态统一交给 layout/MenuPhonePreview，编辑取 layout/MenuEditDialog。
 * 关键约束：最多 3 个一级、每个 5 个二级；新建一级先做草稿，点「保存更改」才插入菜单树；
 * 编辑态输入实时写回，确认后由 hook 防抖落本地草稿；取消不回滚已输入内容；目录不配内容，子项由手机预览下拉管理；
 * 删除整棵菜单会同时清掉默认菜单与全部个性化菜单，必须二次确认。
 */
import { CloudUpload, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { WECHAT_MENU_TOP_LIMIT, type WechatAccountSummary } from '@shared/types/wechat'
import { AlertDialog } from '@webview/components/AlertDialog'
import { AppAction, AppContent, AppDescription, AppHeader, AppPage, AppTitle } from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { MenuEditDialog } from './layout/MenuEditDialog'
import { MenuPhonePreview } from './layout/MenuPhonePreview'
import type { JSX } from 'react'
import { useMenuEditorState } from '../hooks/useMenuEditorState'
import { useWechatMenu } from '../hooks/useWechatMenu'

interface WechatMenuPageProps {
    account: WechatAccountSummary
}

export function WechatMenuPage({ account }: WechatMenuPageProps): JSX.Element {
    const menu = useWechatMenu(account.id)
    const { selection, actions } = useMenuEditorState(menu.buttons, menu)
    const [isRemovePending, setIsRemovePending] = useState(false)

    const handleRemove = async (): Promise<void> => {
        const removed = await menu.remove()
        if (removed) {
            setIsRemovePending(false)
            actions.close()
        }
    }

    return (
        <AppPage>
            <AppHeader>
                <AppTitle>自定义菜单</AppTitle>
                <AppAction>
                    <Button
                        variant="destructive"
                        disabled={menu.buttons.length === 0}
                        onClick={() => setIsRemovePending(true)}
                    >
                        <Trash2 data-icon="inline-start" />
                        删除菜单
                    </Button>
                    <Button
                        isLoading={menu.isSaving}
                        disabled={menu.buttons.length === 0}
                        onClick={() => void menu.save()}
                    >
                        <CloudUpload data-icon="inline-start" />
                        同步
                    </Button>
                </AppAction>
                <AppDescription>{`${account.name} · ${String(menu.buttons.length)}/${String(WECHAT_MENU_TOP_LIMIT)} 一级 ·「保存更改」存草稿，「同步」推送公众号`}</AppDescription>
            </AppHeader>
            <AppContent>
                <MenuPhonePreview
                    buttons={menu.buttons}
                    status={menu.status}
                    error={menu.error}
                    activeIndex={selection.safeIndex}
                    actions={{
                        selectTop: actions.selectTop,
                        editTop: actions.editTop,
                        addTop: actions.addTop,
                        retry: () => void menu.reload(),
                        editSub: actions.editSub,
                        addSub: actions.addSub,
                    }}
                />
            </AppContent>

            {selection.isEditing && selection.editingButton !== undefined && (
                <MenuEditDialog
                    key={selection.dialogKey}
                    open
                    accountId={account.id}
                    button={selection.editingButton}
                    isTop={selection.isEditingTop}
                    isNew={selection.newDraft !== null || selection.editTarget?.isNew === true}
                    actions={{
                        change: actions.change,
                        delete: actions.remove,
                        confirm: actions.confirm,
                        close: actions.close,
                    }}
                />
            )}

            <AlertDialog
                open={isRemovePending}
                title="删除整棵菜单"
                description="将删除该公众号的默认菜单及全部个性化菜单，删除后不可恢复。"
                confirmLabel="删除"
                isDestructive
                onOpenChange={(open) => {
                    if (!open) {
                        setIsRemovePending(false)
                    }
                }}
                onConfirm={handleRemove}
            />
        </AppPage>
    )
}
