/**
 * 微博顶栏账号菜单：触发器是账号头像，下拉里收账号信息、个人主页、我的赞、设置与删除 Cookie。
 * 复用约定：菜单壳取 @components/ui/dropdown-menu（Label / Separator / Group），头像取
 * @components/ui/avatar（Image + Fallback），触发器取 @webview/components/Button；
 * 头像 data URI 由宿主从 {存储根}/weibo_avatar.jpg 生成，前端不直连图床。
 * 关键约束：账号未取到时「个人主页」禁用并给出原因；「我的赞」只依赖登录 Cookie（uid 由宿主解析），
 * 未配置时禁用；头像缺失一律回落昵称首字，不留空白圆；未登录时触发器不渲染头像、改用 outline 变体，
 * 用描边按钮提示「这里还没登录」；
 * 删除 Cookie 只是发信号，二次确认与宿主调用由页面负责，本组件不持有任何业务状态；
 * 菜单宽度显式给定，否则 Radix 按触发按钮宽度撑开，长文案会被挤成多行。
 */
import { Heart, Settings2, Trash2, UserRound } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@components/ui/avatar'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import type { WeiboProfile } from '@shared/types/weibo'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

interface WeiboAccountMenuProps {
    /** 是否已配置登录 Cookie：未配置时删除项禁用 */
    isConfigured: boolean
    /** 账号信息：未取到时为 null，菜单回落为占位文案 */
    profile: WeiboProfile | null
    avatarDataUrl: string | null
    isProfileLoading: boolean
    /** 打开个人主页：uid 缺失时由页面提示，不拼空地址 */
    onOpenProfile: () => void
    /** 打开「我的赞」：列表取数由页面负责，本组件只发起切换 */
    onOpenLikes: () => void
    /** 打开设置弹窗：设置不再是独立视图 */
    onOpenSettings: () => void
    /** 请求删除登录 Cookie：二次确认与宿主调用由页面负责 */
    onDeleteCredential: () => void
}

/** 头像回落字：昵称首字；空名用「微」，避免 Fallback 里一片空白 */
function toFallbackLabel(name: string): string {
    const trimmed = name.trim()
    if (trimmed.length === 0) {
        return '微'
    }
    return [...trimmed][0] ?? '微'
}

/** 副标题：把「未配置 / 读取中 / 未取到 / 粉丝数」压成一行，菜单顶部不会出现空白块 */
function describeAccount(profile: WeiboProfile | null, isConfigured: boolean, isLoading: boolean): string {
    if (!isConfigured) {
        return '未配置登录 Cookie'
    }
    if (profile === null) {
        return isLoading ? '正在读取账号…' : '账号信息未取到'
    }
    return `${String(profile.followersCount)} 粉丝 · ${String(profile.statusesCount)} 微博`
}

interface AccountAvatarProps {
    size: 'sm' | 'lg'
    avatarDataUrl: string | null
    name: string
}

/** 头像：没有 data URI 时只渲染 Fallback，Image 不挂空 src */
function AccountAvatar({ size, avatarDataUrl, name }: AccountAvatarProps): JSX.Element {
    return (
        <Avatar size={size}>
            {avatarDataUrl === null ? null : <AvatarImage src={avatarDataUrl} alt={name} />}
            <AvatarFallback>{toFallbackLabel(name)}</AvatarFallback>
        </Avatar>
    )
}

export function WeiboAccountMenu({
    isConfigured,
    profile,
    avatarDataUrl,
    isProfileLoading,
    onOpenProfile,
    onOpenLikes,
    onOpenSettings,
    onDeleteCredential,
}: WeiboAccountMenuProps): JSX.Element {
    const displayName = profile?.name ?? (isConfigured ? '我的微博' : '未登录')
    const canOpenProfile = profile !== null

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant={isConfigured ? 'ghost' : 'outline'}
                    tooltip={canOpenProfile ? '账号与设置' : '账号与设置（尚未读取到账号）'}
                >
                    {isConfigured ? <AccountAvatar size="sm" avatarDataUrl={avatarDataUrl} name={displayName} /> : null}
                    <span className="max-w-24 truncate">{displayName}</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="flex items-center gap-2">
                    <AccountAvatar size="lg" avatarDataUrl={avatarDataUrl} name={displayName} />
                    <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{displayName}</span>
                        <span className="truncate text-muted-foreground text-xs">
                            {describeAccount(profile, isConfigured, isProfileLoading)}
                        </span>
                    </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                    <DropdownMenuItem disabled={!canOpenProfile} onSelect={onOpenProfile}>
                        <UserRound />
                        个人主页
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={!isConfigured} onSelect={onOpenLikes}>
                        <Heart />
                        我的赞
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={onOpenSettings}>
                        <Settings2 />
                        设置
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" disabled={!isConfigured} onSelect={onDeleteCredential}>
                        <Trash2 />
                        删除 Cookie
                    </DropdownMenuItem>
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
