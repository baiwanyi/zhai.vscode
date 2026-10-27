/**
 * 画风选项与中文标签：生图输入芯片与图片详情（侧车）共用同一份文案。
 * 复用约定：value 与宿主 prompt/styleHints 的 STYLE_HINTS 键一一对应，类型取 @shared/types/press 的 PortraitStyle。
 * 关键约束：标签只做展示，不参与协议；白名单外的值（历史侧车里的旧画风）原样返回，避免显示成「自动」误导。
 */
import type { PortraitStyle } from '@shared/types/press'

export const STYLE_OPTIONS: ReadonlyArray<{ value: PortraitStyle; label: string }> = [
    { value: 'auto', label: '自动' },
    { value: 'guofeng', label: '古风' },
    { value: 'anime', label: '日漫' },
    { value: 'realistic', label: '写实' },
    { value: 'photo', label: '人像' },
    { value: 'cinematic', label: '电影' },
    { value: 'gameart', label: '立绘' },
    { value: 'pixel', label: '像素' },
]

/** 画风标签：白名单外的值原样返回 */
export function styleLabelOf(value: string): string {
    return STYLE_OPTIONS.find((option) => option.value === value)?.label ?? value
}
