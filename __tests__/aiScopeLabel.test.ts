/**
 * 会话来源标签的单元测试：锁定「作用域键 → 类型 + 展示名」的映射口径。
 * 纯函数测试，不依赖宿主：标签只按路径段派生，任何脏值都必须兜底成「通用对话」而不是抛错。
 * 重点防的是三条回归：作品被按章路径拆开（旧版存量）后标签丢失作品名；
 * 笔记展示名带 .md 后缀；未知 / 非法作用域让整个历史列表渲染失败。
 */
import { describe, expect, it } from 'vitest'
import { readScopeLabel } from '../src/modules/ai/scopeLabel'

describe('readScopeLabel', () => {
    it('作品目录取作品名，旧版按章路径同样取作品名', () => {
        expect(readScopeLabel('press/剑来')).toEqual({ kind: 'press', label: '剑来' })
        expect(readScopeLabel('press/剑来/第一章.md')).toEqual({ kind: 'press', label: '剑来' })
    })

    it('笔记取文件名并去掉扩展名', () => {
        expect(readScopeLabel('notes/随手记.md')).toEqual({ kind: 'note', label: '随手记' })
    })

    it('公众号取账号目录名（appid）', () => {
        expect(readScopeLabel('wechat/wx1234567890')).toEqual({ kind: 'wechat', label: 'wx1234567890' })
    })

    it('微博固定为模块名', () => {
        expect(readScopeLabel('weibo')).toEqual({ kind: 'weibo', label: '微博' })
    })

    it('通用对话与未知前缀都回落通用对话', () => {
        expect(readScopeLabel(null)).toEqual({ kind: null, label: '通用对话' })
        expect(readScopeLabel('other/x')).toEqual({ kind: null, label: '通用对话' })
        expect(readScopeLabel('root')).toEqual({ kind: null, label: '通用对话' })
    })

    it('非法路径不抛错，按通用对话兜底', () => {
        expect(readScopeLabel('notes/../etc.md')).toEqual({ kind: null, label: '通用对话' })
        expect(readScopeLabel('d:/notes/a.md')).toEqual({ kind: null, label: '通用对话' })
    })
})
