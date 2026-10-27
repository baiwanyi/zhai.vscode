/**
 * 提示词限额契约：正文、词条、上下文、规则四类文本的长度与条数上限集中在此。
 * 复用约定：出图服务与规则服务共用同一份数值，前端只做可发送判定，真正的截断与丢弃一律以本文件为准。
 * 关键约束：上限只收紧不放宽，放宽会让拼装结果挤占画面描述；规则条数与总长同时生效，先到者截断；
 * 规则名上限同时兼作规则标识（芯片值）上限，两处不得各写一份。
 */

/** 提示词正文长度上限：远超正常拼装结果，超出视为异常请求 */
export const MAX_PROMPT_LENGTH = 4000

/** 词条条数上限：与前端可选芯片数量同量级，超出视为异常请求 */
export const MAX_PROMPT_TAGS = 20

/** 单词条原文长度上限 */
export const MAX_PROMPT_TAG_LENGTH = 512

/** 上下文段数上限：「添加上下文」菜单的项数有限，超出视为异常请求 */
export const MAX_CONTEXTS = 4

/** 单段上下文长度上限：作品设定展开后通常几百字，超出部分截断 */
export const MAX_CONTEXT_LENGTH = 1500

/** 单次出图并入的规则条数上限 */
export const MAX_RULES = 5

/** 单次出图并入的规则正文总长上限：多条规则合计超出即按顺序截断 */
export const MAX_RULE_TOTAL_LENGTH = 3000

/** 规则名长度上限：文件名主干，同时作为规则标识（芯片值）上限 */
export const MAX_RULE_NAME = 40

/** 单条规则正文长度上限 */
export const MAX_RULE_CONTENT = 4000
