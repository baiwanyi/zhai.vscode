/**
 * 仪表盘展示层纯函数：把文件相对路径归入所属模块，以及字数的紧凑展示。
 * 供 hooks 与 layout 组件复用，不做任何宿主请求。
 * 关键约束：模块名规则须与宿主 statsRepository.toModuleName 保持一致，任一侧改动都需同步另一侧；
 * 字数口径统一在此（万位保留一位小数），避免各页面各写一套格式化。
 */

/** 无一级目录的顶层文件归入的模块名（与宿主 statsRepository.ROOT_MODULE_NAME 同步） */
export const ROOT_MODULE_NAME = '根目录'

/** 「万」的换算基数，超过该值改用万位展示 */
const TEN_THOUSAND = 10_000

/** 取相对路径的一级目录名，顶层文件归入「根目录」 */
export function moduleOf(relativePath: string): string {
    const separator = relativePath.indexOf('/')
    return separator > 0 ? relativePath.slice(0, separator) : ROOT_MODULE_NAME
}

/** 字数紧凑展示：不足一万原样输出，过万折算「万」并保留一位小数（去掉多余的 .0） */
export function formatWordCount(value: number): string {
    if (value < TEN_THOUSAND) {
        return String(value)
    }
    const wan = value / TEN_THOUSAND
    return `${wan >= 100 ? Math.round(wan) : Number(wan.toFixed(1))} 万`
}
