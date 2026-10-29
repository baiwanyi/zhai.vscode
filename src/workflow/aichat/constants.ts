/**
 * AI 对话底部区域常量：写作命令模板，供菜单、输入区徽章、发送拼装与消息回放共用。
 * 复用约定：命令标题与指令模板集中在此，界面只展示 title，instruction 仅在发送时拼装与回放时剥离。
 * 关键约束：命令只能约束模型的写作口径，落盘与否由指令模板自身与宿主工具守卫决定；
 * instruction 变更会使旧消息失去徽章回显。
 */

/** 写作命令 id */
export type AiCommandId = 'rewrite' | 'polish' | 'typo' | 'deai'

/** 写作命令定义 */
export interface AiCommand {
    id: AiCommandId
    title: string
    /** 发送时自动拼入请求正文的指令模板，不进入输入框展示 */
    instruction: string
}

/** 写作命令索引：菜单、输入区徽章、发送拼装与消息回放共用同一份定义 */
export const AI_COMMAND_MAP: Record<AiCommandId, AiCommand> = {
    rewrite: {
        id: 'rewrite',
        title: '改写',
        instruction: '请改写下面这段内容，保持原意与信息量，调整行文结构与表达方式，使叙述更连贯。只输出改写后的正文。',
    },
    polish: {
        id: 'polish',
        title: '润色',
        instruction: '请润色下面这段内容，保留原意与事实，优化用词、句式与节奏，去除重复与冗词。只输出润色后的正文。',
    },
    typo: {
        id: 'typo',
        title: '校对',
        instruction: '请检查下面这段内容的错别字、标点与明显病句，按「原文 → 建议」逐条列出，不要改写其他内容。',
    },
    deai: {
        id: 'deai',
        title: '去 AI 味',
        instruction:
            '请改写下面这段内容，去掉 AI 生成痕迹：避免套路化排比与万能词，缩短长句，用具体细节替代空泛表述。保持原意，只输出改写后的正文。',
    },
}

/** 写作命令清单（顺序即菜单展示顺序） */
export const AI_COMMANDS: readonly AiCommand[] = [
    AI_COMMAND_MAP.rewrite,
    AI_COMMAND_MAP.polish,
    AI_COMMAND_MAP.typo,
    AI_COMMAND_MAP.deai,
]

/** 指令前缀匹配表：按模板长度降序，保证消息回放时最长的指令优先命中 */
export const AI_COMMAND_PREFIXES: readonly AiCommand[] = [...AI_COMMANDS].sort(
    (left, right) => right.instruction.length - left.instruction.length,
)

/** 命令 id 收窄：只接受命令表中的 id，用于草稿恢复等外部来源数据 */
export function isAiCommandId(value: unknown): value is AiCommandId {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(AI_COMMAND_MAP, value)
}


