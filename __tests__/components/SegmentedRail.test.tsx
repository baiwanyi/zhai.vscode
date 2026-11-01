// @vitest-environment jsdom
/**
 * SegmentedRail 交互用例：覆盖单选回调、重复点击不回调、禁用与图标位渲染。
 * 复用约定：渲染与查询走 @testing-library/react，点击用 user-event；
 * jsdom 环境由本文件首行指令声明，其余用例仍运行在 node 环境。
 * 关键约束：ToggleGroup 在 single 模式下点击已选项会把值置空，组件据此不回调 onChange，
 * 因此「重复点击不回调」是本组件区别于裸 ToggleGroup 的关键约定，必须有用例守住。
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SegmentedRail } from '@webview/components/SegmentedRail'
import type { ReactNode } from 'react'

afterEach(cleanup)

const ITEMS = [
    { value: 'basic', label: '基础' },
    { value: 'story', label: '剧情' },
] as const

function RailIcon({ className }: { className?: string }): ReactNode {
    return <span data-testid="rail-icon" className={className} />
}

describe('SegmentedRail', () => {
    it('渲染全部分段项，并以 ariaLabel 标注整组', () => {
        render(<SegmentedRail items={ITEMS} value="basic" onChange={vi.fn()} ariaLabel="设定分组" />)

        expect(screen.getByRole('radiogroup', { name: '设定分组' })).toBeDefined()
        expect(screen.getByRole('radio', { name: '基础' })).toBeDefined()
        expect(screen.getByRole('radio', { name: '剧情' })).toBeDefined()
    })

    it('点击未选中项回传该值', async () => {
        const user = userEvent.setup()
        const onChange = vi.fn()
        render(<SegmentedRail items={ITEMS} value="basic" onChange={onChange} ariaLabel="设定分组" />)

        await user.click(screen.getByRole('radio', { name: '剧情' }))

        expect(onChange).toHaveBeenCalledTimes(1)
        expect(onChange).toHaveBeenCalledWith('story')
    })

    it('点击已选中项不回调，避免把选中值置空', async () => {
        const user = userEvent.setup()
        const onChange = vi.fn()
        render(<SegmentedRail items={ITEMS} value="basic" onChange={onChange} ariaLabel="设定分组" />)

        await user.click(screen.getByRole('radio', { name: '基础' }))

        expect(onChange).not.toHaveBeenCalled()
    })

    it('整组禁用时点击不回调，且分段项不可用', async () => {
        const user = userEvent.setup()
        const onChange = vi.fn()
        render(<SegmentedRail items={ITEMS} value="basic" onChange={onChange} ariaLabel="设定分组" isDisabled />)

        const story = screen.getByRole('radio', { name: '剧情' })
        expect(story.hasAttribute('disabled')).toBe(true)

        await user.click(story)

        expect(onChange).not.toHaveBeenCalled()
    })

    it('提供了 icon 时渲染图标位，未提供时不渲染', () => {
        const { unmount } = render(
            <SegmentedRail
                items={[{ value: 'basic', label: '基础', icon: RailIcon }]}
                value="basic"
                onChange={vi.fn()}
                ariaLabel="带图标"
            />,
        )

        expect(screen.getByTestId('rail-icon')).toBeDefined()
        unmount()

        render(<SegmentedRail items={ITEMS} value="basic" onChange={vi.fn()} ariaLabel="无图标" />)

        expect(screen.queryByTestId('rail-icon')).toBeNull()
    })
})
