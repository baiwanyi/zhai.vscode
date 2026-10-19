/**
 * 功能入口清单：写作管理与公众号管理的整行入口，形态为全宽胶囊按钮。
 * 行样式与顶部「添加」按钮保持一致，跳转逻辑由页面持有；本组件不含任何宿主调用。
 * 关键约束：文件内的行组件为私有实现，仅用于消除两行之间的样式重复。
 */
import { ChevronRight, MessagesSquare, Pencil } from 'lucide-react'
import { Button } from '@components/ui/button'
import type { JSX } from 'react'

interface DashboardEntriesProps {
    onOpenWriting: () => void
    onOpenPress: () => void
}

export function DashboardEntries({ onOpenWriting, onOpenPress }: DashboardEntriesProps): JSX.Element {
    return (
        <div className="flex flex-col gap-2">
            <EntryRow icon={<Pencil />} title="写作管理" onSelect={onOpenWriting} />
            <EntryRow icon={<MessagesSquare />} title="公众号管理" onSelect={onOpenPress} />
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
        <Button variant="outline" size="lg" className="w-full justify-between rounded-full" onClick={onSelect}>
            <span className="flex items-center gap-2">
                {icon}
                {title}
            </span>
            <ChevronRight data-icon="inline-end" />
        </Button>
    )
}
