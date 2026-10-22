/**
 * 大纲模块选项常量：把题材、钩子、状态、角色分类与性别等枚举的展示文案与徽标变体集中在一处。
 * 复用约定：徽标变体只取 badge 组件的语义变体，不写原始色值；页面与卡片均从此表读取，避免各写一套映射。
 * 关键约束：状态与钩子的 key 必须与 types.ts 的联合类型完全一致，新增取值须同时补文案与变体；
 * 张力与步骤的档位顺序参与排序与进度计算，不得随意调整。
 */
import type { PortraitStyle } from '@shared/types/press'
import type { Audience, CharacterGender, CharacterRole, EndingKind, HookKind, PlanStatus, ProjectSetting } from './types'

/** 徽标语义变体：与 @components/ui/badge 的 variant 保持一致 */
export type BadgeTone = 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost'

interface OptionMeta<T extends string> {
    value: T
    label: string
}

/** 章纲状态元数据：文案、徽标变体、状态点底色类名 */
export const PLAN_STATUS_META: Readonly<Record<PlanStatus, { label: string; tone: BadgeTone; dot: string }>> = {
    planned: { label: '待写', tone: 'outline', dot: 'bg-muted-foreground/60' },
    drafting: { label: '在写', tone: 'secondary', dot: 'bg-chart-3' },
    done: { label: '已完成', tone: 'default', dot: 'bg-chart-2' },
    stale: { label: '需复核', tone: 'destructive', dot: 'bg-destructive' },
}

/** 状态筛选：全部与四种状态，供大纲树顶部切换 */
export const STATUS_FILTERS: readonly (OptionMeta<PlanStatus | 'all'>)[] = [
    { value: 'all', label: '全部' },
    { value: 'planned', label: '待写' },
    { value: 'drafting', label: '在写' },
    { value: 'done', label: '已完成' },
    { value: 'stale', label: '需复核' },
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

/** 角色分类：列表分组与人物卡展示共用 */
export const CHARACTER_ROLE_META: Readonly<Record<CharacterRole, { label: string; tone: BadgeTone }>> = {
    protagonist: { label: '主角', tone: 'default' },
    supporting: { label: '配角', tone: 'secondary' },
    antagonist: { label: '反派', tone: 'destructive' },
    neutral: { label: '中立', tone: 'outline' },
    extra: { label: '龙套', tone: 'ghost' },
}

/** 角色分类顺序：列表排序以主角在前、龙套在后，与作者翻卡的顺序一致 */
export const CHARACTER_ROLE_ORDER: readonly CharacterRole[] = [
    'protagonist',
    'supporting',
    'antagonist',
    'neutral',
    'extra',
]

/** 角色筛选项：全部与五种分类，供人物页顶部切换，顺序与 CHARACTER_ROLE_ORDER 一致 */
export const CHARACTER_ROLE_FILTERS: readonly (OptionMeta<CharacterRole | 'all'>)[] = [
    { value: 'all', label: '全部' },
    { value: 'protagonist', label: '主角' },
    { value: 'supporting', label: '配角' },
    { value: 'antagonist', label: '反派' },
    { value: 'neutral', label: '中立' },
    { value: 'extra', label: '龙套' },
]

/** 性别标签：新增弹窗、人物卡与列表徽标共用，未设定不参与生成提示词 */
export const CHARACTER_GENDER_META: Readonly<Record<CharacterGender, { label: string; tone: BadgeTone }>> = {
    male: { label: '男', tone: 'outline' },
    female: { label: '女', tone: 'outline' },
    unspecified: { label: '未设定', tone: 'ghost' },
}

/** 性别选项顺序：男、女、未设定 */
export const CHARACTER_GENDER_ORDER: readonly CharacterGender[] = ['male', 'female', 'unspecified']

/** 角色卡画风选项：值必须落在 shared/types/press 的 PORTRAIT_STYLES 内，写风描述由宿主按同一 key 映射 */
export const PORTRAIT_STYLE_OPTIONS: readonly (OptionMeta<PortraitStyle>)[] = [
    { value: 'realistic', label: '写实' },
    { value: 'guofeng', label: '国风' },
    { value: 'anime', label: '二次元' },
    { value: 'painterly', label: '厚涂' },
    { value: 'cinematic', label: '电影感' },
    { value: 'lineart', label: '线稿' },
]

/** 题材预设：点击加入、再点移除，也可输入自定义题材 */
export const GENRE_OPTIONS: readonly string[] = [
    '都市',
    '悬疑',
    '玄幻',
    '仙侠',
    '科幻',
    '历史',
    '言情',
    '无限流',
    '游戏',
    '现实',
]

/** 目标读者：与 README.md 的 audience 字段一致 */
export const AUDIENCE_OPTIONS: readonly OptionMeta<Audience>[] = [
    { value: '男频', label: '男频' },
    { value: '女频', label: '女频' },
]

/** 结局倾向 */
export const ENDING_OPTIONS: readonly OptionMeta<EndingKind>[] = [
    { value: 'HE', label: 'HE 圆满' },
    { value: 'BE', label: 'BE 悲剧' },
    { value: '开放', label: '开放结局' },
]

/** 金手指类型：可自由输入，预设用于加速填写 */
export const GOLDEN_FINGER_TYPES: readonly string[] = ['系统', '重生', '异能', '随身空间', '无', '自定义']

/** 叙事人称 */
export const PERSPECTIVE_OPTIONS: readonly string[] = ['第三人称', '第一人称', '双线交替']

/** 节奏偏好：向导中决定张力默认分布 */
export const PACING_OPTIONS = [
    { value: 'fast', label: '快节奏爽文' },
    { value: 'steady', label: '稳步推进' },
    { value: 'slow', label: '慢热群像' },
] as const

/** 结构模板：向导中决定卷纲的阶段划分方式 */
export const STRUCTURE_OPTIONS: readonly string[] = ['三幕式', '起承转合', '黄金三章', '不使用模板']

/** 常见禁写项：点击加入禁写清单 */
export const BANNED_OPTIONS: readonly string[] = ['后宫', '虐主', '降智', '工具人配角', '长篇铺垫']

/** 写作流程步骤：设定与人物两页顶部共用 */
export const FLOW_STEPS: readonly { id: number; label: string }[] = [
    { id: 1, label: '新建作品' },
    { id: 2, label: '作品设定' },
    { id: 3, label: '人物设定' },
    { id: 4, label: '大纲' },
    { id: 5, label: '章节写作' },
]

/** 最小设定集字段：缺失时不阻断，只在向导第一步标黄提示 */
export const REQUIRED_SETTING_KEYS: readonly (keyof ProjectSetting)[] = [
    'genres',
    'logline',
    'audience',
    'goldenFingerAbility',
    'conflict',
]
