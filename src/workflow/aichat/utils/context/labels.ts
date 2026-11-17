/**
 * 上下文分类的中文口径：内容分类（kind）与来源分类（scope）两套文案，以及按视图取类别名的纯函数。
 * 复用约定：菜单行类别名、检索行的「最近 X」提示、空态文案与作品面板页签共用这里的映射；
 * 视图类型取同目录 types 的 AiContextPickerView，本文件不引入组件、不发起请求。
 * 关键约束：提及检索的 AiMentionKind 是另一套口径（article 叫「公众号文章」），不要与本映射合并。
 */
import type { AiContextItemKind, AiContextSourceScope } from '@shared/types/aiChat'
import type { AiContextPickerView } from './types'

/** 内容分类名：候选视图的类别名与「最近 X」提示共用 */
export const CONTEXT_KIND_LABELS: Readonly<Record<AiContextItemKind, string>> = {
    note: '笔记',
    article: '文章',
    chapter: '章节',
    character: '人物',
    outline: '大纲',
    setting: '设定',
}

/** 来源分类名：来源视图的类别名与「还没有 X」空态文案共用 */
export const CONTEXT_SCOPE_LABELS: Readonly<Record<AiContextSourceScope, string>> = {
    notebook: '笔记本',
    account: '公众号',
    project: '作品',
}

/** 入口类别名：来源视图看 scope，候选视图看 kind */
export function contextKindLabelOf(view: AiContextPickerView): string {
    if (view.mode === 'source') {
        return CONTEXT_SCOPE_LABELS[view.scope]
    }
    return CONTEXT_KIND_LABELS[view.target.kind]
}

/** 候选检索的占位文案：文章明确到标题，其余统一说「标题」 */
export function contextSearchPlaceholderOf(kind: AiContextItemKind): string {
    return kind === 'article' ? '搜索文章标题' : '搜索标题'
}
