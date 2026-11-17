/**
 * 上下文面板的检索行：输入框 + 「最近 X」口径提示，来源视图与候选视图共用。
 * 复用约定：输入取 ../retrieval 的 AiChatSearchField（自带 200ms 防抖、输入法处理与回车即时检索），
 * 口径提示在菜单场景取 DropdownMenuLabel，非菜单场景退化为普通文本行。
 * 关键约束：菜单项 onSelect 必须 preventDefault，否则点输入框就按「选中」处理、菜单当场收起；
 * 菜单项还要清掉 focus / data-highlighted 底色（父级 ** 选择器特异性更高，须用 ! 压过）；
 * 非菜单场景改用普通容器，输入框不受菜单键盘导航影响；检索框不自动聚焦。
 */
import { DropdownMenuItem, DropdownMenuLabel } from '@components/ui/dropdown-menu'
import type { JSX } from 'react'
import { AiChatSearchField } from '../retrieval/AiChatSearchField'

interface RecentHintProps {
    isPlain: boolean
    kindLabel: string
}

/** 列表口径提示：空关键词时列的是最近更新的内容，标出当前入口对应的类别 */
function RecentHint({ isPlain, kindLabel }: RecentHintProps): JSX.Element {
    if (isPlain) {
        return <div className="px-1 text-xs text-muted-foreground">最近{kindLabel}</div>
    }
    return <DropdownMenuLabel>最近{kindLabel}</DropdownMenuLabel>
}

export interface AiChatContextSearchRowProps {
    isSearching: boolean
    placeholder: string
    /** 列表类别名：检索行下方标出当前入口对应哪一类 */
    kindLabel: string
    onSubmit: (keyword: string) => void
    /** 非菜单场景：整行渲染为普通容器 */
    isPlain: boolean
}

export function AiChatContextSearchRow({
    isSearching,
    placeholder,
    kindLabel,
    onSubmit,
    isPlain,
}: AiChatContextSearchRowProps): JSX.Element {
    const content = (
        <>
            <AiChatSearchField isSearching={isSearching} onSubmit={onSubmit} placeholder={placeholder} />
            <RecentHint isPlain={isPlain} kindLabel={kindLabel} />
        </>
    )
    if (isPlain) {
        // shrink-0：在固定高度的浮层里，检索行不被列表挤压，剩余高度全给列表滚动
        return <div className="flex shrink-0 flex-col gap-1 p-1">{content}</div>
    }
    return (
        <DropdownMenuItem
            // 检索行不参与高亮：清除菜单项的 focus / data-highlighted 底色（父级 ** 选择器带更高特异性，须用 ! 压过）
            className="flex-col items-stretch gap-1 p-1 select-text focus:bg-transparent! data-highlighted:bg-transparent!"
            onSelect={(event): void => {
                event.preventDefault()
            }}
        >
            {content}
        </DropdownMenuItem>
    )
}
