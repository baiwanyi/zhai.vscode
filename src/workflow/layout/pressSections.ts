/**
 * 写作管理页的分区标识表：类型与运行时白名单同源，导航栏与页面共用。
 * 复用约定：导航渲染读 WORKFLOW_PRESS_SECTIONS，页面与宿主视图请求都经 isWorkflowPressSection 收窄，
 * 不在各处重复写分区字面量。
 * 关键约束：新增分区只改这一处，避免出现「类型里有、校验里缺」导致宿主跳转被静默忽略；
 * 该文件只导出常量与纯函数，不含组件，以免破坏导航栏的 fast refresh 边界。
 */
export const WORKFLOW_PRESS_SECTIONS = [
    'chapter',
    'outline',
    'character',
    'setting',
    'naming',
    'image',
    'proofread',
    'snapshot',
    'chat',
    'usage',
] as const

/** 分区标识：与分区内容一一对应；部分分区（如流程步骤跳转的章节写作）没有独立导航入口 */
export type WorkflowPressSection = (typeof WORKFLOW_PRESS_SECTIONS)[number]

/** 收窄宿主下发的视图标识：不属于本页分区的一律忽略 */
export function isWorkflowPressSection(value: string): value is WorkflowPressSection {
    return (WORKFLOW_PRESS_SECTIONS as readonly string[]).includes(value)
}
