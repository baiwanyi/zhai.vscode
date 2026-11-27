/**
 * 线稿手机预览：按状态分派骨架、错误提示或菜单条，机身与内容分由独立组件承担。
 * 复用约定：外壳取 layout/PhoneFrame，屏幕取 layout/PhoneScreen，底部菜单条取 layout/PhoneMenuBar，错误提示取 components/Alert；
 * 交互出口收拢为 actions 对象，数量上限取 shared/types/wechat 常量。
 * 关键约束：机身取父容器高度的 80% 并垂直居中，父容器须用 AppContent 的非滚动模式；
 * 加载态在手机壳内、错误态为裸 Alert，两态不共用同一容器。
 */
import { BadgeX } from 'lucide-react'
import type { WechatMenuButton } from '@shared/types/wechat'
import { Alert } from '@webview/components/Alert'
import { PhoneFrame } from './PhoneFrame'
import { PhoneMenuBar } from './PhoneMenuBar'
import { PhoneScreen } from './PhoneScreen'
import type { MenuPreviewActions } from './menuPreviewTypes'
import type { JSX } from 'react'

interface MenuPhonePreviewProps {
    buttons: WechatMenuButton[]
    status: 'loading' | 'ready' | 'error'
    error: string | null
    activeIndex: number
    actions: MenuPreviewActions
}

export function MenuPhonePreview({ buttons, status, error, activeIndex, actions }: MenuPhonePreviewProps): JSX.Element {
    if (status === 'loading') {
        return (
            <PhoneFrame>
                <PhoneScreen status="loading" />
            </PhoneFrame>
        )
    }
    if (status === 'error') {
        return (
            <Alert
                icon={<BadgeX />}
                variant="destructive"
                title="加载菜单失败"
                description={error ?? '请稍后重试'}
                actionText="重试"
                actionStatus="secondary"
                callback={actions.retry}
            />
        )
    }
    return (
        <PhoneFrame>
            <PhoneScreen status="ready" />
            <PhoneMenuBar buttons={buttons} activeIndex={activeIndex} actions={actions} />
        </PhoneFrame>
    )
}
