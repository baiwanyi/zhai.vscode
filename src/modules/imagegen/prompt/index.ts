/**
 * 生图提示词的唯一入口：把「改提示词该看哪个文件」列成一张表，跨层无法合并的几处也在此点名。
 * 复用约定：宿主侧一律从本文件取拼装、规则、画风、指令与限额，新增提示词模块先在此登记并补一行导航；
 * 前端与共享的提示词代码不在本目录（见下表），调整任一侧口径时另一侧必须同步。
 * 关键约束：本目录只放「文本怎么来、怎么拼」，请求字段校验、落盘、配额与侧车一律留在服务层；
 * 词库内容不随扩展打包：目录由 zhai.prompt.rootPath 决定，留空为 {存储根}/prompt/tags/*.md。
 *
 * ── 改提示词导航 ───────────────────────────────────────────────
 * 拼装顺序 / 负向前缀   modules/imagegen/prompt/finalPrompt.ts
 * 画风描述              modules/imagegen/prompt/styleHints.ts
 * 出图指令话术          modules/imagegen/prompt/instruction.ts
 * 增强改写要求          modules/imagegen/prompt/enhancePrompt.ts
 * 规则文件读写          modules/imagegen/prompt/ruleService.ts
 * 词库文件读写          modules/imagegen/prompt/tagService.ts
 * 词库 md 格式规范      docs/modules/imagegen.md（3.4「词库 md 格式规范」）
 * 词库 md 解析          modules/imagegen/prompt/tagMarkdown.ts
 * 各段长度 / 条数上限   modules/imagegen/prompt/limits.ts
 * 正文与角色段          workflow/imagegen/prompt/promptSections.ts
 * 作品设定上下文        workflow/imagegen/prompt/promptSections.ts
 * 比例意图关键词        workflow/imagegen/prompt/ratioIntent.ts
 * 词条权重剥离          shared/utils/promptTag.ts
 * 词库内容              {词库目录}/tags/*.md（zhai.prompt.rootPath，留空为存储根下的 prompt）
 * 预览图                {词库目录}/images/{分类}/{分组}/{词条}.webp，哈希兜底 sha1 前 10 位
 * 提示词目录归属        modules/common/promptRoot.ts（tags / images / rules 三项由同一父目录派生）
 */
export { composeImagePrompt, type ImagePromptParts } from './finalPrompt'
export { PromptRuleService } from './ruleService'
export { PromptTagService } from './tagService'
export { parseTagId, parseTagMarkdown, serializeTagMarkdown, tagIdOf, type TagMarkdownEntry } from './tagMarkdown'
export { STYLE_HINTS } from './styleHints'
export { buildImageInstruction, type ImageInstructionInput } from './instruction'
export { ENHANCE_SYSTEM_PROMPT } from './enhancePrompt'
export {
    MAX_CONTEXT_LENGTH,
    MAX_CONTEXTS,
    MAX_PROMPT_LENGTH,
    MAX_PROMPT_TAG_LENGTH,
    MAX_PROMPT_TAGS,
    MAX_RULE_CONTENT,
    MAX_RULE_NAME,
    MAX_RULE_TOTAL_LENGTH,
    MAX_RULES,
    MAX_TAG_ID_LENGTH,
    MAX_TAG_LABEL,
} from './limits'
