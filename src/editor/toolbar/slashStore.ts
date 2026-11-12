/**
 * 斜杠菜单会话：把 Suggestion 插件回传的状态交给 React，并把键盘事件回流给菜单。
 * 复用约定：模块级单例 + useSyncExternalStore 订阅，不为一个弹层再造 Context；
 * 全编辑器只有一份斜杠菜单，因此不需要多实例隔离。
 * 关键约束：会话必须带 range——执行命令要靠它删掉「/查询词」；
 * 键盘处理由 React 注册、编辑器转调，因为编辑器侧拿不到菜单当前的选中项。
 */
import type { SlashCommand } from './slashCommands'
import type { Range } from '@tiptap/core'

/** 一次斜杠会话：从输入 `/` 到选中命令或退出之间有效 */
export interface SlashSession {
    items: SlashCommand[]
    range: Range
    /** 弹层锚点：触发位置的视口坐标（矩形底边之下） */
    anchor: { left: number; top: number }
    /** 执行命令：由 Suggestion 的 command 回调注入，内部会再触发一次编辑器事务 */
    run: (item: SlashCommand) => void
}

let session: SlashSession | null = null
let keyHandler: ((event: KeyboardEvent) => boolean) | null = null
const listeners = new Set<() => void>()

function emit(): void {
    for (const listener of listeners) {
        listener()
    }
}

export function getSlashSession(): SlashSession | null {
    return session
}

export function setSlashSession(next: SlashSession | null): void {
    session = next
    emit()
}

export function subscribeSlash(listener: () => void): () => void {
    listeners.add(listener)
    return (): void => {
        listeners.delete(listener)
    }
}

export function setSlashKeyHandler(handler: ((event: KeyboardEvent) => boolean) | null): void {
    keyHandler = handler
}

/** 编辑器把按键转给菜单：返回 true 表示已消费，编辑器不再处理该键 */
export function handleSlashKey(event: KeyboardEvent): boolean {
    return keyHandler === null ? false : keyHandler(event)
}
