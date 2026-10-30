/**
 * 工作流内容归属的单元测试：覆盖公众号「选模块」判定、作用域回落与专属分区清单。
 * 纯函数测试，不依赖宿主：归属、作用域与可用分区必须由同一处推导，测试即锁定这套口径。
 * 重点防的是两条回归：公众号在「选了模块但没打开该模块文档」时丢失归属；
 * 公众号对话作用域回落到 root，与管理面板共用同一个作用域。
 */
import { describe, expect, it } from 'vitest'
import type { WorkflowContextState } from '../../src/shared/types/workflow'
import {
    readAvailableSections,
    readContentScope,
    readScopeDir,
    RESIDENT_SECTIONS,
    SCOPE_SECTIONS,
    WECHAT_MODULE_KEY,
} from '../../src/workflow/layout/contentScope'

/** 构造路由事实：只写用例关心的字段 */
function context(partial: Partial<WorkflowContextState>): WorkflowContextState {
    return { scene: 'editorNote', module: 'root', selectedModule: null, projectDir: null, ...partial }
}

describe('readContentScope', () => {
    it('笔记目录优先判为笔记归属', () => {
        expect(readContentScope(context({ module: 'notes' }))).toBe('note')
    })

    it('wechat 目录判为公众号归属', () => {
        expect(readContentScope(context({ module: WECHAT_MODULE_KEY }))).toBe('wechat')
    })

    it('仅选了公众号模块（文档仍在 root）也判为公众号归属', () => {
        expect(readContentScope(context({ module: 'root', selectedModule: WECHAT_MODULE_KEY }))).toBe('wechat')
    })

    it('打开了作品目录时判为作品归属', () => {
        expect(readContentScope(context({ module: 'root', projectDir: 'press/剑来' }))).toBe('press')
    })

    it('笔记判定优先于作品：作品内打开笔记不会误判成作品归属', () => {
        expect(readContentScope(context({ module: 'notes', projectDir: 'press/剑来' }))).toBe('note')
    })

    it('两类事实都为空时不归属任何模块', () => {
        expect(readContentScope(context({}))).toBeNull()
    })
})

describe('readScopeDir', () => {
    it('作品取 projectDir', () => {
        const state = context({ projectDir: 'press/剑来' })
        expect(readScopeDir(state, 'press')).toBe('press/剑来')
    })

    it('公众号在选模块场景回落到模块键，而不是沿用 root', () => {
        const state = context({ module: 'root', selectedModule: WECHAT_MODULE_KEY })
        expect(readScopeDir(state, 'wechat')).toBe(WECHAT_MODULE_KEY)
    })

    it('公众号在该目录文档下沿用模块键', () => {
        const state = context({ module: WECHAT_MODULE_KEY })
        expect(readScopeDir(state, 'wechat')).toBe(WECHAT_MODULE_KEY)
    })

    it('无归属时没有作用域目录', () => {
        expect(readScopeDir(context({}), null)).toBeNull()
    })
})

describe('分区清单', () => {
    it('公众号专属分区为六项运营页', () => {
        expect(SCOPE_SECTIONS.wechat).toEqual(['menu', 'material', 'stats', 'comment', 'fans', 'push'])
    })

    it('公众号归属下可用分区 = 常驻 + 六个专属', () => {
        const available = readAvailableSections('wechat')
        expect(available).toHaveLength(RESIDENT_SECTIONS.length + SCOPE_SECTIONS.wechat.length)
        expect(available).toContain('push')
        expect(available).not.toContain('setting')
    })

    it('无归属时只有常驻分区', () => {
        expect(readAvailableSections(null)).toEqual(RESIDENT_SECTIONS)
    })
})
