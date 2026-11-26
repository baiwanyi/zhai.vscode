/**
 * 场景纲卡片：一张 Card 承载章节的全部场景，头部含场景数、写法说明与添加按钮，空列表给出明确文案。
 * 复用约定：外层与单场卡片均取 @components/ui/card，场景字段取 ui/field 的 FieldGroup 与 components/InputTextGroup，按钮取 @webview/components/Button，空态取 blocks/Empty；
 * 场景字段 id 以场景 id 前缀区分多场同屏，缺三要素的提示只在单场卡片内显示。
 * 关键约束：改动只经 onPatch / onAdd / onRemove 回传场景补丁，不直接修改传入数组；
 * 序号展示用 scene.order，可访问名称用数组位置，两者口径不同但各自稳定。
 */
import { Clapperboard, Plus, Trash2 } from 'lucide-react'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card'
import { FieldGroup } from '@components/ui/field'
import { Badge } from '@webview/blocks/Badge'
import { Empty } from '@webview/blocks/Empty'
import { Button } from '@webview/components/Button'
import { InputTextGroup } from '@webview/components/InputTextGroup'
import type { OutlineScene } from '../../types'
import type { JSX } from 'react'

/** 判断一场戏是否缺少最小结构：没有欲望、阻碍或变化时给出提示 */
function isSceneIncomplete(scene: OutlineScene): boolean {
    return (
        scene.desire.trim().length === 0 ||
        scene.obstacle.trim().length === 0 ||
        (scene.result.trim().length === 0 && scene.emotion.trim().length === 0)
    )
}

interface ChapterSceneItemProps {
    scene: OutlineScene
    index: number
    onChange: (patch: Partial<OutlineScene>) => void
    onRemove: () => void
}

/** 单场戏：左侧强调条 + 场景徽标把它和章纲字段区分开，字段名与场景纲的文档键一致 */
function ChapterSceneItem({ scene, index, onChange, onRemove }: ChapterSceneItemProps): JSX.Element {
    return (
        <Card size="sm">
            <CardHeader>
                <CardTitle>
                    <InputTextGroup
                        id={`scene-title-${scene.id}`}
                        value={scene.title}
                        label={`场景 ${scene.order}`}
                        aria-label={`第 ${index + 1} 场戏标题`}
                        placeholder="这场戏发生在哪里?"
                        onChange={(title) => onChange({ title })}
                    />
                </CardTitle>
                <CardAction>
                    <Button
                        variant="destructive"
                        size="icon"
                        tooltip={`删除第 ${index + 1} 场戏`}
                        aria-label={`删除第 ${index + 1} 场戏`}
                        onClick={onRemove}
                    >
                        <Trash2 />
                    </Button>
                </CardAction>
                {isSceneIncomplete(scene) ? (
                    <CardDescription className="col-span-full">
                        没有欲望、阻碍与变化：这场戏可以考虑删掉或与相邻场景合并。
                    </CardDescription>
                ) : null}
            </CardHeader>
            <CardContent>
                <FieldGroup className="flex flex-col gap-2">
                    <InputTextGroup
                        id={`scene-desire-${scene.id}`}
                        value={scene.desire}
                        label="欲望"
                        placeholder="谁想要什么"
                        onChange={(desire) => onChange({ desire })}
                    />
                    <InputTextGroup
                        id={`scene-obstacle-${scene.id}`}
                        value={scene.obstacle}
                        label="阻碍"
                        placeholder="谁 / 什么阻止"
                        onChange={(obstacle) => onChange({ obstacle })}
                    />
                    <InputTextGroup
                        id={`scene-choice-${scene.id}`}
                        value={scene.choice}
                        label="选择"
                        placeholder="他做了什么"
                        onChange={(choice) => onChange({ choice })}
                    />
                    <InputTextGroup
                        id={`scene-result-${scene.id}`}
                        value={scene.result}
                        label="结果"
                        placeholder="达成 / 失败 / 代价"
                        onChange={(result) => onChange({ result })}
                    />
                    <InputTextGroup
                        id={`scene-emotion-${scene.id}`}
                        value={scene.emotion}
                        label="情绪变化"
                        placeholder="从什么到什么"
                        onChange={(emotion) => onChange({ emotion })}
                    />
                </FieldGroup>
            </CardContent>
        </Card>
    )
}

interface ChapterEditSceneCardProps {
    scenes: readonly OutlineScene[]
    onAdd: () => void
    onPatch: (sceneId: string, patch: Partial<OutlineScene>) => void
    onRemove: (sceneId: string) => void
}

/** 场景纲卡片：头部说明与添加入口固定，内容区按场景数在空态与列表间切换 */
export function ChapterEditSceneCard({ scenes, onAdd, onPatch, onRemove }: ChapterEditSceneCardProps): JSX.Element {
    return (
        <Card size="sm">
            <CardHeader>
                <CardTitle>场景纲</CardTitle>
                <CardAction className="flex items-center gap-2">
                    <Badge variant="outline">{scenes.length} 场</Badge>
                    <Button variant="secondary" size="icon-xs" tooltip="添加场景" onClick={onAdd}>
                        <Plus />
                    </Button>
                </CardAction>
            </CardHeader>
            <CardContent>
                {scenes.length === 0 ? (
                    <Empty
                        icon={Clapperboard}
                        title="还没有场景"
                        description="写细纲时按「谁想要什么 → 遇到什么 → 做了什么选择 → 结果 → 情绪变化」拆成一场场。"
                        className="py-6"
                    />
                ) : (
                    <div className="flex flex-col gap-2">
                        {scenes.map((scene, index) => (
                            <ChapterSceneItem
                                key={scene.id}
                                scene={scene}
                                index={index}
                                onChange={(patch) => onPatch(scene.id, patch)}
                                onRemove={() => onRemove(scene.id)}
                            />
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
