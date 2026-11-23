/**
 * 大纲结构纲面板：三幕 / 起承转合 / 英雄之旅的节拍表，独立成段、只回传结构段补丁。
 * 复用约定：字段行复用 ui/input 与 ui/textarea，卡片外壳取 ui/card，
 * 按钮取 components/Button 的 ghost / outline 两级，提示文案只取语义令牌。
 * 关键约束：只维护全书级的阶段与关键事件，卷章细节在章纲页里改；
 * 设定归作品设定、节奏类型在章纲里维护、时间线不再是模块，故本文件不再有对应面板；
 * 添加阶段的入口在页头第二行，这里只做编辑与删除；删除与排序都返回新数组，不原地修改传入的阶段数组。
 */
import { Trash2 } from 'lucide-react'
import { Card, CardContent } from '@components/ui/card'
import { Input } from '@components/ui/input'
import { Textarea } from '@components/ui/textarea'
import { Button } from '@webview/components/Button'
import type { OutlineAct } from '../../types'
import type { JSX, ReactNode } from 'react'

/** 单行字段：标签在上、输入在下，整块留出可点击的空白 */
function OutlineTextField({
    id,
    label,
    value,
    placeholder,
    onChange,
}: {
    id: string
    label: string
    value: string
    placeholder?: string
    onChange: (value: string) => void
}): JSX.Element {
    return (
        <div className="flex flex-col gap-1">
            <label htmlFor={id} className="text-muted-foreground">
                {label}
            </label>
            <Input
                id={id}
                value={value}
                placeholder={placeholder}
                className="h-7"
                onChange={(event) => onChange(event.target.value)}
            />
        </div>
    )
}

/** 多行字段：用于关键事件这类需要几句话的字段 */
function OutlineTextArea({
    id,
    label,
    value,
    placeholder,
    onChange,
}: {
    id: string
    label: string
    value: string
    placeholder?: string
    onChange: (value: string) => void
}): JSX.Element {
    return (
        <div className="flex flex-col gap-1">
            <label htmlFor={id} className="text-muted-foreground">
                {label}
            </label>
            <Textarea
                id={id}
                value={value}
                placeholder={placeholder}
                className="min-h-16"
                onChange={(event) => onChange(event.target.value)}
            />
        </div>
    )
}

/** 面板外壳：标题 + 说明 + 内容，保持各模块页面的视觉一致 */
function PanelShell({
    title,
    description,
    children,
}: {
    title: string
    description: string
    children: ReactNode
}): JSX.Element {
    return (
        <div className="flex flex-col gap-3 p-3">
            <header className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                    <h2 className="font-heading font-semibold">{title}</h2>
                    <p className="text-muted-foreground">{description}</p>
                </div>
            </header>
            {children}
        </div>
    )
}

interface StructurePanelProps {
    acts: OutlineAct[]
    onChange: (acts: OutlineAct[]) => void
}

/** 结构纲：三幕 / 起承转合 / 英雄之旅的节拍表 */
export function StructurePanel({ acts, onChange }: StructurePanelProps): JSX.Element {
    const handlePatch = (actId: string, patch: Partial<OutlineAct>): void => {
        onChange(acts.map((act) => (act.id === actId ? { ...act, ...patch } : act)))
    }

    return (
        <PanelShell title="结构纲" description="标出激励事件、第一次转折、中点、低谷与高潮：先定大转折，再拆卷章">
            {acts.length === 0 ? (
                <p className="text-muted-foreground">还没有结构阶段。先写下「开端 / 对抗 / 高潮」，再逐条补事件。</p>
            ) : (
                <div className="flex flex-col gap-2">
                    {acts.map((act, index) => (
                        <Card key={act.id} size="sm">
                            <CardContent className="flex flex-col gap-2">
                                <div className="flex items-center gap-1.5">
                                    <span className="shrink-0 text-muted-foreground tabular-nums">{index + 1}</span>
                                    <Input
                                        value={act.name}
                                        aria-label={`第 ${index + 1} 个阶段名`}
                                        placeholder="阶段名：开端 / 中点 / 低谷 / 高潮"
                                        className="h-7 font-medium"
                                        onChange={(event) => handlePatch(act.id, { name: event.target.value })}
                                    />
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="shrink-0 rounded-full"
                                        aria-label={`删除第 ${index + 1} 个阶段`}
                                        onClick={() => onChange(acts.filter((item) => item.id !== act.id))}
                                    >
                                        <Trash2 />
                                    </Button>
                                </div>
                                <OutlineTextField
                                    id={`outline-act-position-${act.id}`}
                                    label="位置"
                                    value={act.position}
                                    placeholder="打破平衡 / 升级对抗 / 迫使选择"
                                    onChange={(position) => handlePatch(act.id, { position })}
                                />
                                <OutlineTextArea
                                    id={`outline-act-event-${act.id}`}
                                    label="关键事件"
                                    value={act.event}
                                    placeholder="这一阶段真正发生了什么，主角因此改变了什么"
                                    onChange={(event) => handlePatch(act.id, { event })}
                                />
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </PanelShell>
    )
}
