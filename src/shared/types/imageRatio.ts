/**
 * 画面比例字典：可选比例清单、比例到像素的映射与入参收窄。
 * 复用约定：前端比例选项、正文比例意图探测与宿主出图请求校验共用同一份清单，
 * 宽高换算只在此处进行，避免前端与宿主各算一套尺寸。
 * 关键约束：IMAGE_RATIOS 的顺序即界面上选项的呈现顺序，增删比例必须同步补齐 IMAGE_RATIO_SIZE，
 * 否则通道会取到 undefined 尺寸；isImageRatio 只认白名单字面量，不做前缀匹配或大小写归一。
 */

/** 画面比例 */
export type ImageRatio = '1:1' | '3:4' | '4:3' | '16:9' | '9:16'

/** 比例白名单：前端选项与宿主入参校验共用同一份 */
export const IMAGE_RATIOS: readonly ImageRatio[] = ['1:1', '3:4', '4:3', '16:9', '9:16']

/** 比例到像素的固定映射：通道只接受 WxH，换算集中在此，避免前后端各算一套 */
export const IMAGE_RATIO_SIZE: Readonly<Record<ImageRatio, string>> = {
    '1:1': '1024x1024',
    '3:4': '768x1024',
    '4:3': '1024x768',
    '16:9': '1280x720',
    '9:16': '720x1280',
}

/** 比例收窄：非白名单值一律不通过 */
export function isImageRatio(value: unknown): value is ImageRatio {
    return typeof value === 'string' && IMAGE_RATIOS.some((item) => item === value)
}
