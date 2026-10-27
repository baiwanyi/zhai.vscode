/**
 * 生图提示词的唯一入口：把「改提示词该看哪个文件」列成一张表，跨层无法合并的几处也在此点名。
 * 复用约定：宿主侧一律从本文件取拼装、规则、画风、指令与限额，新增提示词模块先在此登记并补一行导航；
 * 前端与共享的提示词代码不在本目录（见下表），调整任一侧口径时另一侧必须同步。
 * 关键约束：本目录只放「文本怎么来、怎么拼」，请求字段校验、落盘、配额与侧车一律留在服务层；
 * 词库内容是构建产物，改内容走上游分片与 scripts/build-prompt-tags.mjs，不手改 JSON。
 *
 * ── 改提示词导航 ───────────────────────────────────────────────
 * 拼装顺序 / 负向前缀   modules/imagegen/prompt/finalPrompt.ts
 * 画风描述              modules/imagegen/prompt/styleHints.ts
 * 出图指令话术          modules/imagegen/prompt/instruction.ts
 * 增强改写要求          modules/imagegen/prompt/enhancePrompt.ts
 * 规则文件读写          modules/imagegen/prompt/ruleService.ts
 * 各段长度 / 条数上限   modules/imagegen/prompt/limits.ts
 * 正文与角色段          workflow/imagegen/prompt/promptSections.ts
 * 作品设定上下文        workflow/imagegen/prompt/promptSections.ts
 * 比例意图关键词        workflow/imagegen/prompt/ratioIntent.ts
 * 词条权重剥离          shared/utils/promptTag.ts
 * 词库内容              scripts/build-prompt-tags.mjs → prompt/data/promptTags.json
 */
export { composeImagePrompt, type ImagePromptParts } from './finalPrompt'
export { PromptRuleService } from './ruleService'
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
} from './limits'
