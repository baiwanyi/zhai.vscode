/**
 * 设定字段生成提示词：按作品名、故事内核四项与世界观 / 金手指的描述类字段，
 * 把作品已填的定位、世界观与故事信息折算成一次性生成的对话消息。
 * 复用约定：消息结构复用 ../../ai/provider 的 AiChatMessage，字段名与白名单取自 shared/types/press；
 * 事实行由本文件的 buildSettingFactLines 统一产出，条目描述提示词（./lorePrompt）复用同一份；
 * 多行字段进提示词前统一折成单行（见 ./plainText）。
 * 关键约束：只送已填字段，空字段不写占位；目标字段自身不重复列出，已有草稿时要求在其基础上完善、不另起一稿；
 * 篇幅与「只输出正文」的约束按字段分别给出，避免作品名被写成一段话。
 */
import type { AiChatMessage } from '@modules/ai/provider'
import type { SettingFieldGenerateRequest, SettingFieldKey, SettingSnapshot } from '@shared/types/press'
import { toSingleLine } from './plainText'

/** 系统提示：限定输出形态与事实边界 */
const SYSTEM_PROMPT = `你是中文网络小说的设定助手。只输出目标字段的正文，不要标题、编号、Markdown、列表符号、引号或解释。
正文写成连续的一段话，不要换行分条——写入文档时每个字段只占一行键值。
不得编造与已知信息冲突的事实；信息不足时按题材与目标读者做最合理的推断，写具体、可用的内容。`

/** 字段展示名：既用于提示词，也用来在事实行里排除目标字段 */
const FIELD_LABELS: Readonly<Record<SettingFieldKey, string>> = {
    title: '作品名',
    summary: '简介',
    logline: '一句话梗概',
    opening: '开篇灵感',
    conflict: '核心冲突',
    worldview: '世界观总述',
    geography: '地理格局',
    era: '时代舞台',
    factions: '势力格局',
    powerSystem: '力量体系',
    concepts: '核心概念',
    taboo: '禁忌设定',
    goldenFingerAbility: '金手指能力',
    goldenFingerCost: '金手指代价',
    goldenFingerLimit: '金手指限制',
    goldenFingerUpgrade: '升级体系',
}

interface FieldSpec {
    /** 篇幅要求：只写进提示词，不做硬校验 */
    length: string
    /** 该字段必须交代清楚的内容 */
    rules: readonly string[]
}

/** 各字段的篇幅与写作要求 */
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
    worldview: {
        length: '200~400 字',
        rules: [
            '交代世界的形态、力量来源、种族与文明结构，说清这个世界靠什么运转',
            '落到具体的制度、现象或历史事件上，不写「强者为尊」这类空话',
        ],
    },
    geography: {
        length: '60~150 字',
        rules: [
            '写出主要地域、场景与彼此的空间关系：距离、通路与差异',
            '点出主角起点的地域，以及后续故事可能迁移的方向',
        ],
    },
    era: {
        length: '20~60 字',
        rules: ['一句话说清时代舞台：年代、技术与力量水平、社会秩序', '与题材标签一致，不写与本作无关的历史背景'],
    },
    factions: {
        length: '80~200 字',
        rules: [
            '按「势力名 + 一句话定位」连续叙述，写清各方诉求、彼此关系与实力对比',
            '至少给出一股与主角对立的力量，冲突才有落点',
        ],
    },
    powerSystem: {
        length: '80~200 字',
        rules: [
            '写清力量来源、层级划分与晋升条件，包括上限与限制',
            '与金手指区分：体系是人人可走的路，金手指是主角独有的例外',
        ],
    },
    concepts: {
        length: '60~160 字，多个概念用分号分隔',
        rules: [
            '只写作品独有的名词，按「名词：含义」逐条给出，条目之间用分号（；）分隔',
            '给 3~6 条，不重复世界观总述里已经解释清楚的内容',
        ],
    },
    taboo: {
        length: '40~120 字',
        rules: [
            '写作时不得违反的硬约束：禁写的桥段、必须遵守的设定规则、不能崩坏的口径',
            '写成可以直接照做的禁令，不写风格偏好',
        ],
    },
    goldenFingerAbility: {
        length: '80~200 字',
        rules: [
            '说清金手指能给主角什么、如何获得与成长，以及与常规力量体系的差异',
            '落到能直接写进情节的具体用法，避免「全方位无敌」这类模糊表述',
        ],
    },
    goldenFingerCost: {
        length: '60~150 字',
        rules: [
            '写使用金手指要付出的东西：寿命、气血、资源、好感或反噬，与「限制」区分开',
            '代价要能在后续章节反复制造冲突，而不只是开局的设定说明',
        ],
    },
    goldenFingerLimit: {
        length: '50~120 字',
        rules: [
            '写适用范围的硬边界：次数、冷却、生效条件，以及金手指做不到什么',
            '与代价区分：代价是「用了要付什么」，限制是「什么时候根本用不了」',
        ],
    },
    goldenFingerUpgrade: {
        length: '80~200 字',
        rules: [
            '写金手指自身的成长阶段：先解锁什么、分几级、每一级新增什么能力',
            '升级条件要具体（达成事件、消耗资源或满足门槛），不与世界观的力量体系重复',
        ],
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
    const facts = buildSettingFactLines(request, label)
    const current = toSingleLine(request[request.field])
    const lines = facts.length > 0 ? ['已知信息：', ...facts] : ['已知信息：其它字段都还没填，按常见设定自行取舍。']
    lines.push('', `目标字段：${label}（${spec.length}）`, ...spec.rules.map((rule) => `- ${rule}`))
    if (current.length > 0) {
        lines.push(`已有草稿（在此基础上完善，保留可用的事实与专有名词，不要另起一稿）：${current}`)
    }
    lines.push('要求：只输出该字段的正文，不要解释思路，也不要复述上面已有的设定。')
    return lines.join('\n')
}

/** 事实行定义：标签 + 快照字段，顺序即提示词里的排列顺序（定位 → 世界观 → 故事 → 其他） */
const FACT_FIELDS: readonly (readonly [string, keyof SettingSnapshot])[] = [
    ['目标读者', 'audience'],
    ['题材', 'genres'],
    ['时代舞台', 'era'],
    ['时间档位', 'period'],
    ['地点档位', 'place'],
    ['世界观总述', 'worldview'],
    ['地理格局', 'geography'],
    ['势力格局', 'factions'],
    ['力量体系', 'powerSystem'],
    ['核心概念', 'concepts'],
    ['禁忌设定', 'taboo'],
    ['金手指类型', 'goldenFingerType'],
    ['金手指能力', 'goldenFingerAbility'],
    ['金手指代价', 'goldenFingerCost'],
    ['金手指限制', 'goldenFingerLimit'],
    ['升级体系', 'goldenFingerUpgrade'],
    ['作品名', 'title'],
    ['简介', 'summary'],
    ['一句话梗概', 'logline'],
    ['开篇灵感', 'opening'],
    ['核心冲突', 'conflict'],
    ['结局倾向', 'ending'],
    ['叙事视角', 'perspective'],
    ['叙事结构', 'narrative'],
    ['语言风格', 'tone'],
    ['参考作品', 'references'],
    ['补充信息', 'extra'],
]

/**
 * 已填信息折算成「键：值」事实行，空字段不写占位。
 * excludeLabel 用于排除目标字段自身——生成某个字段时不该把它当作既有事实复述一遍。
 */
export function buildSettingFactLines(snapshot: SettingSnapshot, excludeLabel?: string): string[] {
    return FACT_FIELDS.filter(([label]) => label !== excludeLabel)
        .map(([label, key]): readonly [string, string] => {
            const value = snapshot[key]
            return [label, toSingleLine(Array.isArray(value) ? value.join('、') : value)]
        })
        .filter(([, value]) => value.length > 0)
        .map(([label, value]) => `${label}：${value}`)
}
