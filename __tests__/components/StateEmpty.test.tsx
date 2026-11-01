// @vitest-environment jsdom
/**
 * StateEmpty 渲染用例：覆盖空态、加载态、说明可选、图标位与底部操作区插槽。
 * 复用约定：渲染与查询走 @testing-library/react；jsdom 环境由本文件首行指令声明。
 * 关键约束：加载态与空态互斥——isLoading 为真时不得再出现标题与说明，
 * 否则「还没有数据」会被读屏与用户在读取过程中同时看到，本用例守住这条。
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StateEmpty } from '@webview/components/StateEmpty'
import type { ReactNode } from 'react'

afterEach(cleanup)

function EmptyIcon({ className }: { className?: string }): ReactNode {
    return <span data-testid="empty-icon" className={className} />
}

describe('StateEmpty', () => {
    it('空态渲染标题与说明', () => {
        render(<StateEmpty title="还没有快照" description="保存后会自动留版" />)

        expect(screen.getByText('还没有快照')).toBeDefined()
        expect(screen.getByText('保存后会自动留版')).toBeDefined()
    })

    it('说明省略时不渲染说明节点', () => {
        render(<StateEmpty title="还没有快照" />)

        expect(screen.getByText('还没有快照')).toBeDefined()
        expect(screen.queryByText('保存后会自动留版')).toBeNull()
    })

    it('加载态只渲染加载文案，不同时展示标题与说明', () => {
        render(<StateEmpty title="还没有快照" description="保存后会自动留版" isLoading />)

        expect(screen.getByText('正在读取…')).toBeDefined()
        expect(screen.queryByText('还没有快照')).toBeNull()
        expect(screen.queryByText('保存后会自动留版')).toBeNull()
    })

    it('loadingLabel 覆盖默认加载文案', () => {
        render(<StateEmpty title="还没有快照" isLoading loadingLabel="正在读取快照…" />)

        expect(screen.getByText('正在读取快照…')).toBeDefined()
        expect(screen.queryByText('正在读取…')).toBeNull()
    })

    it('提供了 icon 时渲染图标位，加载态不渲染业务图标', () => {
        const { unmount } = render(<StateEmpty title="还没有快照" icon={EmptyIcon} />)
        expect(screen.getByTestId('empty-icon')).toBeDefined()
        unmount()

        render(<StateEmpty title="还没有快照" icon={EmptyIcon} isLoading />)
        expect(screen.queryByTestId('empty-icon')).toBeNull()
    })

    it('传了 children 时渲染底部操作区', () => {
        render(
            <StateEmpty title="还没有快照">
                <button type="button">立即快照</button>
            </StateEmpty>,
        )

        expect(screen.getByRole('button', { name: '立即快照' })).toBeDefined()
    })

    it('未传 children 时不渲染操作区', () => {
        render(<StateEmpty title="还没有快照" />)

        expect(screen.queryByRole('button')).toBeNull()
    })
})
