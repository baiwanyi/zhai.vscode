/**
 * 校对页常量：四类检查的标题、徽标、配色与文案集中在此，卡片渲染、状态统计与空态文案共用一份。
 * 复用约定：类别 id 取自共享契约，界面只认这里的元数据，不自行拼状态文案与配色；
 * available 标记该类是否已有检查能力，未接入的类别只展示说明，不给出「未发现问题」的误导性结论。
 * 关键约束：免责提示与状态文案属于产品口径，修改前须与校对策略同步，避免界面承诺超出实际能力。
 */
import type { ProofreadCategory, ProofreadIssue } from '@shared/types/proofread'

/** 单类检查的界面元数据 */
export interface ProofreadCategoryMeta {
    id: ProofreadCategory
    /** 单字徽标：对齐参考界面的「错 / 病 / 险 / 纠」 */
    badge: string
    title: string
    /** 徽标配色类：浅底深字，明暗主题共用 */
    toneClass: string
    description: string
    /** 该类未发现问题时的文案 */
    emptyText: string
    /** 是否已接入检查能力 */
    available: boolean
}

/** 四类检查元数据 */
export const PROOFREAD_CATEGORY_META: Readonly<Record<ProofreadCategory, ProofreadCategoryMeta>> = {
    typo: {
        id: 'typo',
        badge: '错',
        title: '错别字',
        toneClass: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
        description: '内置词表与标点规则',
        emptyText: '未发现错别字与标点问题',
        available: true,
    },
    sentence: {
        id: 'sentence',
        badge: '病',
        title: '病句',
        toneClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
        description: 'AI 语义检查，仅提示不改写',
        emptyText: '未发现明显病句',
        available: true,
    },
    risk: {
        id: 'risk',
        badge: '险',
        title: '风险段落',
        toneClass: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
        description: 'AI 段落级风险提示，请人工确认',
        emptyText: '未发现风险段落',
        available: true,
    },
    custom: {
        id: 'custom',
        badge: '纠',
        title: '自定义纠错',
        toneClass: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
        description: '按个人词库匹配',
        emptyText: '词库为空或未命中',
        available: true,
    },
}

/** 检查卡展示顺序 */
export const PROOFREAD_CATEGORY_LIST: readonly ProofreadCategoryMeta[] = [
    PROOFREAD_CATEGORY_META.typo,
    PROOFREAD_CATEGORY_META.sentence,
    PROOFREAD_CATEGORY_META.risk,
    PROOFREAD_CATEGORY_META.custom,
]

/** 页面标题 */
export const PAGE_TITLE = '校对'

/** 页面描述：目标就绪与未就绪两套文案 */
export const PAGE_DESCRIPTION_READY = '检查错别字、标点与自定义词库命中，可逐条定位并一键写回'
export const PAGE_DESCRIPTION_EMPTY = '在编辑器中打开要校对的章节，回到本页即可开始'

/** 主按钮文案：已有结果时改为「重新校对」 */
export const RUN_LABEL = '开始校对'
export const RERUN_LABEL = '重新校对'

/** 底部免责提示：与参考界面口径一致 */
export const DISCLAIMER = '智能识别，可能出现误差，仅供参考'

/** 空态标题与说明 */
export const EMPTY_TITLE = '尚未读取到校对目标'
export const EMPTY_DESCRIPTION = '校对以当前编辑器中的文档为准，请先打开章节或笔记文档'

/** 未接入类别的状态文案 */
export const UNAVAILABLE_LABEL = '未接入'

/** 属于 AI 检查的类别：状态文案与本地规则分开表达 */
export const PROOFREAD_AI_CATEGORIES: readonly ProofreadCategory[] = ['sentence', 'risk']

/** AI 检查开关文案 */
export const AI_TOGGLE_LABEL = 'AI 检查'

/** AI 类别未执行时的提示：开关开着也只跑本地规则，AI 检查要等用户点「开始校对」 */
export const AI_IDLE_HINT = '点击「开始校对」后才会执行 AI 语义检查'
export const AI_OFF_HINT = '已关闭 AI 检查，仅展示本地规则结果'

/** AI 段落级结果的补充提示 */
export const AI_DISCLAIMER = 'AI 结果由模型判断，请逐条人工确认后再修改'

/** AI 特征检测卡：标题与说明 */
export const DETECT_TITLE = 'AI 特征检测'
export const DETECT_DESCRIPTION = '由腾讯云朱雀模型判断人工创作与 AI 生成的占比'
export const DETECT_EMPTY_HINT = '检测后展示三类内容占比，以及最值得复核的可疑段落'

/** AI 特征检测卡：按钮与状态文案 */
export const DETECT_RUN_LABEL = '开始检测'
export const DETECT_RERUN_LABEL = '重新检测'
export const DETECT_RUNNING_LABEL = '正在检测…'
export const DETECT_CONFIGURE_LABEL = '配置密钥'

/** 三类占比的展示名：与朱雀 labels_ratio 的 0/1/2 对应 */
export const DETECT_LABEL_NAMES: Readonly<Record<0 | 1 | 2, string>> = {
    0: '人工特征',
    1: 'AI 特征',
    2: '疑似 AI',
}

/** 人工占比低于该阈值时提示「人工创作特征较弱」 */
export const DETECT_LOW_HUMAN_THRESHOLD = 0.35

/** 检测结果免责语：沿用朱雀官方口径 */
export const DETECT_DISCLAIMER = '本结果仅为辅助判断，不应作为任何审核或处罚的决定性依据'

/** 上传同意弹窗文案 */
export const DETECT_CONSENT_TITLE = '确认将正文上传至第三方'
export const DETECT_CONSENT_DESCRIPTION =
    'AI 特征检测需要把当前正文发送至腾讯云 EdgeOne 朱雀检测服务。正文不会保存在本插件，但会经过第三方服务处理，请确认后再继续。'
export const DETECT_CONSENT_CONFIRM = '同意并继续'
export const DETECT_CONSENT_CANCEL = '取消'

/** 单类问题的统计：仅统计未被忽略的条目 */
export function countIssues(issues: readonly ProofreadIssue[], category: ProofreadCategory): number {
    return issues.filter((issue) => issue.category === category).length
}
