/**
 * 标注扩展：把划线装饰插件注册进编辑器 schema，使其随编辑器实例创建与销毁。
 * 复用约定：插件实现见 annotationDecorations，本文件只做 Tiptap 包装，不含业务逻辑。
 * 关键约束：必须由 useEditor 的 extensions 注册——只从外部 dispatch 事务时插件并不存在，
 * 装饰不会生效且不会有任何报错，属于难排查的静默失效。
 */
import { Extension } from '@tiptap/core'
import { createAnnotationPlugin } from './annotationDecorations'
import type { Plugin } from '@tiptap/pm/state'

export const AnnotationExtension = Extension.create({
    name: 'zhaiAnnotation',

    addProseMirrorPlugins(): Plugin[] {
        return [createAnnotationPlugin()]
    },
})
