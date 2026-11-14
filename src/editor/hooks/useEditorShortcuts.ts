/**
 * 编辑区快捷键接管：Ctrl/Cmd+F 打开查找、Ctrl/Cmd+S 显式保存。
 * 复用约定：保存先走 useEditorDocument 的 flush 再请求宿主 editor/save，失败提示统一用 sonner。
 * 关键约束：webview 内没有原生查找条与保存入口，必须自己接管；
 * 键位按 event.code 判定——中文输入法组合期间 event.key 可能是 'Process'，按 key 判会漏掉保存；
 * AltGr 在部分布局下会带 ctrlKey，不能当快捷键；监听挂在 window 上，卸载必须摘除。
 */
import { useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { request } from '@shared/utils/bridge'

/** 保存失败兜底文案：宿主未就绪、超时与落盘被拒共用同一口径，不让用户猜是没保存还是没反应 */
const MESSAGE_SAVE_FAILED = '保存失败：请确认文件未被占用或设为只读'

export function useEditorShortcuts(flush: () => Promise<boolean>, openSearch: () => void): void {
    /** 保存在途标记：一次性保存请求要等 flush 回来才发，期间再次触发只会重复落盘 */
    const isSavingRef = useRef(false)

    const handleSave = useCallback(async (): Promise<void> => {
        if (isSavingRef.current) {
            return
        }
        isSavingRef.current = true
        try {
            // 先把防抖窗口里的输入回写进 TextDocument，再让宿主落盘：
            // autoSave 关闭时这是唯一能真正写文件的路径
            await flush()
            const result = await request<{ saved: boolean }>('editor/save')
            if (!result.saved) {
                toast.error(MESSAGE_SAVE_FAILED)
            }
        } catch {
            // 宿主未就绪、超时与同步抛错都走同一套文案，不让用户猜是没保存还是没反应
            toast.error(MESSAGE_SAVE_FAILED)
        } finally {
            isSavingRef.current = false
        }
    }, [flush])

    useEffect(() => {
        const handleShortcut = (event: KeyboardEvent): void => {
            if (!event.ctrlKey && !event.metaKey) {
                return
            }
            // AltGr 在部分键盘布局下会同时带上 ctrlKey，不能当快捷键吞掉
            if (event.altKey) {
                return
            }
            if (event.code === 'KeyF') {
                event.preventDefault()
                // 长按会持续补发 repeat 事件：重复打开会把查找面板的输入与高亮反复重置
                if (!event.repeat) {
                    openSearch()
                }
                return
            }
            if (event.code === 'KeyS') {
                event.preventDefault()
                // 同理：长按 Ctrl+S 每一下都 flush + save，只会让宿主反复落盘同一个版本
                if (!event.repeat) {
                    void handleSave()
                }
            }
        }
        window.addEventListener('keydown', handleShortcut)
        return (): void => {
            window.removeEventListener('keydown', handleShortcut)
        }
    }, [handleSave, openSearch])
}
