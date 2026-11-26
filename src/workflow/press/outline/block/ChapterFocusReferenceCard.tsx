/**
 * 写前查纲的本次引用卡片：列出即将注入 AI 对话的卷纲、章纲、出场人物、题材风格与设定约束。
 * 复用约定：明细行与分隔线取 ChapterFocusParts，章节标题取 press/utils 的 chapterTitleLabel。
 * 关键约束：只作展示，实际注入由对话框底部的「添加到AI对话」动作完成；
 * 设定约束只列标签，与 formatChapterOutlineText 注入的条目同源。
 */
import { BookMarked, Globe, ScrollText, ShieldCheck, Users } from 'lucide-react'
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
    /** 本章相关设定约束：地点条目、金手指代价与限制、核心概念与禁忌 */
    constraintLabel: string
}

/** 本次引用：即将注入 AI 对话的卷纲、章纲、出场人物、题材风格与设定约束 */
export function ChapterFocusReferenceCard({
    volume,
    chapter,
    characterLabel,
    settingLabel,
    constraintLabel,
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
                    <DetailSeparator />
                    <ChapterDetailItem icon={ShieldCheck} label="设定约束" value={constraintLabel} />
                </ItemGroup>
            </CardContent>
        </Card>
    )
}
