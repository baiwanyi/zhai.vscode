/**
 * 正文比例意图探测：从提示词正文里识别用户写下的画面比例（数字写法或中英文比例词）。
 * 复用约定：比例白名单取 @shared/types/imagegen 的 isImageRatio，本文件只负责定位与取值，
 * 是否真的切换比例由调用方决定，不写回任何作品配置。
 * 关键约束：数字写法只认白名单内的值，文字只认 RATIO_KEYWORDS 登记的中英文词，其余描述一律不猜；
 * 多类写法按出现位置合流，最后一次出现优先；英文词在小写副本上定位，索引与原串一致。
 */
import { isImageRatio, type ImageRatio } from '@shared/types/imagegen'

/** 比例字面量：正文里写「16:9」这类比例即可自动切换，全角冒号与斜杠都收，前后紧邻数字或小数点的跳过 */
const RATIO_PATTERN = /(?<![\d.])(\d{1,2})\s*[:：/]\s*(\d{1,2})(?![\d.])/gu

/** 比例词：中文与英文同义写法等价于数字比例，同样参与「最后一次出现优先」的判定（英文不区分大小写） */
const RATIO_KEYWORDS: ReadonlyArray<{ keyword: string; ratio: ImageRatio }> = [
    { keyword: '竖版', ratio: '9:16' },
    { keyword: 'vertical', ratio: '9:16' },
    { keyword: 'portrait', ratio: '9:16' },
    { keyword: '横版', ratio: '16:9' },
    { keyword: 'horizontal', ratio: '16:9' },
    { keyword: 'landscape', ratio: '16:9' },
    { keyword: '方形', ratio: '1:1' },
    { keyword: 'square', ratio: '1:1' },
]

/**
 * 从正文里取最后一个出现的比例意图，供输入卡片自动切换比例。
 * 关键约束：数字写法只认白名单内的值（1:1 / 3:4 / 4:3 / 16:9 / 9:16），
 * 文字只认 RATIO_KEYWORDS 里登记的中英文词，其余描述一律不猜——猜错比不猜更糟；
 * 各类写法按出现位置合流，谁在后面以谁为准，符合「后补的约束覆盖先前描述」的直觉。
 */
export function detectImageRatio(text: string): ImageRatio | null {
    let detected: ImageRatio | null = null
    let detectedAt = -1
    for (const match of text.matchAll(RATIO_PATTERN)) {
        const candidate = `${match[1] ?? ''}:${match[2] ?? ''}`
        const at = match.index ?? -1
        if (isImageRatio(candidate) && at > detectedAt) {
            detected = candidate
            detectedAt = at
        }
    }
    // 英文词不区分大小写：统一在小写副本上取位置，索引与原串一致
    const lowered = text.toLowerCase()
    for (const { keyword, ratio } of RATIO_KEYWORDS) {
        const at = lowered.lastIndexOf(keyword)
        if (at > detectedAt) {
            detected = ratio
            detectedAt = at
        }
    }
    return detected
}
