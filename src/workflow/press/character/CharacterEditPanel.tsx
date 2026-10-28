/**
 * 人物卡编辑器：按「基础 / 外貌 / 动机 / 背景 / 关系」五组编辑单个角色，字段与 角色设定.md 的区块对齐。
 * 复用约定：分组切换复用 ui/tabs（均分整行、不横向滚动），字段纵向排布与间距统一交给 ui/field 的 FieldGroup，
 * 单行 / 多行字段收在同文件的私有组件里；角色、性别与体型选择复用 components/SegmentedRail，
 * 性格标签与外貌标签都复用设定页的 TagPicker：候选分别来自 ./characterTraits 的人性设定库
 * 与 ./characterAppearanceTags 的七类外貌标签库，外貌标签是主设定、外貌描写只作补充；
 * 各标签页收在同文件的私有组件里，主组件只做编排与外貌生成状态；
 * 外貌描写取 @webview/components/AiTextareaField（输入组 + 生成按钮 + 生成态光晕，
 * 与设定页五个字段共用），本组件只把生成状态与回调传下去。
 * 关键约束：所有控件只通过补丁回传给调用方（编辑弹窗的草稿），本组件不持有角色数据副本，生成结果写回后仍需用户保存；
 * 外貌生成的 hook 必须留在主组件：切换标签页会卸载面板内容，挂在面板内会连带取消在途请求；
 * 基础信息固定两列排版，左列展示角色设定图封面、右列为字段；图片统一在生图页产出与替换，人物卡内不再出图；
 * 单行输入统一 32px 高、上下各 6px 内边距；结果与失败原因统一经 sonner 提示，页面内不渲染内联错误文本。
 */
import { toast } from 'sonner'
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { ScrollArea } from '@components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@components/ui/tabs'
import { Textarea } from '@components/ui/textarea'
import { AiTextareaField } from '@webview/components/AiTextareaField'
import { CoverFigure } from '@webview/components/CoverFigure'
import { SegmentedRail } from '@webview/components/SegmentedRail'
import { APPEARANCE_TAG_GROUPS, APPEARANCE_TAG_MAX_COUNT } from './characterAppearanceTags'
import { TRAIT_GROUPS, TRAIT_MAX_COUNT } from './characterTraits'
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
import { TagPicker } from '../setting/TagPicker'
import { toOptionValue } from '../utils'

/** 单行输入统一 32px 高、上下各 6px 内边距：与 Select 触发器等控件对齐 */
const INPUT_CLASS = 'h-8 px-3 py-1 leading-5'

/** 标签页内容左右留一点内边距：五个面板共用，切换时内容宽度不跳 */
const TAB_CONTENT_CLASS = 'px-1'

/** 字段纵向间距统一交给 FieldGroup：五个标签页与基础页右列共用，改间距只改这一处 */
const FIELD_GROUP_CLASS = 'gap-3'

/** 多行字段高度档位：短档 4 行、长档 6 行；类名集中在此，调用方不传任意类，避免 Tailwind 扫不到 */
const TEXTAREA_HEIGHT_CLASS: Readonly<Record<'short' | 'long', string>> = {
    short: 'min-h-16',
    long: 'min-h-24',
}

/** 作品层上下文：外貌生成要时代与题材，角色设定图要目录，两者都随作品切换 */
export interface CharacterWorkspace {
    aiContext: AppearanceContext
    /** 当前作品目录：角色设定图从该作品的 Images 回读 */
    dirPath: string
}

interface CharacterEditPanelProps {
    character: CharacterCard
    workspace: CharacterWorkspace
    onChange: (patch: Partial<CharacterCard>) => void
}

export function CharacterEditPanel({ character, workspace, onChange }: CharacterEditPanelProps): JSX.Element {
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
    /** 当前作品目录：角色设定图从该作品的 Images 回读 */
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
        <FieldGroup className={FIELD_GROUP_CLASS}>
            <div className="grid grid-cols-2 gap-3">
                <CharacterPortraitFigure character={character} dirPath={dirPath} />
                <FieldGroup className={FIELD_GROUP_CLASS}>
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
                </FieldGroup>
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
        </FieldGroup>
    )
}

interface CharacterAppearanceTabProps extends CharacterTabProps {
    /** 生成中：禁用按钮并换成 spinner */
    isGenerating: boolean
    /** 触发一次生成：忙碌判定与请求都在外层，切换标签页不会打断在途请求 */
    onGenerate: () => void
}

/** 外貌页：标签定骨架、描写作补充，两者一起交给 AI 生成；忙碌态由外层持有，这里只做透传 */
function CharacterAppearanceTab({
    character,
    isGenerating,
    onChange,
    onGenerate,
}: CharacterAppearanceTabProps): JSX.Element {
    return (
        <FieldGroup className={FIELD_GROUP_CLASS}>
            <Field>
                <FieldTitle>外貌标签</FieldTitle>
                <TagPicker
                    groups={APPEARANCE_TAG_GROUPS}
                    value={character.appearanceTags}
                    placeholder="点击选择外貌标签，支持自定义"
                    max={APPEARANCE_TAG_MAX_COUNT}
                    onChange={(appearanceTags) => onChange({ appearanceTags })}
                />
                <FieldDescription>
                    七类标签只取看得见的部分，挑 10 到 15 个最能区分人物；喜好要落在穿着与随身物上，不写主观评价
                </FieldDescription>
            </Field>
            <AiTextareaField
                id="character-appearance"
                label="外貌描写"
                value={character.appearance}
                placeholder="如：说话前先把袖口卷到小臂；笑起来时左眉那道旧疤会跟着绷紧"
                isGenerating={isGenerating}
                description="标签之外补句子，给正文直接引用；AI 生成以标签为准、这段描写作语气与细节补充，不会覆盖标签"
                generateLabel="AI 生成"
                onChange={(appearance) => onChange({ appearance })}
                onGenerate={onGenerate}
            />
        </FieldGroup>
    )
}

/** 动机页：性格标签与三项多行输入，推动人物做决定的内因集中在这里 */
function CharacterMotiveTab({ character, onChange }: CharacterTabProps): JSX.Element {
    return (
        <FieldGroup className={FIELD_GROUP_CLASS}>
            <Field>
                <FieldTitle>性格标签</FieldTitle>
                <TagPicker
                    groups={TRAIT_GROUPS}
                    value={character.traits}
                    placeholder="点击选择性格，支持自定义"
                    max={TRAIT_MAX_COUNT}
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
        </FieldGroup>
    )
}

/** 背景页：出身、能力与成长弧线，长文本统一用长档高度 */
function CharacterBackgroundTab({ character, onChange }: CharacterTabProps): JSX.Element {
    return (
        <FieldGroup className={FIELD_GROUP_CLASS}>
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
        </FieldGroup>
    )
}

/** 关系页：关系图谱尚未提供，先以文字记录与其他人物、组织的张力 */
function CharacterRelationTab({ character, onChange }: CharacterTabProps): JSX.Element {
    return (
        <FieldGroup className={FIELD_GROUP_CLASS}>
            <CharacterTextareaField
                id="character-relation"
                label="人物关系"
                value={character.relation}
                placeholder="与其他人物、组织的关系与张力"
                height="long"
                description="关系图谱在后续版本提供，这里先以文字记录"
                onChange={(relation) => onChange({ relation })}
            />
        </FieldGroup>
    )
}

interface CharacterPortraitFigureProps {
    character: CharacterCard
    /** 当前作品目录：角色设定图从该作品的 Images 回读 */
    dirPath: string
}

/**
 * 角色设定图：回读该人物的封面（未设封面时取最新一张）。
 * 回读由 useCharacterCover 承担，出图、换图与图库管理都在生图页完成，三态展示交给 CoverFigure。
 */
function CharacterPortraitFigure({ character, dirPath }: CharacterPortraitFigureProps): JSX.Element {
    const { portrait, isLoading } = useCharacterCover(dirPath, character.id, character.coverPortraitId)
    return (
        <CoverFigure
            src={portrait?.url ?? null}
            isLoading={isLoading}
            alt={`${character.name} 的角色设定图`}
            emptyTitle="还没有角色设定图"
            emptyDescription="在生图页为该人物生成后，这里显示封面图"
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
