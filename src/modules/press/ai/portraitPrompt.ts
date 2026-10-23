/**
 * 角色设定图提示词：把人物卡与作品氛围拼成图像模型可用的自然语言描述。
 * 复用约定：插画基底、画风提示与禁止项集中在此一份，不散落到服务层；尺寸与模型交给配置，提示词只管画什么。
 * 关键约束：按番茄小说「一键生图」的章节配图观感收口（叙事场景 + 氛围光影，画风交给 STYLE_HINTS），
 * 支持两段式——scene 由文本模型先写画面，缺省时回退到纯字段模板，保证文本模型失败也能出图；
 * 不按封面或纯立绘方向写；提示词上限 900 字，超长时先裁主体、再拼画面要求——宁可少写背景，也不能丢掉约束。
 */
import type { PortraitGenerateRequest, PortraitStyle } from '../../../shared/types/press'

/** 提示词长度上限：多数服务商限制 1000 字符以内，中文按 900 字控制 */
const MAX_PROMPT_LENGTH = 900

/** 叙述类字段（动机、背景、关系）的单段上限：整段搬进提示词会挤掉画面要求 */
const MAX_NARRATIVE_LENGTH = 100

/** 长文本裁剪：超长时截断并留省略号，保留可读的前半段 */
function clip(text: string, limit: number): string {
    return text.length > limit ? `${text.slice(0, limit)}…` : text
}

/**
 * 统一插画基底：只约束构图、光影与画面质感，不锁定画风，具体画法交给 STYLE_HINTS。
 * 对齐番茄小说「一键生图」的章节配图观感：人物为主体，场景承载身份信息。
 */
const ILLUSTRATION_STYLE_BASE =
    '竖版小说配图（9:16 比例），电影感三分法构图，视平线机位微带仰拍，' +
    '单个人物作为绝对视觉中心，呈半身至膝上景别，肢体语言与视线带有明确的情节张力与情绪暗示；' +
    '背景提炼出代表人物身份的核心环境符号，利用“前景虚化遮挡 + 中景主体清晰 + 远景环境纵深”拉开画面空间层次；' +
    '光影需遵循所选画风的环境逻辑，塑造出明确的人物面部与服装体积感；' +
    '色彩通透，材质有真实的质感响应，拒绝过度饱和的塑料感和浓重的滤镜感'

/**
 * 画面风格描述：key 与 shared/types/press 的 PORTRAIT_STYLES 一一对应，新增风格须在此登记。
 * 文案对齐番茄小说 AI 生图的风格分类，用画面要素而不是风格名描述，模型才画得准。
 */
export const STYLE_HINTS: Readonly<Record<PortraitStyle, string>> = {
    auto: '按题材与世界观自动匹配画风并锁定统一基调：古风玄幻走东方幻想厚涂或工笔重彩，衣料可见织绣层次与云雾介质；现代都市走高规格商业立绘或半写实插画，人物比例唯美，保留真实织物的高光反射但皮肤呈现完美的CG质感；悬疑罪案走冷硬电影写实，以低饱和基底与单一硬光源建立压迫感。全组保持同一镜头语言、同一材质精度与同一颗粒基准，不混入廉价CG感或影楼滤镜',

    anime: '日系TV动画赛璐璐上色，干净闭合线稿与硬边描线，平涂固有色，阴影为明确硬边、少渐变，高饱和但色相分层清楚；面部保留动画式概括，服装褶皱用利落锐角阴影切分，背景可简化但透视准确；整体避免厚涂混入、避免塑料高光，保留原画级线条稳定性',

    guofeng:
        '东方古风工笔重彩与水墨晕染结合：建筑形制写清（重檐庑殿顶、斗拱层叠、汉白玉台基），衣料为层叠丝绸与刺绣，腰封、披帛、纹样有可辨的织物质感与边缘垂坠；光线以暖金夕照或冷调柔光为主，落在金瓦、玉面、织金上的高光锐度不同；云雾作为有厚度、有方向、受光衰减的介质穿行于楼阁与人物之间，不是均匀白雾；配色走赭石、青灰、石绿、淡金，低饱和但矿物色颗粒感保留；构图可参平远手卷式，人物作为尺度链末端，不抢占建筑纵深',

    realistic:
        '纪实摄影，35—50mm 标准或广角镜头，半身或全身构图，人物与环境高度融合，保留完整的背景细节与环境纵深，不使用极致大光圈；皮肤有真实的毛孔、细纹、轻微瑕疵与自然油光，布料呈现棉麻毛呢的粗糙漫反射差异；光线以自然漫射光、阴天柔光或室内混合光为主，允许出现真实但不完美的阴影，暗部保留多层细节；整体偏客观纪实，轻微胶片颗粒，拒绝过度磨皮、拒绝影楼式完美打光、拒绝CG塑料感',

    photo: '高级商业人像写真，85mm 或 50mm 定焦，f/1.4—f/2.8 超大光圈，人物胸像或半身特写，焦外呈现奶油般柔滑的背景虚化与迷人的圆形光斑；构图干净，重点刻画面部，皮肤纹理精致无瑕疵，眼中有明亮清晰的眼神光，嘴唇有自然微光；光源优先自然窗光、黄金时刻（golden hour）侧逆光或柔光箱打光，环境光参与色调但不污染肤色；整体呈现精致的唯美质感，避免过度磨皮导致的假面感，避免HDR式强反差',

    cinematic:
        '2.35:1 宽银幕电影剧照，具有强烈的叙事感与戏剧张力，镜头常带有强烈的前景遮挡（如透过窗缝、树叶、百叶窗看人）或大留白负空间；主光动机明确，使用门缝漏光、百叶窗硬光、侧逆光或低角度逆光勾勒轮廓，必须伴随可见的体积光介质（烟雾、灰尘、水汽）；色调走低饱和基底加受控的冷暖对比（如青橙调或冷蓝调），空气透视强烈，远景对比与饱和下降；胶片颗粒细腻，不做均匀补光的“海报式打光”',

    pixel: '8-bit 像素画，低分辨率网格与有限色板，色块边缘锐利、无抗锯齿渐变；角色轮廓用最少像素概括可辨动作，阴影为硬边色块切换而非平滑过渡；背景以重复 tile 和几何色块建立空间，光源用离散亮点暗示，不出现摄影式柔光和景深；整体保持复古游戏画面的色数限制与网格感，避免高分辨率混入',

    gameart:
        '高规格商业立绘与半写实厚涂，游戏角色原画级完成度：人物五官与身体比例经唯美化处理，皮肤呈现无瑕疵的陶瓷/哑光CG质感（无真实毛孔），面部有明确的高光与体积感；先建立明确光源（如侧逆光、顶光）再推材质，丝绸有锐利高光与层叠褶皱、金属有窄且冷的高光边缘、皮革有磨砂颗粒；强轮廓光将人物从背景中分离，背景可虚化为概念设计式的散景光斑；保留厚涂笔触的体积感，拒绝真实摄影的粗糙感，也拒绝平涂赛璐璐混入',
}

/**
 * 构造图像生成提示词
 * @param scene 文本模型先写好的画面描述；缺省或为空时只用人物字段，保证失败也能出图
 */
export function buildPortraitPrompt(request: PortraitGenerateRequest, scene?: string): string {
    const background = [...request.genres, request.era].filter((item) => item.length > 0).join('、')
    // 性别、年龄、身高、体型、身份共同决定身形比例与身份气质，缺项直接跳过
    const basics = [
        request.gender,
        request.age.length > 0 ? `${request.age} 岁` : '',
        request.height,
        request.bodyType,
        request.identity,
    ]
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
    if (request.desire.length > 0 || request.weakness.length > 0) {
        const motive = [request.desire, request.weakness].filter((item) => item.length > 0).join('；')
        lines.push(`动机：${clip(motive, MAX_NARRATIVE_LENGTH)}`)
    }
    if (request.background.length > 0) {
        lines.push(`背景：${clip(request.background, MAX_NARRATIVE_LENGTH)}`)
    }
    if (request.relation.length > 0) {
        // 关系只作为神态与场景语境的参照，画面仍只画一个人，由末尾要求兜底
        lines.push(`人际关系：${clip(request.relation, MAX_NARRATIVE_LENGTH)}`)
    }
    if (background.length > 0) {
        lines.push(`世界观：${background}`)
    }
    if (request.tone.length > 0) {
        lines.push(`整体氛围：${request.tone}`)
    }
    const requirement =
        '【画面约束】呈现具有强叙事感的“小说内文插图”气质，聚焦单一核心人物；依据其身份与世界观自然融入所处场景、环境光线与随身道具（如古风的玉佩/长剑，现代的咖啡杯/手机），背景适度虚化以突出人物主体；' +
        '【负面屏蔽】严禁出现文字、水印、logo、边框、海报式排版、杂志封面感、多余人物、分镜拆解图，严禁出现与世界观时代冲突的现代违和物品。'
    // 先给「要求」留足额度再裁主体：画面约束比背景细节更重要，不能被截掉
    const body = lines.join('\n')
    return `${body.slice(0, Math.max(0, MAX_PROMPT_LENGTH - requirement.length - 1))}\n${requirement}`
}
