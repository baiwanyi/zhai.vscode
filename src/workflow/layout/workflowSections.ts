/**
 * 工作流分区标识表：类型与运行时白名单同源，导航栏与各模块页面共用，作品、笔记与公众号共享同一份清单。
 * 复用约定：分区标识以本文件为准，侧栏入口清单见 WorkflowNav（入口可只覆盖部分分区——chapter 没有独立
 * 导航项，仅由流程步骤跳转进入）；页面与宿主视图请求都经 isWorkflowSection 收窄，
 * 不在各处重复写分区字面量。
 * 关键约束：新增分区只改这一处，避免出现「类型里有、校验里缺」导致宿主跳转被静默忽略；
 * 该文件只导出常量与纯函数，不含组件，以免破坏导航栏的 fast refresh 边界。
 */
export const WORKFLOW_SECTIONS = [
    'chapter',
    'outline',
    'character',
    'setting',
    'naming',
    'menu',
    'material',
    'stats',
    'comment',
    'fans',
    'push',
    'media',
    'proofread',
    'snapshot',
    'chat',
    'usage',
] as const

/** 分区标识：与分区内容一一对应；部分分区（如流程步骤跳转的章节写作）没有独立导航入口 */
export type WorkflowSection = (typeof WORKFLOW_SECTIONS)[number]

/** 收窄宿主下发的视图标识：不属于本页分区的一律忽略 */
export function isWorkflowSection(value: string): value is WorkflowSection {
    return (WORKFLOW_SECTIONS as readonly string[]).includes(value)
}
