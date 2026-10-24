/**
 * Webview 共享纯函数单测：覆盖时间格式化、token 折算、错误文案收窄与剪贴板写入四项能力。
 * 重点验证：时间解析失败返回空串（回退文案由调用方决定，快照层再回退原值）、token 的两级折算单位、
 * Error 与非 Error 的错误文案收窄，以及剪贴板不可用时返回 false 而不是抛错。
 * 约束：只测不依赖 React 的纯函数；组件交互需要 jsdom 与 testing-library，另行决策后再补。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyToClipboard, formatDateTime, formatRelativeTime, formatTokens, toErrorText } from '../src/webview/utils'

// utils 顶层引入了 sonner（依赖 React 与浏览器环境），node 环境下用空实现替换，只保留被测纯函数
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('formatDateTime', () => {
    it('合法时间格式化为本地年月日时分', () => {
        const value = new Date(2026, 9, 24, 8, 5).toISOString()
        expect(formatDateTime(value)).toBe('2026-10-24 08:05')
    })

    it('非法时间返回空串', () => {
        expect(formatDateTime('not-a-date')).toBe('')
    })
})

describe('formatTokens', () => {
    it('不足一千原样返回', () => {
        expect(formatTokens(999)).toBe('999')
    })

    it('过千折算为 k 并保留一位小数', () => {
        expect(formatTokens(1500)).toBe('1.5k')
    })

    it('过百万折算为 M', () => {
        expect(formatTokens(2_400_000)).toBe('2.4M')
    })
})

describe('toErrorText', () => {
    it('Error 取 message', () => {
        expect(toErrorText(new Error('宿主返回未知错误'))).toBe('宿主返回未知错误')
    })

    it('字符串原样返回', () => {
        expect(toErrorText('请求超时')).toBe('请求超时')
    })

    it('普通对象转字符串', () => {
        expect(toErrorText({ code: 1 })).toBe('[object Object]')
    })
})

describe('formatRelativeTime', () => {
    it('无效时间返回空串', () => {
        expect(formatRelativeTime('invalid')).toBe('')
    })

    it('十秒内显示刚刚', () => {
        expect(formatRelativeTime(new Date().toISOString())).toBe('刚刚')
    })
})

describe('copyToClipboard', () => {
    it('剪贴板不可用时返回 false 而不抛错', async () => {
        await expect(copyToClipboard('文本')).resolves.toBe(false)
    })

    it('写入成功返回 true', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined)
        vi.stubGlobal('navigator', { clipboard: { writeText } })
        await expect(copyToClipboard('文本')).resolves.toBe(true)
        expect(writeText).toHaveBeenCalledWith('文本')
    })
})
