// @vitest-environment jsdom
/**
 * ImageComposer 交互用例：覆盖参数未读完的占位、发送编排、角色/设定/词条芯片、取消与迟到回包、增强还原。
 * 复用约定：渲染查询走 @testing-library/react，输入与点击用 user-event；输入区以轻量替身接管，
 * 提示词面板走真实组件与真实词库，断言落在「发什么请求、回调收到什么」上，正文拼装规则由纯函数承担。
 * 关键约束：取消后迟到的成功回包必须走 onLateGenerated 而不是 onGenerated——否则会清空他刚重新输入的正文，
 * 这是本组件最容易回退的分支；词条只以芯片存在，正文里不该出现词条文本。
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@components/ui/tooltip'
import type { ImageGenerateResult, PromptTag, PromptTagListResult } from '@shared/types/imagegen'
import type { PortraitStyle } from '@shared/types/press'
import { ImageComposer } from '@webview/workflow/imagegen/layout/ImageComposer'
import type { PromptCharacterSnapshot } from '@webview/workflow/imagegen/layout/ImageComposer'
import type { JSX } from 'react'

const { requestMock, toastErrorMock } = vi.hoisted(() => ({
    requestMock: vi.fn(),
    toastErrorMock: vi.fn(),
}))

vi.mock('@shared/utils/bridge', () => ({ request: requestMock }))
vi.mock('@shared/utils/error', () => ({ toastError: toastErrorMock }))

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

/** 第二个角色：拼音（bai）排在「林清」（lin）之前，码位序则相反，用来区分排序规则 */
const CHARACTER_B: PromptCharacterSnapshot = {
    id: 'char-2',
    name: '白露',
    appearance: '青衫执灯',
    identity: '游医',
    gender: 'female',
    age: '三十',
}

/** 参考图回包：路径是宿主登记过的本地绝对路径，url 只用于芯片缩略图与预览 */
const REFERENCE = {
    path: 'd:/vault/ref.png',
    name: '参考图.png',
    url: 'https://example.test/ref.png',
}

const GENERATED: ImageGenerateResult = {
    image: {
        id: 'photo-20261025143000-aB3xK9Qz',
        kind: 'photo',
        path: 'press/剑来/Images/photo-20261025143000-aB3xK9Qz.png',
        url: 'https://example.test/photo.png',
        createdAt: '2026-10-25T14:30:00.000Z',
        characterId: null,
        loreId: null,
        loreKind: null,
    },
}

type ComposerProps = Parameters<typeof ImageComposer>[0]

function renderComposer(overrides: Partial<ComposerProps> = {}): ComposerProps {
    const props: ComposerProps = {
        dirPath: DIR_PATH,
        characters: [CHARACTER],
        setting: { title: '剑来' },
        initialCharacterId: null,
        defaultRatio: '3:4',
        defaultStyle: 'auto',
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

/** 测试词条：词库改由宿主回传后，用例自带一条最小数据，不再依赖打包词库 */
const TAG: PromptTag = {
    id: '人物::基础::女性',
    object: '人物',
    attribute: '基础',
    name: '女性',
    prompt: 'female',
    preview: null,
}

/** 测试词库：面板首屏一级与二级分类都默认选首项，故这条打开面板后即可见 */
const TAG_LIBRARY: PromptTagListResult = {
    objects: [{ name: '人物', attributes: [{ name: '基础', count: 1 }] }],
    tags: [TAG],
    dirPath: 'D:/vault/prompt/tags',
    imageDirPath: 'D:/vault/prompt/images',
}

function firstTag(): PromptTag {
    return TAG
}

/** 打开提示词面板并点选首条词条（已挂则取消） */
async function clickFirstTag(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    const tag = firstTag()
    await user.click(screen.getByRole('button', { name: '提示词' }))
    await user.click(await screen.findByRole('button', { name: tag.name }))
}

/**
 * 取出第 n 次出图请求的参数：菜单挂载时会先发规则列举，不能按下标硬取调用记录。
 * 找不到时直接抛错，避免用例在断言处才报「undefined 上取属性」。
 */
function generateParams(index = 0): Record<string, unknown> {
    const calls = requestMock.mock.calls.filter((call) => call[0] === 'pressAi/generateImage')
    const params: unknown = calls[index]?.[1]
    if (typeof params !== 'object' || params === null) {
        throw new Error('没有出图请求')
    }
    return params as Record<string, unknown>
}

/**
 * 打开「添加上下文 → 规则」子菜单：子菜单由指针移动展开，
 * jsdom 下 userEvent 的 hover 不派发 pointermove，这里显式触发一次。
 */
async function openRuleMenu(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.click(screen.getByRole('button', { name: '添加上下文' }))
    fireEvent.pointerMove(await screen.findByRole('menuitem', { name: '规则' }), { pointerType: 'mouse' })
}

/** 默认回包：规则与词库按测试数据返回、预览图库无图、abort 视为成功，其余按出图成功处理 */
function defaultResponse(method: string): Promise<unknown> {
    if (method === 'pressAi/listPromptRules') {
        return Promise.resolve({ rules: [], dirPath: '' })
    }
    if (method === 'pressAi/listPromptTags') {
        return Promise.resolve(TAG_LIBRARY)
    }
    if (method === 'pressAi/getPromptImageBase') {
        return Promise.resolve({ baseUrl: null, dirPath: '' })
    }
    return method === 'pressAi/generateImage/abort' ? Promise.resolve({ aborted: true }) : Promise.resolve(GENERATED)
}

/** 只覆盖出图行为：规则列举、预览图库与 abort 仍走默认回包，避免污染 toast 与调用断言 */
function mockGenerate(handler: () => Promise<unknown>): void {
    requestMock.mockImplementation((method: string) =>
        method === 'pressAi/generateImage' ? handler() : defaultResponse(method),
    )
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
    // 默认：出图成功，abort 视为成功，规则为空、预览图库按「没有图」回包（两个面板都照常可用）
    requestMock.mockImplementation((method: string) => defaultResponse(method))
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

    it('初始角色自带角色徽标，按角色图发送并拼接角色段', async () => {
        const user = userEvent.setup()
        renderComposer({ initialCharacterId: CHARACTER.id })

        // 徽标只显示角色名（图标由渲染层补），移除入口的可访问名据此拼接
        expect(screen.getByRole('button', { name: '移除林清' })).toBeDefined()

        await user.type(inputBox(), '雨夜长街')
        await user.click(screen.getByRole('button', { name: '发送' }))

        const params = generateParams()
        expect(params.kind).toBe('portrait')
        expect(params.characterId).toBe(CHARACTER.id)
        expect(params.prompt).toBe('雨夜长街\n\n角色：林清\n外形：女性，二十\n身份：剑客\n外貌：白衣负剑')
    })

    it('角色选择器选人即挂角色徽标，按角色图发送', async () => {
        const user = userEvent.setup()
        renderComposer()

        expect(screen.queryByRole('button', { name: '移除林清' })).toBeNull()

        await user.click(screen.getByRole('button', { name: '角色设定' }))
        await user.click(screen.getByRole('menuitemradio', { name: '林清' }))
        expect(screen.getByRole('button', { name: '移除林清' })).toBeDefined()

        await user.type(inputBox(), '雨夜长街')
        await user.click(screen.getByRole('button', { name: '发送' }))

        const params = generateParams()
        expect(params.kind).toBe('portrait')
        expect(params.characterId).toBe(CHARACTER.id)
    })

    it('角色菜单按名字字母序排列', async () => {
        const user = userEvent.setup()
        renderComposer({ characters: [CHARACTER, CHARACTER_B] })

        await user.click(screen.getByRole('button', { name: '角色设定' }))

        // 「不使用角色」固定置顶，其余按拼音字母序：白露（bai）排在林清（lin）之前
        const names = screen.getAllByRole('menuitemradio').map((item) => item.textContent)
        expect(names).toEqual(['不使用角色', '白露', '林清'])
    })

    it('选「不使用角色」清掉徽标并回落普通图', async () => {
        const user = userEvent.setup()
        renderComposer({ initialCharacterId: CHARACTER.id })

        await user.click(screen.getByRole('button', { name: '角色设定' }))
        await user.click(screen.getByRole('menuitemradio', { name: '不使用角色' }))
        expect(screen.queryByRole('button', { name: '移除林清' })).toBeNull()

        await user.type(inputBox(), '雨夜长街')
        await user.click(screen.getByRole('button', { name: '发送' }))

        const params = generateParams()
        expect(params.kind).toBe('photo')
        expect(params.characterId).toBeNull()
        expect(params.prompt).toBe('雨夜长街')
    })

    it('上下文芯片可开关，移除后不再提交上下文', async () => {
        const user = userEvent.setup()
        renderComposer()

        await user.click(screen.getByRole('button', { name: '添加上下文' }))
        await user.click(screen.getByRole('menuitemcheckbox', { name: '作品设定' }))
        expect(screen.getByText('作品设定')).toBeDefined()

        await user.type(inputBox(), '雨夜长街')
        await user.click(screen.getByRole('button', { name: '移除作品设定' }))
        expect(screen.queryByText('作品设定')).toBeNull()

        await user.click(screen.getByRole('button', { name: '发送' }))
        expect(generateParams().prompt).toBe('雨夜长街')
        expect(generateParams().contexts).toBeUndefined()
    })

    it('作品设定作为上下文提交，不混入提示词正文', async () => {
        const user = userEvent.setup()
        renderComposer()

        await user.type(inputBox(), '雨夜长街')
        await user.click(screen.getByRole('button', { name: '添加上下文' }))
        await user.click(screen.getByRole('menuitemcheckbox', { name: '作品设定' }))
        await user.click(screen.getByRole('button', { name: '发送' }))

        expect(generateParams().prompt).toBe('雨夜长街')
        expect(generateParams().contexts).toEqual(['书名：剑来'])
    })

    it('规则子菜单勾选后只带标识随请求下发，发送后芯片清空', async () => {
        const user = userEvent.setup()
        requestMock.mockImplementation((method: string) =>
            method === 'pressAi/listPromptRules'
                ? Promise.resolve({ rules: [{ id: '冷色调', name: '冷色调' }], dirPath: 'D:/vault/prompt/rules' })
                : defaultResponse(method),
        )
        renderComposer()

        await user.click(screen.getByRole('button', { name: '添加上下文' }))
        // 子菜单由指针移动展开：jsdom 下 userEvent 的 hover 不派发 pointermove，这里显式触发一次
        fireEvent.pointerMove(await screen.findByRole('menuitem', { name: '规则' }), { pointerType: 'mouse' })
        // 规则行同时挂着编辑与删除按钮，accessible name 不止规则名，这里按名称包含匹配
        await user.click(await screen.findByRole('menuitem', { name: /冷色调/u }))

        // 规则正文留在磁盘，芯片只带标识
        expect(screen.getByRole('button', { name: '移除冷色调' })).toBeDefined()
        expect(inputBox().value).toBe('')

        await user.type(inputBox(), '雨夜长街')
        await user.click(screen.getByRole('button', { name: '发送' }))

        expect(generateParams().promptRules).toEqual(['冷色调'])
        expect(screen.queryByRole('button', { name: '移除冷色调' })).toBeNull()
    })

    it('编辑规则先读回正文，改名后已挂芯片跟着换标识', async () => {
        const user = userEvent.setup()
        requestMock.mockImplementation((method: string) => {
            if (method === 'pressAi/listPromptRules') {
                return Promise.resolve({ rules: [{ id: '冷色调', name: '冷色调' }], dirPath: 'D:/vault/prompt/rules' })
            }
            if (method === 'pressAi/readPromptRule') {
                return Promise.resolve({ name: '冷色调', content: '降饱和，避免高光溢出' })
            }
            if (method === 'pressAi/updatePromptRule') {
                return Promise.resolve({ id: '低饱和', name: '低饱和' })
            }
            return defaultResponse(method)
        })
        renderComposer()

        await openRuleMenu(user)
        await user.click(await screen.findByRole('menuitem', { name: /冷色调/u }))
        expect(screen.getByRole('button', { name: '移除冷色调' })).toBeDefined()

        await openRuleMenu(user)
        await user.click(await screen.findByRole('button', { name: '编辑冷色调' }))

        // 点行尾按钮只打开弹窗，不能顺带把该行挂载态翻掉；
        // 模态弹窗会把其余区域标成 aria-hidden，查芯片需显式带上 hidden
        const dialog = await screen.findByRole('dialog', { name: '编辑规则' })
        expect(screen.getByRole('button', { name: '移除冷色调', hidden: true })).toBeDefined()

        // 正文由宿主读盘回填，弹窗里不是空表单
        const nameInput = within(dialog).getByLabelText<HTMLInputElement>('名称')
        expect(within(dialog).getByLabelText<HTMLTextAreaElement>('规则内容').value).toBe('降饱和，避免高光溢出')

        await user.clear(nameInput)
        await user.type(nameInput, '低饱和')
        await user.click(within(dialog).getByRole('button', { name: '保存' }))

        await waitFor(() => {
            expect(requestMock.mock.calls.find((call) => call[0] === 'pressAi/updatePromptRule')?.[1]).toEqual({
                previousName: '冷色调',
                name: '低饱和',
                content: '降饱和，避免高光溢出',
            })
        })
        // 改名等于换标识：芯片跟着换，旧标识不残留
        await waitFor(() => {
            expect(screen.queryByRole('dialog')).toBeNull()
        })
        expect(screen.getByRole('button', { name: '移除低饱和' })).toBeDefined()
        expect(screen.queryByRole('button', { name: '移除冷色调' })).toBeNull()
    })

    it('删除规则走二次确认，成功后摘掉对应芯片', async () => {
        const user = userEvent.setup()
        requestMock.mockImplementation((method: string) => {
            if (method === 'pressAi/listPromptRules') {
                return Promise.resolve({ rules: [{ id: '冷色调', name: '冷色调' }], dirPath: 'D:/vault/prompt/rules' })
            }
            if (method === 'pressAi/deletePromptRule') {
                return Promise.resolve({ rules: [], dirPath: 'D:/vault/prompt/rules' })
            }
            return defaultResponse(method)
        })
        renderComposer()

        await openRuleMenu(user)
        await user.click(await screen.findByRole('menuitem', { name: /冷色调/u }))
        expect(screen.getByRole('button', { name: '移除冷色调' })).toBeDefined()

        await openRuleMenu(user)
        await user.click(await screen.findByRole('button', { name: '删除冷色调' }))

        // 未确认前不落盘
        expect(requestMock.mock.calls.some((call) => call[0] === 'pressAi/deletePromptRule')).toBe(false)

        const dialog = await screen.findByRole('alertdialog')
        await user.click(within(dialog).getByRole('button', { name: '删除' }))

        await waitFor(() => {
            expect(requestMock.mock.calls.find((call) => call[0] === 'pressAi/deletePromptRule')?.[1]).toEqual({
                name: '冷色调',
            })
        })
        // 先等确认框收起，否则 aria-hidden 会让「芯片已摘除」看起来成立
        await waitFor(() => {
            expect(screen.queryByRole('alertdialog')).toBeNull()
        })
        expect(screen.queryByRole('button', { name: '移除冷色调' })).toBeNull()
    })

    it('点选词条只挂芯片不写正文，发送时带上词条标识', async () => {
        const user = userEvent.setup()
        renderComposer()
        const tag = firstTag()

        await clickFirstTag(user)

        // 词条不进正文，只以芯片呈现；正文为空但有词条时同样可发送
        expect(screen.getByRole('button', { name: `移除${tag.name}` })).toBeDefined()
        expect(inputBox().value).toBe('')
        expect(screen.getByRole('button', { name: '发送' }).hasAttribute('disabled')).toBe(false)

        await user.click(screen.getByRole('button', { name: '发送' }))

        // 打开面板时也发过预览图库请求，出图调用要按方法名挑出来
        expect(generateParams().prompt).toBe('')
        expect(generateParams().promptTags).toEqual([tag.id])
        // 发送即清空：芯片随正文一起收走
        expect(screen.queryByRole('button', { name: `移除${tag.name}` })).toBeNull()
    })

    it('面板按选中态回显，再点同一词条即取消芯片', async () => {
        const user = userEvent.setup()
        renderComposer()
        const tag = firstTag()

        await clickFirstTag(user)
        expect(screen.getByRole('button', { name: tag.name }).getAttribute('aria-pressed')).toBe('true')

        await user.click(screen.getByRole('button', { name: tag.name }))
        expect(screen.queryByRole('button', { name: `移除${tag.name}` })).toBeNull()
        expect(screen.getByRole('button', { name: tag.name }).getAttribute('aria-pressed')).toBe('false')
    })

    it('新建词条：搜索栏旁的按钮开表单，提交后落盘并回到列表', async () => {
        const user = userEvent.setup()
        requestMock.mockImplementation((method: string) => {
            if (method === 'pressAi/savePromptTag') {
                return Promise.resolve({ ...TAG, id: '人物::基础::少女', name: '少女', prompt: 'little_girl' })
            }
            return defaultResponse(method)
        })
        renderComposer()

        await user.click(screen.getByRole('button', { name: '提示词' }))
        await user.click(await screen.findByRole('button', { name: '新建词条' }))

        const dialog = await screen.findByRole('dialog', { name: '新建词条' })
        await user.type(within(dialog).getByLabelText('分类'), '人物')
        await user.type(within(dialog).getByLabelText('分组'), '基础')
        await user.type(within(dialog).getByLabelText('词条名'), '少女')
        await user.type(within(dialog).getByLabelText('提示词原文'), 'little_girl')
        await user.click(within(dialog).getByRole('button', { name: '保存' }))

        await waitFor(() => {
            expect(requestMock.mock.calls.find((call) => call[0] === 'pressAi/savePromptTag')?.[1]).toEqual({
                object: '人物',
                attribute: '基础',
                name: '少女',
                prompt: 'little_girl',
            })
        })
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    })

    it('编辑词条：表单回填原文，改名后已挂芯片跟着换新标识', async () => {
        const user = userEvent.setup()
        requestMock.mockImplementation((method: string) => {
            if (method === 'pressAi/updatePromptTag') {
                return Promise.resolve({ ...TAG, id: '人物::基础::少女', name: '少女' })
            }
            return defaultResponse(method)
        })
        renderComposer()

        await clickFirstTag(user)
        expect(screen.getByRole('button', { name: '移除女性' })).toBeDefined()

        // 编辑入口常驻 DOM、悬停才可点，jsdom 不做命中测试，可直接点击
        await user.click(await screen.findByRole('button', { name: '编辑女性' }))
        const dialog = await screen.findByRole('dialog', { name: '编辑词条' })
        const nameInput = within(dialog).getByLabelText<HTMLInputElement>('词条名')
        expect(nameInput.value).toBe('女性')
        expect(within(dialog).getByLabelText<HTMLTextAreaElement>('提示词原文').value).toBe('female')

        await user.clear(nameInput)
        await user.type(nameInput, '少女')
        await user.click(within(dialog).getByRole('button', { name: '保存' }))

        await waitFor(() => {
            expect(requestMock.mock.calls.find((call) => call[0] === 'pressAi/updatePromptTag')?.[1]).toEqual({
                previousId: TAG.id,
                object: '人物',
                attribute: '基础',
                name: '少女',
                prompt: 'female',
            })
        })
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
        expect(screen.getByRole('button', { name: '移除少女' })).toBeDefined()
        expect(screen.queryByRole('button', { name: '移除女性' })).toBeNull()
    })

    it('删除词条走二次确认，成功后摘掉对应芯片', async () => {
        const user = userEvent.setup()
        requestMock.mockImplementation((method: string) => {
            if (method === 'pressAi/deletePromptTag') {
                return Promise.resolve({ ...TAG_LIBRARY, objects: [], tags: [] })
            }
            return defaultResponse(method)
        })
        renderComposer()

        await clickFirstTag(user)
        await user.click(await screen.findByRole('button', { name: '删除女性' }))

        // 未确认前不落盘
        expect(requestMock.mock.calls.some((call) => call[0] === 'pressAi/deletePromptTag')).toBe(false)

        const dialog = await screen.findByRole('alertdialog')
        await user.click(within(dialog).getByRole('button', { name: '删除' }))

        await waitFor(() => {
            expect(requestMock.mock.calls.find((call) => call[0] === 'pressAi/deletePromptTag')?.[1]).toEqual({
                id: TAG.id,
            })
        })
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
        expect(screen.queryByRole('button', { name: '移除女性' })).toBeNull()
    })

    it('发送失败时词条芯片随草稿回填', async () => {
        const user = userEvent.setup()
        mockGenerate(() => Promise.reject(new Error('通道不可用')))
        renderComposer()
        const tag = firstTag()

        await clickFirstTag(user)
        await user.click(screen.getByRole('button', { name: '发送' }))

        expect(toastErrorMock).toHaveBeenCalledTimes(1)
        expect(screen.getByRole('button', { name: `移除${tag.name}` })).toBeDefined()
    })

    it('发送后冷静期内的第二次点击不会误取消在途请求', async () => {
        const user = userEvent.setup()
        mockGenerate(() => new Promise<ImageGenerateResult>(() => undefined))
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
        mockGenerate(
            () =>
                new Promise<ImageGenerateResult>((resolve) => {
                    resolveGenerate = resolve
                }),
        )
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
        mockGenerate(() => Promise.reject(new Error('通道不可用')))
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
        expect(generateParams().ratio).toBe('16:9')
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

    it('切换画风写回作品配置', async () => {
        const user = userEvent.setup()
        const onSettingsChange = vi.fn()
        renderComposer({ onSettingsChange })

        // 画风收进单选卡面板：触发器回显当前画风名，先开面板，再点目标画风的单选卡
        await user.click(screen.getByRole('button', { name: '画面风格 自动，点击切换' }))
        await user.click(screen.getByRole('radio', { name: '古风' }))
        expect(onSettingsChange).toHaveBeenCalledWith({ portraitStyle: 'guofeng' satisfies PortraitStyle })

        // 再换一次：触发器已回显新画风，写回仍是同一侧
        await user.click(screen.getByRole('button', { name: '画面风格 古风，点击切换' }))
        await user.click(screen.getByRole('radio', { name: '写实' }))
        expect(onSettingsChange).toHaveBeenLastCalledWith({ portraitStyle: 'realistic' satisfies PortraitStyle })
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

    it('增强提示词时把角色段一并提交，还原仍回到纯正文', async () => {
        const user = userEvent.setup()
        requestMock.mockImplementation((method: string) =>
            method === 'pressAi/enhanceImagePrompt'
                ? Promise.resolve({ text: '雨夜长街，白衣女子负剑而行' })
                : Promise.resolve(GENERATED),
        )
        renderComposer({ initialCharacterId: CHARACTER.id })

        await user.type(inputBox(), '雨夜长街')
        await user.click(screen.getByRole('button', { name: '增强提示词' }))

        expect(requestMock).toHaveBeenCalledWith(
            'pressAi/enhanceImagePrompt',
            {
                dirPath: DIR_PATH,
                text: '雨夜长街\n\n角色：林清\n外形：女性，二十\n身份：剑客\n外貌：白衣负剑',
                promptTags: [],
            },
            expect.any(Number),
        )
        expect(inputBox().value).toBe('雨夜长街，白衣女子负剑而行')

        await user.click(screen.getByRole('button', { name: '还原提示词' }))
        expect(inputBox().value).toBe('雨夜长街')
    })

    it('增强时带上词条标识，改写后摘芯片，还原时连芯片一起补回', async () => {
        const user = userEvent.setup()
        requestMock.mockImplementation((method: string) =>
            method === 'pressAi/enhanceImagePrompt'
                ? Promise.resolve({ text: 'female，雨夜长街' })
                : defaultResponse(method),
        )
        renderComposer()
        const tag = firstTag()

        await clickFirstTag(user)
        await user.type(inputBox(), '雨夜长街')
        await user.click(screen.getByRole('button', { name: '增强提示词' }))

        // 词条只传标识，原文由宿主按 mergePromptTags 合并后改写，与出图同一口径
        expect(requestMock).toHaveBeenCalledWith(
            'pressAi/enhanceImagePrompt',
            { dirPath: DIR_PATH, text: '雨夜长街', promptTags: [tag.id] },
            expect.any(Number),
        )
        // 词条描述已并入改写结果，芯片要摘掉，否则发送时会被宿主二次合并
        expect(screen.queryByRole('button', { name: `移除${tag.name}` })).toBeNull()

        await user.click(screen.getByRole('button', { name: '还原提示词' }))
        expect(inputBox().value).toBe('雨夜长街')
        expect(screen.getByRole('button', { name: `移除${tag.name}` })).toBeDefined()
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

    it('参考图挂芯片后随请求下发路径，只有参考图也能发送', async () => {
        const user = userEvent.setup()
        requestMock.mockImplementation((method: string) =>
            method === 'pressAi/pickReferenceImage'
                ? Promise.resolve({ reference: REFERENCE })
                : defaultResponse(method),
        )
        renderComposer()

        await user.click(screen.getByRole('button', { name: '添加参考图片' }))
        expect(await screen.findByText(REFERENCE.name)).toBeDefined()
        // 正文为空，但挂了参考图，发送必须可用
        expect(screen.getByRole('button', { name: '发送' }).hasAttribute('disabled')).toBe(false)

        await user.click(screen.getByRole('button', { name: '发送' }))
        expect(generateParams().referenceImages).toEqual([REFERENCE.path])
        // 发送即清空：参考图芯片跟着正文一起清掉
        await waitFor(() => expect(screen.queryByText(REFERENCE.name)).toBeNull())
    })

    it('参考图最多三张，达到上限后选图按钮禁用', async () => {
        const user = userEvent.setup()
        let index = 0
        requestMock.mockImplementation((method: string) => {
            if (method !== 'pressAi/pickReferenceImage') {
                return defaultResponse(method)
            }
            index += 1
            return Promise.resolve({
                reference: {
                    path: `d:/vault/ref-${String(index)}.png`,
                    name: `ref-${String(index)}.png`,
                    url: `https://example.test/ref-${String(index)}.png`,
                },
            })
        })
        renderComposer()

        for (let count = 1; count <= 3; count += 1) {
            await user.click(screen.getByRole('button', { name: '添加参考图片' }))
            expect(await screen.findByText(`ref-${String(count)}.png`)).toBeDefined()
        }

        expect(screen.getByRole('button', { name: '参考图已达上限' }).hasAttribute('disabled')).toBe(true)
    })
})
