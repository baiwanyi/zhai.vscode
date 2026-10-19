/**
 * 人物卡详情：按「基础 / 性格与动机 / 背景与能力 / 关系」四组编辑单个角色，字段与 角色设定.md 的区块对齐。
 * 复用约定：分组切换复用 ui/tabs（横向可滚动），字段布局复用 ui/field，定位选择复用 ui/toggle-group，
 * 标签型字段（性格）复用设定页的 TagField，保持两页的录入手感一致。
 * 关键约束：所有控件都通过补丁回传给页面，本组件不持有角色数据副本，避免与大纲中的出场人物不同步；
 * 定位为单人卡片，字段 id 固定，同时只会挂载一张卡，不存在重复 id。
 */
import { ArrowLeft } from 'lucide-react'
import { Button } from '@components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@components/ui/tabs'
import { Textarea } from '@components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@components/ui/toggle-group'
import type { CharacterCard, CharacterRole } from '../types'
import type { JSX } from 'react'
import { CHARACTER_ROLE_META } from '../constants'
import { TagField } from '../setting/TagField'

interface CharacterDetailProps {
    character: CharacterCard
    onChange: (patch: Partial<CharacterCard>) => void
    /** 窄容器下返回人物列表；宽容器下为无操作 */
    onBack: () => void
}

/** 可选定位：顺序与列表分组一致 */
const ROLE_OPTIONS: readonly CharacterRole[] = ['protagonist', 'heroine', 'supporting', 'antagonist']

export function CharacterDetail({ character, onChange, onBack }: CharacterDetailProps): JSX.Element {
    const handleRoleChange = (value: string): void => {
        const next = ROLE_OPTIONS.find((role) => role === value)
        if (next) {
            onChange({ role: next })
        }
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
                <Button
                    size="icon-xs"
                    variant="ghost"
                    className="rounded-full @2xl:hidden"
                    aria-label="返回人物列表"
                    onClick={onBack}
                >
                    <ArrowLeft />
                </Button>
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{character.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                    {CHARACTER_ROLE_META[character.role].label}
                </span>
            </div>
            <Tabs defaultValue="basic" className="min-h-0 flex-1 gap-0">
                <div className="shrink-0 overflow-x-auto px-2 pt-2">
                    <TabsList variant="line" className="w-max">
                        <TabsTrigger value="basic">基础</TabsTrigger>
                        <TabsTrigger value="motive">性格与动机</TabsTrigger>
                        <TabsTrigger value="ability">背景与能力</TabsTrigger>
                        <TabsTrigger value="relation">关系</TabsTrigger>
                    </TabsList>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                    <TabsContent value="basic" className="flex flex-col gap-3">
                        <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
                            <Field>
                                <FieldLabel htmlFor="character-name">姓名</FieldLabel>
                                <Input
                                    id="character-name"
                                    value={character.name}
                                    className="h-7 text-xs"
                                    onChange={(event) => onChange({ name: event.target.value })}
                                />
                            </Field>
                            <Field>
                                <FieldLabel htmlFor="character-alias">别名 / 称号</FieldLabel>
                                <Input
                                    id="character-alias"
                                    value={character.alias}
                                    className="h-7 text-xs"
                                    onChange={(event) => onChange({ alias: event.target.value })}
                                />
                            </Field>
                            <Field>
                                <FieldLabel htmlFor="character-age">年龄</FieldLabel>
                                <Input
                                    id="character-age"
                                    value={character.age}
                                    className="h-7 text-xs"
                                    onChange={(event) => onChange({ age: event.target.value })}
                                />
                            </Field>
                            <Field>
                                <FieldLabel htmlFor="character-identity">身份</FieldLabel>
                                <Input
                                    id="character-identity"
                                    value={character.identity}
                                    className="h-7 text-xs"
                                    onChange={(event) => onChange({ identity: event.target.value })}
                                />
                            </Field>
                        </div>
                        <Field>
                            <FieldLabel htmlFor="character-role">定位</FieldLabel>
                            <ToggleGroup
                                type="single"
                                value={character.role}
                                className="flex-wrap"
                                onValueChange={handleRoleChange}
                            >
                                {ROLE_OPTIONS.map((role) => (
                                    <ToggleGroupItem key={role} value={role} size="sm" variant="outline">
                                        {CHARACTER_ROLE_META[role].label}
                                    </ToggleGroupItem>
                                ))}
                            </ToggleGroup>
                            <FieldDescription>定位决定大纲排布时该人物承担的功能</FieldDescription>
                        </Field>
                    </TabsContent>

                    <TabsContent value="motive" className="flex flex-col gap-3">
                        <Field>
                            <FieldLabel htmlFor="character-traits">性格标签</FieldLabel>
                            <TagField
                                inputId="character-traits"
                                value={character.traits}
                                options={[]}
                                placeholder="输入性格标签，回车添加"
                                max={6}
                                onChange={(traits) => onChange({ traits })}
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="character-desire">核心欲望</FieldLabel>
                            <Input
                                id="character-desire"
                                value={character.desire}
                                className="h-7 text-xs"
                                onChange={(event) => onChange({ desire: event.target.value })}
                            />
                            <FieldDescription>推动这个人物做所有决定的那个念头</FieldDescription>
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="character-weakness">致命弱点</FieldLabel>
                            <Input
                                id="character-weakness"
                                value={character.weakness}
                                className="h-7 text-xs"
                                onChange={(event) => onChange({ weakness: event.target.value })}
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="character-catchphrase">口头禅</FieldLabel>
                            <Input
                                id="character-catchphrase"
                                value={character.catchphrase}
                                className="h-7 text-xs"
                                onChange={(event) => onChange({ catchphrase: event.target.value })}
                            />
                        </Field>
                    </TabsContent>

                    <TabsContent value="ability" className="flex flex-col gap-3">
                        <Field>
                            <FieldLabel htmlFor="character-ability">能力 / 资源</FieldLabel>
                            <Textarea
                                id="character-ability"
                                value={character.ability}
                                className="min-h-16 text-xs"
                                onChange={(event) => onChange({ ability: event.target.value })}
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="character-arc">成长弧线</FieldLabel>
                            <Textarea
                                id="character-arc"
                                value={character.arc}
                                placeholder="从什么状态，走到什么状态"
                                className="min-h-16 text-xs"
                                onChange={(event) => onChange({ arc: event.target.value })}
                            />
                        </Field>
                    </TabsContent>

                    <TabsContent value="relation" className="flex flex-col gap-3">
                        <Field>
                            <FieldLabel htmlFor="character-relation">人物关系</FieldLabel>
                            <Textarea
                                id="character-relation"
                                value={character.relation}
                                placeholder="与其他人物、组织的关系与张力"
                                className="min-h-24 text-xs"
                                onChange={(event) => onChange({ relation: event.target.value })}
                            />
                            <FieldDescription>关系图谱在后续版本提供，这里先以文字记录</FieldDescription>
                        </Field>
                    </TabsContent>
                </div>
            </Tabs>
        </div>
    )
}
