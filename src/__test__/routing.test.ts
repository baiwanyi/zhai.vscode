/**
 * 工作流路由规则单测：覆盖模块映射、入口意图、笔记编辑场景、用户覆盖与兜底五类分支。
 * 复用 vitest；用例只依赖纯函数与共享类型，不加载组件，也不触碰宿主环境。
 */
import { describe, expect, it } from 'vitest'
import type { WorkflowContextState } from '@/shared/types/workflow'
import { resolveWorkflow } from '../webview/workflow/routing'

/** 构造路由事实：仅覆盖用例关心的字段 */
function buildContext(patch: Partial<WorkflowContextState>): WorkflowContextState {
    return { scene: 'idle', module: 'root', requestedModule: null, ...patch }
}

describe('resolveWorkflow', () => {
    it('写作管理模块场景复用现有 AI 对话页', () => {
        const result = resolveWorkflow({
            context: buildContext({ scene: 'module', module: 'press' }),
            override: null,
        })
        expect(result).toEqual({ workflowId: 'chat', reason: 'module' })
    })

    it('公众号管理模块场景进入占位页', () => {
        const result = resolveWorkflow({
            context: buildContext({ scene: 'module', module: 'wechat' }),
            override: null,
        })
        expect(result).toEqual({ workflowId: 'placeholder', reason: 'module' })
    })

    it('笔记编辑场景进入占位页，且优先于模块兜底', () => {
        const result = resolveWorkflow({
            context: buildContext({ scene: 'editorNote', module: 'notes' }),
            override: null,
        })
        expect(result).toEqual({ workflowId: 'placeholder', reason: 'scene' })
    })

    it('入口显式意图优先于笔记编辑场景', () => {
        const result = resolveWorkflow({
            context: buildContext({ scene: 'editorNote', module: 'notes', requestedModule: 'press' }),
            override: null,
        })
        expect(result).toEqual({ workflowId: 'chat', reason: 'requested' })
    })

    it('入口意图指向公众号管理时进入占位页', () => {
        const result = resolveWorkflow({
            context: buildContext({ scene: 'idle', module: 'notes', requestedModule: 'wechat' }),
            override: null,
        })
        expect(result).toEqual({ workflowId: 'placeholder', reason: 'requested' })
    })

    it('用户覆盖优先于模块与场景映射', () => {
        const result = resolveWorkflow({
            context: buildContext({ scene: 'editorNote', module: 'notes' }),
            override: 'chat',
        })
        expect(result).toEqual({ workflowId: 'chat', reason: 'override' })
    })

    it('未登记模块且无场景时回落到 AI 对话页', () => {
        const result = resolveWorkflow({
            context: buildContext({ scene: 'idle', module: 'reader' }),
            override: null,
        })
        expect(result).toEqual({ workflowId: 'chat', reason: 'fallback' })
    })

    it('入口意图指向未登记模块时忽略意图并继续回落', () => {
        const result = resolveWorkflow({
            context: buildContext({ scene: 'idle', module: 'root', requestedModule: 'unknown-module' }),
            override: null,
        })
        expect(result).toEqual({ workflowId: 'chat', reason: 'fallback' })
    })
})
