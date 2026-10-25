// @vitest-environment jsdom
/**
 * ImageComposer 交互用例：覆盖参数未读完的占位、发送编排、角色/设定芯片、封面模式、取消与迟到回包、增强还原。
 * 复用约定：渲染查询走 @testing-library/react，输入与点击用 user-event；输入区与词库弹层以轻量替身接管，
 * 断言落在「发什么请求、回调收到什么」上，正文拼装规则由纯函数承担。
 * 关键约束：取消后迟到的成功回包必须走 onLateGenerated 而不是 onGenerated——否则会替用户认领封面、
 * 清空他刚重新输入的正文，这是本组件最容易回退的分支。
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@components/ui/tooltip'
import type { ImageGenerateResult } from '@shared/types/imagegen'
import type { PortraitStyle } from '@shared/types/press'
import { ImageComposer } from '@webview/workflow/imagegen/layout/ImageComposer'
import type { PromptCharacterSnapshot } from '@webview/workflow/imagegen/layout/ImageComposer'
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
        isLoaded: true,
        ...overrides,
    }
    // 增强按钮带 tooltip：与 bootstrap 的挂载方式一致，外包 TooltipProvider
    render(
        <TooltipProvider>
            <ImageComposer {...props} />
        </TooltipProvider>,
    )
    return props
}

function inputBox(): HTMLTextAreaElement {
    return screen.getByLabelText<HTMLTextAreaElement>(PLACEHOLDER)
}

/** 菜单浮层依赖 ResizeObserver 量取尺寸：jsdom 未实现，补空桩避免渲染中断 */
class ResizeObserverStub {
    observe = (): void => undefined
    unobserve = (): void => undefined
    disconnect = (): void => undefined
}

/** Radix 菜单展开依赖指针捕获与 scrollIntoView，jsdom 下补空实现才能在用例里点开比例菜单 */
function stubDropdownDom(): void {
    Element.prototype.scrollIntoView = (): void => undefined
    Element.prototype.hasPointerCapture = (): boolean => false
    Element.prototype.setPointerCapture = (): void => undefined
    Element.prototype.releasePointerCapture = (): void => undefined
}

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    stubDropdownDom()
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
    it('参数未读完只渲染占位，不挂载正文控件', () => {
        renderComposer({ isLoaded: false })

        expect(screen.queryByLabelText(PLACEHOLDER)).toBeNull()
        expect(screen.queryByRole('button', { name: '发送' })).toBeNull()
    })

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

    it('发送后冷静期内的第二次点击不会误取消在途请求', async () => {
        const user = userEvent.setup()
        requestMock.mockImplementation((method: string) =>
            method === 'pressAi/generateImage'
                ? new Promise<ImageGenerateResult>(() => undefined)
                : Promise.resolve({ aborted: true }),
        )
        renderComposer()

        await user.type(inputBox(), '雨夜长街')
        await user.click(screen.getByRole('button', { name: '发送' }))
        // 首击后按钮即刻变成取消，连点的第二下正好落在这个位置：冷静期内必须被丢弃
        await user.click(screen.getByRole('button', { name: '取消生成' }))

        expect(requestMock).not.toHaveBeenCalledWith('pressAi/generateImage/abort')
        expect(screen.getByRole('button', { name: '取消生成' })).toBeDefined()
    })

    it('生成中切换为取消按钮，取消后迟到回包只走 onLateGenerated', async () => {
        const user = userEvent.setup()
        const onGenerated = vi.fn()
        const onLateGenerated = vi.fn()
        const onGeneratingChange = vi.fn()
        let resolveGenerate: (result: ImageGenerateResult) => void = () => {}
        requestMock.mockImplementation((method: string) => {
            if (method === 'pressAi/generateImage') {
                return new Promise<ImageGenerateResult>((resolve) => {
                    resolveGenerate = resolve
                })
            }
            return Promise.resolve({ aborted: true })
        })
        renderComposer({ onGenerated, onLateGenerated, onGeneratingChange })

        await user.type(inputBox(), '雨夜长街')
        await user.click(screen.getByRole('button', { name: '发送' }))
        expect(screen.getByRole('button', { name: '取消生成' })).toBeDefined()
        // 发送即清空：不能等出图回包才清，否则生成期间看着像没发出去
        expect(inputBox().value).toBe('')
        // 页面靠这个标记在列表首位挂骨架占位
        expect(onGeneratingChange).toHaveBeenLastCalledWith(true)

        // 发送后有 300ms 冷静期，取消按钮在这段窗口内不响应（防连点误取消），等过去再点
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 350)
        })
        await user.click(screen.getByRole('button', { name: '取消生成' }))
        expect(requestMock).toHaveBeenCalledWith('pressAi/generateImage/abort')
        expect(screen.getByRole('button', { name: '发送' })).toBeDefined()
        // 取消是同步复位：占位必须立刻收起，不能等宿主回包
        expect(onGeneratingChange).toHaveBeenLastCalledWith(false)

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

        // 比例收进菜单：先开触发器，再点目标档位
        await user.click(screen.getByRole('button', { name: '当前比例 3:4，点击切换' }))
        await user.click(screen.getByRole('menuitem', { name: '1:1' }))

        expect(onSettingsChange).toHaveBeenCalledWith({ defaultRatio: '1:1' })
    })

    it('正文写明比例时自动选中对应比例并随请求下发', async () => {
        const user = userEvent.setup()
        const onSettingsChange = vi.fn()
        renderComposer({ onSettingsChange })

        await user.type(inputBox(), '雨夜长街 16:9 宽幅')
        expect(screen.getByRole('button', { name: '当前比例 16:9，点击切换' })).toBeDefined()

        await user.click(screen.getByRole('button', { name: '发送' }))
        const [, params] = requestMock.mock.calls[0] as [string, { ratio: string }]
        expect(params.ratio).toBe('16:9')
        // 自动切换只改本次会话，不写回作品默认比例
        expect(onSettingsChange).not.toHaveBeenCalled()
    })

    it('比例关键字没变时，继续输入不覆盖手动选的比例', async () => {
        const user = userEvent.setup()
        renderComposer()

        await user.type(inputBox(), '雨夜长街 16:9')
        expect(screen.getByRole('button', { name: '当前比例 16:9，点击切换' })).toBeDefined()

        await user.click(screen.getByRole('button', { name: '当前比例 16:9，点击切换' }))
        await user.click(screen.getByRole('menuitem', { name: '1:1' }))
        expect(screen.getByRole('button', { name: '当前比例 1:1，点击切换' })).toBeDefined()

        // 正文里的关键字没变，随手再写字不该把比例打回 16:9
        await user.type(inputBox(), '，冷调')
        expect(screen.getByRole('button', { name: '当前比例 1:1，点击切换' })).toBeDefined()
    })

    it('正文写竖版 / 横版 / 方形时按对应比例切换', async () => {
        const user = userEvent.setup()
        renderComposer()

        await user.type(inputBox(), '竖版构图')
        expect(screen.getByRole('button', { name: '当前比例 9:16，点击切换' })).toBeDefined()

        await user.clear(inputBox())
        await user.type(inputBox(), '横版海报')
        expect(screen.getByRole('button', { name: '当前比例 16:9，点击切换' })).toBeDefined()

        await user.clear(inputBox())
        await user.type(inputBox(), '方形头像')
        expect(screen.getByRole('button', { name: '当前比例 1:1，点击切换' })).toBeDefined()
    })

    it('正文写英文比例词时按对应比例切换，且不区分大小写', async () => {
        const user = userEvent.setup()
        renderComposer()

        await user.type(inputBox(), 'portrait shot')
        expect(screen.getByRole('button', { name: '当前比例 9:16，点击切换' })).toBeDefined()

        await user.clear(inputBox())
        await user.type(inputBox(), 'Landscape poster')
        expect(screen.getByRole('button', { name: '当前比例 16:9，点击切换' })).toBeDefined()

        await user.clear(inputBox())
        await user.type(inputBox(), 'Square avatar')
        expect(screen.getByRole('button', { name: '当前比例 1:1，点击切换' })).toBeDefined()
    })

    it('中文比例词与数字写法同时出现时，以靠后的为准', async () => {
        const user = userEvent.setup()
        renderComposer()

        await user.type(inputBox(), '16:9 改为竖版')
        expect(screen.getByRole('button', { name: '当前比例 9:16，点击切换' })).toBeDefined()

        await user.clear(inputBox())
        await user.type(inputBox(), '竖版改为 16:9')
        expect(screen.getByRole('button', { name: '当前比例 16:9，点击切换' })).toBeDefined()
    })

    it('切换画风按当前模式写回对应一侧配置', async () => {
        const user = userEvent.setup()
        const onSettingsChange = vi.fn()
        renderComposer({ onSettingsChange })

        // 画风收进单选卡面板：触发器回显当前画风名，先开面板，再点目标画风的单选卡
        await user.click(screen.getByRole('button', { name: '画面风格 自动，点击切换' }))
        await user.click(screen.getByRole('radio', { name: '古风' }))
        expect(onSettingsChange).toHaveBeenCalledWith({ portraitStyle: 'guofeng' satisfies PortraitStyle })

        // 切到封面模式后触发器换用封面画风（photo → 人像），写回落在 coverStyle 一侧
        await user.click(screen.getByRole('button', { name: '作品封面' }))
        await user.click(screen.getByRole('button', { name: '画面风格 人像，点击切换' }))
        await user.click(screen.getByRole('radio', { name: '写实' }))
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
        await user.click(screen.getByRole('button', { name: '还原提示词' }))
        expect(inputBox().value).toBe('雨夜长街')
    })

    it('增强后发送，增强态随输入框一起复位', async () => {
        const user = userEvent.setup()
        requestMock.mockImplementation((method: string) =>
            method === 'pressAi/enhanceImagePrompt'
                ? Promise.resolve({ text: '雨夜长街，湿石板反光' })
                : Promise.resolve(GENERATED),
        )
        renderComposer()

        await user.type(inputBox(), '雨夜长街')
        await user.click(screen.getByRole('button', { name: '增强提示词' }))
        expect(screen.getByRole('button', { name: '还原提示词' })).toBeDefined()

        await user.click(screen.getByRole('button', { name: '发送' }))

        // 空输入框不是增强结果，按钮必须回到增强图标，不能还挂着「还原」
        expect(screen.getByRole('button', { name: '增强提示词' })).toBeDefined()
        expect(screen.queryByRole('button', { name: '还原提示词' })).toBeNull()
    })

    it('增强后发送失败，草稿连同增强态一起还回去', async () => {
        const user = userEvent.setup()
        requestMock.mockImplementation((method: string) => {
            if (method === 'pressAi/enhanceImagePrompt') {
                return Promise.resolve({ text: '雨夜长街，湿石板反光' })
            }
            if (method === 'pressAi/generateImage') {
                return Promise.reject(new Error('通道不可用'))
            }
            return Promise.resolve({ aborted: true })
        })
        renderComposer()

        await user.type(inputBox(), '雨夜长街')
        await user.click(screen.getByRole('button', { name: '增强提示词' }))
        await user.click(screen.getByRole('button', { name: '发送' }))

        expect(inputBox().value).toBe('雨夜长街，湿石板反光')
        expect(screen.getByRole('button', { name: '还原提示词' })).toBeDefined()
    })
})
