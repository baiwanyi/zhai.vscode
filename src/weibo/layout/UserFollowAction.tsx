/**
 * 主页关注动作：未关注时是一个「关注」按钮；已关注时悬停展开设置分组 / 设置备注 / 取消关注。
 * 复用约定：关注态与写操作交给 hooks/useWeiboAuthorFollow，按钮取 @webview/components/Button，
 * 悬停面板取 @components/ui/hover-card，两个设置弹窗交给同目录 UserGroupDialog / UserRemarkDialog。
 * 关键约束：已关注时按钮本身不承担取关，取关只在悬停菜单里，避免误触取消；
 * 打开弹窗前先收起悬停面板，两层浮层不叠加；备注是受控值，保存后由页面回写并刷新列表；
 * 关注态是本组件状态，切换用户时由页面用 key 重挂载重置。
 * 已知限制：Radix 的 HoverCardContent 不透出卸载回焦回调，面板退场时可能把焦点抢回触发按钮，
 * 与随后打开的模态弹窗存在竞态；要修只能在 resources/shadcn/ui/hover-card.tsx 里自行包 FocusScope。
 */
import { cn } from 'cn'
import { FolderCog, UserCheck, UserMinus, UserPlus, UserRoundPen } from 'lucide-react'
import { useCallback, useState } from 'react'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@components/ui/hover-card'
import type { WeiboUserInfo } from '@shared/types/weibo'
import { Button } from '@webview/components/Button'
import { UserGroupDialog } from './UserGroupDialog'
import { UserRemarkDialog } from './UserRemarkDialog'
import type { JSX } from 'react'
import { useWeiboAuthorFollow } from '../hooks/useWeiboAuthorFollow'

/** 悬停面板里的菜单项：统一 ghost + 左对齐，宽度占满面板 */
const MENU_ITEM_CLASS = 'w-full justify-start'

/** 悬停面板的开合延迟：80ms 躲开指针划过，120ms 留出从按钮移到面板上的时间 */
const MENU_OPEN_DELAY_MS = 80
const MENU_CLOSE_DELAY_MS = 120

export interface UserFollowActionProps {
    /** 主页资料：只取关注动作需要的三个字段，调用方只在资料到货后渲染本组件 */
    user: Pick<WeiboUserInfo, 'id' | 'name' | 'isFollowing'>
    /** 当前生效的备注名：空串表示无备注，按钮文案据此切「备注 / 已关注」 */
    remark: string
    /** 备注保存成功：由页面回写并刷新列表作者名 */
    onRemarkSaved: (remark: string) => void
}

export function UserFollowAction({ user, remark, onRemarkSaved }: UserFollowActionProps): JSX.Element {
    const { isFollowing, isFollowPending, canFollow, toggleFollow } = useWeiboAuthorFollow({
        id: user.id,
        name: user.name,
        isFollowing: user.isFollowing,
    })
    /** 悬停面板开合：点击菜单项时先手动收起，避免与弹窗叠在一起 */
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    /** 当前打开的设置弹窗：两个弹窗互斥，用单一状态表达，避免两个布尔同时为 true */
    const [activeDialog, setActiveDialog] = useState<'group' | 'remark' | null>(null)
    /** 文案里的称呼：昵称缺失或全是空白时用「该用户」，避免出现「关注 」这样的悬空空格 */
    const nameForLabel = user.name.trim().length > 0 ? user.name : '该用户'

    const openGroupDialog = useCallback((): void => {
        setIsMenuOpen(false)
        setActiveDialog('group')
    }, [])

    const openRemarkDialog = useCallback((): void => {
        setIsMenuOpen(false)
        setActiveDialog('remark')
    }, [])

    const handleGroupDialogOpenChange = useCallback((next: boolean): void => {
        setActiveDialog(next ? 'group' : null)
    }, [])

    const handleRemarkDialogOpenChange = useCallback((next: boolean): void => {
        setActiveDialog(next ? 'remark' : null)
    }, [])

    const handleUnfollow = useCallback((): void => {
        setIsMenuOpen(false)
        toggleFollow(false)
    }, [toggleFollow])

    const handleFollow = useCallback((): void => {
        toggleFollow(true)
    }, [toggleFollow])

    if (!isFollowing) {
        return (
            <Button
                variant="outline"
                tooltip={canFollow ? `关注 ${nameForLabel}` : '缺少用户 uid，无法关注'}
                aria-label={canFollow ? `关注 ${nameForLabel}` : '无法关注该用户'}
                isLoading={isFollowPending}
                disabled={!canFollow}
                onClick={handleFollow}
            >
                <UserPlus />
                关注
            </Button>
        )
    }

    return (
        <>
            <HoverCard
                open={isMenuOpen}
                onOpenChange={setIsMenuOpen}
                openDelay={MENU_OPEN_DELAY_MS}
                closeDelay={MENU_CLOSE_DELAY_MS}
            >
                <HoverCardTrigger asChild>
                    <Button
                        variant="outline"
                        aria-label={`已关注 ${nameForLabel}：悬停可设置分组、备注或取消关注`}
                        isLoading={isFollowPending}
                    >
                        <UserCheck />
                        <span className="max-w-24 truncate">{remark.length > 0 ? remark : '已关注'}</span>
                    </Button>
                </HoverCardTrigger>
                <HoverCardContent align="end" className="w-40 p-1">
                    <div className="flex flex-col">
                        {/* 三个动作都以作者 uid 为键：uid 非法时点下去只会被宿主拒绝或静默丢弃，直接置灰 */}
                        <Button
                            variant="ghost"
                            size="sm"
                            className={MENU_ITEM_CLASS}
                            disabled={!canFollow}
                            onClick={openGroupDialog}
                        >
                            <FolderCog />
                            设置分组
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            className={MENU_ITEM_CLASS}
                            disabled={!canFollow}
                            onClick={openRemarkDialog}
                        >
                            <UserRoundPen />
                            设置备注
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            className={cn(MENU_ITEM_CLASS, 'text-destructive hover:text-destructive')}
                            disabled={!canFollow}
                            onClick={handleUnfollow}
                        >
                            <UserMinus />
                            取消关注
                        </Button>
                    </div>
                </HoverCardContent>
            </HoverCard>
            <UserGroupDialog
                uid={user.id}
                userName={user.name}
                isOpen={activeDialog === 'group'}
                onOpenChange={handleGroupDialogOpenChange}
            />
            <UserRemarkDialog
                uid={user.id}
                userName={user.name}
                initialRemark={remark}
                isOpen={activeDialog === 'remark'}
                onOpenChange={handleRemarkDialogOpenChange}
                onSaved={onRemarkSaved}
            />
        </>
    )
}
