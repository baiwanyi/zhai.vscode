/**
 * 提示词分类栏样式：一级分类与二级分组各一套「栏体 + 选中项」配色，供提示词面板共用。
 * 复用约定：Tailwind 原子类以常量形式给出，调用方直接传给 PromptCategoryRail 的 className / itemClassName。
 * 关键约束：本文件只放样式常量，不含组件与逻辑——否则会破坏分类栏组件的 fast refresh 边界。
 */
/** 一级分类栏：窄且底色深，与右侧分组栏拉开层级 */
export const PROMPT_OBJECT_RAIL_CLASS = 'w-32 shrink-0 overflow-y-auto bg-muted p-1.5'

/** 一级分类项：选中态用主色实心 */
export const PROMPT_OBJECT_ITEM_CLASS =
    'hover:bg-white/5 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground'

/** 二级分组栏：略宽、浅一档底色，与一级分类栏区分主次 */
export const PROMPT_ATTRIBUTE_RAIL_CLASS = 'w-40 shrink-0 overflow-y-auto bg-muted/50 p-1.5'

/** 二级分组项：右端带该组词条数，选中态用次级色块 */
export const PROMPT_ATTRIBUTE_ITEM_CLASS = 'data-[state=on]:bg-secondary data-[state=on]:text-foreground'
