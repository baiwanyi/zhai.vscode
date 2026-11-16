/**
 * 仪表盘展示层纯函数：字数的紧凑展示。
 * 供 press、wechat 等页面的 utils 与组件复用，不做任何宿主请求。
 * 关键约束：字数口径统一在此（万位保留一位小数），避免各页面各写一套格式化。
 */

/** 「万」的换算基数，超过该值改用万位展示 */
const TEN_THOUSAND = 10_000

/** 字数紧凑展示：不足一万原样输出，过万折算「万」并保留一位小数（去掉多余的 .0） */
export function formatWordCount(value: number): string {
    if (value < TEN_THOUSAND) {
        return String(value)
    }
    const wan = value / TEN_THOUSAND
    return `${wan >= 100 ? Math.round(wan) : Number(wan.toFixed(1))} 万`
}
