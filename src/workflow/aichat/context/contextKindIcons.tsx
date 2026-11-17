/**
 * 上下文分类的图标：内容分类（kind）与来源分类（scope）各一张只读映射，供列表行与子菜单共用。
 * 复用约定：图标取 lucide-react，尺寸与配色取 ../utils/context/styles 的 CONTEXT_ICON_CLASS，与 WorkflowNav 同源。
 * 关键约束：模块级 JSX 元素实例被多处共享，调用方不得向其注入按行变化的 props；
 * 行内还需要额外状态（如选中态）时在行组件里叠加，不要改这张表。
 */
import { BookOpen, FileText, Globe, Library, ListTree, MessageSquare, Newspaper, Package, Users } from 'lucide-react'
import type { AiContextItemKind, AiContextSourceScope } from '@shared/types/aiChat'
import type { JSX } from 'react'
import { CONTEXT_ICON_CLASS } from '../utils/context/styles'

/** 候选行图标：按 kind 取，与导航栏、入口菜单同一套意象 */
export const CONTEXT_KIND_ICONS: Readonly<Record<AiContextItemKind, JSX.Element>> = {
    note: <FileText className={CONTEXT_ICON_CLASS} />,
    article: <Newspaper className={CONTEXT_ICON_CLASS} />,
    chapter: <BookOpen className={CONTEXT_ICON_CLASS} />,
    character: <Users className={CONTEXT_ICON_CLASS} />,
    outline: <ListTree className={CONTEXT_ICON_CLASS} />,
    setting: <Globe className={CONTEXT_ICON_CLASS} />,
}

/** 来源行图标：整本来源按 scope 取，与一级菜单同源 */
export const CONTEXT_SCOPE_ICONS: Readonly<Record<AiContextSourceScope, JSX.Element>> = {
    notebook: <Library className={CONTEXT_ICON_CLASS} />,
    account: <MessageSquare className={CONTEXT_ICON_CLASS} />,
    project: <Package className={CONTEXT_ICON_CLASS} />,
}
