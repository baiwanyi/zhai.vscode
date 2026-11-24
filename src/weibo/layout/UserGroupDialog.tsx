/**
 * 设置分组弹窗：选择该关注用户所属的分组，并可就地新建分组。
 * 复用约定：骨架取 @webview/components/Dialog（标题 / 说明 / 取消与保存），
 * 分组选择与「公开」开关都用 @components/ui 的 button 与 switch；
 * 新建分组一行取 @components/ui/input-group（InputGroupInput + inline-end 附加区，
 * 开关与提交按钮都收在输入框右侧，不另占一行）；
 * 分组取数与两项写操作交给 hooks/useWeiboUserGroups，名称 trim 走 hooks/useTrimmedInput。
 * 关键约束：选择只落本地草稿，点「保存分组」才提交，未改动时保存禁用；
 * 分组以两列按钮网格呈现（aria-pressed 表达选中），数量有限，不引入滚动条；
 * 加载中（带 Spinner）、无分组与选择说明统一写在弹窗 description 一处，正文里不再插提示行；
 * 新建分组成功后自动选中并清空输入框，名称 1-8 字，只敲空格不可提交；
 * 读取失败时给出错误与重试入口并禁用保存，避免拿空列表把用户移出自定义分组；
 * 全部取消选择等于移出自定义分组（提交 0），文案里要说清。
 */
import { Check, CornerDownLeft } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Field, FieldError, FieldGroup, FieldLabel } from '@components/ui/field'
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput,
    InputGroupText,
} from '@components/ui/input-group'
import { Label } from '@components/ui/label'
import { Spinner } from '@components/ui/spinner'
import { Switch } from '@components/ui/switch'
import { WEIBO_GROUP_NAME_MAX } from '@shared/types/weibo'
import { Button } from '@webview/components/Button'
import { Dialog } from '@webview/components/Dialog'
import { useTrimmedInput } from '@webview/hooks/useTrimmedInput'
import type { JSX } from 'react'
import { useWeiboUserGroups } from '../hooks/useWeiboUserGroups'

/** 集合比较：勾选顺序没有意义，按集合判等；比的是去重后的元素，草稿里混进重复 id 也不会误判成「未改动」 */
function isSameGroupSet(current: string[], saved: string[]): boolean {
    const currentSet = new Set(current)
    const savedSet = new Set(saved)
    if (currentSet.size !== savedSet.size) {
        return false
    }
    return [...currentSet].every((id) => savedSet.has(id))
}

export interface UserGroupDialogProps {
    /** 目标用户 uid：分组读写都以它为键 */
    uid: string
    /** 用户昵称：只用于标题与说明 */
    userName: string
    isOpen: boolean
    onOpenChange: (isOpen: boolean) => void
    /** 保存成功：页面可据此刷新资料或给回执 */
    onSaved?: () => void
}

export function UserGroupDialog({ uid, userName, isOpen, onOpenChange, onSaved }: UserGroupDialogProps): JSX.Element {
    const { state, reload, create, save } = useWeiboUserGroups(uid, isOpen)
    /** 勾选草稿：null 表示跟随已保存分组，避免读取完成后回填覆盖用户刚做的改动 */
    const [draftIds, setDraftIds] = useState<string[] | null>(null)
    const [isPublic, setIsPublic] = useState(false)
    const { value: nameValue, trimmedValue, isBlank, setValue: setNameValue, reset: resetName } = useTrimmedInput()
    /** 弹窗会话标记：每次关闭自增，在途的新建回包发现标记变了就丢弃，不把草稿写回已关闭的弹窗 */
    const sessionRef = useRef(0)

    const selectedIds = draftIds ?? state.groupIds
    const isChanged = draftIds !== null && !isSameGroupSet(draftIds, state.groupIds)
    const isBusy = state.isLoading || state.isSaving || state.isCreating
    /** 读取失败时连新建一起禁用：拿不到原有分组，新建后保存会把 origin 空壳提交上去，可能把用户移出原有分组 */
    const isCreateDisabled = isBusy || state.errorMessage !== null

    /** 关闭：丢弃未提交的勾选与新建草稿 */
    const handleOpenChange = useCallback(
        (next: boolean): void => {
            if (!next) {
                sessionRef.current += 1
                setDraftIds(null)
                resetName()
                setIsPublic(false)
            }
            onOpenChange(next)
        },
        [onOpenChange, resetName],
    )

    const toggleGroup = useCallback(
        (id: string, checked: boolean): void => {
            const base = draftIds ?? state.groupIds
            setDraftIds(checked ? [...base, id] : base.filter((item) => item !== id))
        },
        [draftIds, state.groupIds],
    )

    /** 新建：成功后自动选中，用户可以继续选别的分组再一起保存 */
    const handleCreate = useCallback((): void => {
        if (isBlank || state.isCreating || state.errorMessage !== null) {
            return
        }
        const base = draftIds ?? state.groupIds
        const session = sessionRef.current
        void create(trimmedValue, isPublic).then((group) => {
            // 弹窗已关闭：草稿与输入框都随关闭清空了，回包不再写回，也不再弹提示
            if (group === null || sessionRef.current !== session) {
                return
            }
            resetName()
            setIsPublic(false)
            setDraftIds([...base, group.id])
            toast.success(`已新建分组「${group.name}」，保存后生效`)
        })
    }, [
        create,
        draftIds,
        isBlank,
        isPublic,
        resetName,
        state.errorMessage,
        state.groupIds,
        state.isCreating,
        trimmedValue,
    ])

    const handleSubmit = useCallback((): void => {
        void save(selectedIds).then((isSaved) => {
            if (!isSaved) {
                return
            }
            // 走统一的关闭路径：草稿、名称与「公开」开关一起清掉，否则下次打开会残留上一次的输入
            handleOpenChange(false)
            onSaved?.()
            toast.success('分组已更新')
        })
    }, [handleOpenChange, onSaved, save, selectedIds])

    return (
        <Dialog
            open={isOpen}
            title={userName.trim().length > 0 ? `设置分组 · ${userName}` : '设置分组'}
            description={
                state.isLoading ? (
                    <span className="inline-flex items-center gap-1.5">
                        <Spinner className="size-3" aria-hidden="true" />
                        正在读取分组…
                    </span>
                ) : state.groups.length === 0 && state.errorMessage === null ? (
                    '还没有分组，先新建一个'
                ) : (
                    '选择该用户所属的分组；全部取消选择即移出自定义分组。'
                )
            }
            confirmLabel="保存分组"
            isLoading={state.isSaving}
            isDisabled={!isChanged || state.isLoading || state.isCreating || state.errorMessage !== null}
            className="sm:max-w-md"
            onOpenChange={handleOpenChange}
            onConfirm={handleSubmit}
        >
            <FieldGroup>
                <Field data-invalid={state.errorMessage !== null} data-disabled={state.isLoading}>
                    <FieldLabel>关注分组</FieldLabel>
                    {state.groups.length === 0 ? null : (
                        // 两列按钮网格：分组数量有限，不用滚动条，选中态靠按钮变体与勾标表达
                        <div className="grid grid-cols-2 gap-2">
                            {state.groups.map((group) => {
                                const isSelected = selectedIds.includes(group.id)
                                return (
                                    <Button
                                        key={group.id}
                                        type="button"
                                        variant={isSelected ? 'default' : 'outline'}
                                        className="min-w-0 justify-between gap-2"
                                        aria-pressed={isSelected}
                                        disabled={isBusy}
                                        onClick={() => {
                                            toggleGroup(group.id, !isSelected)
                                        }}
                                    >
                                        <span className="min-w-0 truncate font-normal">{group.name}</span>
                                        {isSelected ? (
                                            <Check className="size-3.5 shrink-0" aria-hidden="true" />
                                        ) : group.memberCount > 0 ? (
                                            <span className="shrink-0 text-muted-foreground text-xs">
                                                {String(group.memberCount)}
                                            </span>
                                        ) : null}
                                    </Button>
                                )
                            })}
                        </div>
                    )}
                    {state.errorMessage === null ? null : (
                        <>
                            <FieldError className="text-xs">{state.errorMessage}</FieldError>
                            <Button size="sm" variant="outline" disabled={state.isLoading} onClick={reload}>
                                重新读取
                            </Button>
                        </>
                    )}
                </Field>
                <Field data-disabled={isCreateDisabled}>
                    <FieldLabel htmlFor="weibo-new-group-name">新建分组</FieldLabel>
                    {/* 名称、公开开关与提交按钮收在同一条输入框里：弹窗窄，拆成两行会把分组列表挤下去 */}
                    <InputGroup>
                        <InputGroupInput
                            id="weibo-new-group-name"
                            value={nameValue}
                            maxLength={WEIBO_GROUP_NAME_MAX}
                            placeholder={`分组名称（1-${String(WEIBO_GROUP_NAME_MAX)} 字）`}
                            disabled={isCreateDisabled}
                            onChange={(event) => {
                                setNameValue(event.target.value)
                            }}
                        />
                        <InputGroupAddon align="inline-end">
                            <InputGroupText className="gap-1.5">
                                <Switch
                                    id="weibo-new-group-public"
                                    checked={isPublic}
                                    disabled={isCreateDisabled}
                                    onCheckedChange={setIsPublic}
                                />
                                <Label htmlFor="weibo-new-group-public" className="font-normal text-xs">
                                    公开
                                </Label>
                            </InputGroupText>
                            <InputGroupButton
                                variant="default"
                                aria-label="新建分组"
                                disabled={isBlank || isCreateDisabled}
                                isLoading={state.isCreating}
                                onClick={handleCreate}
                            >
                                <CornerDownLeft />
                            </InputGroupButton>
                        </InputGroupAddon>
                    </InputGroup>
                </Field>
            </FieldGroup>
        </Dialog>
    )
}
