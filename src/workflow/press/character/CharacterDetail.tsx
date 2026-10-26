/**
 * 人物卡编辑器：按「基础 / 外貌 / 动机 / 背景 / 关系」五组编辑单个角色，字段与 角色设定.md 的区块对齐。
 * 复用约定：分组切换复用 ui/tabs（均分整行、不横向滚动），字段布局复用 ui/field 与同文件的单行 / 多行字段组件，
 * 角色、性别与体型选择复用 components/SegmentedRail，标签型字段（性格）复用设定页的 TagField；
 * 各标签页收在同文件的私有组件里，主组件只做编排与外貌生成状态。
 * 关键约束：所有控件只通过补丁回传给调用方（编辑弹窗的草稿），本组件不持有角色数据副本，生成结果写回后仍需用户保存；
 * 外貌生成的 hook 必须留在主组件：切换标签页会卸载面板内容，挂在面板内会连带取消在途请求；
 * 基础信息固定两列排版，左列展示角色设定图封面、右列为字段；图片统一在生图页产出与替换，人物卡内不再出图；
 * 单行输入统一 32px 高、上下各 6px 内边距；结果与失败原因统一经 sonner 提示，页面内不渲染内联错误文本。
 */
import { ImagePlus, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import { Field, FieldDescription, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@components/ui/input-group'
import { ScrollArea } from '@components/ui/scroll-area'
import { Skeleton } from '@components/ui/skeleton'
import { Spinner } from '@components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@components/ui/tabs'
import { Textarea } from '@components/ui/textarea'
import { Image } from '@webview/components/Image'
import { SegmentedRail } from '@webview/components/SegmentedRail'
import { useCharacterAppearance } from './useCharacterAppearance'
import { useCharacterCover } from './useCharacterCover'
import type { CharacterCard } from '../types'
import type { AppearanceContext } from './useCharacterAppearance'
import type { JSX } from 'react'
import {
    CHARACTER_BODY_TYPE_OPTIONS,
    CHARACTER_BODY_TYPE_ORDER,
    CHARACTER_GENDER_OPTIONS,
    CHARACTER_GENDER_ORDER,
    CHARACTER_ROLE_OPTIONS,
    CHARACTER_ROLE_ORDER,
} from '../constants'
import { TagField } from '../setting/TagField'
import { toOptionValue } from '../utils'

/** 单行输入统一 32px 高、上下各 6px 内边距：与 Select 触发器等控件对齐 */
const INPUT_CLASS = 'h-8 px-3 py-1 leading-5'

/** 标签页内容统一纵向排布：五个面板共用，切换时间距不跳 */
const TAB_CONTENT_CLASS = 'flex flex-col gap-3 px-1'

/** 多行字段高度档位：短档 4 行、长档 6 行；类名集中在此，调用方不传任意类，避免 Tailwind 扫不到 */
const TEXTAREA_HEIGHT_CLASS: Readonly<Record<'short' | 'long', string>> = {
    short: 'min-h-16',
    long: 'min-h-24',
}

/** 作品层上下文：外貌生成要时代与题材，角色设定图要目录，两者都随作品切换 */
export interface CharacterWorkspace {
    aiContext: AppearanceContext
    /** 当前作品目录：角色设定图从该作品的 Portraits 回读 */
    dirPath: string
}

interface CharacterDetailProps {
    character: CharacterCard
    workspace: CharacterWorkspace
    onChange: (patch: Partial<CharacterCard>) => void
}

export function CharacterDetail({ character, workspace, onChange }: CharacterDetailProps): JSX.Element {
    const { aiContext, dirPath } = workspace
    const { isGenerating, generate } = useCharacterAppearance()

    /** 生成外貌草稿：成功后直接写入字段，用户仍可修改或撤销 */
    const handleGenerateAppearance = async (): Promise<void> => {
        const content = await generate(character, aiContext)
        if (content !== null) {
            onChange({ appearance: content })
            toast.success('外貌描写已生成，保存人物卡后生效')
        }
    }

    return (
        <Tabs defaultValue="basic" className="min-h-0 flex-1">
            <TabsList className="w-full">
                <TabsTrigger value="basic">基础</TabsTrigger>
                <TabsTrigger value="appearance">外貌</TabsTrigger>
                <TabsTrigger value="motive">动机</TabsTrigger>
                <TabsTrigger value="ability">背景</TabsTrigger>
                <TabsTrigger value="relation">关系</TabsTrigger>
            </TabsList>
            {/* 滚动槽常驻：长短标签页切换时内容宽度不跳，避免滚动条反复挤占空间 */}
            <ScrollArea className="min-h-0 flex-1 p-4">
                <TabsContent value="basic" className={TAB_CONTENT_CLASS}>
                    <CharacterBasicTab character={character} dirPath={dirPath} onChange={onChange} />
                </TabsContent>
                <TabsContent value="appearance" className={TAB_CONTENT_CLASS}>
                    <CharacterAppearanceTab
                        character={character}
                        isGenerating={isGenerating}
                        onChange={onChange}
                        onGenerate={() => {
                            void handleGenerateAppearance()
                        }}
                    />
                </TabsContent>
                <TabsContent value="motive" className={TAB_CONTENT_CLASS}>
                    <CharacterMotiveTab character={character} onChange={onChange} />
                </TabsContent>
                <TabsContent value="ability" className={TAB_CONTENT_CLASS}>
                    <CharacterBackgroundTab character={character} onChange={onChange} />
                </TabsContent>
                <TabsContent value="relation" className={TAB_CONTENT_CLASS}>
                    <CharacterRelationTab character={character} onChange={onChange} />
                </TabsContent>
            </ScrollArea>
        </Tabs>
    )
}

/** 各标签页共用的最小契约：只读人物卡字段、只回传补丁 */
interface CharacterTabProps {
    character: CharacterCard
    onChange: (patch: Partial<CharacterCard>) => void
}

interface CharacterBasicTabProps extends CharacterTabProps {
    /** 当前作品目录：角色设定图从该作品的 Portraits 回读 */
    dirPath: string
}

/** 基础页：左列角色设定图、右列姓名等单行字段与性别；身份、角色、体型排在下方 */
function CharacterBasicTab({ character, dirPath, onChange }: CharacterBasicTabProps): JSX.Element {
    const handleGenderChange = (value: string): void => {
        const next = toOptionValue(CHARACTER_GENDER_ORDER, value)
        if (next !== null) {
            onChange({ gender: next })
        }
    }

    const handleRoleChange = (value: string): void => {
        const next = toOptionValue(CHARACTER_ROLE_ORDER, value)
        if (next !== null) {
            onChange({ role: next })
        }
    }

    /** 体型是必选档位：取消选择时保持原值，避免出现空体型 */
    const handleBodyTypeChange = (value: string): void => {
        const next = toOptionValue(CHARACTER_BODY_TYPE_ORDER, value)
        if (next !== null) {
            onChange({ bodyType: next })
        }
    }

    return (
        <>
            <div className="grid grid-cols-2 gap-3">
                <CharacterPortraitFigure character={character} dirPath={dirPath} />
                <div className="flex flex-col gap-3">
                    <CharacterInputField
                        id="character-name"
                        label="姓名"
                        value={character.name}
                        onChange={(name) => onChange({ name })}
                    />
                    <CharacterInputField
                        id="character-alias"
                        label="昵称"
                        value={character.alias}
                        onChange={(alias) => onChange({ alias })}
                    />
                    <CharacterInputField
                        id="character-age"
                        label="年龄"
                        value={character.age}
                        onChange={(age) => onChange({ age })}
                    />
                    <CharacterInputField
                        id="character-height"
                        label="身高"
                        value={character.height}
                        placeholder="如：一米七八"
                        onChange={(height) => onChange({ height })}
                    />
                    <Field>
                        <FieldLabel htmlFor="character-gender">性别</FieldLabel>
                        <SegmentedRail
                            items={CHARACTER_GENDER_OPTIONS}
                            value={character.gender}
                            onChange={handleGenderChange}
                            ariaLabel="性别"
                            variant="chip"
                        />
                    </Field>
                </div>
            </div>

            <CharacterTextareaField
                id="character-identity"
                label="身份"
                value={character.identity}
                placeholder="如：星月宗外门弟子，兼商会账房"
                description="门派、职位与出身可以一起写，续写时按这段确定说话分寸"
                onChange={(identity) => onChange({ identity })}
            />
            <Field>
                <FieldLabel htmlFor="character-role">角色</FieldLabel>
                <SegmentedRail
                    items={CHARACTER_ROLE_OPTIONS}
                    value={character.role}
                    onChange={handleRoleChange}
                    ariaLabel="角色"
                    variant="chip"
                />
                <FieldDescription>角色分类决定大纲排布时该人物承担的功能</FieldDescription>
            </Field>
            <Field>
                <FieldLabel htmlFor="character-body-type">体型</FieldLabel>
                <SegmentedRail
                    items={CHARACTER_BODY_TYPE_OPTIONS}
                    value={character.bodyType}
                    onChange={handleBodyTypeChange}
                    ariaLabel="体型"
                    variant="chip"
                />
                <FieldDescription>与身高一起约束外貌描写和角色设定图的身形比例</FieldDescription>
            </Field>
        </>
    )
}

interface CharacterAppearanceTabProps extends CharacterTabProps {
    /** 生成中：禁用按钮并换成 spinner */
    isGenerating: boolean
    /** 触发一次生成：忙碌判定与请求都在外层，切换标签页不会打断在途请求 */
    onGenerate: () => void
}

/** 外貌页：生成按钮的忙碌态由外层持有，本组件只负责文案与按钮摆放 */
function CharacterAppearanceTab({
    character,
    isGenerating,
    onChange,
    onGenerate,
}: CharacterAppearanceTabProps): JSX.Element {
    return (
        <Field>
            <FieldLabel htmlFor="character-appearance">外貌描写</FieldLabel>
            <InputGroup>
                <InputGroupTextarea
                    id="character-appearance"
                    value={character.appearance}
                    placeholder="如：瘦高，袖口永远卷到小臂；指节有薄茧，左眉一道旧疤"
                    className="min-h-40"
                    onChange={(event) => onChange({ appearance: event.target.value })}
                />
                <InputGroupAddon align="block-end">
                    <InputGroupButton size="icon-xs" className="ml-auto" disabled={isGenerating} onClick={onGenerate}>
                        {isGenerating ? <Spinner /> : <Sparkles />}
                        <span className="sr-only">AI 生成</span>
                    </InputGroupButton>
                </InputGroupAddon>
            </InputGroup>
            <FieldDescription>
                写外观与气质，供正文引用；AI 会结合角色、性别、身份、性格与作品时代生成一版草稿
            </FieldDescription>
        </Field>
    )
}

/** 动机页：性格标签与三项多行输入，推动人物做决定的内因集中在这里 */
function CharacterMotiveTab({ character, onChange }: CharacterTabProps): JSX.Element {
    return (
        <>
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
            <CharacterTextareaField
                id="character-desire"
                label="核心欲望"
                value={character.desire}
                placeholder="推进这个人物的那个念头"
                description="推动这个人物做所有决定的那个念头"
                onChange={(desire) => onChange({ desire })}
            />
            <CharacterTextareaField
                id="character-weakness"
                label="致命弱点"
                value={character.weakness}
                placeholder="能被对手利用、也能推动转变的软肋"
                onChange={(weakness) => onChange({ weakness })}
            />
            <CharacterTextareaField
                id="character-catchphrase"
                label="口头禅"
                value={character.catchphrase}
                placeholder="出场时反复出现的那句话"
                onChange={(catchphrase) => onChange({ catchphrase })}
            />
        </>
    )
}

/** 背景页：出身、能力与成长弧线，长文本统一用长档高度 */
function CharacterBackgroundTab({ character, onChange }: CharacterTabProps): JSX.Element {
    return (
        <>
            <CharacterTextareaField
                id="character-background"
                label="背景故事"
                value={character.background}
                placeholder="出身、关键经历与性格成因"
                height="long"
                description="导入作品时由出场原文归纳，续写时用来把握人物的行事逻辑"
                onChange={(background) => onChange({ background })}
            />
            <CharacterTextareaField
                id="character-ability"
                label="能力 / 资源"
                value={character.ability}
                onChange={(ability) => onChange({ ability })}
            />
            <CharacterTextareaField
                id="character-arc"
                label="成长弧线"
                value={character.arc}
                placeholder="从什么状态，走到什么状态"
                onChange={(arc) => onChange({ arc })}
            />
        </>
    )
}

/** 关系页：关系图谱尚未提供，先以文字记录与其他人物、组织的张力 */
function CharacterRelationTab({ character, onChange }: CharacterTabProps): JSX.Element {
    return (
        <CharacterTextareaField
            id="character-relation"
            label="人物关系"
            value={character.relation}
            placeholder="与其他人物、组织的关系与张力"
            height="long"
            description="关系图谱在后续版本提供，这里先以文字记录"
            onChange={(relation) => onChange({ relation })}
        />
    )
}

interface CharacterPortraitFigureProps {
    character: CharacterCard
    /** 当前作品目录：角色设定图从该作品的 Portraits 回读 */
    dirPath: string
}

/**
 * 角色设定图展示：取人物卡封面，未设封面时退回最新一张。
 * 回读与选图由 useCharacterCover 承担，出图、换图与图库管理都在生图页完成，这里只呈现结果。
 */
function CharacterPortraitFigure({ character, dirPath }: CharacterPortraitFigureProps): JSX.Element {
    const { portrait, isLoading } = useCharacterCover(dirPath, character.id, character.coverPortraitId)

    if (isLoading) {
        return <Skeleton className="aspect-3/4 w-full rounded-lg" />
    }
    if (portrait === null) {
        return (
            <Empty className="border py-4">
                <EmptyHeader>
                    <EmptyMedia variant="icon">
                        <ImagePlus />
                    </EmptyMedia>
                    <EmptyTitle>还没有角色设定图</EmptyTitle>
                    <EmptyDescription>在生图页为该人物生成后，这里显示封面图</EmptyDescription>
                </EmptyHeader>
            </Empty>
        )
    }
    return (
        <Image
            src={portrait.url}
            alt={`${character.name} 的角色设定图`}
            aspect="3/4"
            size="lg"
            className="border border-border"
        />
    )
}

interface CharacterInputFieldProps {
    id: string
    label: string
    value: string
    placeholder?: string
    onChange: (value: string) => void
}

/** 单行字段：标签、输入框与统一尺寸收在一处，新增字段不再重复写一遍 className 与取值回调 */
function CharacterInputField({ id, label, value, placeholder, onChange }: CharacterInputFieldProps): JSX.Element {
    return (
        <Field>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            <Input
                id={id}
                value={value}
                placeholder={placeholder}
                className={INPUT_CLASS}
                onChange={(event) => onChange(event.target.value)}
            />
        </Field>
    )
}

interface CharacterTextareaFieldProps {
    id: string
    label: string
    value: string
    placeholder?: string
    /** 高度档位：默认短档（4 行），长文本用 long（6 行） */
    height?: 'short' | 'long'
    description?: string
    onChange: (value: string) => void
}

/** 多行字段：说明文字可选，缺省时不渲染占位段落，避免空节点撑出额外间距 */
function CharacterTextareaField({
    id,
    label,
    value,
    placeholder,
    height = 'short',
    description,
    onChange,
}: CharacterTextareaFieldProps): JSX.Element {
    return (
        <Field>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            <Textarea
                id={id}
                value={value}
                placeholder={placeholder}
                className={TEXTAREA_HEIGHT_CLASS[height]}
                onChange={(event) => onChange(event.target.value)}
            />
            {description === undefined ? null : <FieldDescription>{description}</FieldDescription>}
        </Field>
    )
}
