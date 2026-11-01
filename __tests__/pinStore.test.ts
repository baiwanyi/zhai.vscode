/**
 * pinStore 单元测试：覆盖置顶列表的读取、幂等置顶、顺序规则与非法数据兜底。
 * 用内存 Memento 桩承接 globalState 依赖，断言以 store 返回的列表为准。
 */
import { describe, expect, it } from 'vitest'
import type { Memento } from 'vscode'
import { PinStore } from '../src/modules/note/pinStore'

/** 置顶键名：与实现约定一致，供预置已落盘数据使用 */
const PINNED_KEY = 'zhai.note.pinnedPaths'

/** 构造内存 Memento 桩与置顶存储：entries 暴露原始存储供断言 */
function createStore(initial?: unknown): { store: PinStore; entries: Map<string, unknown> } {
    const entries = new Map<string, unknown>()
    if (initial !== undefined) {
        entries.set(PINNED_KEY, initial)
    }
    const memento: Memento = {
        keys: (): readonly string[] => [...entries.keys()],
        get<T>(key: string, defaultValue?: T): T {
            const value = entries.get(key)
            return (value ?? defaultValue) as T
        },
        update(key: string, value: unknown): Thenable<void> {
            entries.set(key, value)
            return Promise.resolve()
        },
    }
    return { store: new PinStore(memento), entries }
}

describe('PinStore', () => {
    it('未存储任何数据时返回空列表', () => {
        const { store } = createStore()
        expect(store.list()).toEqual([])
    })

    it('置顶多项时按传入顺序返回并落盘', async () => {
        const { store, entries } = createStore()
        const next = await store.setPinned(['notes/a.md', 'notes/b.md'], true)
        expect(next).toEqual(['notes/a.md', 'notes/b.md'])
        expect(entries.get(PINNED_KEY)).toEqual(['notes/a.md', 'notes/b.md'])
    })

    it('重复置顶同一项保持幂等且不改变既有顺序', async () => {
        const { store } = createStore()
        await store.setPinned(['notes/a.md', 'notes/b.md'], true)
        const next = await store.setPinned(['notes/a.md'], true)
        expect(next).toEqual(['notes/a.md', 'notes/b.md'])
    })

    it('新置顶项排在既有置顶项之前', async () => {
        const { store } = createStore()
        await store.setPinned(['notes/a.md'], true)
        const next = await store.setPinned(['notes/b.md'], true)
        expect(next).toEqual(['notes/b.md', 'notes/a.md'])
    })

    it('取消置顶只移除目标路径', async () => {
        const { store } = createStore()
        await store.setPinned(['notes/a.md', 'notes/b.md'], true)
        const next = await store.setPinned(['notes/a.md'], false)
        expect(next).toEqual(['notes/b.md'])
    })

    it('读取时剔除重复项与非字符串项', () => {
        const { store } = createStore(['notes/a.md', 42, 'notes/a.md', null, 'notes/b.md'])
        expect(store.list()).toEqual(['notes/a.md', 'notes/b.md'])
    })

    it('存储值被污染为非数组时返回空列表', () => {
        const { store } = createStore('notes/a.md')
        expect(store.list()).toEqual([])
    })
})
