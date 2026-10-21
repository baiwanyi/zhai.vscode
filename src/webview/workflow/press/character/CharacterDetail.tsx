/**
 * 人物卡编辑器：按「基础 / 外貌 / 性格与动机 / 背景与能力 / 关系」五组编辑单个角色，字段与 角色设定.md 的区块对齐。
 * 复用约定：分组切换复用 ui/tabs（横向可滚动），字段布局复用 ui/field，定位选择复用 ui/toggle-group，
 * 标签型字段（性格）复用设定页的 TagField；外貌由 useCharacterAppearance 经宿主 AI 生成。
 * 关键约束：所有控件只通过补丁回传给调用方（编辑弹窗的草稿），本组件不持有角色数据副本；
 * 外貌生成结果写入字段后仍需用户保存，未保存即关闭弹窗则丢弃；字段 id 固定，同时只会挂载一张卡。
 */
import { Sparkles } from 'lucide-react'
import { Alert, AlertDescription } from '@components/ui/alert'
import { Button } from '@components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { Spinner } from '@components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@components/ui/tabs'
import { Textarea } from '@components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@components/ui/toggle-group'
import { useCharacterAppearance } from './useCharacterAppearance'
import type { CharacterCard, CharacterRole } from '../types'
import type { AppearanceContext } from './useCharacterAppearance'
import type { JSX } from 'react'
import { CHARACTER_ROLE_META } from '../constants'
import { TagField } from '../setting/TagField'

interface CharacterDetailProps {
    character: CharacterCard
    onChange: (patch: Partial<CharacterCard>) => void
    /** 作品层氛围：供外貌生成约束时代与题材 */
    aiContext: AppearanceContext
}

/** 可选定位：顺序与列表分组一致 */
const ROLE_OPTIONS: readonly CharacterRole[] = ['protagonist', 'heroine', 'supporting', 'antagonist']

export function CharacterDetail({ character, onChange, aiContext }: CharacterDetailProps): JSX.Element {
    const { isGenerating, error, generate, abort } = useCharacterAppearance()

    const handleRoleChange = (value: string): void => {
        const next = ROLE_OPTIONS.find((role) => role === value)
        if (next) {
            onChange({ role: next })
        }
    }

    /** 生成外貌草稿：成功后直接写入字段，用户仍可修改或撤销 */
    const handleGenerateAppearance = async (): Promise<void> => {
        const content = await generate(character, aiContext)
        if (content !== null) {
            onChange({ appearance: content })
        }
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            <Tabs defaultValue="basic" className="min-h-0 flex-1 gap-0">
                <div className="shrink-0 overflow-x-auto">
                    <TabsList variant="line" className="w-max">
                        <TabsTrigger value="basic">基础</TabsTrigger>
                        <TabsTrigger value="appearance">外貌</TabsTrigger>
                        <TabsTrigger value="motive">性格与动机</TabsTrigger>
                        <TabsTrigger value="ability">背景与能力</TabsTrigger>
                        <TabsTrigger value="relation">关系</TabsTrigger>
                    </TabsList>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto py-2">
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

                    <TabsContent value="appearance" className="flex flex-col gap-3">
                        <Field>
                            <div className="flex items-center justify-between gap-2">
                                <FieldLabel htmlFor="character-appearance">外貌描写</FieldLabel>
                                {isGenerating ? (
                                    <Button
                                        size="xs"
                                        variant="ghost"
                                        onClick={() => {
                                            void abort()
                                        }}
                                    >
                                        <Spinner data-icon="inline-start" />
                                        取消
                                    </Button>
                                ) : (
                                    <Button
                                        size="xs"
                                        variant="outline"
                                        onClick={() => {
                                            void handleGenerateAppearance()
                                        }}
                                    >
                                        <Sparkles data-icon="inline-start" />
                                        AI 生成
                                    </Button>
                                )}
                            </div>
                            <Textarea
                                id="character-appearance"
                                value={character.appearance}
                                placeholder="如：瘦高，袖口永远卷到小臂；指节有薄茧，左眉一道旧疤"
                                className="min-h-40 text-xs"
                                onChange={(event) => onChange({ appearance: event.target.value })}
                            />
                            <FieldDescription>
                                写外观与气质，供正文引用；AI 会结合定位、身份、性格与作品时代生成一版草稿
                            </FieldDescription>
                            {error !== null ? (
                                <Alert variant="destructive">
                                    <AlertDescription>{error}</AlertDescription>
                                </Alert>
                            ) : null}
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
