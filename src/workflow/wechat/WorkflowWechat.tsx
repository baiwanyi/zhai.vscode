/**
 * 公众号工作流页：内容归属为公众号时由 WorkflowScreen 渲染，内部按分区切换六个运营页与常驻分区。
 * 复用约定：账号作用域取 hooks/useWechatAccountScope（宿主写入的当前账号），分区页各自负责取数与渲染，
 * 对话、媒体、校对等常驻分区直接交给 layout/WorkflowResidentSection；
 * 侧边导航在 WorkflowScreen 层常驻，本页不自绘导航、也不处理宿主视图请求。
 * 关键约束：常驻分区先于账号状态分派——打开一篇批次文章就能用对话、媒体与校对，不能因未选账号被挡；
 * 未选账号时六运营分区统一显示引导空态——运营动作都必须落在具体公众号上，渲染半成品只会让人以为坏了；
 * 读取失败给重试，不静默显示空列表；分区页按账号 id 作 key，切换账号即重挂载，不沿用上一个账号的快照。
 */
import { Send } from 'lucide-react'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import { Skeleton } from '@components/ui/skeleton'
import { AppContent, AppHeader, AppPage } from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { WechatCommentPage } from './comment/WechatCommentPage'
import { WechatFansPage } from './fans/WechatFansPage'
import { useWechatAccountScope } from './hooks/useWechatAccountScope'
import { WechatMaterialPage } from './material/WechatMaterialPage'
import { WechatMenuPage } from './menu/WechatMenuPage'
import { WechatPendingSection } from './pending/WechatPendingSection'
import { WechatPushPage } from './push/WechatPushPage'
import { WechatStatsPage } from './stats/WechatStatsPage'
import type { WorkflowSection } from '../layout/workflowSections'
import type { JSX } from 'react'
import { RESIDENT_SECTIONS } from '../layout/contentScope'
import { WorkflowResidentSection } from '../layout/WorkflowResidentSection'

interface WorkflowWechatProps {
    /** 当前分区：由 WorkflowScreen 托管，与侧边导航同源 */
    section: WorkflowSection
    /** 对话作用域目录：公众号取模块目录，交给常驻分区复用 */
    scopeDir: string | null
}

export function WorkflowWechat({ section, scopeDir }: WorkflowWechatProps): JSX.Element {
    const { account, status, error, reload } = useWechatAccountScope()

    // 常驻分区与账号无关：打开批次文章时对话、媒体、校对要直接可用
    if (RESIDENT_SECTIONS.includes(section)) {
        return <WorkflowResidentSection section={section} scopeDir={scopeDir} />
    }

    if (status === 'loading') {
        return (
            <AppPage>
                <AppHeader className="justify-between">
                    <Skeleton className="h-5 w-28" />
                    <Skeleton className="h-8 w-16 rounded-md" />
                </AppHeader>
                <AppContent className="flex flex-col gap-2">
                    <Skeleton className="h-24 w-full rounded-xl" />
                    <Skeleton className="h-24 w-full rounded-xl" />
                </AppContent>
            </AppPage>
        )
    }

    if (status === 'error' || account === null) {
        const isError = status === 'error'
        return (
            <AppPage>
                <AppContent className="flex min-h-0 flex-1 flex-col justify-center">
                    <Empty>
                        <EmptyHeader>
                            <EmptyMedia variant="icon" className="size-12 rounded-2xl">
                                <Send className="size-5" />
                            </EmptyMedia>
                            <EmptyTitle>{isError ? '公众号账号读取失败' : '还没有选择公众号'}</EmptyTitle>
                            <EmptyDescription>
                                {isError
                                    ? (error ?? '请稍后重试')
                                    : '运营功能都作用在某个具体公众号上：先到仪表盘的「公众号管理」里添加账号，点进任意账号即可选中。'}
                            </EmptyDescription>
                        </EmptyHeader>
                        {isError && (
                            <EmptyContent>
                                <Button variant="outline" onClick={() => void reload()}>
                                    重试
                                </Button>
                            </EmptyContent>
                        )}
                    </Empty>
                </AppContent>
            </AppPage>
        )
    }

    switch (section) {
        case 'push':
            return <WechatPushPage key={account.id} account={account} />
        case 'material':
            return <WechatMaterialPage key={account.id} account={account} />
        case 'menu':
            return <WechatMenuPage key={account.id} account={account} />
        case 'fans':
            return <WechatFansPage key={account.id} account={account} />
        case 'stats':
            return <WechatStatsPage key={account.id} account={account} />
        case 'comment':
            return <WechatCommentPage key={account.id} account={account} />
        default:
            return <WechatPendingSection section={section} accountName={account.name} />
    }
}
