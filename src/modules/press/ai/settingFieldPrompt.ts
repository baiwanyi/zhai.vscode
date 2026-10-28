/**
 * 设定字段生成提示词：按作品名 / 简介 / 一句话梗概 / 开篇灵感 / 核心冲突五类，
 * 把作品已填的定位、世界观与故事信息折算成一次性生成的对话消息。
 * 复用约定：消息结构复用 ../../ai/provider 的 AiChatMessage，字段名与白名单取自 shared/types/press；
 * 多行字段进提示词前统一折成单行（见 ./plainText）。
 * 关键约束：只送已填字段，空字段不写占位；目标字段自身不重复列出，已有草稿时要求在其基础上完善、不另起一稿；
 * 篇幅与「只输出正文」的约束按字段分别给出，避免作品名被写成一段话。
 */
import type { AiChatMessage } from '@modules/ai/provider'
import type { SettingFieldGenerateRequest, SettingFieldKey } from '@shared/types/press'
import { toSingleLine } from './plainText'

/** 系统提示：限定输出形态与事实边界 */
const SYSTEM_PROMPT = `你是中文网络小说的设定助手。只输出目标字段的正文，不要标题、编号、Markdown、列表符号、引号或解释。
不得编造与已知信息冲突的事实；信息不足时按题材与目标读者做最合理的推断，写具体、可用的内容。`

/** 字段展示名：既用于提示词，也用来在事实行里排除目标字段 */
const FIELD_LABELS: Readonly<Record<SettingFieldKey, string>> = {
    title: '作品名',
    summary: '简介',
    logline: '一句话梗概',
    opening: '开篇灵感',
    conflict: '核心冲突',
}

interface FieldSpec {
    /** 篇幅要求：只写进提示词，不做硬校验 */
    length: string
    /** 该字段必须交代清楚的内容 */
    rules: readonly string[]
}

/** 五个字段各自的篇幅与写作要求 */
const FIELD_SPECS: Readonly<Record<SettingFieldKey, FieldSpec>> = {
    title: {
        length: '6~14 个字',
        rules: [
            '一个能直接当书名用的标题，不带书名号、不带副标题，不堆「之」「的」',
            '要能看出题材或金手指，避免只靠「重生」「系统」这类套路词拼出来的组合',
        ],
    },
    summary: {
        length: '120~200 字',
        rules: ['说清主角是谁、要做什么、好看在哪里，可留一个悬念', '用陈述句，不写「本书讲述了」这类开场套话'],
    },
    logline: {
        length: '30~60 字，硬上限 120 字',
        rules: ['一句话讲完「谁，在什么处境下，要做什么，代价是什么」', '不分段、不排比、不铺垫背景'],
    },
    opening: {
        length: '80~160 字',
        rules: ['第一章开篇的画面或事件，落在一个具体场景里', '结尾留一个钩子（疑问、异常或冲突），不写后续纲要'],
    },
    conflict: {
        length: '60~120 字',
        rules: ['写清主角要什么、谁在阻拦、失败会失去什么', '对抗方要具体到人或势力，不写「命运」这类抽象阻力'],
    },
}

/** 构造设定字段生成消息 */
export function buildSettingFieldMessages(request: SettingFieldGenerateRequest): AiChatMessage[] {
    return [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(request) },
    ]
}

/** 用户提示：已知信息 + 目标字段要求 + 已有草稿 */
function buildUserPrompt(request: SettingFieldGenerateRequest): string {
    const label = FIELD_LABELS[request.field]
    const spec = FIELD_SPECS[request.field]
    const facts = buildFactLines(request)
    const current = toSingleLine(request[request.field])
    const lines = facts.length > 0 ? ['已知信息：', ...facts] : ['已知信息：其它字段都还没填，按常见设定自行取舍。']
    lines.push('', `目标字段：${label}（${spec.length}）`, ...spec.rules.map((rule) => `- ${rule}`))
    if (current.length > 0) {
        lines.push(`已有草稿（在此基础上完善，保留可用的事实与专有名词，不要另起一稿）：${current}`)
    }
    lines.push('要求：只输出该字段的正文，不要解释思路，也不要复述上面已有的设定。')
    return lines.join('\n')
}

/** 已填信息折算成「键：值」事实行：按定位 → 世界观 → 故事 → 其他排列，目标字段自身不列出 */
function buildFactLines(request: SettingFieldGenerateRequest): string[] {
    const facts: readonly (readonly [string, string])[] = [
        ['目标读者', request.audience],
        ['题材', request.genres.join('、')],
        ['时代', request.era],
        ['时间档位', request.period],
        ['地点档位', request.place],
        ['世界观总述', request.worldview],
        ['地理', request.geography],
        ['势力', request.factions],
        ['力量体系', request.powerSystem],
        ['核心概念', request.concepts],
        ['金手指类型', request.goldenFingerType],
        ['金手指能力', request.goldenFingerAbility],
        ['金手指代价', request.goldenFingerCost],
        ['作品名', request.title],
        ['简介', request.summary],
        ['一句话梗概', request.logline],
        ['开篇灵感', request.opening],
        ['核心冲突', request.conflict],
        ['结局倾向', request.ending],
        ['叙事视角', request.perspective],
        ['叙事结构', request.narrative],
        ['语言风格', request.tone],
        ['参考作品', request.references],
        ['补充信息', request.extra],
    ]
    const targetLabel = FIELD_LABELS[request.field]
    return facts
        .filter(([label]) => label !== targetLabel)
        .map(([label, value]) => [label, toSingleLine(value)] as const)
        .filter(([, value]) => value.length > 0)
        .map(([label, value]) => `${label}：${value}`)
}
