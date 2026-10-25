// @vitest-environment jsdom
/**
 * ImageComposer 交互用例：覆盖发送编排、角色/设定芯片、封面模式、取消与迟到回包、增强还原。
 * 复用约定：渲染查询走 @testing-library/react，输入与点击用 user-event；输入区与词库弹层以轻量替身接管，
 * 断言落在「发什么请求、回调收到什么」上，正文拼装规则由纯函数承担。
 * 关键约束：取消后迟到的成功回包必须走 onLateGenerated 而不是 onGenerated——否则会替用户认领封面、
 * 清空他刚重新输入的正文，这是本组件最容易回退的分支。
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImageGenerateResult } from '@shared/types/imagegen'
import type { PortraitStyle } from '@shared/types/press'
import { ImageComposer } from '@webview/workflow/imagegen/ImageComposer'
import type { PromptCharacterSnapshot } from '@webview/workflow/imagegen/ImageComposer'
import type { JSX } from 'react'

const { requestMock, toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
    requestMock: vi.fn(),
    toastErrorMock: vi.fn(),
    toastSuccessMock: vi.fn(),
}))

vi.mock('@shared/utils/bridge', () => ({ request: requestMock }))
vi.mock('@shared/utils/error', () => ({ toastError: toastErrorMock }))
vi.mock('sonner', () => ({ toast: { success: toastSuccessMock } }))

interface FakeChip {
    id: string
    label: string
}

/** 输入区替身：只保留正文 textarea 与芯片标签/移除入口，contentEditable 的 DOM 行为不在此用例范围 */
vi.mock('@webview/components/RichChipInput', () => {
    interface FakeRichChipInputProps {
        value: string
        chips: FakeChip[]
        placeholder: string
        disabled?: boolean
        onChange: (value: string) => void
        onRemoveChip: (id: string) => void
    }

    const RichChipInput = ({
        value,
        chips,
        placeholder,
        disabled,
        onChange,
        onRemoveChip,
    }: FakeRichChipInputProps): JSX.Element => (
        <div>
            {chips.map((chip) => (
                <span key={chip.id}>
                    {chip.label}
                    <button type="button" aria-label={`移除${chip.label}`} onClick={() => onRemoveChip(chip.id)}>
                        移除
                    </button>
                </span>
            ))}
            <textarea
                aria-label={placeholder}
                value={value}
                disabled={disabled}
                onChange={(event) => onChange(event.target.value)}
            />
        </div>
    )

    return { RichChipInput }
})

const DIR_PATH = 'press/剑来'
const PLACEHOLDER = '描述画面：人物、动作、场景、光线与氛围…'

const CHARACTER: PromptCharacterSnapshot = {
    id: 'char-1',
    name: '林清',
    appearance: '白衣负剑',
    identity: '剑客',
    gender: 'female',
    age: '二十',
}

const GENERATED: ImageGenerateResult = {
    image: {
        id: 'photo-20261025143000-aB3xK9Qz',
        kind: 'photo',
        path: 'press/剑来/Images/photo-20261025143000-aB3xK9Qz.png',
        url: 'https://example.test/photo.png',
        createdAt: '2026-10-25T14:30:00.000Z',
        characterId: null,
    },
    coverSelectedId: null,
}

type ComposerProps = Parameters<typeof ImageComposer>[0]

function renderComposer(overrides: Partial<ComposerProps> = {}): ComposerProps {
    const props: ComposerProps = {
        dirPath: DIR_PATH,
        characters: [CHARACTER],
        setting: { title: '剑来' },
        activeCharacterId: null,
        defaultRatio: '3:4',
        defaultStyle: 'auto',
        coverStyle: 'photo',
        onSettingsChange: vi.fn(),
        onGenerated: vi.fn(),
        onLateGenerated: vi.fn(),
        ...overrides,
    }
    render(<ImageComposer {...props} />)
    return props
}

function inputBox(): HTMLTextAreaElement {
    return screen.getByLabelText<HTMLTextAreaElement>(PLACEHOLDER)
}

beforeEach(() => {
    requestMock.mockReset()
    toastErrorMock.mockReset()
    toastSuccessMock.mockReset()
    // 默认：出图成功，abort 视为成功
    requestMock.mockImplementation((method: string) =>
        method === 'pressAi/generateImage/abort' ? Promise.resolve({ aborted: true }) : Promise.resolve(GENERATED),
    )
})

afterEach(cleanup)

describe('ImageComposer', () => {
    it('正文为空时发送按钮禁用', () => {
        renderComposer()

        expect(screen.getByRole('button', { name: '发送' }).hasAttribute('disabled')).toBe(true)
    })

    it('发送普通图：带上正文与作品级默认参数，成功后回调并清空输入', async () => {
        const user = userEvent.setup()
        const onGenerated = vi.fn()
        renderComposer({ onGenerated })

        await user.type(inputBox(), '雨夜长街')
        await user.click(screen.getByRole('button', { name: '发送' }))

        expect(requestMock).toHaveBeenCalledWith(
            'pressAi/generateImage',
            {
                dirPath: DIR_PATH,
                prompt: '雨夜长街',
                kind: 'photo',
                characterId: null,
                ratio: '3:4',
                style: 'auto',
                enhancedFrom: undefined,
            },
            expect.any(Number),
        )
        expect(onGenerated).toHaveBeenCalledWith(GENERATED)
        expect(inputBox().value).toBe('')
    })

    it('挂上角色芯片后按角色图发送，正文与角色段分段拼接', async () => {
        const user = userEvent.setup()
        renderComposer({ activeCharacterId: CHARACTER.id })

        await user.type(inputBox(), '雨夜长街')
        await user.click(screen.getByRole('button', { name: '角色设定' }))
        await user.click(screen.getByRole('button', { name: '发送' }))

        const [, params] = requestMock.mock.calls[0] as [string, { prompt: string; kind: string; characterId: string }]
        expect(params.kind).toBe('portrait')
        expect(params.characterId).toBe(CHARACTER.id)
        expect(params.prompt).toBe('雨夜长街\n\n角色：林清\n外形：女性，二十\n身份：剑客\n外貌：白衣负剑')
    })

    it('未选角色时角色设定按钮禁用', () => {
        renderComposer()

        expect(screen.getByRole('button', { name: '角色设定' }).hasAttribute('disabled')).toBe(true)
    })

    it('命令动作芯片可开关，移除后不再并入提示词', async () => {
        const user = userEvent.setup()
        renderComposer()

        await user.click(screen.getByRole('button', { name: '命令动作' }))
        expect(screen.getByText('作品设定')).toBeDefined()

        await user.type(inputBox(), '雨夜长街')
        await user.click(screen.getByRole('button', { name: '移除作品设定' }))
        expect(screen.queryByText('作品设定')).toBeNull()

        await user.click(screen.getByRole('button', { name: '发送' }))
        const [, params] = requestMock.mock.calls[0] as [string, { prompt: string }]
        expect(params.prompt).toBe('雨夜长街')
    })

    it('作品设定芯片并入书名等设定段', async () => {
        const user = userEvent.setup()
        renderComposer()

        await user.type(inputBox(), '雨夜长街')
        await user.click(screen.getByRole('button', { name: '命令动作' }))
        await user.click(screen.getByRole('button', { name: '发送' }))

        const [, params] = requestMock.mock.calls[0] as [string, { prompt: string }]
        expect(params.prompt).toBe('雨夜长街\n\n书名：剑来')
    })

    it('封面模式：按钮改文案、以 cover 发送，成功后退出模式并提示', async () => {
        const user = userEvent.setup()
        const onGenerated = vi.fn()
        renderComposer({ onGenerated })

        await user.click(screen.getByRole('button', { name: '作品封面' }))
        expect(screen.getByRole('button', { name: '生成封面' })).toBeDefined()

        await user.type(inputBox(), '山川远景')
        await user.click(screen.getByRole('button', { name: '生成封面' }))

        const [, params] = requestMock.mock.calls[0] as [string, { kind: string; characterId: string | null }]
        expect(params.kind).toBe('cover')
        expect(params.characterId).toBeNull()
        expect(toastSuccessMock).toHaveBeenCalledWith('作品封面已更新')
        expect(screen.getByRole('button', { name: '发送' })).toBeDefined()
    })

    it('生成中切换为取消按钮，取消后迟到回包只走 onLateGenerated', async () => {
        const user = userEvent.setup()
        const onGenerated = vi.fn()
        const onLateGenerated = vi.fn()
        let resolveGenerate: (result: ImageGenerateResult) => void = () => {}
        requestMock.mockImplementation((method: string) => {
            if (method === 'pressAi/generateImage') {
                return new Promise<ImageGenerateResult>((resolve) => {
                    resolveGenerate = resolve
                })
            }
            return Promise.resolve({ aborted: true })
        })
        renderComposer({ onGenerated, onLateGenerated })

        await user.type(inputBox(), '雨夜长街')
        await user.click(screen.getByRole('button', { name: '发送' }))
        expect(screen.getByRole('button', { name: '取消生成' })).toBeDefined()

        await user.click(screen.getByRole('button', { name: '取消生成' }))
        expect(requestMock).toHaveBeenCalledWith('pressAi/generateImage/abort')
        expect(screen.getByRole('button', { name: '发送' })).toBeDefined()

        act(() => {
            resolveGenerate(GENERATED)
        })
        await waitFor(() => expect(onLateGenerated).toHaveBeenCalledTimes(1))

        expect(onGenerated).not.toHaveBeenCalled()
        // 取消后正文保留，用户可以直接重发
        expect(inputBox().value).toBe('雨夜长街')
    })

    it('生成失败时提示错误并主动取消宿主在途请求', async () => {
        const user = userEvent.setup()
        requestMock.mockImplementation((method: string) => {
            if (method === 'pressAi/generateImage') {
                return Promise.reject(new Error('通道不可用'))
            }
            return Promise.resolve({ aborted: true })
        })
        renderComposer()

        await user.type(inputBox(), '雨夜长街')
        await user.click(screen.getByRole('button', { name: '发送' }))

        expect(toastErrorMock).toHaveBeenCalledTimes(1)
        expect(requestMock).toHaveBeenCalledWith('pressAi/generateImage/abort')
        expect(inputBox().value).toBe('雨夜长街')
    })

    it('切换比例写入作品级配置', async () => {
        const user = userEvent.setup()
        const onSettingsChange = vi.fn()
        renderComposer({ onSettingsChange })

        await user.click(screen.getByRole('button', { name: '1:1' }))

        expect(onSettingsChange).toHaveBeenCalledWith({ defaultRatio: '1:1' })
    })

    it('切换画风按当前模式写回对应一侧配置', async () => {
        const user = userEvent.setup()
        const onSettingsChange = vi.fn()
        renderComposer({ onSettingsChange })

        await user.click(screen.getByRole('button', { name: '画面风格' }))
        await user.click(screen.getByRole('button', { name: '古风' }))
        expect(onSettingsChange).toHaveBeenCalledWith({ portraitStyle: 'guofeng' satisfies PortraitStyle })

        await user.click(screen.getByRole('button', { name: '作品封面' }))
        await user.click(screen.getByRole('button', { name: '画面风格' }))
        await user.click(screen.getByRole('button', { name: '写实' }))
        expect(onSettingsChange).toHaveBeenLastCalledWith({ coverStyle: 'realistic' satisfies PortraitStyle })
    })

    it('增强提示词改写正文，还原后回到原文', async () => {
        const user = userEvent.setup()
        requestMock.mockImplementation((method: string) =>
            method === 'pressAi/enhanceImagePrompt'
                ? Promise.resolve({ text: '雨夜长街，湿石板反光' })
                : Promise.resolve(GENERATED),
        )
        renderComposer()

        await user.type(inputBox(), '雨夜长街')
        await user.click(screen.getByRole('button', { name: '增强提示词' }))

        expect(inputBox().value).toBe('雨夜长街，湿石板反光')
        await user.click(screen.getByRole('button', { name: '还原' }))
        expect(inputBox().value).toBe('雨夜长街')
    })
})
