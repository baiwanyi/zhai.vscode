/**
 * 画面风格字典：风格取值、白名单、默认值与入参收窄。
 * 复用约定：出图参数、人物卡与媒体页共用同一份取值，前端选项表与宿主 STYLE_HINTS 的键都以此为准；
 * 定义从 press 契约下沉至此，press 侧以转发方式保持既有引用不变。
 * 关键约束：新增取值必须同时在前端选项表与宿主 STYLE_HINTS 中登记，
 * 否则该风格拿不到画面描述，生成结果会退化为纯风格名。
 */

/**
 * 画面风格：对齐番茄小说 AI 生图的风格分类，取值参与宿主提示词映射，
 * 新增值须同时在前端选项表与宿主 STYLE_HINTS 中登记。
 */
export type PortraitStyle = 'auto' | 'anime' | 'guofeng' | 'realistic' | 'cinematic' | 'photo' | 'pixel' | 'gameart'

/** 风格白名单：前端选项与宿主入参校验共用同一份，避免两处口径分叉 */
export const PORTRAIT_STYLES: readonly PortraitStyle[] = [
    'auto',
    'anime',
    'guofeng',
    'realistic',
    'cinematic',
    'photo',
    'pixel',
    'gameart',
]

/** 默认风格：智能匹配，由宿主按题材与世界观选择具体画风 */
export const DEFAULT_PORTRAIT_STYLE: PortraitStyle = 'auto'

/** 风格收窄：只接受白名单值 */
export function isPortraitStyle(value: unknown): value is PortraitStyle {
    return PORTRAIT_STYLES.some((item) => item === value)
}
