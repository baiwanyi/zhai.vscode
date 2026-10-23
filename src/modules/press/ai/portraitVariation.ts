/**
 * 角色卡画面变化：为每次出图挑一组「动作 + 地点 + 光线 + 姿态」，让同一角色的多张设定图不撞构图。
 * 复用约定：只服务提示词层，不写盘、不进人物卡；AI 通道可用时交给文本模型顺着这组方向写画面，
 * 通道不可用时由本模块拼成一句中文直接当画面描述用，保证两条路径都带变化。
 * 关键约束：上一张用过的组合必须避开——连续两次拿到同一组等于没有变化；
 * 取值只描述可画的动作与场景，不引入朝代、地名与专有名词，避免与作品设定冲突。
 */

/** 一组画面变化：四项共同决定这张图「在做什么、在哪里、什么光、怎么站」 */
export interface PortraitVariation {
    /** 动作：角色正在做的事，决定手部与身体朝向 */
    action: string
    /** 地点：与身份相称的完整场景 */
    place: string
    /** 光线：时间与光源，决定色调与明暗关系 */
    light: string
    /** 姿态：镜头给到的角度与视线方向 */
    pose: string
}

/** 动作候选：偏日常与功夫两类，都能自洽地落在一个单人画面里 */
const VARIATION_ACTIONS: readonly string[] = [
    '临窗翻书',
    '抚琴调弦',
    '执剑而立',
    '负手看雨',
    '低头整理袖口',
    '抬袖擦拭随身兵器',
    '煮茶候沸',
    '倚栏远眺',
    '策马回望',
    '提灯夜行',
    '蹲身查看地面的痕迹',
    '抬手接住落雪',
    '收拾行囊',
    '在纸上落笔',
    '挽弓试弦',
    '涉水过溪',
]

/** 地点候选：室内外交替，避免每张都站在院子里 */
const VARIATION_PLACES: readonly string[] = [
    '书房窗前',
    '庭院回廊',
    '山道石阶',
    '酒肆角落',
    '渡口船头',
    '竹林深处',
    '市集摊前',
    '高墙门阶下',
    '屋顶瓦脊',
    '溪边石上',
    '驿站门前',
    '檐下长廊',
    '旷野土坡',
    '客栈楼梯口',
]

/** 光线候选：时间与光源要具体，模型才知道往哪个方向打光 */
const VARIATION_LIGHTS: readonly string[] = [
    '清晨薄雾里的冷光',
    '正午烈日下的硬光',
    '黄昏逆光的暖调',
    '雨夜一盏灯的局部光',
    '雪后晴日的清冷反光',
    '烛火摇曳的暖橘光',
    '月下朦胧的银色光',
    '阴天漫射的柔光',
]

/** 姿态候选：换角度比换表情更能拉开两张图的差距 */
const VARIATION_POSES: readonly string[] = [
    '侧身回望镜头',
    '低头专注不看镜头',
    '抬眼直视镜头',
    '背对镜头露出半侧脸',
    '抬手遮挡光线',
    '俯身向前倾',
    '仰头看向上方',
    '半跪起身的瞬间',
]

/** 随机取一项：候选表都非空，索引兜底只为满足类型收窄 */
function pickOne(items: readonly string[], random: () => number): string {
    const index = Math.floor(random() * items.length)
    return items[index] ?? items[0] ?? ''
}

/** 组一组变化：四个维度独立取值 */
function buildVariation(random: () => number): PortraitVariation {
    return {
        action: pickOne(VARIATION_ACTIONS, random),
        place: pickOne(VARIATION_PLACES, random),
        light: pickOne(VARIATION_LIGHTS, random),
        pose: pickOne(VARIATION_POSES, random),
    }
}

/** 判断两组变化是否完全一致：任一项不同即视为换了画面 */
function isSameVariation(left: PortraitVariation, right: PortraitVariation): boolean {
    return (
        left.action === right.action &&
        left.place === right.place &&
        left.light === right.light &&
        left.pose === right.pose
    )
}

/**
 * 挑一组与上一次不同的变化。
 * @param previous 上一次用过的组合；传 null 表示本实例还没生成过
 * @param random 随机源，默认 Math.random，测试可注入固定序列
 */
export function pickVariation(
    previous: PortraitVariation | null,
    random: () => number = Math.random,
): PortraitVariation {
    const candidate = buildVariation(random)
    if (previous === null || !isSameVariation(previous, candidate)) {
        return candidate
    }
    // 四项全撞的概率极低，但「每次都不一样」是硬约束，撞了就顺移一个动作
    const index = VARIATION_ACTIONS.indexOf(candidate.action)
    const nextAction = VARIATION_ACTIONS[(index + 1) % VARIATION_ACTIONS.length] ?? candidate.action
    return { ...candidate, action: nextAction }
}

/** 拼成一句可直接当画面描述的中文：模板回退与日志复用同一段文字 */
export function formatVariation(variation: PortraitVariation): string {
    return `${variation.pose}，${variation.action}，场景是${variation.place}，${variation.light}`
}
