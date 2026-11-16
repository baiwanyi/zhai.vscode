/**
 * 出图参数契约：作品级可覆盖项、默认值与覆盖键回报。
 * 复用约定：比例取 ./imageRatio 的 ImageRatio，画风取 ./imageStyle 的 PortraitStyle，
 * 前端选项与宿主回落共用 DEFAULT_IMAGE_SETTINGS，避免两处口径分叉。
 * 关键约束：只保存「与默认不同」的键，overrides 回报的是实际生效的覆盖项；
 * 配额与超时是全局护栏，不在此列，也不接受作品级覆盖。
 */
import type { ImageRatio } from './imageRatio'
import type { PortraitStyle } from './imageStyle'

/** 生成参数：作品级可覆盖项，配额与超时不在此列 */
export interface ImageSettings {
    /** 每次打开 composer 时默认选中的比例 */
    defaultRatio: ImageRatio
    /** 角色图与普通图默认画风 */
    portraitStyle: PortraitStyle
    /** 附加风格补充：拼在提示词末尾 */
    promptSuffix: string
    /** 负向约束：拼在提示词末尾的「避免」段 */
    negative: string
}

/** 参数默认值：前端选项与宿主回落共用同一份，避免两处口径分叉 */
export const DEFAULT_IMAGE_SETTINGS: ImageSettings = {
    defaultRatio: '3:4',
    portraitStyle: 'auto',
    promptSuffix: '',
    negative: '',
}

/** 参数读取结果：overrides 列出已覆盖的键，其余跟随默认值 */
export interface ImageSettingsResult {
    settings: ImageSettings
    overrides: ReadonlyArray<keyof ImageSettings>
}
