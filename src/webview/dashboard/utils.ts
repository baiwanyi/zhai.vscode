/**
 * 仪表盘展示层纯函数：把文件相对路径归入所属模块，供笔记筛选与模块口径对齐。
 * 供 hooks 与 layout 组件复用，不做任何宿主请求。
 * 关键约束：模块名规则须与宿主 statsRepository.toModuleName 保持一致，任一侧改动都需同步另一侧。
 */

/** 无一级目录的顶层文件归入的模块名（与宿主 statsRepository.ROOT_MODULE_NAME 同步） */
export const ROOT_MODULE_NAME = '根目录'

/** 取相对路径的一级目录名，顶层文件归入「根目录」 */
export function moduleOf(relativePath: string): string {
    const separator = relativePath.indexOf('/')
    return separator > 0 ? relativePath.slice(0, separator) : ROOT_MODULE_NAME
}
