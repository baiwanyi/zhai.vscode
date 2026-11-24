// @vitest-environment jsdom
/**
 * StateEmpty 渲染用例：覆盖空态、加载态、说明可选、图标位与底部操作区插槽。
 * 复用约定：渲染与查询走 @testing-library/react；jsdom 环境由本文件首行指令声明。
 * 关键约束：加载态与空态互斥——isLoading 为真时不渲染说明，避免空态的「还没有数据」被读屏与用户同时看到；
 * 加载态图标位：传了 icon 用业务图标，未传则是项目 logo；标题位固定为「转圈 + 文案」；
 * title 可省略，省略时不渲染标题文案节点（只有图标的留白页），本用例守住这三条。
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StateEmpty } from '@webview/blocks/StateEmpty'
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

    it('加载态以 title 为文案，不渲染说明', () => {
        render(<StateEmpty title="正在读取快照…" description="保存后会自动留版" isLoading />)

        expect(screen.getByText('正在读取快照…')).toBeDefined()
        expect(screen.queryByText('保存后会自动留版')).toBeNull()
    })

    it('加载文案随 title 变化，组件不再提供默认措辞', () => {
        render(<StateEmpty title="正在提取人物卡…" isLoading />)

        expect(screen.getByText('正在提取人物卡…')).toBeDefined()
        expect(screen.queryByText('正在读取…')).toBeNull()
    })

    it('提供了 icon 时渲染图标位', () => {
        render(<StateEmpty title="还没有快照" icon={EmptyIcon} />)
        expect(screen.getByTestId('empty-icon')).toBeDefined()
    })

    it('title 省略时不渲染标题节点，图标位照常', () => {
        render(<StateEmpty icon={EmptyIcon} />)

        expect(screen.getByTestId('empty-icon')).toBeDefined()
        expect(document.querySelector('[data-slot="empty-title"]')).toBeNull()
    })

    it('加载态传了 icon 时图标常驻，标题位显示转圈与加载文案', () => {
        render(<StateEmpty title="正在读取快照…" description="保存后会自动留版" icon={EmptyIcon} isLoading />)

        expect(screen.getByTestId('empty-icon')).toBeDefined()
        // 标题位是「转圈 + 文案」同一行：文案照常可见，转圈自身隐藏以免重复播报
        expect(screen.getByText('正在读取快照…')).toBeDefined()
        expect(document.querySelector('[data-slot="spinner"]')).not.toBeNull()
        expect(screen.queryByText('保存后会自动留版')).toBeNull()
    })

    it('加载态未传 icon 时图标位显示项目 logo，标题位同样带转圈', () => {
        render(<StateEmpty title="正在读取工作流" isLoading />)

        expect(document.querySelector('[data-slot="empty-icon"] img')).not.toBeNull()
        expect(document.querySelector('[data-slot="spinner"]')).not.toBeNull()
        expect(screen.getByText('正在读取工作流')).toBeDefined()
    })

    it('未传 icon 时图标位始终渲染项目 logo', () => {
        render(<StateEmpty title="还没有快照" />)

        expect(document.querySelector('[data-slot="empty-icon"] img')).not.toBeNull()
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
