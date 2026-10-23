/**
 * 作品快照页：顶部分区栏切换两条时间线——「设定与大纲」是四份结构化文档的整版快照，
 * 「章节正文」是每章独立的正文历史。
 * 复用约定：分区切换由 SnapshotSectionRail 承担（与取名页分类栏同形态），两个面板各自管理取数、空态与确认弹窗；
 * 本文件只做分区状态与布局，页面不自带额外滚动层。
 * 关键约束：两个面板都以 dirPath 为数据边界，切换作品时随路由重挂载，不跨作品复用列表。
 */
import { useState } from 'react'
import { ChapterSnapshotPanel } from './ChapterSnapshotPanel'
import { DocSnapshotPanel } from './DocSnapshotPanel'
import { SnapshotSectionRail } from './SnapshotSectionRail'
import type { SnapshotSection } from './SnapshotSectionRail'
import type { JSX } from 'react'

interface PressSnapshotPageProps {
    /** 当前作品目录：两条时间线都以该作品的 Snapshots 目录为根 */
    dirPath: string
}

export function PressSnapshotPage({ dirPath }: PressSnapshotPageProps): JSX.Element {
    const [section, setSection] = useState<SnapshotSection>('doc')

    return (
        <div className="@container flex h-full min-h-0 flex-col gap-3 p-3">
            <header className="flex flex-col shrink-0 gap-2">
                <h2 className="truncate font-heading text-lg">快照</h2>
                <p className="min-w-0 flex-1 text-muted-foreground text-xs">
                    作品信息、设定、角色与大纲有改动时自动留一版；恢复前会自动把当前内容也留一版。
                </p>
                <SnapshotSectionRail activeSection={section} onSelect={setSection} />
            </header>

            {section === 'doc' ? <DocSnapshotPanel dirPath={dirPath} /> : <ChapterSnapshotPanel dirPath={dirPath} />}
        </div>
    )
}
