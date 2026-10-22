/**
 * 角色设定图提示词：把人物卡与作品氛围拼成图像模型可用的自然语言描述。
 * 复用约定：插画基底、画风提示与禁止项集中在此一份，不散落到服务层；尺寸与模型交给配置，提示词只管画什么。
 * 关键约束：按番茄小说「一键生图」的章节配图观感收口（叙事场景 + 氛围光影，画风交给 STYLE_HINTS），
 * 支持两段式——scene 由文本模型先写画面，缺省时回退到纯字段模板，保证文本模型失败也能出图；
 * 不按封面或纯立绘方向写；提示词按服务商上限截断且保留前段（人物特征在前，场景氛围在后）。
 */
import type { PortraitGenerateRequest, PortraitStyle } from '../../../shared/types/press'

/** 提示词长度上限：多数服务商限制 1000 字符以内，中文按 600 字控制 */
const MAX_PROMPT_LENGTH = 600

/**
 * 统一插画基底：只约束构图、光影与画面质感，不锁定画风，具体画法交给 STYLE_HINTS。
 * 对齐番茄小说「一键生图」的章节配图观感：人物为主体，场景承载身份信息。
 */
const ILLUSTRATION_STYLE_BASE =
    '竖版小说配图，单个人物位于画面中央偏前，半身至膝上入镜，姿态与视线带出情节感，' +
    '身后是与其身份相称的完整场景，前后景层次分明、中景景深，侧上方柔和体积光，色彩通透干净'

/**
 * 画面风格描述：key 与 shared/types/press 的 PORTRAIT_STYLES 一一对应，新增风格须在此登记。
 * 文案对齐番茄小说 AI 生图的风格分类，用画面要素而不是风格名描述，模型才画得准。
 */
const STYLE_HINTS: Readonly<Record<PortraitStyle, string>> = {
    auto: '按题材与世界观自动匹配画风：古风玄幻走东方古风原画，现代都市走半写实插画，整体保持统一',
    anime: '日系动画赛璐璐上色，干净线稿与明快高饱和配色',
    guofeng: '东方古风，工笔重彩与水墨晕染结合，衣袂层叠、纹样考究，淡雅配色与氤氲氛围',
    realistic: '写实摄影风格，真实皮肤与布料纹理，五官比例真实，自然光影',
    cinematic: '电影感，电影级布光与调色，强轮廓光与空气感，胶片颗粒',
    photo: '摄影质感，单反人像质感，皮肤细节真实，浅景深背景虚化，环境光自然',
    pixel: '8-bit 像素画风，低分辨率色块与复古游戏画面，锐利像素边缘',
    gameart: '游戏角色原画级厚涂，装备与材质细节，概念设计光影与轮廓高光',
}

/**
 * 构造图像生成提示词
 * @param scene 文本模型先写好的画面描述；缺省或为空时只用人物字段，保证失败也能出图
 */
export function buildPortraitPrompt(request: PortraitGenerateRequest, scene?: string): string {
    const background = [...request.genres, request.era].filter((item) => item.length > 0).join('、')
    const basics = [request.gender, request.age.length > 0 ? `${request.age} 岁` : '', request.identity]
        .filter((item) => item.length > 0)
        .join('，')
    // 画面描述在基底之后、画风之前：先定「画什么」，再定「怎么画」
    const sceneLine = scene !== undefined && scene.length > 0 ? `画面：${scene}。` : ''
    const lines = [
        `${ILLUSTRATION_STYLE_BASE}。${sceneLine}画风：${STYLE_HINTS[request.style]}。`,
        `角色：${request.name}（${request.role}）`,
    ]
    if (basics.length > 0) {
        lines.push(`基本信息：${basics}`)
    }
    if (request.appearance.length > 0) {
        lines.push(`外貌：${request.appearance}`)
    }
    if (request.traits.length > 0) {
        lines.push(`气质与性格：${request.traits.join('、')}`)
    }
    if (request.ability.length > 0) {
        lines.push(`能力或随身物件：${request.ability}`)
    }
    if (background.length > 0) {
        lines.push(`世界观：${background}`)
    }
    if (request.tone.length > 0) {
        lines.push(`整体氛围：${request.tone}`)
    }
    lines.push(
        '要求：画面只出现一个人物，按身份与世界观补全所处场景、光线与随身物件，让画面像小说配图而不是封面海报；' +
            '不要文字、水印、logo、边框、多余人物或分解图。',
    )
    return lines.join('\n').slice(0, MAX_PROMPT_LENGTH)
}
