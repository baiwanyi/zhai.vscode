/**
 * 头部功能入口清单：写作管理、公众号管理与微博的整行入口，形态为全宽胶囊按钮。
 * 行样式与顶部「添加」按钮保持一致，跳转逻辑由页面持有；本组件不含任何宿主调用。
 * 复用约定：公众号与微博行取 layout 下的品牌图标组件，其余行沿用 lucide 图标。
 * 关键约束：入口顺序即展示顺序；待办事项不在此列，它以模块卡片形式落在概览区；
 * 微博入口在编辑区打开独立面板，与公众号的页内路由分属两种打开方式，回调不可互换；
 * 图标槽固定 size-5（20px）并居中：lucide 为 16px、品牌图标为 20px，槽位不统一时各行文本左边缘会错开。
 * 文件内的行组件为私有实现，仅用于消除各行之间的样式重复。
 */
import { ChevronRight, FilePen } from 'lucide-react'
import { Button } from '@webview/components/Button'
import { WechatIcon } from './WechatIcon'
import { WeiboIcon } from './WeiboIcon'
import type { JSX } from 'react'

interface DashboardHeaderEntriesProps {
    onOpenWriting: () => void
    onOpenPress: () => void
    /** 打开微博面板：在编辑区新开一个 webview 页，不参与仪表盘页内路由 */
    onOpenWeibo: () => void
}

export function DashboardHeaderEntries({
    onOpenWriting,
    onOpenPress,
    onOpenWeibo,
}: DashboardHeaderEntriesProps): JSX.Element {
    return (
        <div className="flex w-full flex-col gap-2">
            <EntryRow icon={<FilePen />} title="写作管理" onSelect={onOpenWriting} />
            <EntryRow icon={<WechatIcon />} title="公众号管理" onSelect={onOpenPress} />
            <EntryRow icon={<WeiboIcon />} title="微博" onSelect={onOpenWeibo} />
        </div>
    )
}

interface EntryRowProps {
    icon: JSX.Element
    title: string
    onSelect: () => void
}

function EntryRow({ icon, title, onSelect }: EntryRowProps): JSX.Element {
    return (
        <Button variant="outline" className="w-full justify-between rounded-full" onClick={onSelect}>
            <span className="flex items-center gap-2">
                {/* 图标槽统一 size-5：lucide 为 16px、品牌图标为 20px，不统一槽位会让各行文本的左边缘错开 */}
                <span className="flex size-5 shrink-0 items-center justify-center">{icon}</span>
                {title}
            </span>
            <ChevronRight data-icon="inline-end" />
        </Button>
    )
}
