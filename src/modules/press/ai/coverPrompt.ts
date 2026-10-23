/**
 * 作品封面提示词：把作品设定拼成图像模型可用的竖版封面描述。
 * 复用约定：画风描述直接复用 ./portraitPrompt 的 STYLE_HINTS，不另写一套画风文案；
 * 尺寸与模型交给配置，提示词只负责画什么。
 * 关键约束：封面是完整书籍封面（2:3 竖版），必须预留标题与署名留白，并禁止模型自行书写任何文字——
 * 文字由后期排版叠加；正文信息按「题材 → 梗概 → 世界观 → 氛围」的顺序裁剪，先保画面主体再补背景。
 */
import { STYLE_HINTS } from './portraitPrompt'
import type { CoverGenerateRequest } from '../../../shared/types/press'

/** 提示词长度上限：与角色卡同一服务商限制，中文按 900 字控制 */
const MAX_PROMPT_LENGTH = 900

/** 梗概与世界观单段上限：整段搬进提示词会挤掉画面约束 */
const MAX_NARRATIVE_LENGTH = 120

/** 长文本裁剪：超长时截断并留省略号 */
function clip(text: string, limit: number): string {
    return text.length > limit ? `${text.slice(0, limit)}…` : text
}

/**
 * 封面构图基底：只约束比例、构图分区与质感，画面内容交给作品设定与画风。
 * 上下留白是硬约束——标题与署名要落在留白里，不能被画面元素吃掉。
 */
const COVER_BASE =
    '竖版书籍封面插画（2:3 比例），单幅完整画面，无分栏、无拼贴；' +
    '画面主体是能概括全书气质的核心场景与象征意象，人物可作点缀但不独占画面；' +
    '构图分区明确：画面上部约四分之一留出干净的暗部或渐隐留白供水印标题，下部留出窄条留白供署名；' +
    '视觉重心落在中下部的场景与光影上；光影有明确方向与体积感，色彩统一在一个冷暖主调内，' +
    '材质有真实响应，拒绝过度饱和的塑料感与廉价滤镜'

/**
 * 构造封面图像生成提示词
 * @param request 作品设定快照：缺项直接跳过，只有作品名也允许出图
 */
export function buildCoverPrompt(request: CoverGenerateRequest): string {
    const lines = [`${COVER_BASE}。画风：${STYLE_HINTS[request.style]}。`]
    if (request.title.length > 0) {
        // 标题只作气质参照，明确禁止画进画面，避免模型生成乱码文字
        lines.push(`作品名（仅用于理解气质，不要画进画面）：${clip(request.title, 40)}`)
    }
    const genres = request.genres.filter((item) => item.length > 0).join('、')
    if (genres.length > 0) {
        lines.push(`题材：${genres}`)
    }
    if (request.logline.length > 0) {
        lines.push(`故事梗概：${clip(request.logline, MAX_NARRATIVE_LENGTH)}`)
    }
    if (request.worldview.length > 0) {
        lines.push(`世界观：${clip(request.worldview, MAX_NARRATIVE_LENGTH)}`)
    }
    if (request.tone.length > 0) {
        lines.push(`整体氛围：${request.tone}`)
    }
    if (request.perspective.length > 0) {
        lines.push(`叙事视角：${request.perspective}`)
    }
    const requirement =
        '【画面约束】按上述题材与氛围确定时代与场景元素，避免与世界观冲突的现代违和物品；' +
        '画面需在缩略图尺寸下仍可辨识主体轮廓，主体不要贴边。' +
        '【负面屏蔽】严禁出现任何文字、书名、作者名、水印、logo、二维码、条码、边框、书脊、多本书并排、' +
        '杂志排版与裸露内容。'
    // 先给「要求」留足额度再裁主体：排版约束比背景细节更重要
    const body = lines.join('\n')
    return `${body.slice(0, Math.max(0, MAX_PROMPT_LENGTH - requirement.length - 1))}\n${requirement}`
}
