/**
 * AI 对话底部区域常量：写作命令模板与参考资料源清单，供菜单组件与发送逻辑共用。
 * 复用约定：命令标题、指令模板与写回策略集中在此，避免菜单文案与业务判断两处分叉。
 * 关键约束：applyPolicy 为 report 的命令只输出检查结果，永不提供写回编辑栏入口。
 */

/** 写作命令 id */
export type AiCommandId = 'rewrite' | 'polish' | 'typo' | 'deai'

/** 写回策略：replace 允许写回编辑栏，report 仅展示结果 */
export type AiApplyPolicy = 'replace' | 'report'

/** 写作命令定义 */
export interface AiCommand {
    id: AiCommandId
    title: string
    /** 点击命令后写入输入框的指令模板 */
    instruction: string
    applyPolicy: AiApplyPolicy
}

/** 写作命令清单（顺序即菜单展示顺序） */
export const AI_COMMANDS: readonly AiCommand[] = [
    {
        id: 'rewrite',
        title: '改写',
        instruction:
            '请改写下面这段内容，保持原意与信息量，调整行文结构与表达方式，使叙述更连贯。只输出改写后的正文。',
        applyPolicy: 'replace',
    },
    {
        id: 'polish',
        title: '润色',
        instruction: '请润色下面这段内容，保留原意与事实，优化用词、句式与节奏，去除重复与冗词。只输出润色后的正文。',
        applyPolicy: 'replace',
    },
    {
        id: 'typo',
        title: '找错别字',
        instruction: '请检查下面这段内容的错别字、标点与明显病句，按「原文 → 建议」逐条列出，不要改写其他内容。',
        applyPolicy: 'report',
    },
    {
        id: 'deai',
        title: '去 AI 味',
        instruction:
            '请改写下面这段内容，去掉 AI 生成痕迹：避免套路化排比与万能词，缩短长句，用具体细节替代空泛表述。保持原意，只输出改写后的正文。',
        applyPolicy: 'replace',
    },
]

/** 参考资料类别 */
export type AiReferenceKind = 'poetry' | 'quote' | 'classic' | 'history'

/** 参考资料源定义：enabled 为 false 时仅作占位，不发起任何请求 */
export interface AiReferenceSource {
    kind: AiReferenceKind
    title: string
    description: string
    enabled: boolean
}

/** 参考资料源清单（当前全部为占位） */
export const AI_REFERENCE_SOURCES: readonly AiReferenceSource[] = [
    { kind: 'poetry', title: '古诗词', description: '按意象或主题检索诗句', enabled: false },
    { kind: 'quote', title: '名言名句', description: '引用名人原话与出处', enabled: false },
    { kind: 'classic', title: '经典文本', description: '古籍与经典段落原文', enabled: false },
    { kind: 'history', title: '历史资料', description: '时间、人物与制度背景', enabled: false },
]
