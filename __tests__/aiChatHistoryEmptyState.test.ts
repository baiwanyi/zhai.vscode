/**
 * 历史页空态文案的单元测试：锁定三种空态的标题与描述。
 * 纯函数测试，不依赖宿主与 DOM：文案是界面可见内容，改动必须同步更新用例。
 * 重点防的是三条回归：一条记录都没有时不再引导去发起对话；过滤无结果时提示词不准确；
 * 按来源筛选无结果时丢掉筛选名（用户不知道是哪一项为空）。
 */
import { describe, expect, it } from 'vitest'
import type { AiConversationSummary } from '../src/shared/types/aiChat'
import { describeHistoryEmptyState } from '../src/workflow/aichat/history/utils/emptyState'

/** 构造会话摘要：只写用例关心的字段 */
function createSession(overrides: Partial<AiConversationSummary> = {}): AiConversationSummary {
    return {
        id: 'conv-1',
        title: '会话',
        updatedAt: '2026-11-23T00:00:00.000Z',
        scopeKind: null,
        scopeLabel: '通用对话',
        scopeKey: null,
        ...overrides,
    }
}

describe('describeHistoryEmptyState', () => {
    it('一条记录都没有时引导去发起对话', () => {
        expect(describeHistoryEmptyState({ sessions: [], keyword: '', kindFilter: undefined, mode: 'scope' })).toEqual({
            title: '暂无历史对话',
            description: '在当前对象里发起一次对话后，这里会留下记录；需要找其它对象的记录可切到「全部」。',
        })
    })

    it('过滤无结果时提示换关键词', () => {
        const sessions = [createSession()]
        expect(describeHistoryEmptyState({ sessions, keyword: '不存在', kindFilter: undefined, mode: 'all' })).toEqual({
            title: '没有匹配的对话',
            description: '换个关键词再试，或清空过滤条件。',
        })
    })

    it('按来源筛选无结果时带筛选名提示', () => {
        const sessions = [createSession()]
        expect(describeHistoryEmptyState({ sessions, keyword: '', kindFilter: 'press', mode: 'press' })).toEqual({
            title: '「作品」下还没有会话',
            description: '该来源在最近 50 条会话里没有记录，可切到「全部」再看一次。',
        })
    })

    it('范围筛选无结果时用通用标题，不冒充某个来源', () => {
        const sessions = [createSession()]
        expect(describeHistoryEmptyState({ sessions, keyword: '', kindFilter: undefined, mode: 'all' })).toEqual({
            title: '暂无历史对话',
            description: '该来源在最近 50 条会话里没有记录，可切到「全部」再看一次。',
        })
    })
})
