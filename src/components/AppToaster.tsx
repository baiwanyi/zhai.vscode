/**
 * 全局提示层：统一读 VS Code 主题后挂载 sonner Toaster，各页面不再各自组合主题与提示层。
 * 复用约定：主题取 @webview/hooks/useVscodeTheme，Toaster 取 @components/ui/sonner；
 * 页面在根节点渲染一次即可，不必再单独调用 useVscodeTheme。
 * 关键约束：必须挂在页面根节点、位于所有内容之后，保证提示层压在内容之上。
 */
import { Toaster } from '@components/ui/sonner'
import { useVscodeTheme } from '@webview/hooks/useVscodeTheme'
import type { JSX } from 'react'

export function AppToaster(): JSX.Element {
    const theme = useVscodeTheme()
    return <Toaster theme={theme} />
}
