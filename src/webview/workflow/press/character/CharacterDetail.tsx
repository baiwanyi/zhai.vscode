/**
 * 人物卡编辑器：按「基础 / 外貌 / 角色卡 / 动机 / 背景 / 关系」六组编辑单个角色，字段与 角色设定.md 的区块对齐。
 * 复用约定：分组切换复用 ui/tabs（均分整行、不横向滚动），字段布局复用 ui/field，角色、体型与性别选择复用 ui/toggle-group，
 * 标签型字段（性格）复用设定页的 TagField；外貌与角色卡分别由 useCharacterAppearance、CharacterPortraitPanel 承担。
 * 关键约束：所有控件只通过补丁回传给调用方（编辑弹窗的草稿），本组件不持有角色数据副本；
 * 生成结果写入字段或图库后仍需用户保存，未保存即关闭弹窗则丢弃；字段 id 固定，同时只会挂载一张卡；
 * 基础信息固定两列排版（姓名/昵称、年龄/身高各一行），身份与动机三项用多行输入——这些字段常常不止一句话；
 * 单行输入统一 32px 高、上下各 6px 内边距，与 Select 触发器等控件对齐；
 * 生成结果与失败原因统一经 sonner 提示，页面内不渲染内联错误文本。
 */
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { Spinner } from '@components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@components/ui/tabs'
import { Textarea } from '@components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@components/ui/toggle-group'
import { CharacterPortraitPanel } from './CharacterPortraitPanel'
import { useCharacterAppearance } from './useCharacterAppearance'
import type { CharacterCard } from '../types'
import type { AppearanceContext } from './useCharacterAppearance'
import type { JSX } from 'react'
import {
    CHARACTER_BODY_TYPE_META,
    CHARACTER_BODY_TYPE_ORDER,
    CHARACTER_GENDER_META,
    CHARACTER_GENDER_ORDER,
    CHARACTER_ROLE_META,
    CHARACTER_ROLE_ORDER,
} from '../constants'
import { TagField } from '../setting/TagField'

interface CharacterDetailProps {
    character: CharacterCard
    onChange: (patch: Partial<CharacterCard>) => void
    /** 作品层氛围：供外貌生成约束时代与题材 */
    aiContext: AppearanceContext
    /** 当前作品目录：角色卡落在该作品目录下 */
    dirPath: string
}

export function CharacterDetail({ character, onChange, aiContext, dirPath }: CharacterDetailProps): JSX.Element {
    const { isGenerating, generate, abort } = useCharacterAppearance()

    const handleRoleChange = (value: string): void => {
        const next = CHARACTER_ROLE_ORDER.find((role) => role === value)
        if (next) {
            onChange({ role: next })
        }
    }

    const handleGenderChange = (value: string): void => {
        const next = CHARACTER_GENDER_ORDER.find((gender) => gender === value)
        if (next) {
            onChange({ gender: next })
        }
    }

    /** 体型是必选档位：取消选择时保持原值，避免出现空体型 */
    const handleBodyTypeChange = (value: string): void => {
        const next = CHARACTER_BODY_TYPE_ORDER.find((bodyType) => bodyType === value)
        if (next) {
            onChange({ bodyType: next })
        }
    }

    /** 生成外貌草稿：成功后直接写入字段，用户仍可修改或撤销 */
    const handleGenerateAppearance = async (): Promise<void> => {
        const content = await generate(character, aiContext)
        if (content !== null) {
            onChange({ appearance: content })
            toast.success('外貌描写已生成，保存人物卡后生效')
        }
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            <Tabs defaultValue="basic" className="min-h-0 flex-1 gap-0">
                {/* 标签均分整行宽度：6 个标签在窄面板下不换行、不横向滚动，下划线也不会被滚动容器裁掉 */}
                <div className="shrink-0">
                    <TabsList variant="line" className="w-full">
                        <TabsTrigger value="basic" className="px-1">
                            基础
                        </TabsTrigger>
                        <TabsTrigger value="appearance" className="px-1">
                            外貌
                        </TabsTrigger>
                        <TabsTrigger value="portrait" className="px-1">
                            角色卡
                        </TabsTrigger>
                        <TabsTrigger value="motive" className="px-1">
                            动机
                        </TabsTrigger>
                        <TabsTrigger value="ability" className="px-1">
                            背景
                        </TabsTrigger>
                        <TabsTrigger value="relation" className="px-1">
                            关系
                        </TabsTrigger>
                    </TabsList>
                </div>
                {/* 滚动槽常驻：长短标签页切换时内容宽度不跳，避免滚动条反复挤占空间；左右留 2px 防止聚焦环被横向裁切 */}
                <div className="min-h-0 flex-1 overflow-y-auto px-0.5 py-2 [scrollbar-gutter:stable]">
                    <TabsContent value="basic" className="flex flex-col gap-3">
                        {/* 两列固定：姓名/昵称、年龄/身高各占一行，窄面板下也不折行 */}
                        <div className="grid grid-cols-2 gap-3">
                            <Field>
                                <FieldLabel htmlFor="character-name">姓名</FieldLabel>
                                <Input
                                    id="character-name"
                                    value={character.name}
                                    className="h-8 px-3 py-1 leading-5"
                                    onChange={(event) => onChange({ name: event.target.value })}
                                />
                            </Field>
                            <Field>
                                <FieldLabel htmlFor="character-alias">昵称</FieldLabel>
                                <Input
                                    id="character-alias"
                                    value={character.alias}
                                    className="h-8 px-3 py-1 leading-5"
                                    onChange={(event) => onChange({ alias: event.target.value })}
                                />
                            </Field>
                            <Field>
                                <FieldLabel htmlFor="character-age">年龄</FieldLabel>
                                <Input
                                    id="character-age"
                                    value={character.age}
                                    className="h-8 px-3 py-1 leading-5"
                                    onChange={(event) => onChange({ age: event.target.value })}
                                />
                            </Field>
                            <Field>
                                <FieldLabel htmlFor="character-height">身高</FieldLabel>
                                <Input
                                    id="character-height"
                                    value={character.height}
                                    placeholder="如：一米七八"
                                    className="h-8 px-3 py-1 leading-5"
                                    onChange={(event) => onChange({ height: event.target.value })}
                                />
                            </Field>
                        </div>
                        <Field>
                            <FieldLabel htmlFor="character-identity">身份</FieldLabel>
                            <Textarea
                                id="character-identity"
                                value={character.identity}
                                placeholder="如：星月宗外门弟子，兼商会账房"
                                className="min-h-16"
                                onChange={(event) => onChange({ identity: event.target.value })}
                            />
                            <FieldDescription>门派、职位与出身可以一起写，续写时按这段确定说话分寸</FieldDescription>
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="character-role">角色</FieldLabel>
                            <ToggleGroup
                                type="single"
                                value={character.role}
                                className="flex-wrap"
                                onValueChange={handleRoleChange}
                            >
                                {CHARACTER_ROLE_ORDER.map((role) => (
                                    <ToggleGroupItem key={role} value={role} size="sm" variant="outline">
                                        {CHARACTER_ROLE_META[role].label}
                                    </ToggleGroupItem>
                                ))}
                            </ToggleGroup>
                            <FieldDescription>角色分类决定大纲排布时该人物承担的功能</FieldDescription>
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="character-body-type">体型</FieldLabel>
                            <ToggleGroup
                                type="single"
                                value={character.bodyType}
                                className="flex-wrap"
                                onValueChange={handleBodyTypeChange}
                            >
                                {CHARACTER_BODY_TYPE_ORDER.map((bodyType) => (
                                    <ToggleGroupItem key={bodyType} value={bodyType} size="sm" variant="outline">
                                        {CHARACTER_BODY_TYPE_META[bodyType].label}
                                    </ToggleGroupItem>
                                ))}
                            </ToggleGroup>
                            <FieldDescription>与身高一起约束外貌描写和角色设定图的身形比例</FieldDescription>
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="character-gender">性别</FieldLabel>
                            <ToggleGroup
                                type="single"
                                value={character.gender}
                                className="flex-wrap"
                                onValueChange={handleGenderChange}
                            >
                                {CHARACTER_GENDER_ORDER.map((gender) => (
                                    <ToggleGroupItem key={gender} value={gender} size="sm" variant="outline">
                                        {CHARACTER_GENDER_META[gender].label}
                                    </ToggleGroupItem>
                                ))}
                            </ToggleGroup>
                            <FieldDescription>用于外貌描写与角色设定图的性别约束，男女必选其一</FieldDescription>
                        </Field>
                    </TabsContent>

                    <TabsContent value="appearance" className="flex flex-col gap-3">
                        <Field>
                            <div className="flex items-center justify-between gap-2">
                                <FieldLabel htmlFor="character-appearance">外貌描写</FieldLabel>
                                {isGenerating ? (
                                    <Button
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
                                className="min-h-40"
                                onChange={(event) => onChange({ appearance: event.target.value })}
                            />
                            <FieldDescription>
                                写外观与气质，供正文引用；AI 会结合角色、性别、身份、性格与作品时代生成一版草稿
                            </FieldDescription>
                        </Field>
                    </TabsContent>

                    <TabsContent value="portrait" className="flex flex-col gap-3">
                        <CharacterPortraitPanel
                            character={character}
                            aiContext={aiContext}
                            dirPath={dirPath}
                            onChange={onChange}
                        />
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
                            <Textarea
                                id="character-desire"
                                value={character.desire}
                                placeholder="推进这个人物的那个念头"
                                className="min-h-16"
                                onChange={(event) => onChange({ desire: event.target.value })}
                            />
                            <FieldDescription>推动这个人物做所有决定的那个念头</FieldDescription>
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="character-weakness">致命弱点</FieldLabel>
                            <Textarea
                                id="character-weakness"
                                value={character.weakness}
                                placeholder="能被对手利用、也能推动转变的软肋"
                                className="min-h-16"
                                onChange={(event) => onChange({ weakness: event.target.value })}
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="character-catchphrase">口头禅</FieldLabel>
                            <Textarea
                                id="character-catchphrase"
                                value={character.catchphrase}
                                placeholder="出场时反复出现的那句话"
                                className="min-h-16"
                                onChange={(event) => onChange({ catchphrase: event.target.value })}
                            />
                        </Field>
                    </TabsContent>

                    <TabsContent value="ability" className="flex flex-col gap-3">
                        <Field>
                            <FieldLabel htmlFor="character-background">背景故事</FieldLabel>
                            <Textarea
                                id="character-background"
                                value={character.background}
                                placeholder="出身、关键经历与性格成因"
                                className="min-h-24"
                                onChange={(event) => onChange({ background: event.target.value })}
                            />
                            <FieldDescription>导入作品时由出场原文归纳，续写时用来把握人物的行事逻辑</FieldDescription>
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="character-ability">能力 / 资源</FieldLabel>
                            <Textarea
                                id="character-ability"
                                value={character.ability}
                                className="min-h-16"
                                onChange={(event) => onChange({ ability: event.target.value })}
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="character-arc">成长弧线</FieldLabel>
                            <Textarea
                                id="character-arc"
                                value={character.arc}
                                placeholder="从什么状态，走到什么状态"
                                className="min-h-16"
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
                                className="min-h-24"
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
