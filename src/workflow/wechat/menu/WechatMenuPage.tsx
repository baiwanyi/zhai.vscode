/**
 * 自定义菜单页：手机壳预览 + 选中一级的结构化编辑，保存即整棵覆盖平台菜单。
 * 复用约定：状态与增删操作全部在 hooks/useWechatMenu，本页只做展示与输入绑定；
 * 外壳取 AppPage，字段用 ui/field + input + select，预览条与编辑区共用一份 activeIndex。
 * 关键约束：平台一级最多 3 个、二级最多 5 个，达上限时「添加」按钮禁用并说明原因，
 * 不做静默忽略；目录节点不参与点击，因此不显示动作字段，切换回按钮时恢复默认动作；
 * 保存前不做局部裁剪，结构问题由宿主校验后统一提示，避免两端口径不一致。
 */
import { Plus, Save, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import { Skeleton } from '@components/ui/skeleton'
import {
    WECHAT_MENU_SUB_LIMIT,
    WECHAT_MENU_TOP_LIMIT,
    type WechatAccountSummary,
    type WechatMenuButton,
    type WechatMenuType,
} from '@shared/types/wechat'
import { AppContent, AppDescription, AppFooter, AppHeader, AppPage, AppTitle } from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'
import { useWechatMenu, WECHAT_MENU_TYPE_OPTIONS } from '../hooks/useWechatMenu'

/** 收窄动作类型回传值 */
function readMenuType(value: string): WechatMenuType {
    return value === 'view' ? 'view' : value === 'miniprogram' ? 'miniprogram' : 'click'
}

interface WechatMenuPageProps {
    account: WechatAccountSummary
}

export function WechatMenuPage({ account }: WechatMenuPageProps): JSX.Element {
    const menu = useWechatMenu(account.id)
    const [activeIndex, setActiveIndex] = useState(0)

    // 删除一级后索引可能越界：按当前长度收敛，不改写 state
    const safeIndex = menu.buttons.length === 0 ? -1 : Math.min(activeIndex, menu.buttons.length - 1)
    const active = safeIndex >= 0 ? menu.buttons[safeIndex] : undefined

    const renderBody = (): JSX.Element => {
        if (menu.status === 'loading') {
            return (
                <div className="flex flex-col gap-2">
                    <Skeleton className="h-12 w-full rounded-xl" />
                    <Skeleton className="h-32 w-full rounded-xl" />
                </div>
            )
        }
        if (menu.status === 'error') {
            return (
                <div className="flex flex-col gap-2 rounded-xl border p-3">
                    <p className="text-sm">菜单读取失败</p>
                    <p className="text-xs text-muted-foreground">{menu.error ?? '请稍后重试'}</p>
                    <Button variant="outline" onClick={() => void menu.reload()}>
                        重试
                    </Button>
                </div>
            )
        }
        if (menu.buttons.length === 0) {
            return (
                <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed p-3">
                    <p className="text-sm">还没有配置菜单</p>
                    <p className="text-xs text-muted-foreground">
                        公众号菜单最多 3 个一级，每个一级下最多 5 个二级。先添加一个一级菜单再编辑其动作。
                    </p>
                    <Button variant="outline" onClick={menu.addButton}>
                        添加一级菜单
                    </Button>
                </div>
            )
        }
        return (
            <div className="flex flex-col gap-3">
                <MenuPreview
                    buttons={menu.buttons}
                    activeIndex={safeIndex}
                    onSelect={(index) => setActiveIndex(index)}
                />
                {active !== undefined && (
                    <TopButtonEditor
                        button={active}
                        onChange={(patch) => menu.setButton(safeIndex, patch)}
                        onToggleGroup={() => menu.toggleGroup(safeIndex)}
                        onRemove={() => menu.removeButton(safeIndex)}
                        onAddSub={() => menu.addSub(safeIndex)}
                        onRemoveSub={(subIndex) => menu.removeSub(safeIndex, subIndex)}
                        onChangeSub={(subIndex, patch) => menu.setSub(safeIndex, subIndex, patch)}
                    />
                )}
            </div>
        )
    }

    return (
        <AppPage onContextMenu={(event) => event.preventDefault()}>
            <AppHeader align="start">
                <AppTitle>自定义菜单</AppTitle>
                <AppDescription>{`${account.name} · ${String(menu.buttons.length)}/${String(WECHAT_MENU_TOP_LIMIT)} 个一级`}</AppDescription>
            </AppHeader>
            <AppContent isScrollable>{renderBody()}</AppContent>
            <AppFooter className="justify-between">
                <Button
                    variant="outline"
                    disabled={menu.buttons.length >= WECHAT_MENU_TOP_LIMIT}
                    tooltip={
                        menu.buttons.length >= WECHAT_MENU_TOP_LIMIT
                            ? `公众号最多 ${String(WECHAT_MENU_TOP_LIMIT)} 个一级菜单`
                            : '添加一级菜单'
                    }
                    onClick={menu.addButton}
                >
                    <Plus data-icon="inline-start" />
                    一级
                </Button>
                <Button
                    variant="primary"
                    isLoading={menu.isSaving}
                    disabled={menu.buttons.length === 0}
                    onClick={() => void menu.save()}
                >
                    <Save data-icon="inline-start" />
                    发布
                </Button>
            </AppFooter>
        </AppPage>
    )
}

/** 手机壳预览：三个栏位横向排布，点选切换编辑对象 */
function MenuPreview({
    buttons,
    activeIndex,
    onSelect,
}: {
    buttons: WechatMenuButton[]
    activeIndex: number
    onSelect: (index: number) => void
}): JSX.Element {
    return (
        <div className="rounded-xl border bg-muted/20 p-2">
            <div className="flex items-stretch gap-1">
                {buttons.map((button, index) => (
                    <button
                        key={`${button.name}-${String(index)}`}
                        type="button"
                        className={`min-w-0 flex-1 rounded-md px-1 py-2 text-center text-xs transition-colors ${
                            index === activeIndex
                                ? 'bg-background shadow-sm'
                                : 'text-muted-foreground hover:bg-background/60'
                        }`}
                        onClick={() => onSelect(index)}
                    >
                        <span className="block truncate">{button.name.length > 0 ? button.name : '未命名'}</span>
                    </button>
                ))}
            </div>
        </div>
    )
}

/** 一级编辑区：名称、形态（按钮 / 目录）、动作字段，目录额外渲染二级列表 */
function TopButtonEditor({
    button,
    onChange,
    onToggleGroup,
    onRemove,
    onAddSub,
    onRemoveSub,
    onChangeSub,
}: {
    button: WechatMenuButton
    onChange: (patch: Partial<WechatMenuButton>) => void
    onToggleGroup: () => void
    onRemove: () => void
    onAddSub: () => void
    onRemoveSub: (subIndex: number) => void
    onChangeSub: (subIndex: number, patch: Partial<WechatMenuButton>) => void
}): JSX.Element {
    const isGroup = button.subButton !== undefined
    return (
        <div className="flex flex-col gap-3 rounded-xl border p-3">
            <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{isGroup ? '一级目录' : '一级菜单'}</p>
                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={onToggleGroup}>
                        {isGroup ? '改为按钮' : '改为目录'}
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="删除一级菜单" tooltip="删除" onClick={onRemove}>
                        <Trash2 />
                    </Button>
                </div>
            </div>

            <FieldGroup className="gap-3">
                <Field>
                    <FieldLabel htmlFor="wechat-menu-name">名称</FieldLabel>
                    <Input
                        id="wechat-menu-name"
                        value={button.name}
                        maxLength={16}
                        onChange={(event) => onChange({ name: event.target.value })}
                    />
                    <FieldDescription>一级名称不超过 16 字节（约 5 个汉字）。</FieldDescription>
                </Field>

                {!isGroup && <ActionFields idPrefix="wechat-menu-top" button={button} onChange={onChange} />}
            </FieldGroup>

            {isGroup && (
                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">
                            {`二级 ${String(button.subButton?.length ?? 0)}/${String(WECHAT_MENU_SUB_LIMIT)}`}
                        </p>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={(button.subButton?.length ?? 0) >= WECHAT_MENU_SUB_LIMIT}
                            onClick={onAddSub}
                        >
                            添加二级
                        </Button>
                    </div>
                    {(button.subButton ?? []).map((sub, subIndex) => (
                        <div
                            key={`${sub.name}-${String(subIndex)}`}
                            className="flex flex-col gap-2 rounded-lg border p-2"
                        >
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-xs text-muted-foreground">{`二级 ${String(subIndex + 1)}`}</p>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label="删除二级菜单"
                                    tooltip="删除"
                                    onClick={() => onRemoveSub(subIndex)}
                                >
                                    <Trash2 />
                                </Button>
                            </div>
                            <Input
                                value={sub.name}
                                maxLength={30}
                                placeholder="二级名称"
                                onChange={(event) => onChangeSub(subIndex, { name: event.target.value })}
                            />
                            <ActionFields
                                idPrefix={`wechat-menu-sub-${String(subIndex)}`}
                                button={sub}
                                onChange={(patch) => onChangeSub(subIndex, patch)}
                            />
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

/** 动作字段：按类型显示 key / url / appid + pagepath */
function ActionFields({
    idPrefix,
    button,
    onChange,
}: {
    idPrefix: string
    button: WechatMenuButton
    onChange: (patch: Partial<WechatMenuButton>) => void
}): JSX.Element {
    const type = button.type ?? 'click'
    return (
        <>
            <Field>
                <FieldLabel htmlFor={`${idPrefix}-type`}>动作</FieldLabel>
                <Select value={type} onValueChange={(value) => onChange({ type: readMenuType(value) })}>
                    <SelectTrigger id={`${idPrefix}-type`}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {WECHAT_MENU_TYPE_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                                {option.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </Field>

            {type === 'click' && (
                <Field>
                    <FieldLabel htmlFor={`${idPrefix}-key`}>消息标识</FieldLabel>
                    <Input
                        id={`${idPrefix}-key`}
                        value={button.key ?? ''}
                        placeholder="如 MENU_ABOUT"
                        onChange={(event) => onChange({ key: event.target.value })}
                    />
                    <FieldDescription>点击后微信推送该标识的事件，由你自己的服务接收。</FieldDescription>
                </Field>
            )}

            {type === 'view' && (
                <Field>
                    <FieldLabel htmlFor={`${idPrefix}-url`}>网页地址</FieldLabel>
                    <Input
                        id={`${idPrefix}-url`}
                        value={button.url ?? ''}
                        placeholder="https://"
                        onChange={(event) => onChange({ url: event.target.value })}
                    />
                </Field>
            )}

            {type === 'miniprogram' && (
                <>
                    <Field>
                        <FieldLabel htmlFor={`${idPrefix}-appid`}>小程序 AppID</FieldLabel>
                        <Input
                            id={`${idPrefix}-appid`}
                            value={button.appid ?? ''}
                            placeholder="wx..."
                            onChange={(event) => onChange({ appid: event.target.value })}
                        />
                    </Field>
                    <Field>
                        <FieldLabel htmlFor={`${idPrefix}-pagepath`}>页面路径</FieldLabel>
                        <Input
                            id={`${idPrefix}-pagepath`}
                            value={button.pagepath ?? ''}
                            placeholder="pages/index/index"
                            onChange={(event) => onChange({ pagepath: event.target.value })}
                        />
                    </Field>
                </>
            )}
        </>
    )
}
