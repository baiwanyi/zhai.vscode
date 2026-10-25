/**
 * 角色卡画面变化：覆盖随机取值、与上一张撞车时强制换项，以及变化方向是否真的进了场景描述消息。
 * 复用约定：随机源由参数注入，测试用固定序列替代 Math.random，断言可以精确到具体词；
 * 请求对象只填参与断言的字段，其余留空串，避免样例数据反过来绑住提示词结构。
 * 关键约束：「每次都不一样」是硬约束，撞车分支必须被断言覆盖，不能只依赖随机性。
 */
import { describe, expect, it } from 'vitest'
import type { PortraitVariation } from '../src/modules/imagegen/ai/portraitVariation'
import type { PortraitGenerateRequest } from '../src/shared/types/press'
import { buildSceneMessages } from '../src/modules/imagegen/ai/portraitScenePrompt'
import { formatVariation, pickVariation } from '../src/modules/imagegen/ai/portraitVariation'

/** 固定随机源：始终取每张候选表的第一项，便于断言具体组合 */
const FIRST_ITEMS = (): number => 0

/** 期望的「第一项」组合：候选表顺序一变，这条断言就该跟着改 */
const FIRST_VARIATION: PortraitVariation = {
    action: '临窗翻书',
    place: '书房窗前',
    light: '清晨薄雾里的冷光',
    pose: '侧身回望镜头',
}

/** 最小可用的人物卡快照：只填断言用得到的字段 */
function createRequest(overrides: Partial<PortraitGenerateRequest> = {}): PortraitGenerateRequest {
    return {
        dirPath: 'press/剑来',
        characterId: '12345678',
        name: '陆远',
        role: '主角',
        gender: '男',
        age: '二十出头',
        height: '一米七八',
        bodyType: '清瘦',
        identity: '书生',
        appearance: '清瘦书生模样',
        traits: ['护短'],
        desire: '让身边人过上好日子',
        weakness: '爱显摆',
        ability: '洞察之眼',
        background: '长流村穷书生',
        relation: '苏璃烟之夫',
        era: '古代',
        genres: ['玄幻'],
        tone: '轻松',
        style: 'guofeng',
        ...overrides,
    }
}

describe('pickVariation', () => {
    it('按注入的随机源取到候选表首项', () => {
        expect(pickVariation(null, FIRST_ITEMS)).toEqual(FIRST_VARIATION)
    })

    it('与上一张完全撞车时强制换一个动作', () => {
        const variation = pickVariation(FIRST_VARIATION, FIRST_ITEMS)

        expect(variation.action).toBe('抚琴调弦')
        expect(variation.place).toBe(FIRST_VARIATION.place)
    })

    it('只要有一项不同就照常采用，不做多余改动', () => {
        const previous: PortraitVariation = { ...FIRST_VARIATION, pose: '抬眼直视镜头' }

        expect(pickVariation(previous, FIRST_ITEMS)).toEqual(FIRST_VARIATION)
    })
})

describe('formatVariation', () => {
    it('四项按 姿态 → 动作 → 地点 → 光线 拼成一句中文', () => {
        expect(formatVariation(FIRST_VARIATION)).toBe('侧身回望镜头，临窗翻书，场景是书房窗前，清晨薄雾里的冷光')
    })
})

describe('buildSceneMessages', () => {
    it('把本次变化方向写进用户消息，并保留人物卡字段', () => {
        const messages = buildSceneMessages(createRequest(), FIRST_VARIATION)
        const userContent = messages[1]?.content ?? ''

        expect(userContent).toContain('本次变化方向：侧身回望镜头，临窗翻书，场景是书房窗前，清晨薄雾里的冷光')
        expect(userContent).toContain('人物：陆远（主角·男）')
    })

    it('系统提示要求动作与地点落在变化方向上', () => {
        const messages = buildSceneMessages(createRequest(), FIRST_VARIATION)
        const systemContent = messages[0]?.content ?? ''

        expect(systemContent).toContain('「本次变化方向」')
        expect(systemContent).toContain('不要反复使用正面笔直站立')
    })
})
