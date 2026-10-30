/**
 * 待接入分区的占位：说明该分区将提供什么、依赖哪类接口权限，而不是渲染空白页或假数据。
 * 复用约定：文案集中在 PENDING_META，按分区 id 查表；外壳取 components/AppPage，
 * 空态取 @components/ui/empty，与其余分区页的视觉保持一致。
 * 关键约束：必须写清「需要认证主体」这类前置条件——否则用户会以为是功能坏了；
 * 未登记的分区（理论上不会出现）给通用文案兜底，不抛错也不渲染空 div。
 */
import { BarChart3, Construction, MessageSquare, Menu, UserRound } from 'lucide-react'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import { AppContent, AppDescription, AppHeader, AppPage, AppTitle } from '@webview/components/AppPage'
import type { WorkflowSection } from '../../layout/workflowSections'
import type { JSX } from 'react'

interface PendingMeta {
    title: string
    description: string
    /** 接口权限前置条件：没有权限时在公众号后台也看不到对应入口 */
    requirement: string
    icon: typeof Menu
}

/** 分区 → 占位文案：只登记尚未接入的四个分区 */
const PENDING_META: Readonly<Record<string, PendingMeta>> = {
    menu: {
        title: '自定义菜单',
        description: '可视化编辑一级与二级菜单，支持发送消息、跳转网页与跳转小程序，保存后直接覆盖线上菜单。',
        requirement: '一般公众号即可配置，一级菜单最多 3 个、每个最多 5 个二级菜单。',
        icon: Menu,
    },
    stats: {
        title: '数据统计',
        description: '用户增长、图文阅读与菜单点击的趋势，按 7 / 15 / 30 天取数并缓存到本地。',
        requirement: '需要认证主体：未认证账号调用 datacube 接口会被拒绝。',
        icon: BarChart3,
    },
    comment: {
        title: '留言管理',
        description: '按文章查看留言、加精与回复，是发布后与读者互动的入口。',
        requirement:
            '需要认证主体且账号已开通留言（2018 年后注册的账号默认没有）。接入前还需在群发时保存平台返回的 msg_data_id——' +
            '留言接口按「群发消息 + 文章序号」定位，没有这个标识就无法查询，当前链路尚未保存，因此本分区暂不提供数据。',
        icon: MessageSquare,
    },
    fans: {
        title: '用户管理',
        description: '粉丝列表、标签分组与备注，支持按标签筛选与批量打标。',
        requirement: '一般公众号可用，单次最多拉取 1 万个关注者。',
        icon: UserRound,
    },
}

interface WechatPendingSectionProps {
    section: WorkflowSection
    /** 当前账号名：占位页也告诉用户「这些功能将作用在哪个账号上」 */
    accountName: string
}

export function WechatPendingSection({ section, accountName }: WechatPendingSectionProps): JSX.Element {
    const meta = PENDING_META[section]
    const Icon = meta?.icon ?? Construction
    const title = meta?.title ?? '该分区待接入'
    const description = meta?.description ?? '这个分区还没有接入对应的公众号接口。'

    return (
        <AppPage onContextMenu={(event) => event.preventDefault()}>
            <AppHeader align="start">
                <AppTitle>{title}</AppTitle>
                <AppDescription>{accountName}</AppDescription>
            </AppHeader>
            <AppContent className="flex min-h-0 flex-1 flex-col justify-center">
                <Empty>
                    <EmptyHeader>
                        <EmptyMedia variant="icon" className="size-12 rounded-2xl">
                            <Icon className="size-5" />
                        </EmptyMedia>
                        <EmptyTitle>{`${title}将在下一步接入`}</EmptyTitle>
                        <EmptyDescription>{description}</EmptyDescription>
                        {meta !== undefined && <EmptyDescription>{meta.requirement}</EmptyDescription>}
                    </EmptyHeader>
                </Empty>
            </AppContent>
        </AppPage>
    )
}
