// @vitest-environment jsdom
/**
 * WeiboLink 激活链路用例：主页链接走页内回调，其余链接仍交宿主打开。
 * 复用约定：jsdom + @testing-library/react，bridge.request 与 toastError 以替身接管；
 * Provider 用真实的 WeiboUserPageProvider，断言的是「链接到回调」这一段接线。
 * 关键约束：链接不能带 href（webview 会把 href 交给系统浏览器），因此点击不产生默认导航；
 * 未挂 Provider 时必须退回 weibo/openPost，不能因为缺少上下文丢掉动作。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WeiboLink } from '@webview/weibo/block/WeiboRichText'
import { WeiboUserPageProvider } from '@webview/weibo/context/WeiboUserPageProvider'

/** 请求替身：调用方会接 `.catch`，一定要回 Promise */
const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn(() => Promise.resolve(undefined)) }))

vi.mock('@shared/utils/bridge', () => ({ request: requestMock }))
vi.mock('@shared/utils/error', () => ({ toastError: vi.fn() }))

afterEach(() => {
    cleanup()
    vi.clearAllMocks()
})

/** 包一层 Provider：openUser 见调用即记录 */
function renderWithProvider(url: string, openUser: (target: unknown) => void): void {
    render(
        <WeiboUserPageProvider openUser={openUser}>
            <WeiboLink text="@2129704452" url={url} />
        </WeiboUserPageProvider>,
    )
}

describe('WeiboLink 激活链路', () => {
    it('主页链接交给页内导航，不发宿主请求', () => {
        const openUser = vi.fn()
        renderWithProvider('https://weibo.com/u/2129704452', openUser)

        fireEvent.click(screen.getByRole('link', { name: '@2129704452' }))

        expect(openUser).toHaveBeenCalledWith({ kind: 'uid', value: '2129704452' })
        expect(requestMock).not.toHaveBeenCalled()
    })

    it('主页短形式与昵称形式同样命中页内导航', () => {
        const openUser = vi.fn()
        renderWithProvider('https://weibo.com/2129704452', openUser)
        fireEvent.click(screen.getByRole('link'))
        expect(openUser).toHaveBeenCalledWith({ kind: 'uid', value: '2129704452' })

        cleanup()
        renderWithProvider('https://weibo.com/n/%E5%B0%8F%E5%A4%AA%E9%98%B3', openUser)
        fireEvent.click(screen.getByRole('link'))
        expect(openUser).toHaveBeenCalledWith({ kind: 'name', value: '小太阳' })
    })

    it('回车与空格与点击等价', () => {
        const openUser = vi.fn()
        renderWithProvider('https://weibo.com/u/2129704452', openUser)

        fireEvent.keyDown(screen.getByRole('link'), { key: 'Enter' })
        fireEvent.keyDown(screen.getByRole('link'), { key: ' ' })

        expect(openUser).toHaveBeenCalledTimes(2)
    })

    it('非主页链接仍走宿主 openPost', () => {
        const openUser = vi.fn()
        renderWithProvider('https://s.weibo.com/weibo?q=%E8%AF%9D%E9%A2%98', openUser)

        fireEvent.click(screen.getByRole('link'))

        expect(openUser).not.toHaveBeenCalled()
        expect(requestMock).toHaveBeenCalledWith('weibo/openPost', {
            url: 'https://s.weibo.com/weibo?q=%E8%AF%9D%E9%A2%98',
        })
    })

    it('链接不带 href，未挂 Provider 时退回宿主打开', () => {
        render(<WeiboLink text="@2129704452" url="https://weibo.com/u/2129704452" />)

        expect(screen.getByRole('link').getAttribute('href')).toBeNull()
        fireEvent.click(screen.getByRole('link'))
        expect(requestMock).toHaveBeenCalledWith('weibo/openPost', { url: 'https://weibo.com/u/2129704452' })
    })
})
