/**
 * 「添加上下文」的来源入口菜单：只维护入口清单（文案 / 图标 / 视图），渲染四个来源子菜单。
 * 复用约定：子菜单壳取同目录 AiChatContextSourceSubMenu，行内图标与行样式取 ../utils/context/styles，
 * 本层不碰取数、过滤与提交，只把回调原样透传。
 * 关键约束：每一项都是独立的 DropdownMenuSub，必须由 DropdownMenuContent 直接包含，中间不能再包 div；
 * 顺序即展示顺序；作品入口只负责选出作品目录，选中后由外壳把菜单内容切到作品面板（AiChatContextProjectMenu）。
 */
import { FileText, Library, Newspaper, Package } from 'lucide-react'
import { AiChatContextSourceSubMenuEntry } from './AiChatContextSourceSubMenu'
import type { AiChatContextSubMenuCallbacks, AiContextPickerView } from '../utils/context/types'
import type { JSX } from 'react'
import { CONTEXT_ICON_CLASS } from '../utils/context/styles'

/** 一级菜单项标识：只用于 React key 与语义命名，子菜单渲染哪种内容视图由 view 决定 */
type ContextPickerKey = 'notebook' | 'note' | 'article' | 'project'

interface ContextEntry {
    key: ContextPickerKey
    label: string
    icon: JSX.Element
    /** 子菜单的内容视图 */
    view: AiContextPickerView
}

/** 一级菜单项：顺序即展示顺序，view 决定子菜单渲染哪一种内容 */
const CONTENT_ENTRIES: readonly ContextEntry[] = [
    {
        key: 'notebook',
        label: '选择笔记本',
        icon: <Library className={CONTEXT_ICON_CLASS} />,
        view: { mode: 'source', scope: 'notebook' },
    },
    {
        key: 'note',
        label: '选择笔记',
        icon: <FileText className={CONTEXT_ICON_CLASS} />,
        view: { mode: 'items', target: { kind: 'note' } },
    },
    {
        key: 'article',
        label: '选择文章',
        icon: <Newspaper className={CONTEXT_ICON_CLASS} />,
        view: { mode: 'items', target: { kind: 'article' } },
    },
    {
        key: 'project',
        label: '选择作品',
        icon: <Package className={CONTEXT_ICON_CLASS} />,
        view: { mode: 'source', scope: 'project' },
    },
]

/** 全部来源入口的入参：外壳只回传回调，入口清单与图标都在本模块维护 */
type AiChatContextSourceMenuProps = AiChatContextSubMenuCallbacks

/** 四个来源入口一次渲染：外壳只决定它们落在哪张菜单里 */
export function AiChatContextSourceMenu({
    scope,
    onClose,
    onAdded,
    onError,
    onPickProject,
}: AiChatContextSourceMenuProps): JSX.Element {
    return (
        <>
            {CONTENT_ENTRIES.map((entry) => (
                <AiChatContextSourceSubMenuEntry
                    key={entry.key}
                    label={entry.label}
                    icon={entry.icon}
                    view={entry.view}
                    scope={scope}
                    onClose={onClose}
                    onAdded={onAdded}
                    onError={onError}
                    onPickProject={onPickProject}
                />
            ))}
        </>
    )
}
