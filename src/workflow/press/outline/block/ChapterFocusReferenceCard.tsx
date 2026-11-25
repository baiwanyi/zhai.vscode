/**
 * 写前查纲的本次引用卡片：列出即将注入 AI 对话的卷纲、章纲、出场人物与题材风格。
 * 复用约定：明细行与分隔线取 ChapterFocusParts，章节标题取 press/utils 的 chapterTitleLabel。
 * 关键约束：只作展示，实际注入由对话框底部的「添加到AI对话」动作完成。
 */
import { BookMarked, Globe, ScrollText, Users } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card'
import { ItemGroup } from '@components/ui/item'
import { ChapterDetailItem, DETAIL_GROUP_CLASS, DetailSeparator } from './ChapterFocusParts'
import type { OutlineChapter, OutlineVolume } from '../../types'
import type { JSX } from 'react'
import { chapterTitleLabel } from '../../utils'

interface ChapterFocusReferenceCardProps {
    volume: OutlineVolume
    chapter: OutlineChapter
    characterLabel: string
    settingLabel: string
}

/** 本次引用：即将注入 AI 对话的卷纲、章纲、出场人物与题材风格 */
export function ChapterFocusReferenceCard({
    volume,
    chapter,
    characterLabel,
    settingLabel,
}: ChapterFocusReferenceCardProps): JSX.Element {
    return (
        <Card size="sm">
            <CardHeader>
                <CardTitle>本次引用</CardTitle>
                <CardDescription>注入 AI 对话的上下文</CardDescription>
            </CardHeader>
            <CardContent>
                <ItemGroup className={DETAIL_GROUP_CLASS}>
                    <ChapterDetailItem icon={BookMarked} label="卷纲" value={volume.name} />
                    <DetailSeparator />
                    <ChapterDetailItem
                        icon={ScrollText}
                        label="章纲"
                        value={`${chapterTitleLabel(chapter)} · ${chapter.beats.length} 条节拍`}
                    />
                    <DetailSeparator />
                    <ChapterDetailItem icon={Users} label="出场人物" value={characterLabel} />
                    <DetailSeparator />
                    <ChapterDetailItem icon={Globe} label="题材 / 风格" value={settingLabel} />
                </ItemGroup>
            </CardContent>
        </Card>
    )
}
