/**
 * 大纲线索与时间线面板：伏笔线索表负责「埋什么、第几章埋、何时回收、由谁触发」，
 * 时间线负责多线叙事的事件顺序；两者都独立成段，与卷章、人物纲互不覆盖。
 * 复用约定：章节引用选项由 utils 的 createChapterRefOptions 统一生成，取值形如「1-2」；
 * 人物下拉取 CharacterCard，状态档位取 CLUE_STATUS_OPTIONS；卡片与按钮沿用 ui/card 与 components/Button。
 * 关键约束：线索只改自己那一段，回收状态由作者显式切换（写后回填也会改这一项，但需用户确认）；
 * 逾期预警只做提示，不自动改状态、不阻止保存；时间线的章节引用允许写多个，解析不到的引用直接丢弃。
 */
import { Clock, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@components/ui/badge'
import { Card, CardContent } from '@components/ui/card'
import { Input } from '@components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import { Button } from '@webview/components/Button'
import type { CharacterCard, OutlineChapterRef, OutlineClue, OutlineTimelineEvent } from '../../types'
import type { ChapterRefOption, ClueWarning } from '../../utils'
import type { JSX } from 'react'
import { CLUE_STATUS_META, CLUE_STATUS_OPTIONS } from '../../constants'
import { createClue, createTimelineEvent, parseChapterRefValue } from '../../utils'

/** 章节引用下拉：空值用 none 表示未定，避免受控 Select 出现空串 */
const NO_REF = 'none'

interface CluePanelProps {
    clues: OutlineClue[]
    characters: CharacterCard[]
    refOptions: ChapterRefOption[]
    warnings: ClueWarning[]
    onChange: (clues: OutlineClue[]) => void
}

/** 伏笔线索表：每条记录埋设章、回收章、触发者与状态 */
export function CluePanel({ clues, characters, refOptions, warnings, onChange }: CluePanelProps): JSX.Element {
    const handlePatch = (clueId: string, patch: Partial<OutlineClue>): void => {
        onChange(clues.map((clue) => (clue.id === clueId ? { ...clue, ...patch } : clue)))
    }

    /** 下拉回传字符串：none 还原为 null，其余按「卷序-章序」解析 */
    const toRef = (value: string): OutlineClue['plant'] => (value === NO_REF ? null : parseChapterRefValue(value))

    return (
        <div className="flex flex-col gap-3 p-3">
            <header className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                    <h2 className="font-heading font-semibold">伏笔线索</h2>
                    <p className="text-muted-foreground">
                        伏笔只埋不收是大纲最常见的塌陷：每条都写清埋设章、回收章与触发者，逾期在下方提醒
                    </p>
                </div>
                <Button variant="outline" onClick={() => onChange([...clues, createClue()])}>
                    <Plus />
                    添加线索
                </Button>
            </header>

            {warnings.length > 0 ? (
                <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/30 px-2 py-1.5">
                    {warnings.map((warning) => (
                        <div key={warning.clue.id} className="flex items-center gap-1.5">
                            <Badge variant={warning.severity === 'warning' ? 'destructive' : 'outline'}>
                                {warning.severity === 'warning' ? '逾期' : '提醒'}
                            </Badge>
                            <span className="min-w-0 flex-1 truncate text-muted-foreground">{warning.message}</span>
                        </div>
                    ))}
                </div>
            ) : null}

            {clues.length === 0 ? (
                <p className="text-muted-foreground">
                    还没有线索。先记一条「埋了什么、准备在第几章回收」，写完正文后回填状态。
                </p>
            ) : (
                <div className="flex flex-col gap-2">
                    {clues.map((clue, index) => (
                        <Card key={clue.id} size="sm">
                            <CardContent className="flex flex-col gap-2">
                                <div className="flex items-center gap-1.5">
                                    <Input
                                        value={clue.name}
                                        aria-label={`第 ${index + 1} 条线索名称`}
                                        placeholder="线索名：玉牌裂纹 / 无名信 / 旧照片"
                                        className="h-7 font-medium"
                                        onChange={(event) => handlePatch(clue.id, { name: event.target.value })}
                                    />
                                    <Select
                                        value={clue.status}
                                        onValueChange={(value) => {
                                            const next = CLUE_STATUS_OPTIONS.find((option) => option.value === value)
                                            if (next !== undefined) {
                                                handlePatch(clue.id, { status: next.value })
                                            }
                                        }}
                                    >
                                        <SelectTrigger aria-label="线索状态" className="h-7 w-24">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectGroup>
                                                {CLUE_STATUS_OPTIONS.map((option) => (
                                                    <SelectItem key={option.value} value={option.value}>
                                                        {option.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectGroup>
                                        </SelectContent>
                                    </Select>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="shrink-0 rounded-full"
                                        aria-label={`删除第 ${index + 1} 条线索`}
                                        onClick={() => onChange(clues.filter((item) => item.id !== clue.id))}
                                    >
                                        <Trash2 />
                                    </Button>
                                </div>
                                <div className="grid grid-cols-1 gap-2 @md:grid-cols-3">
                                    <div className="flex flex-col gap-1">
                                        <span className="text-muted-foreground">埋设章</span>
                                        <Select
                                            value={
                                                clue.plant === null
                                                    ? NO_REF
                                                    : `${String(clue.plant.volumeOrder)}-${String(clue.plant.chapterOrder)}`
                                            }
                                            onValueChange={(value) => handlePatch(clue.id, { plant: toRef(value) })}
                                        >
                                            <SelectTrigger aria-label="埋设章" className="h-7 w-full">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectGroup>
                                                    <SelectItem value={NO_REF}>未定</SelectItem>
                                                    {refOptions.map((option) => (
                                                        <SelectItem key={option.value} value={option.value}>
                                                            {option.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectGroup>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <span className="text-muted-foreground">回收章</span>
                                        <Select
                                            value={
                                                clue.payoff === null
                                                    ? NO_REF
                                                    : `${String(clue.payoff.volumeOrder)}-${String(clue.payoff.chapterOrder)}`
                                            }
                                            onValueChange={(value) => handlePatch(clue.id, { payoff: toRef(value) })}
                                        >
                                            <SelectTrigger aria-label="回收章" className="h-7 w-full">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectGroup>
                                                    <SelectItem value={NO_REF}>未定</SelectItem>
                                                    {refOptions.map((option) => (
                                                        <SelectItem key={option.value} value={option.value}>
                                                            {option.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectGroup>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <span className="text-muted-foreground">触发者</span>
                                        <Select
                                            value={clue.triggerId.length > 0 ? clue.triggerId : NO_REF}
                                            onValueChange={(value) =>
                                                handlePatch(clue.id, { triggerId: value === NO_REF ? '' : value })
                                            }
                                        >
                                            <SelectTrigger aria-label="触发者" className="h-7 w-full">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectGroup>
                                                    <SelectItem value={NO_REF}>未指定</SelectItem>
                                                    {characters.map((character) => (
                                                        <SelectItem key={character.id} value={character.id}>
                                                            {character.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectGroup>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <Input
                                    value={clue.note}
                                    aria-label={`第 ${index + 1} 条线索备注`}
                                    placeholder="备注：这条线在暗示什么、回收时读者该有什么反应"
                                    className="h-7"
                                    onChange={(event) => handlePatch(clue.id, { note: event.target.value })}
                                />
                                <span className="text-muted-foreground">
                                    当前状态：{CLUE_STATUS_META[clue.status].label}
                                </span>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    )
}

interface TimelinePanelProps {
    events: OutlineTimelineEvent[]
    characters: CharacterCard[]
    onChange: (events: OutlineTimelineEvent[]) => void
}

/** 把章节引用拼成「1-1、1-2」的可编辑文本 */
function formatRefs(event: OutlineTimelineEvent): string {
    return event.refs.map((ref) => `${String(ref.volumeOrder)}-${String(ref.chapterOrder)}`).join('、')
}

/** 时间线：故事内时间、事件、涉及章与涉及人物 */
export function TimelinePanel({ events, characters, onChange }: TimelinePanelProps): JSX.Element {
    const handlePatch = (eventId: string, patch: Partial<OutlineTimelineEvent>): void => {
        onChange(events.map((event) => (event.id === eventId ? { ...event, ...patch } : event)))
    }

    /** 涉及章文本 → 引用数组：解析不了的写法直接丢弃，不猜测位置 */
    const handleRefsChange = (eventId: string, text: string): void => {
        const refs = text
            .split(/[、,，;；\s]+/u)
            .map((item) => parseChapterRefValue(item))
            .filter((ref): ref is OutlineChapterRef => ref !== null)
        handlePatch(eventId, { refs })
    }

    /** 涉及人物文本 → 人物 id：只认已存在的姓名 */
    const handleCharactersChange = (eventId: string, text: string): void => {
        const names = text
            .split(/[、,，;；\s]+/u)
            .map((item) => item.trim())
            .filter((item) => item.length > 0)
        const characterIds = names
            .map((name) => characters.find((character) => character.name === name)?.id)
            .filter((id): id is string => id !== undefined)
        handlePatch(eventId, { characterIds })
    }

    return (
        <div className="flex flex-col gap-3 p-3">
            <header className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                    <h2 className="font-heading font-semibold">时间线</h2>
                    <p className="text-muted-foreground">
                        多线叙事、群像与悬疑的先后顺序依据：写故事内时间，再挂上涉及章与人物
                    </p>
                </div>
                <Button variant="outline" onClick={() => onChange([...events, createTimelineEvent()])}>
                    <Plus />
                    添加事件
                </Button>
            </header>

            {events.length === 0 ? (
                <p className="text-muted-foreground">还没有时间线事件。先记下「哪件事发生在哪一章之前」。</p>
            ) : (
                <div className="flex flex-col gap-2">
                    {events.map((event, index) => (
                        <Card key={event.id} size="sm">
                            <CardContent className="flex flex-col gap-2">
                                <div className="flex items-center gap-1.5">
                                    <Clock className="shrink-0 text-muted-foreground" aria-hidden="true" />
                                    <Input
                                        value={event.title}
                                        aria-label={`第 ${index + 1} 个事件名`}
                                        placeholder="事件名：旧信被发现 / 宗门大比"
                                        className="h-7 font-medium"
                                        onChange={(changeEvent) =>
                                            handlePatch(event.id, { title: changeEvent.target.value })
                                        }
                                    />
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="shrink-0 rounded-full"
                                        aria-label={`删除第 ${index + 1} 个事件`}
                                        onClick={() => onChange(events.filter((item) => item.id !== event.id))}
                                    >
                                        <Trash2 />
                                    </Button>
                                </div>
                                <div className="grid grid-cols-1 gap-2 @md:grid-cols-3">
                                    <div className="flex flex-col gap-1">
                                        <span className="text-muted-foreground">故事内时间</span>
                                        <Input
                                            value={event.when}
                                            aria-label={`第 ${index + 1} 个事件的时间`}
                                            placeholder="第三年冬 / 事发当夜"
                                            className="h-7"
                                            onChange={(changeEvent) =>
                                                handlePatch(event.id, { when: changeEvent.target.value })
                                            }
                                        />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <span className="text-muted-foreground">涉及章（1-1、1-2）</span>
                                        <Input
                                            value={formatRefs(event)}
                                            aria-label={`第 ${index + 1} 个事件的涉及章`}
                                            placeholder="1-1、1-2"
                                            className="h-7"
                                            onChange={(changeEvent) =>
                                                handleRefsChange(event.id, changeEvent.target.value)
                                            }
                                        />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <span className="text-muted-foreground">涉及人物</span>
                                        <Input
                                            value={event.characterIds
                                                .map((id) => characters.find((character) => character.id === id)?.name)
                                                .filter((name): name is string => name !== undefined)
                                                .join('、')}
                                            aria-label={`第 ${index + 1} 个事件的涉及人物`}
                                            placeholder="角色名，用顿号分隔"
                                            className="h-7"
                                            onChange={(changeEvent) =>
                                                handleCharactersChange(event.id, changeEvent.target.value)
                                            }
                                        />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    )
}
