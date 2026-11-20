/**
 * 颜色工具：把上游给的十六进制底色换算成可读前景色，供徽标在浅底/深底上自适应。
 * 复用约定：纯函数、不依赖 React 与宿主能力，任何前端模块都可直接引用；
 * 只处理 #rgb / #rrggbb，rgb() 等其它形态一律回退白字，调用方无需再写分支。
 * 关键约束：本文件不做合法性白名单收窄（那是取数层的职责），
 * 传入非法颜色只会得到白字，不会抛错也不会返回空值。
 */

/** 短 hex 补成完整 6 位：非 hex 字面量返回 null，由调用方回落到白字 */
function expandHexColor(color: string): string | null {
    const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/iu.exec(color)
    if (short !== null) {
        const [, red, green, blue] = short
        if (red === undefined || green === undefined || blue === undefined) {
            return null
        }
        return `#${red}${red}${green}${green}${blue}${blue}`
    }
    return /^#[0-9a-f]{6}$/iu.test(color) ? color : null
}

/** 按底色亮度选前景色：亮底用深字，暗底与 rgb() 形式用白字 */
export function pickReadableForeground(backgroundColor: string): string {
    const hex = expandHexColor(backgroundColor)
    if (hex === null) {
        return '#ffffff'
    }
    const red = Number.parseInt(hex.slice(1, 3), 16)
    const green = Number.parseInt(hex.slice(3, 5), 16)
    const blue = Number.parseInt(hex.slice(5, 7), 16)
    // 加权亮度近似：0.6 以上视为浅色底
    return (0.299 * red + 0.587 * green + 0.114 * blue) / 255 > 0.6 ? '#1f1f1f' : '#ffffff'
}
