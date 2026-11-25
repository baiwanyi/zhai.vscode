/**
 * 大纲、人物与资料条目的选项常量：把钩子、状态、角色分类、性别、体型与条目分类的展示文案、
 * 图标与徽标变体集中在一处。
 * 复用约定：徽标变体只取 badge 组件的语义变体，不写原始色值；页面与卡片均从此表读取，避免各写一套映射；
 * 作品设定字段的选项（篇幅、时间、地点、结局、视角、结构、风格、规避内容与题材标签）统一在
 * setting/settingOptions.ts 维护，本文件只保留跨模块共用的选项结构类型。
 * 关键约束：状态与钩子的 key 必须与 types.ts 的联合类型完全一致，新增取值须同时补文案与变体；
 * 张力与步骤的档位顺序参与排序与进度计算，不得随意调整；资料条目的顺序即设定页分段顺序。
 */
import { MapPin, Package, Swords } from 'lucide-react'
import type { SettingFieldKey } from '@shared/types/press'
import type {
    ActKind,
    CharacterBodyType,
    CharacterGender,
    CharacterRole,
    ClueKind,
    ClueStatus,
    HookKind,
    LoreKind,
    OutlineGranularity,
    OutlineModuleKey,
    OutlineScene,
    PacingKind,
    PlanStatus,
} from './types'
import type { LucideIcon } from 'lucide-react'

/** 徽标语义变体：与 @components/ui/badge 的 variant 保持一致 */
export type BadgeTone = 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost'

export interface OptionMeta<T extends string> {
    value: T
    label: string
}

/** 数值型选项：篇幅这类以数字为取值的档位 */
export interface NumberOptionMeta {
    value: number
    label: string
}

/** 带悬停说明的选项：叙事视角、语言风格这类需要解释取舍的枚举 */
export interface OptionHintMeta extends OptionMeta<string> {
    /** 悬停提示：说明该取值的写法与适用场景 */
    hint: string
}

/** 选项来源：顺序表 + 同 key 的文案表，两者共同决定选项内容与先后 */
type OptionSource<T extends string> = Readonly<Record<T, { label: string }>>

/** 由顺序与文案派生选项：顺序与文案只保留一处来源，避免两张表各写一遍后漂移 */
function toOptions<T extends string>(order: readonly T[], meta: OptionSource<T>): readonly OptionMeta<T>[] {
    return order.map((value) => ({ value, label: meta[value].label }))
}

/**
 * 章纲状态元数据：文案、徽标变体、状态点底色类名。
 * 关键约束：四态是「大纲工作文件」的状态——已写=正文已兑现，待改=正文偏离大纲需复核，
 * 废弃=保留记录但不计入完成度，待写=尚未落笔。
 */
export const PLAN_STATUS_META: Readonly<Record<PlanStatus, { label: string; tone: BadgeTone; dot: string }>> = {
    planned: { label: '待写', tone: 'outline', dot: 'bg-muted-foreground/60' },
    written: { label: '已写', tone: 'default', dot: 'bg-chart-2' },
    revise: { label: '待改', tone: 'secondary', dot: 'bg-chart-4' },
    discarded: { label: '废弃', tone: 'destructive', dot: 'bg-destructive' },
}

/** 颗粒度文案与顺序：粗纲管方向、中纲管事件链、细纲管当天落笔 */
export const GRANULARITY_META: Readonly<Record<OutlineGranularity, { label: string; description: string }>> = {
    coarse: { label: '粗纲', description: '故事核、人物弧、三幕大转折' },
    medium: { label: '中纲', description: '事件链与章纲卡' },
    fine: { label: '细纲', description: '场景、节拍与当天落笔细节' },
}

/** 颗粒度顺序：由粗到细，视图切换与档位选择共用 */
export const GRANULARITY_ORDER: readonly OutlineGranularity[] = ['coarse', 'medium', 'fine']

/** 颗粒度选项：卷/章节点标记与顶栏视图切换共用 */
export const GRANULARITY_OPTIONS = toOptions(GRANULARITY_ORDER, GRANULARITY_META)

/** 节奏类型文案：每章一档，避免连续同类章节 */
export const PACING_META: Readonly<Record<PacingKind, { label: string; className: string }>> = {
    tension: { label: '紧张', className: 'bg-chart-5/15 text-chart-5' },
    setup: { label: '铺垫', className: 'bg-chart-4/15 text-chart-4' },
    payoff: { label: '爽点', className: 'bg-chart-2/15 text-chart-2' },
    sorrow: { label: '虐点', className: 'bg-chart-1/15 text-chart-1' },
    breath: { label: '喘息', className: 'bg-muted text-muted-foreground' },
}

/** 节奏选项顺序：与写作时的情绪分布一一对应 */
export const PACING_KIND_ORDER: readonly PacingKind[] = ['tension', 'setup', 'payoff', 'sorrow', 'breath']

/** 节奏选项：节奏面板的下拉与徽标共用 */
export const PACING_KIND_OPTIONS = toOptions(PACING_KIND_ORDER, PACING_META)

/** 全书转折类型文案：未指定 + 五种全书级大转折 */
export const ACT_KIND_META: Readonly<Record<ActKind, { label: string }>> = {
    none: { label: '未指定' },
    inciting: { label: '激励事件' },
    midpoint: { label: '中点' },
    'low-point': { label: '低谷' },
    climax: { label: '高潮' },
    resolution: { label: '结局' },
}

/** 转折类型顺序：下拉与解析共用，未指定排首位 */
export const ACT_KIND_ORDER: readonly ActKind[] = [
    'none',
    'inciting',
    'midpoint',
    'low-point',
    'climax',
    'resolution',
]

/** 转折类型选项：结构纲下拉使用 */
export const ACT_KIND_OPTIONS = toOptions(ACT_KIND_ORDER, ACT_KIND_META)

/** 伏笔状态文案：未回收 / 已回收 / 已废弃 */
export const CLUE_STATUS_META: Readonly<Record<ClueStatus, { label: string; tone: BadgeTone }>> = {
    planted: { label: '未回收', tone: 'outline' },
    'paid-off': { label: '已回收', tone: 'default' },
    dropped: { label: '已废弃', tone: 'secondary' },
}

/** 伏笔状态顺序：线索表筛选与统计共用 */
export const CLUE_STATUS_ORDER: readonly ClueStatus[] = ['planted', 'paid-off', 'dropped']

/** 伏笔状态选项 */
export const CLUE_STATUS_OPTIONS = toOptions(CLUE_STATUS_ORDER, CLUE_STATUS_META)

/** 伏笔类型文案：未指定兼容旧数据，其余对应人物 / 情节 / 道具 / 设定 */
export const CLUE_KIND_META: Readonly<Record<ClueKind, { label: string; tone: BadgeTone }>> = {
    none: { label: '未指定', tone: 'ghost' },
    character: { label: '人物', tone: 'secondary' },
    plot: { label: '情节', tone: 'default' },
    item: { label: '道具', tone: 'outline' },
    setting: { label: '设定', tone: 'secondary' },
}

/** 伏笔类型顺序：选项与条目徽标共用 */
export const CLUE_KIND_ORDER: readonly ClueKind[] = ['none', 'character', 'plot', 'item', 'setting']

/** 伏笔类型选项 */
export const CLUE_KIND_OPTIONS = toOptions(CLUE_KIND_ORDER, CLUE_KIND_META)

/**
 * 功能模块元数据：导航栏顺序为「卷纲 → 章纲 → 结构 → 伏笔」，日常写作从卷纲进入。
 * 关键约束：value 必须与 OutlineModuleKey 完全一致，新增模块须同时补导航文案与页面分支；
 * 设定归作品设定、节奏类型进章纲、时间线不再作模块，故这里只有四个页面。
 */
export const OUTLINE_MODULE_META: readonly OptionMeta<OutlineModuleKey>[] = [
    { value: 'volume', label: '卷纲' },
    { value: 'chapter', label: '章纲' },
    { value: 'structure', label: '结构' },
    { value: 'clue', label: '伏笔' },
]

/** 章末钩子：生成与编辑时用于标注本卷节奏 */
export const HOOK_OPTIONS: readonly OptionMeta<HookKind>[] = [
    { value: 'suspense', label: '悬念' },
    { value: 'twist', label: '反转' },
    { value: 'emotion', label: '情绪高点' },
    { value: 'none', label: '无' },
]

/** 张力档位文案：1-5 档，供滑块旁的文字提示 */
export const TENSION_LABELS: readonly string[] = ['平缓', '铺垫', '推进', '紧张', '高潮']

/**
 * 角色分类：列表分组与人物卡展示共用。
 * 徽标配色取 VSCode 图表语义色（chart-1~5），每类一色，浅底 + 同色文字；龙套取中性灰，不写原始色值。
 */
export const CHARACTER_ROLE_META: Readonly<Record<CharacterRole, { label: string; className: string }>> = {
    protagonist: { label: '主角', className: 'bg-chart-1/15 text-chart-1' },
    supporting: { label: '配角', className: 'bg-chart-4/15 text-chart-4' },
    antagonist: { label: '反派', className: 'bg-chart-5/15 text-chart-5' },
    neutral: { label: '中立', className: 'bg-chart-2/15 text-chart-2' },
    extra: { label: '龙套', className: 'bg-muted text-muted-foreground' },
}

/** 角色分类顺序：列表排序以主角在前、龙套在后，与作者翻卡的顺序一致 */
export const CHARACTER_ROLE_ORDER: readonly CharacterRole[] = [
    'protagonist',
    'supporting',
    'antagonist',
    'neutral',
    'extra',
]

/** 角色选项：由顺序与文案表派生，人物卡的分段选择器直接消费 */
export const CHARACTER_ROLE_OPTIONS = toOptions(CHARACTER_ROLE_ORDER, CHARACTER_ROLE_META)

/** 角色筛选项：全部与五种分类，供人物页顶部切换，顺序与 CHARACTER_ROLE_ORDER 一致 */
export const CHARACTER_ROLE_FILTERS: readonly OptionMeta<CharacterRole | 'all'>[] = [
    { value: 'all', label: '全部' },
    { value: 'protagonist', label: '主角' },
    { value: 'supporting', label: '配角' },
    { value: 'antagonist', label: '反派' },
    { value: 'neutral', label: '中立' },
    { value: 'extra', label: '龙套' },
]

/** 性别文案：新增弹窗与人物卡共用，仅男女两项；列表改用图标展示，生成提示词取同一份中文标签 */
export const CHARACTER_GENDER_META: Readonly<Record<CharacterGender, { label: string }>> = {
    male: { label: '男' },
    female: { label: '女' },
}

/** 性别选项顺序：男、女，必选其一 */
export const CHARACTER_GENDER_ORDER: readonly CharacterGender[] = ['male', 'female']

/** 性别选项：由顺序与文案表派生，人物卡的分段选择器直接消费 */
export const CHARACTER_GENDER_OPTIONS = toOptions(CHARACTER_GENDER_ORDER, CHARACTER_GENDER_META)

/**
 * 体型文案与顺序：与角色分类一样以预设选项填写，避免「微胖 / 偏瘦」这类自由表述无法比较。
 * 十档同时覆盖身高（娇小 → 修长）与胖瘦（清瘦 → 肥胖），写作时按档位决定动作与服装描写。
 */
export const CHARACTER_BODY_TYPE_META: Readonly<Record<CharacterBodyType, { label: string }>> = {
    petite: { label: '娇小' },
    lean: { label: '清瘦' },
    slim: { label: '纤细' },
    tall: { label: '修长' },
    average: { label: '匀称' },
    athletic: { label: '健壮' },
    burly: { label: '魁梧' },
    round: { label: '圆润' },
    plump: { label: '丰腴' },
    heavy: { label: '肥胖' },
}

/** 体型选项顺序：按「娇小 → 丰腴」由轻到重的阅读顺序排列 */
export const CHARACTER_BODY_TYPE_ORDER: readonly CharacterBodyType[] = [
    'petite',
    'lean',
    'slim',
    'tall',
    'average',
    'athletic',
    'burly',
    'round',
    'plump',
    'heavy',
]

/** 体型选项：由顺序与文案表派生，人物卡的分段选择器直接消费 */
export const CHARACTER_BODY_TYPE_OPTIONS = toOptions(CHARACTER_BODY_TYPE_ORDER, CHARACTER_BODY_TYPE_META)

/**
 * 资料条目分类元数据：设定页分段、列表空态与卡片徽标共用。
 * 关键约束：label 同时是空态文案与保存提示的拼接来源，改文案即改所有提示口径；
 * 图标只用于分段栏与空态，不得在卡片内重复堆叠。
 */
export const LORE_KIND_META: Readonly<
    Record<LoreKind, { label: string; icon: LucideIcon; emptyTitle: string; emptyDescription: string }>
> = {
    faction: {
        label: '势力',
        icon: Swords,
        emptyTitle: '还没有势力',
        emptyDescription: '先立一个对手组织，冲突才有落点',
    },
    place: {
        label: '地点',
        icon: MapPin,
        emptyTitle: '还没有地点',
        emptyDescription: '写下主要场景，章纲里的地点才有依据',
    },
    item: {
        label: '物品',
        icon: Package,
        emptyTitle: '还没有物品',
        emptyDescription: '记下关键道具，伏笔与回收才不至于断线',
    },
}

/** 条目分类顺序：设定页分段顺序与列表筛选顺序共用 */
export const LORE_KIND_ORDER: readonly LoreKind[] = ['faction', 'place', 'item']

/** 金手指类型候选分组：`label` 是下拉里的分组标题 */
export interface GoldenFingerTypeGroup {
    label: string
    options: readonly string[]
}

/**
 * 金手指类型候选：按网文常见套路归类，设定页以分组的单选下拉呈现。
 * 改动这里即同时影响选择器与「当前值是否在候选内」的判断，不另写第二份清单。
 */
export const GOLDEN_FINGER_TYPE_GROUPS: readonly GoldenFingerTypeGroup[] = [
    {
        label: '系统流',
        options: ['系统', '签到系统', '任务系统', '商城系统', '抽卡系统', '模拟器', '聊天群', '直播系统'],
    },
    { label: '重生与穿越', options: ['重生', '穿越', '魂穿', '回到过去', '未来记忆'] },
    { label: '空间与储物', options: ['随身空间', '洞天福地', '随身庄园', '储物空间', '灵田空间'] },
    { label: '血脉与异能', options: ['异能', '血脉觉醒', '天赋异禀', '传承记忆', '神格碎片'] },
    { label: '器灵与外挂', options: ['随身老爷爷', '器灵', '功法宝库', '无限复制', '鉴定之眼'] },
    { label: '信息与预见', options: ['预知未来', '读心术', '未来日记', '推演模拟', '时间回溯'] },
    { label: '气运与召唤', options: ['气运之子', '欧皇体质', '召唤角色', '契约兽', '绝对防御'] },
    { label: '无金手指', options: ['无'] },
]

/** 写作流程步骤：设定与人物两页顶部共用 */
export const FLOW_STEPS: readonly { id: number; label: string }[] = [
    { id: 1, label: '新建作品' },
    { id: 2, label: '作品设定' },
    { id: 3, label: '人物设定' },
    { id: 4, label: '大纲' },
    { id: 5, label: '章节写作' },
]

/** 新建卷、新建章时的默认单章目标字数，与网文常规更新量一致 */
export const DEFAULT_CHAPTER_WORD_GOAL = 2500

/** 提取范围模式：全篇整树覆盖、连续区间、逐章勾选 */
export type ExtractScope = 'all' | 'range' | 'chapters'

/** 提取范围选项：说明文案直接写清覆盖范围，避免用户误触全篇 */
export const EXTRACT_SCOPE_OPTIONS: readonly { value: ExtractScope; label: string; description: string }[] = [
    { value: 'all', label: '全篇', description: '按素材重建整棵大纲树，会覆盖当前草稿' },
    { value: 'range', label: '章节范围', description: '只刷新作品对应区间内的章纲，卷章结构不变' },
    { value: 'chapters', label: '指定章节', description: '勾选作品章节，刷新大纲里同卷同位置的章纲' },
]

/** 模式取值收窄：单选组回传的是 string，不能直接当联合类型用 */
export function isExtractScope(value: string): value is ExtractScope {
    return value === 'all' || value === 'range' || value === 'chapters'
}

/**
 * 设定页写入文本时的字数上限：输入框 maxLength 与 AI 生成结果的截断共用同一份口径。
 * 取值比提示词里的篇幅要求宽一档，留给作者自己发挥；作品名只用于截断生成结果，输入框不设限。
 */
export const SETTING_FIELD_MAX_LENGTH: Readonly<Record<SettingFieldKey, number>> = {
    title: 40,
    summary: 240,
    logline: 120,
    opening: 240,
    conflict: 160,
    theme: 120,
    arc: 160,
    worldview: 600,
    geography: 300,
    era: 120,
    factions: 300,
    powerSystem: 300,
    concepts: 400,
    taboo: 200,
    goldenFingerAbility: 300,
    goldenFingerCost: 200,
    goldenFingerLimit: 200,
    goldenFingerUpgrade: 300,
}

/** 场景纲可展示的文本字段：不含序号等数值字段，便于统一按字符串处理 */
type SceneDetailKey = keyof Pick<OutlineScene, 'desire' | 'obstacle' | 'choice' | 'result' | 'emotion'>

/** 场景纲五项的顺序与取值键：界面明细、文档序列化与解析读取共用同一口径 */
export const SCENE_FIELD_META: ReadonlyArray<readonly [string, SceneDetailKey]> = [
    ['欲望', 'desire'],
    ['阻碍', 'obstacle'],
    ['选择', 'choice'],
    ['结果', 'result'],
    ['情绪变化', 'emotion'],
]
