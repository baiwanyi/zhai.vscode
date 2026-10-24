/**
 * 作品快照页：顶部分区栏切换两条时间线——「设定与大纲」是四份结构化文档的整版快照，
 * 「章节正文」是每章独立的正文历史。
 * 复用约定：外壳取 components/AppPage（标题、说明、分区栏各归其槽位），分区切换由 SnapshotSectionRail 承担，
 * 两个面板各自管理取数、空态与确认弹窗；本文件只做分区状态与布局，页面不自带额外滚动层。
 * 关键约束：两个面板都以 dirPath 为数据边界，切换作品时随路由重挂载，不跨作品复用列表；
 * 主体滚动由面板自身承担，故 AppContent 不传 isScrollable，避免外层再套一层滚动容器。
 */
import { useState } from 'react'
import { AppAction, AppContent, AppDescription, AppHeader, AppPage, AppTitle } from '@webview/components/AppPage'
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
        <AppPage>
            <AppHeader>
                <AppTitle>快照</AppTitle>
                <AppDescription>
                    设定、大纲等文档与章节正文改动时自动留一版，恢复前也会先留一版，误操作随时可退回。
                </AppDescription>
                <AppAction>
                    <SnapshotSectionRail activeSection={section} onSelect={setSection} />
                </AppAction>
            </AppHeader>
            <AppContent>
                {section === 'doc' ? (
                    <DocSnapshotPanel dirPath={dirPath} />
                ) : (
                    <ChapterSnapshotPanel dirPath={dirPath} />
                )}
            </AppContent>
        </AppPage>
    )
}
