/**
 * 人物设定页：写作流程的第三步，左列表右人物卡；窄容器下改为「列表 → 详情」的下钻式单栏。
 * 复用约定：列表与卡片分别由 CharacterList、CharacterDetail 承担，本文件只做选中项与补丁回传的编排，
 * 步骤条复用 PressFlowSteps，空态复用 ui/empty，说明文案沿用页面 p-3 + gap-2 的节奏。
 * 关键约束：详情区的显示与否由选中项决定，窄容器选中人物后必须隐藏列表而不是叠加两栏；
 * 选中项失效（人物被删除）时回退到列表，不得渲染空详情。
 */
import { cn } from 'cn'
import { ArrowRight, UserRound } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@components/ui/badge'
import { Button } from '@components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import { CharacterDetail } from './CharacterDetail'
import { CharacterList } from './CharacterList'
import type { CharacterCard } from '../types'
import type { JSX } from 'react'
import { PressFlowSteps } from '../layout/PressFlowSteps'

interface PressCharacterPageProps {
    characters: CharacterCard[]
    onCreateCharacter: () => void
    onChangeCharacter: (id: string, patch: Partial<CharacterCard>) => void
    onSelectStep: (step: number) => void
    onNext: () => void
}

export function PressCharacterPage({
    characters,
    onCreateCharacter,
    onChangeCharacter,
    onSelectStep,
    onNext,
}: PressCharacterPageProps): JSX.Element {
    const [selectedId, setSelectedId] = useState<string | null>(null)
    // 未选中或选中项失效（人物被删除、列表整体替换）时回退到第一位，避免详情区空白
    const selectedCharacter = characters.find((character) => character.id === selectedId) ?? characters.at(0) ?? null
    // 下钻状态只看用户是否主动点选过：窄容器下初始必须停在列表，而不是直接进入详情
    const hasActiveSelection = selectedId !== null

    const handleCreate = (): void => {
        onCreateCharacter()
    }

    return (
        <div className="@container flex h-full min-h-0 flex-col gap-2 p-3">
            <header className="flex flex-col gap-1.5">
                <PressFlowSteps current={3} onSelect={onSelectStep} />
                <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                        <h2 className="truncate font-heading text-sm font-semibold">人物设定</h2>
                        <p className="truncate text-xs text-muted-foreground">欲望与弱点决定冲突，大纲排布时会引用</p>
                    </div>
                    <Badge variant="outline" className="shrink-0 tabular-nums">
                        {characters.length} 人
                    </Badge>
                </div>
            </header>
            <div className="flex min-h-0 flex-1 gap-2">
                <aside
                    className={cn(
                        'min-h-0 w-full overflow-y-auto @2xl:w-60 @2xl:shrink-0',
                        hasActiveSelection && 'hidden @2xl:block',
                    )}
                >
                    <CharacterList
                        characters={characters}
                        selectedId={selectedCharacter?.id ?? null}
                        onSelect={setSelectedId}
                        onCreate={handleCreate}
                    />
                </aside>
                <section
                    className={cn(
                        'min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card',
                        !hasActiveSelection && 'hidden @2xl:block',
                    )}
                >
                    {selectedCharacter ? (
                        <CharacterDetail
                            character={selectedCharacter}
                            onChange={(patch) => onChangeCharacter(selectedCharacter.id, patch)}
                            onBack={() => setSelectedId(null)}
                        />
                    ) : (
                        <Empty className="h-full">
                            <EmptyHeader>
                                <EmptyMedia variant="icon">
                                    <UserRound />
                                </EmptyMedia>
                                <EmptyTitle>选择一个人物</EmptyTitle>
                                <EmptyDescription>左侧列表点选后可编辑人物卡，或在列表上方新增</EmptyDescription>
                            </EmptyHeader>
                        </Empty>
                    )}
                </section>
            </div>
            <footer className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    至少补齐主角与一名对手，大纲才能排布冲突
                </span>
                <Button size="sm" onClick={onNext}>
                    下一步：生成大纲
                    <ArrowRight data-icon="inline-end" />
                </Button>
            </footer>
        </div>
    )
}
