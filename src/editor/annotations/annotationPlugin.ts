/**
 * 标注装饰插件：把 DecorationSet 挂到 ProseMirror 插件状态上，并提供唯一的写入入口。
 * 复用约定：标注变化时用事务 meta 整体替换装饰，其余事务按 mapping 跟随文档编辑；
 * 写入统一走 applyDecorationSet，别处不再手写 setMeta + dispatch。
 * 关键约束：必须由 useEditor 的 extensions 注册（见 annotationExtension）——只从外部 dispatch 事务时
 * 插件并不存在，装饰不会生效也不会有任何报错，属于难排查的静默失效；
 * 写入必须 setMeta('addToHistory', false)，标注是视图层信息，不能污染撤销栈；
 * key 与装饰构建共用同一实例，改名会同时让读取与写入落空。
 */
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { DecorationSet } from '@tiptap/pm/view'
import type { EditorState } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'

/** 装饰插件键：事务 meta 与状态读取共用 */
export const annotationPluginKey = new PluginKey<DecorationSet>('zhai-annotation-decorations')

/** 装饰插件：初始为空，收到 meta 整体替换，否则按编辑映射跟随 */
export function createAnnotationPlugin(): Plugin<DecorationSet> {
    return new Plugin<DecorationSet>({
        key: annotationPluginKey,
        state: {
            init: (): DecorationSet => DecorationSet.empty,
            apply: (transaction, previous): DecorationSet => {
                const next: unknown = transaction.getMeta(annotationPluginKey)
                if (next instanceof DecorationSet) {
                    return next
                }
                return previous.map(transaction.mapping, transaction.doc)
            },
        },
        props: {
            decorations: (state: EditorState): DecorationSet =>
                annotationPluginKey.getState(state) ?? DecorationSet.empty,
        },
    })
}

/** 把一份装饰整体投到编辑器：不写历史，也不触发内容变更回调 */
export function applyDecorationSet(editor: Editor, set: DecorationSet): void {
    const transaction = editor.state.tr.setMeta(annotationPluginKey, set).setMeta('addToHistory', false)
    editor.view.dispatch(transaction)
}
