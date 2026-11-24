/**
 * 按作品设定生成卷纲提示词：把故事核、世界观与人物折算成一次分卷请求。
 * 复用约定：消息结构复用 ../../ai/provider 的 AiChatMessage；已填设定的事实行由 ./settingFieldPrompt 的
 * buildSettingFactLines 统一产出，避免与设定生成两处各写一份口径。
 * 关键约束：只要求输出卷级字段（卷名 / 预计章节数 / 核心事件 / 主要情节 / 关键转折 / 卷末结果），
 * 不生成任何章纲；卷名必须带「第N卷」前缀；输出为纯 JSON 数组，解析与截断在 pressAiService 侧完成。
 */
import type { AiChatMessage } from '@modules/ai/provider'
import type { VolumeOutlinesGenerateRequest } from '@shared/types/press'
import { toSingleLine } from './plainText'
import { buildSettingFactLines } from './settingFieldPrompt'

/** 系统提示：限定输出形态与职责边界 */
const SYSTEM_PROMPT = `你是中文网络小说的分卷策划。作者给出了作品设定，你要把全书拆成若干卷的卷纲。
只输出一个 JSON 数组，不要解释、不要标题、不要 Markdown 代码围栏。
数组每一项的格式固定为 {"name":"第1卷 卷名","expectedChapters":30,"coreEvent":"这一卷发生了什么","mainPlot":["情节一","情节二"],"turningPoints":["转折一"],"result":"卷末留下什么"}，不要增删字段。
卷名必须以「第N卷」开头且卷序连续；不得编造与作品设定冲突的势力、规则或人物。`

/** 核心事件的篇幅：写满因果但不啰嗦 */
const CORE_EVENT_HINT = '80~200 字'

/** 卷末结果的篇幅 */
const RESULT_HINT = '40~120 字'

/** 期望卷数的说明：0 表示交给模型按故事规模推断 */
function readVolumeCountHint(request: VolumeOutlinesGenerateRequest): string {
    return request.volumeCount > 0
        ? `期望卷数：${String(request.volumeCount)} 卷（卷序连续，多余篇幅并入最后一卷）`
        : '期望卷数：按目标字数与故事规模自行建议 2~6 卷'
}

/** 已有卷的说明：覆盖语义已在页面上确认，这里只提示卷名可沿用或改写 */
function readExistingHint(request: VolumeOutlinesGenerateRequest): string {
    if (request.existingNames.length === 0) {
        return '现有卷：无，从第1卷开始规划'
    }
    const names = request.existingNames.map((name) => toSingleLine(name)).join('、')
    return `现有卷：${names}（本次生成会按卷序覆盖它们的卷纲，卷名可沿用或改写；章节内容不受影响）`
}

/** 用户提示：作品设定 → 人物 → 分卷要求 → 写作要求 */
function buildUserPrompt(request: VolumeOutlinesGenerateRequest): string {
    const settingFacts = buildSettingFactLines(request.setting)
    const cast = request.characters.length > 0 ? request.characters.join('、') : '尚未创建人物卡'
    return [
        '【作品设定】',
        ...(settingFacts.length > 0 ? settingFacts : ['设定尚未填写，按常见题材自行取舍']),
        '',
        '【人物】',
        `可出场人物：${cast}`,
        '',
        '【分卷要求】',
        readVolumeCountHint(request),
        readExistingHint(request),
        '',
        '【写作要求】',
        `- coreEvent 取 ${CORE_EVENT_HINT}：这一卷谁因为什么必须去做什么，代价是什么`,
        '- mainPlot 是这一卷的情节条目，按发生顺序写 3~8 条，一条一件事，不写章号',
        '- turningPoints 写 1~3 条真正改变走向的转折',
        `- result 取 ${RESULT_HINT}：卷末目标达成或失败、付出的代价、留下的新问题`,
        '- expectedChapters 取整卷章数，10~80 之间的整数',
        '- 只输出 JSON 数组，不要任何解释文字',
    ].join('\n')
}

/** 构造按作品设定生成卷纲的消息 */
export function buildVolumeOutlinesMessages(request: VolumeOutlinesGenerateRequest): AiChatMessage[] {
    return [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(request) },
    ]
}
