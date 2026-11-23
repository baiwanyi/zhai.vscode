/**
 * 工作流内容归属的单元测试：覆盖公众号「选模块」判定、对话作用域粒度与专属分区清单。
 * 纯函数测试，不依赖宿主：归属、作用域与可用分区必须由同一处推导，测试即锁定这套口径。
 * 重点防的是四条回归：公众号在「选了模块但没打开该模块文档」时丢失归属；
 * 公众号对话作用域回落到 root，与管理面板共用同一个作用域；
 * 笔记的会话作用域退回模块目录，导致同一目录下所有笔记共用一份对话；
 * 作品与公众号账号被按文档 / 批次拆分，导致同一作品换章、同一账号换批次就断掉上下文。
 */
import { describe, expect, it } from 'vitest'
import type { WorkflowContextState } from '../src/shared/types/workflow'
import {
    readAvailableSections,
    readContentScope,
    readScopeDir,
    RESIDENT_SECTIONS,
    SCOPE_SECTIONS,
    WECHAT_MODULE_KEY,
    WEIBO_MODULE_KEY,
} from '../src/workflow/layout/contentScope'

/** 构造路由事实：只写用例关心的字段 */
function context(partial: Partial<WorkflowContextState>): WorkflowContextState {
    return {
        scene: 'editorNote',
        module: 'root',
        selectedModule: null,
        projectDir: null,
        docPath: null,
        isMarkdown: true,
        ...partial,
    }
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

    it('宿主下发微博模块时判为微博归属（面板标签在前台）', () => {
        expect(readContentScope(context({ module: WEIBO_MODULE_KEY }))).toBe('weibo')
    })

    it('微博归属优先于背后保留的笔记文档事实', () => {
        expect(readContentScope(context({ module: WEIBO_MODULE_KEY, docPath: 'notes/甲.md' }))).toBe('weibo')
    })

    it('切回编辑器后模块回到文档归属，微博不再命中', () => {
        expect(readContentScope(context({ module: 'notes', docPath: 'notes/甲.md' }))).toBe('note')
    })
})

describe('readScopeDir', () => {
    it('作品内换章不切作用域：整个作品共用一份对话', () => {
        const first = context({ module: 'press', projectDir: 'press/剑来', docPath: 'press/剑来/第一章.md' })
        const second = context({ module: 'press', projectDir: 'press/剑来', docPath: 'press/剑来/第二章.md' })
        expect(readScopeDir(first, 'press')).toBe('press/剑来')
        expect(readScopeDir(second, 'press')).toBe('press/剑来')
    })

    it('作品内未定位到文档时同样取作品目录', () => {
        const state = context({ module: 'press', projectDir: 'press/剑来' })
        expect(readScopeDir(state, 'press')).toBe('press/剑来')
    })

    it('公众号按账号聚合：同账号内不同批次、不同文章共用一份对话', () => {
        const first = context({
            module: WECHAT_MODULE_KEY,
            docPath: 'wechat/wx1234567890/post/202611021530/第一篇.md',
        })
        const second = context({
            module: WECHAT_MODULE_KEY,
            docPath: 'wechat/wx1234567890/post/202611022030/第二篇.md',
        })
        expect(readScopeDir(first, 'wechat')).toBe('wechat/wx1234567890')
        expect(readScopeDir(second, 'wechat')).toBe('wechat/wx1234567890')
    })

    it('不同账号各不相同', () => {
        const left = context({ module: WECHAT_MODULE_KEY, docPath: 'wechat/wx1234567890/post/202611021530/篇.md' })
        const right = context({ module: WECHAT_MODULE_KEY, docPath: 'wechat/wx0987654321/post/202611021530/篇.md' })
        expect(readScopeDir(left, 'wechat')).not.toBe(readScopeDir(right, 'wechat'))
    })

    it('账号目录下的账号级文档同样归到该账号', () => {
        const state = context({ module: WECHAT_MODULE_KEY, docPath: 'wechat/wx1234567890/账号说明.md' })
        expect(readScopeDir(state, 'wechat')).toBe('wechat/wx1234567890')
    })

    it('不在账号目录下的文档回落到模块键', () => {
        const state = context({ module: WECHAT_MODULE_KEY, docPath: 'wechat/临时笔记.md' })
        expect(readScopeDir(state, 'wechat')).toBe(WECHAT_MODULE_KEY)
    })

    it('公众号在选模块场景回落到模块键，而不是沿用 root', () => {
        const state = context({ module: 'root', selectedModule: WECHAT_MODULE_KEY })
        expect(readScopeDir(state, 'wechat')).toBe(WECHAT_MODULE_KEY)
    })

    it('公众号在该目录文档下、无文档路径时沿用模块键', () => {
        const state = context({ module: WECHAT_MODULE_KEY })
        expect(readScopeDir(state, 'wechat')).toBe(WECHAT_MODULE_KEY)
    })

    it('选了公众号模块但停在归属外的文档时，不把对话绑到那份文档上', () => {
        const state = context({ module: 'root', selectedModule: WECHAT_MODULE_KEY, docPath: '随手记.md' })
        expect(readScopeDir(state, 'wechat')).toBe(WECHAT_MODULE_KEY)
    })

    it('笔记按文档路径隔离：同一目录下的不同笔记各用一个作用域', () => {
        const first = context({ module: 'notes', docPath: 'notes/甲.md' })
        const second = context({ module: 'notes', docPath: 'notes/乙.md' })
        expect(readScopeDir(first, 'note')).toBe('notes/甲.md')
        expect(readScopeDir(second, 'note')).toBe('notes/乙.md')
    })

    it('笔记没有活跃文档时回落到模块目录', () => {
        expect(readScopeDir(context({ module: 'notes' }), 'note')).toBe('notes')
    })

    it('无归属时没有作用域目录', () => {
        expect(readScopeDir(context({}), null)).toBeNull()
    })

    it('微博作用域固定为模块键，不绑到背后保留的文档', () => {
        const state = context({ module: WEIBO_MODULE_KEY, docPath: 'notes/甲.md' })
        expect(readScopeDir(state, 'weibo')).toBe(WEIBO_MODULE_KEY)
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

    it('微博没有专属分区，可用分区即常驻分区', () => {
        expect(SCOPE_SECTIONS.weibo).toEqual([])
        expect(readAvailableSections('weibo')).toEqual(RESIDENT_SECTIONS)
    })
})
