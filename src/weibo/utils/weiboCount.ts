/**
 * 互动数展示：万级以上折成「x.x万」，与微博客户端同口径，避免长数字把一行撑宽。
 * 复用约定：只做纯格式化、不做四舍五入到十位等业务判断；调用方决定什么时候展示。
 * 关键约束：不足一万按原文显示；十万级以上不再保留小数（8.3万 / 123万），
 * 输入为非有限数或负数时按 0 处理，避免把异常数据渲染成 NaN。
 */
export function formatWeiboCount(value: number): string {
    if (!Number.isFinite(value) || value <= 0) {
        return '0'
    }
    if (value < 10_000) {
        return String(Math.trunc(value))
    }
    const scaled = value / 10_000
    // 十万级以上保留小数没有信息量，直接取整
    if (scaled >= 100) {
        return `${String(Math.round(scaled))}万`
    }
    return `${scaled.toFixed(1).replace(/\.0$/u, '')}万`
}
