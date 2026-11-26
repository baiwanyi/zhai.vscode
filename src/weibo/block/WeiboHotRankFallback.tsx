/**
 * 热搜状态占位：未配置 / 首次取数 / 失败与空榜三种情况共用一份骨架，侧栏与专页只差尺寸与文案。
 * 复用约定：占位取 @webview/blocks/Empty，重试与去设置入口取 @webview/components/Button；
 * variant 决定内边距、图标尺寸与是否给「去设置」，榜单有内容时返回 null 由调用方渲染列表。
 * 关键约束：hasLoaded 为假同样算加载态，否则空态会先闪一下再被结果替换；
 * 本组件不感知榜单来源，同城等场景的补充说明由调用方通过 emptyHint 传入。
 */
import { Cookie, Flame } from 'lucide-react'
import { Spinner } from '@components/ui/spinner'
import { Empty } from '@webview/blocks/Empty'
import { Button } from '@webview/components/Button'
import type { WeiboHotRankState } from '../hooks/useWeiboHotRank'
import type { JSX } from 'react'

/** 各 variant 的文案与尺寸：侧栏紧凑、专页留白更大 */
interface VariantCopy {
    emptyClass: string
    iconClass: string | undefined
    credentialDescription: string
    loadingTitle: string
    failedTitle: string
    emptyTitle: string
    emptyDescription: string
}

const VARIANT_COPY: Readonly<Record<'sidebar' | 'page', VariantCopy>> = {
    sidebar: {
        emptyClass: 'gap-3 p-3',
        iconClass: 'size-10 rounded-xl',
        credentialDescription: '配置后即可读取实时热搜：先登录 weibo.com，再复制请求头里的完整 Cookie。',
        loadingTitle: '正在读取热搜...',
        failedTitle: '热搜读取失败',
        emptyTitle: '暂时没有热搜内容',
        emptyDescription: '稍后点右上角刷新再试，或确认 Cookie 是否仍然有效。',
    },
    page: {
        emptyClass: 'py-8',
        iconClass: undefined,
        credentialDescription: '榜单同样走网页端登录态：先登录 weibo.com，再复制任意 ajax 请求头里的完整 Cookie。',
        loadingTitle: '正在读取榜单...',
        failedTitle: '榜单读取失败',
        emptyTitle: '这张榜暂时没有内容',
        emptyDescription: '稍后刷新一次再试，或确认 Cookie 是否仍然有效。',
    },
}

export interface WeiboHotRankFallbackProps {
    /** sidebar 贴侧栏卡片，page 用于整页热搜 */
    variant: 'sidebar' | 'page'
    /** 是否已配置 Cookie：未配置只给引导，不发请求 */
    isEnabled: boolean
    state: WeiboHotRankState
    onRetry: () => void
    /** 专页：未配置时的「去设置」入口 */
    onOpenSettings?: () => void
    /** 专页：空榜时的补充说明（如同城暂无榜单） */
    emptyHint?: string
}

export function WeiboHotRankFallback({
    variant,
    isEnabled,
    state,
    onRetry,
    onOpenSettings,
    emptyHint,
}: WeiboHotRankFallbackProps): JSX.Element | null {
    const copy = VARIANT_COPY[variant]
    const isPage = variant === 'page'

    if (!isEnabled) {
        return (
            <Empty
                className={copy.emptyClass}
                icon={Cookie}
                iconClassName={copy.iconClass}
                title="还没有配置微博 Cookie"
                description={copy.credentialDescription}
            >
                {isPage && onOpenSettings !== undefined ? (
                    <Button size="sm" variant="outline" onClick={onOpenSettings}>
                        去设置
                    </Button>
                ) : null}
            </Empty>
        )
    }
    if (!state.hasLoaded || (state.isLoading && state.items.length === 0)) {
        return (
            <Empty
                className={copy.emptyClass}
                icon={Spinner}
                iconClassName={copy.iconClass}
                title={copy.loadingTitle}
            />
        )
    }
    if (state.items.length === 0) {
        const isFailed = state.errorMessage !== null
        return (
            <Empty
                className={copy.emptyClass}
                icon={Flame}
                iconClassName={copy.iconClass}
                title={isFailed ? copy.failedTitle : copy.emptyTitle}
                description={state.errorMessage ?? emptyHint ?? copy.emptyDescription}
            >
                <Button size="sm" variant="outline" onClick={onRetry}>
                    重试
                </Button>
            </Empty>
        )
    }
    return null
}
