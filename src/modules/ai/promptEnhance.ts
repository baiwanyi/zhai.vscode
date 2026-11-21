/**
 * 提示词增强服务：对话、出图与微博文案共用同一套模型调用、超时、空结果校验与用量记账。
 * 复用约定：文本通道与用量记账由调用方注入（两处传入同一 provider 与 UsageRecorder 实例），
 * 改写口径集中在 ENHANCE_SYSTEM_PROMPTS（写作 / 图像 / 压缩 / 微博四种），token 上限、输入输出长度与
 * 归属模块按场景给出；对话侧用 createChatEnhanceRequest，微博侧用 createWeiboEnhanceRequest。
 * 关键约束：模型只做改写，输出直接回填输入框，不建会话、不落盘、不占图片配额；
 * 超时、空结果与超长输出都在本层收口，失败一律抛出，由前端保留原文并提示；
 * 记账是旁路，写库异常不影响改写结果；口径提示词必须要求「保持原意、只输出一段」，否则会污染输入框。
 */
import type { AiUsageModule } from '@shared/types/aiUsage'
import { getSelectedCodebuddyModel } from './providers/codebuddyModels'
import type { AiProvider } from './provider'
import type { UsageRecorder } from './usageRecorder'

/** 增强超时：输入区操作需要及时反馈，超时即中断并抛出，由前端保留原文 */
export const ENHANCE_TIMEOUT_MS = 30_000
/** 对话增强的输入 / 输出字符上限：输入框正文远小于此值，超出截断避免异常载荷占用上下文 */
const CHAT_ENHANCE_MAX_LENGTH = 8_000
/** 对话增强的输出 token 上限：中文约 1.6 字符/token，足够覆盖输入区常见长度 */
const CHAT_ENHANCE_MAX_TOKENS = 1_600

/** 改写场景：写作指令、图像画面描述、笔记合集压缩与微博文案 */
export type EnhancePromptScene = 'write' | 'image' | 'compress' | 'weibo'

/** 改写口径：各场景只改口径文本，模型调用、超时与记账完全一致 */
export const ENHANCE_SYSTEM_PROMPTS: Record<EnhancePromptScene, string> = {
    write: '你是写作指令编辑。把用户输入改写成可直接交给写作助手的指令：补足文体与视角、目标读者、篇幅或字数、结构与节奏、语言风格与禁忌；保持原意与中文表达，不要添加解释、标题或列表，只输出一段连续的指令。',
    image: '你是图像提示词编辑。把用户输入改写成更具体的画面描述：补足人物姿态、服装材质、场景层次、光线方向与镜头距离；保持原意与语言，不要添加解释、标题或列表，只输出一段连续的描述。',
    compress:
        '你是资料压缩助手。把给定的笔记合集压缩成结构化要点：保留人物、设定、事件与结论等事实，去掉重复表述与举例；按笔记标题分组，用简洁的条目输出，不得编造未出现的信息，不要添加解释或前言。',
    weibo: '你是微博文案编辑。把用户输入改写成适合微博发布的一段文字：保留原意与事实，句子更短、信息密度更高，语气自然；已有的 #话题#、@昵称、链接与 [表情] 必须原样保留，不得新增或删除；不要添加解释、标题、前缀或引号，只输出改写后的正文。',
}

/** 压缩输出 token 上限：目标是把整本笔记压到两千字以内 */
const COMPRESS_MAX_TOKENS = 2_000
/** 压缩输入上限：打包文本通常在六千字以内，留出一倍余量 */
const COMPRESS_MAX_INPUT = 12_000

/** 一次增强请求：场景、上限与用量归属由调用方给出 */
export interface PromptEnhanceRequest {
    /** 待改写正文：前后空白会被裁掉，超出 maxInputLength 截断 */
    text: string
    /** 改写场景：决定 system 口径 */
    scene: EnhancePromptScene
    /** 输出 token 上限 */
    maxTokens: number
    /** 输入字符上限 */
    maxInputLength: number
    /** 输出字符上限 */
    maxOutputLength: number
    /** 用量归属模块：对话记 chat，出图记 image */
    module: AiUsageModule
}

/** 压缩请求：口径固定为资料压缩，归属对话模块，输出上限收紧到两千 token */
export function createCompressRequest(text: string): PromptEnhanceRequest {
    return {
        text,
        scene: 'compress',
        maxTokens: COMPRESS_MAX_TOKENS,
        maxInputLength: COMPRESS_MAX_INPUT,
        maxOutputLength: COMPRESS_MAX_INPUT,
        module: 'chat',
    }
}

/** 对话侧请求：口径固定为写作指令，归属对话模块 */
export function createChatEnhanceRequest(text: string): PromptEnhanceRequest {
    return {
        text,
        scene: 'write',
        maxTokens: CHAT_ENHANCE_MAX_TOKENS,
        maxInputLength: CHAT_ENHANCE_MAX_LENGTH,
        maxOutputLength: CHAT_ENHANCE_MAX_LENGTH,
        module: 'chat',
    }
}

/** 微博文案的输入 / 输出字符上限：与发表框 2000 字一致 */
const WEIBO_ENHANCE_MAX_LENGTH = 2_000
/** 微博文案输出 token 上限：两千汉字约 1300 token，留出余量 */
const WEIBO_ENHANCE_MAX_TOKENS = 1_600

/** 微博侧请求：口径为微博文案，归属对话模块（与输入框改写同一本账） */
export function createWeiboEnhanceRequest(text: string): PromptEnhanceRequest {
    return {
        text,
        scene: 'weibo',
        maxTokens: WEIBO_ENHANCE_MAX_TOKENS,
        maxInputLength: WEIBO_ENHANCE_MAX_LENGTH,
        maxOutputLength: WEIBO_ENHANCE_MAX_LENGTH,
        module: 'chat',
    }
}

export class PromptEnhanceService {
    public constructor(
        private readonly provider: AiProvider,
        private readonly usageRecorder: UsageRecorder,
    ) {}

    /** 调用文本通道改写提示词：流式收集为完整文本，成功后按场景模块记账 */
    public async enhance(request: PromptEnhanceRequest): Promise<string> {
        const source = request.text.trim().slice(0, request.maxInputLength)
        if (source.length === 0) {
            throw new Error('请先输入提示词')
        }
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), ENHANCE_TIMEOUT_MS)
        const startedAt = Date.now()
        let content = ''
        try {
            const stream = this.provider.stream({
                model: getSelectedCodebuddyModel(),
                maxTokens: request.maxTokens,
                messages: [
                    { role: 'system', content: ENHANCE_SYSTEM_PROMPTS[request.scene] },
                    { role: 'user', content: source },
                ],
                signal: controller.signal,
            })
            for await (const chunk of stream) {
                content += chunk.content
            }
        } finally {
            clearTimeout(timer)
        }
        const enhanced = content.trim()
        if (enhanced.length === 0) {
            throw new Error('增强失败：模型没有返回内容')
        }
        this.usageRecorder.record({
            module: request.module,
            model: getSelectedCodebuddyModel(),
            usage: null,
            meta: null,
            prompt: source,
            startedAt,
        })
        return enhanced.slice(0, request.maxOutputLength)
    }
}
