/**
 * 单图参数契约：一张图片的生图参数记录。
 * 复用约定：比例取 ./imageRatio 的 ImageRatio，画风取 ./imageStyle 的 PortraitStyle，
 * 记录收窄统一由 @shared/utils/mediaParameters 承担，本文件只描述形态。
 * 关键约束：落 images/{YYYYMM}/settings.json，以媒体 id 为键，索引库不再保存这四项；
 * 手工放入的图片没有对应键，由调用方按「无生图信息」展示，不视为错误。
 */
import type { ImageRatio } from './imageRatio'
import type { PortraitStyle } from './imageStyle'

/**
 * 单张图片的生图参数：落 images/{YYYYMM}/settings.json，以媒体 id 为键。
 * 复用约定：比例与画风沿用白名单，读取时逐项收窄，非法字段整条丢弃；
 * enhancedFrom 为提示词增强前的原文，未增强时为 null。
 * 关键约束：本结构是这四项的唯一读取来源，索引库不再保存。
 */
export interface MediaParameters {
    prompt: string
    ratio: ImageRatio
    style: PortraitStyle
    enhancedFrom: string | null
}
