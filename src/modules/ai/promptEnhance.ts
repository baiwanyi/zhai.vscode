/**
 * 提示词增强服务：对话与出图两侧共用同一套模型调用、超时、空结果校验与用量记账。
 * 复用约定：文本通道与用量记账由调用方注入（两处传入同一 provider 与 UsageRecorder 实例），
 * 改写口径集中在 ENHANCE_SYSTEM_PROMPTS（写作 / 图像两种），token 上限、输入输出长度与
 * 归属模块按场景给出；对话侧用 createChatEnhanceRequest 取写作口径，出图侧直接传 scene: 'image'。
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

/** 改写场景：写作指令与图像画面描述 */
export type EnhancePromptScene = 'write' | 'image'

/** 改写口径：两种场景只改口径文本，模型调用、超时与记账完全一致 */
export const ENHANCE_SYSTEM_PROMPTS: Record<EnhancePromptScene, string> = {
    write: '你是写作指令编辑。把用户输入改写成可直接交给写作助手的指令：补足文体与视角、目标读者、篇幅或字数、结构与节奏、语言风格与禁忌；保持原意与中文表达，不要添加解释、标题或列表，只输出一段连续的指令。',
    image: '你是图像提示词编辑。把用户输入改写成更具体的画面描述：补足人物姿态、服装材质、场景层次、光线方向与镜头距离；保持原意与语言，不要添加解释、标题或列表，只输出一段连续的描述。',
}

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
