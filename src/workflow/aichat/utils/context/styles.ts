/**
 * 上下文菜单的共用视觉常量：行内图标、非菜单场景的行、子菜单触发器与面板宽度。
 * 复用约定：来源子菜单、入口清单、规则子菜单与作品浮层都从这里取类名，同一套规格只维护一份。
 * 关键约束：图标尺寸必须与 WorkflowNav 的分区图标一致；普通行与菜单项同高同间距，
 * 否则作品浮层与下拉菜单并排时行高会错位。
 */
export const CONTEXT_ICON_CLASS = 'size-3.5 shrink-0 text-muted-foreground'

export const CONTEXT_PLAIN_ROW_CLASS =
    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60'

export const CONTEXT_SUB_TRIGGER_CLASS = 'gap-2'

export const CONTEXT_SUB_PANEL_CLASS = 'w-64'

/** 点选型条目按钮：人物网格与设定条目共用，点击即加入上下文，提交中整体降透明度 */
export const CONTEXT_PICK_BUTTON_CLASS =
    'flex min-w-0 items-center gap-1.5 rounded-md border border-border px-2 py-1 text-left text-sm hover:bg-muted/60 disabled:opacity-50'
