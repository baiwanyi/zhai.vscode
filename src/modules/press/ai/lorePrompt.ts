/**
 * 条目描述生成提示词：把势力 / 地点 / 物品的名称、已有草稿与整份设定折算成一次性生成的对话消息。
 * 复用约定：消息结构复用 ../../ai/provider 的 AiChatMessage，分类白名单取自 shared/types/press；
 * 事实行复用 ./settingFieldPrompt 的 buildSettingFactLines，多行字段进提示词前折成单行（见 ./plainText）。
 * 关键约束：只送已填字段，空字段不写占位；名称是生成的核心事实，同类既有条目只作参照、不得重复展开；
 * 已有草稿时要求在其基础上完善、不另起一稿；篇幅与写作要求按分类分别给出，避免势力被写成一段履历。
 */
import type { AiChatMessage } from '@modules/ai/provider'
import type { LoreDescriptionGenerateRequest, PressLoreKind } from '@shared/types/press'
import { toSingleLine } from './plainText'
import { buildSettingFactLines } from './settingFieldPrompt'

/** 系统提示：限定输出形态与事实边界 */
const SYSTEM_PROMPT = `你是中文网络小说的设定助手。只输出条目描述的正文，不要标题、编号、Markdown、列表符号、引号或解释。
不得编造与已知信息冲突的事实；信息不足时按题材与目标读者做最合理的推断，写具体、可用的内容。`

/** 分类展示名：既用于提示词，也用于「同类既有条目」一行 */
const KIND_LABELS: Readonly<Record<PressLoreKind, string>> = {
    faction: '势力',
    place: '地点',
    item: '物品',
}

interface KindSpec {
    /** 篇幅要求：只写进提示词，不做硬校验 */
    length: string
    /** 该分类必须交代清楚的内容 */
    rules: readonly string[]
}

/** 三个分类各自的篇幅与写作要求 */
const KIND_SPECS: Readonly<Record<PressLoreKind, KindSpec>> = {
    faction: {
        length: '120~200 字',
        rules: [
            '写清它是什么组织、立在哪、由谁把持，以及它想要什么',
            '点明与主角的立场关系（合作、敌对或互相利用）与可利用的破口',
            '关联人物只作关系锚点，不展开人物小传',
        ],
    },
    place: {
        length: '100~180 字',
        rules: [
            '写清位置、地貌或空间结构，让人能想象站在哪里',
            '给出氛围与日常：谁在这里出没、发生过什么',
            '至少留一处危险或秘密，供后续情节落点',
        ],
    },
    item: {
        length: '80~150 字',
        rules: [
            '写清外观与材质，抓住一个有辨识度的细节',
            '交代来历或制作者，以及它在故事里能做什么',
            '有代价或限制就一并写出，避免写成无解道具',
        ],
    },
}

/** 构造条目描述生成消息 */
export function buildLoreDescriptionMessages(request: LoreDescriptionGenerateRequest): AiChatMessage[] {
    return [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(request) },
    ]
}

/** 用户提示：既有设定 + 关联锚点 + 目标条目要求 + 已有草稿 */
function buildUserPrompt(request: LoreDescriptionGenerateRequest): string {
    const label = KIND_LABELS[request.kind]
    const spec = KIND_SPECS[request.kind]
    const facts = buildSettingFactLines(request)
    const lines = facts.length > 0 ? ['已知信息：', ...facts] : ['已知信息：作品设定基本空白，按常见题材自行取舍。']
    const members = toFilledNames(request.members)
    if (members.length > 0) {
        lines.push(`关联人物：${members.join('、')}`)
    }
    const siblings = toFilledNames(request.siblings)
    if (siblings.length > 0) {
        lines.push(`同类既有条目（仅作参照，不要重复展开）：${siblings.join('、')}`)
    }
    lines.push('', `目标条目：${label}「${toSingleLine(request.name)}」（${spec.length}）`)
    lines.push(...spec.rules.map((rule) => `- ${rule}`))
    const current = request.description.trim()
    if (current.length > 0) {
        lines.push(`已有草稿（在此基础上完善，保留可用的事实与专有名词，不要另起一稿）：${current}`)
    }
    lines.push('要求：只输出该条目的描述正文，不要解释思路，也不要复述上面已有的设定。')
    return lines.join('\n')
}

/** 名称列表去空并折成单行：空名不进提示词，避免出现「、、」这类空档 */
function toFilledNames(names: readonly string[]): string[] {
    return names.map((name) => toSingleLine(name)).filter((name) => name.length > 0)
}
