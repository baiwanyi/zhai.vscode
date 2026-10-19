/**
 * 编辑器主题读取：以根元素的 .dark 类为唯一口径，供需要显式主题入参的组件（如 sonner 的 Toaster）使用。
 * 复用约定：dashboard 与 workflow 的 Webview 共用本 hook，沿用 bootstrap 写入的 .dark 类，避免引入 next-themes 提供者。
 * 关键约束：仅观察根元素的 class 变化，判定口径须与 bootstrap 的 DARK_THEME_KINDS 保持一致。
 */
import { useEffect, useState } from 'react'

/** 需要显式下发的主题取值 */
export type VscodeTheme = 'light' | 'dark'

/** 依据当前根元素的 .dark 类判定主题 */
function readTheme(): VscodeTheme {
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function useVscodeTheme(): VscodeTheme {
    const [theme, setTheme] = useState<VscodeTheme>(readTheme)

    useEffect(() => {
        const observer = new MutationObserver(() => setTheme(readTheme()))
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
        return (): void => observer.disconnect()
    }, [])

    return theme
}
