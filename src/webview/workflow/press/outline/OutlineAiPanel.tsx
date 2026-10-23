/**
 * 大纲 AI 副驾：横屏宽容器下的右栏，展示本次章节生成会用到的上下文引用与快捷动作。
 * 复用约定：引用行复用 ui/item 与 lucide 图标，动作按钮复用 ui/button 的三个层级（默认 / outline / ghost），
 * 与 AI 对话页的操作区保持同一视觉权重；配色只取语义令牌，不引入独立面板底色。
 * 关键约束：引用清单必须反映真实选中项（卷、章、出场角色、作品设定），不得写成固定文案；
 * 本组件不直接发起生成，只把动作交回页面，保证 AI 调用入口仍集中在会话层。
 */
import { BookMarked, Globe, PenLine, ScrollText, Users, Wand2 } from 'lucide-react'
import { Badge } from '@components/ui/badge'
import { Button } from '@components/ui/button'
import { Item, ItemContent, ItemDescription, ItemTitle } from '@components/ui/item'
import type { CharacterCard, OutlineChapter, OutlineVolume, ProjectSetting } from '../types'
import type { JSX } from 'react'

interface OutlineAiPanelProps {
    setting: ProjectSetting
    volume: OutlineVolume
    chapter: OutlineChapter
    characters: CharacterCard[]
    onOpenChat: () => void
    onOpenWizard: () => void
}

export function OutlineAiPanel({
    setting,
    volume,
    chapter,
    characters,
    onOpenChat,
    onOpenWizard,
}: OutlineAiPanelProps): JSX.Element {
    const selectedCharacters = characters.filter((character) => chapter.characterIds.includes(character.id))
    const characterLabel =
        selectedCharacters.length > 0
            ? selectedCharacters.map((character) => character.name).join('、')
            : '未指定出场人物'
    const settingLabel = `${setting.genres.join(' / ') || '未填题材'} · ${setting.tone || '未填风格'}`

    return (
        <div className="flex h-full min-h-0 flex-col border-l border-border">
            <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
                <span className="font-medium">AI 副驾</span>
                <Badge variant="outline">章节生成</Badge>
            </header>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2">
                <div className="flex flex-col gap-1">
                    <span className="text-muted-foreground">本次引用</span>
                    <Item size="xs" variant="muted" className="gap-2">
                        <BookMarked className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <ItemContent className="min-w-0">
                            <ItemTitle>卷纲</ItemTitle>
                            <ItemDescription className="truncate">{volume.name}</ItemDescription>
                        </ItemContent>
                    </Item>
                    <Item size="xs" variant="muted" className="gap-2">
                        <ScrollText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <ItemContent className="min-w-0">
                            <ItemTitle>章纲</ItemTitle>
                            <ItemDescription className="truncate">
                                {chapter.title} · {chapter.beats.length} 条节拍
                            </ItemDescription>
                        </ItemContent>
                    </Item>
                    <Item size="xs" variant="muted" className="gap-2">
                        <Users className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <ItemContent className="min-w-0">
                            <ItemTitle>人物</ItemTitle>
                            <ItemDescription className="truncate">{characterLabel}</ItemDescription>
                        </ItemContent>
                    </Item>
                    <Item size="xs" variant="muted" className="gap-2">
                        <Globe className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <ItemContent className="min-w-0">
                            <ItemTitle>设定</ItemTitle>
                            <ItemDescription className="truncate">{settingLabel}</ItemDescription>
                        </ItemContent>
                    </Item>
                </div>
                <p className="leading-relaxed text-muted-foreground">
                    生成时按「作品设定 → 本卷目标 → 本章节拍 → 出场人物 → 上一章结尾」的顺序注入，改动以 diff
                    呈现，可撤销。
                </p>
                <div className="flex flex-col gap-1">
                    <Button className="justify-start" onClick={onOpenChat}>
                        <PenLine />
                        生成本章正文
                    </Button>
                    <Button variant="outline" className="justify-start" onClick={onOpenChat}>
                        <ScrollText />
                        按大纲续写
                    </Button>
                    <Button variant="ghost" className="justify-start" onClick={onOpenWizard}>
                        <Wand2 />
                        重写本章纲
                    </Button>
                </div>
            </div>
        </div>
    )
}
