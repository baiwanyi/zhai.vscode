/**
 * 上下文列表的单行：菜单场景渲染 DropdownMenuItem，非菜单场景（作品浮层）渲染普通按钮。
 * 复用约定：行内容由调用方以取值函数注入（标题、辅助信息、行首图标），本组件不认识业务字段；
 * 普通行样式取 ../utils/context/styles 的 CONTEXT_PLAIN_ROW_CLASS。
 * 关键约束：菜单项必须 preventDefault——添加成功由外壳收起菜单，失败时留在原地便于重选；
 * React key 由调用方在 map 处给出，组件内部不接受 key。
 */
import { DropdownMenuItem } from '@components/ui/dropdown-menu'
import type { JSX } from 'react'
import { CONTEXT_PLAIN_ROW_CLASS } from '../utils/context/styles'

export interface AiChatContextRowProps<T> {
    item: T
    /** 主文案：过长按列宽截断 */
    getTitle: (item: T) => string
    /** 右侧辅助信息：返回 undefined 即不渲染；最长占行宽三分之一 */
    getMeta?: (item: T) => string | undefined
    /** 行首图标：返回节点即渲染在标题之前 */
    renderRowIcon?: (item: T) => JSX.Element
    /** 非菜单场景：行渲染为普通按钮，不依赖菜单上下文 */
    isPlain: boolean
    onPick: (item: T) => void
}

export function AiChatContextRow<T>({
    item,
    getTitle,
    getMeta,
    renderRowIcon,
    isPlain,
    onPick,
}: AiChatContextRowProps<T>): JSX.Element {
    const meta = getMeta === undefined ? undefined : getMeta(item)
    const content = (
        <>
            {renderRowIcon === undefined ? null : renderRowIcon(item)}
            <span className="min-w-0 flex-1 truncate">{getTitle(item)}</span>
            {meta === undefined ? null : (
                <span className="max-w-1/3 shrink-0 truncate text-right text-xs text-muted-foreground">{meta}</span>
            )}
        </>
    )
    if (isPlain) {
        return (
            <button type="button" className={CONTEXT_PLAIN_ROW_CLASS} onClick={(): void => onPick(item)}>
                {content}
            </button>
        )
    }
    return (
        <DropdownMenuItem
            onSelect={(event): void => {
                // 不按「选中即收起」处理：添加成功由外壳收起菜单，失败时留在原地便于重选
                event.preventDefault()
                onPick(item)
            }}
        >
            {content}
        </DropdownMenuItem>
    )
}
