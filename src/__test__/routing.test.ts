/**
 * 工作流路由规则单测：覆盖模块页分流、模块选定、笔记编辑场景、未接入模块占位、初始页回落与用户覆盖。
 * 复用 vitest；用例只依赖纯函数与共享类型，不加载组件，也不触碰宿主环境。
 */
import { describe, expect, it } from 'vitest'
import type { WorkflowContextState } from '@shared/types/workflow'
import { readModuleLabel, resolveWorkflow } from '../webview/workflow/core/routing'

/** 构造路由事实：仅覆盖用例关心的字段 */
function buildContext(patch: Partial<WorkflowContextState>): WorkflowContextState {
    return { scene: 'idle', module: 'root', selectedModule: null, projectDir: null, ...patch }
}

describe('resolveWorkflow', () => {
    it('未选定模块且无编辑器时落到初始页', () => {
        expect(resolveWorkflow({ context: buildContext({}), override: null })).toEqual({
            workflowId: 'home',
            reason: 'scene',
        })
    })

    it('选定写作管理后进入写作管理页', () => {
        expect(resolveWorkflow({ context: buildContext({ selectedModule: 'press' }), override: null })).toEqual({
            workflowId: 'press',
            reason: 'selected',
        })
    })

    it('选定公众号管理后进入公众号管理页', () => {
        expect(resolveWorkflow({ context: buildContext({ selectedModule: 'wechat' }), override: null })).toEqual({
            workflowId: 'wechat',
            reason: 'selected',
        })
    })

    it('选定笔记后进入笔记页', () => {
        expect(resolveWorkflow({ context: buildContext({ selectedModule: 'notes' }), override: null })).toEqual({
            workflowId: 'note',
            reason: 'selected',
        })
    })

    it('选定未登记模块时进入占位页', () => {
        expect(resolveWorkflow({ context: buildContext({ selectedModule: 'reader' }), override: null })).toEqual({
            workflowId: 'placeholder',
            reason: 'selected',
        })
    })

    it('模块选定优先于笔记编辑场景', () => {
        expect(
            resolveWorkflow({
                context: buildContext({ scene: 'editorNote', module: 'notes', selectedModule: 'press' }),
                override: null,
            }),
        ).toEqual({ workflowId: 'press', reason: 'selected' })
    })

    it('未选定模块时笔记编辑场景进入笔记页', () => {
        expect(
            resolveWorkflow({ context: buildContext({ scene: 'editorNote', module: 'notes' }), override: null }),
        ).toEqual({ workflowId: 'note', reason: 'scene' })
    })

    it('未选定模块时聚焦写作管理文档进入写作管理页', () => {
        expect(resolveWorkflow({ context: buildContext({ module: 'press' }), override: null })).toEqual({
            workflowId: 'press',
            reason: 'module',
        })
    })

    it('未选定模块时聚焦笔记目录文档进入笔记页', () => {
        expect(resolveWorkflow({ context: buildContext({ module: 'notes' }), override: null })).toEqual({
            workflowId: 'note',
            reason: 'module',
        })
    })

    it('未选定模块时未被认领的模块目录进入占位页', () => {
        expect(resolveWorkflow({ context: buildContext({ module: 'reader' }), override: null })).toEqual({
            workflowId: 'placeholder',
            reason: 'module',
        })
    })

    it('用户覆盖优先于模块选定与场景', () => {
        expect(
            resolveWorkflow({
                context: buildContext({ scene: 'editorNote', module: 'notes', selectedModule: 'wechat' }),
                override: 'press',
            }),
        ).toEqual({ workflowId: 'press', reason: 'override' })
    })
})

describe('readModuleLabel', () => {
    it('已知模块返回中文标题', () => {
        expect(readModuleLabel('press')).toBe('写作管理')
        expect(readModuleLabel('wechat')).toBe('公众号管理')
        expect(readModuleLabel('notes')).toBe('笔记')
    })

    it('未登记模块回退为模块键本身', () => {
        expect(readModuleLabel('unknown-dir')).toBe('unknown-dir')
    })
})
