/**
 * 菜单树纯判断：目录判定、子菜单余量、空名兜底、名称字节校验与坐标取节点，供预览与编辑共用同一口径。
 * 复用约定：类型、上限与字节计算取 shared/types/wechat，纯函数，不读状态不发请求；
 * 关键约束：目录以 subButton 是否存在为准，空数组也算目录；名称按 UTF-8 字节计，与宿主 readWechatMenuButtons 同口径；坐标失效一律返回 undefined。
 */
import {
    WECHAT_MENU_SUB_LIMIT,
    WECHAT_MENU_SUB_NAME_BYTES,
    WECHAT_MENU_TOP_NAME_BYTES,
    readByteLength,
    type WechatMenuButton,
} from '@shared/types/wechat'

/** 目录判定：有 subButton 即为目录，空数组也算 */
export function isMenuGroup(button: WechatMenuButton): boolean {
    return button.subButton !== undefined
}

/** 能否继续添加子菜单：未达平台上限，叶子也可转为目录 */
export function canAddSubMenu(button: WechatMenuButton): boolean {
    return (button.subButton?.length ?? 0) < WECHAT_MENU_SUB_LIMIT
}

/** 展示名兜底：空串回落「未命名」 */
export function readMenuDisplayName(name: string): string {
    return name.length > 0 ? name : '未命名'
}

/** 名称是否合法：去空白后非空且 UTF-8 字节数不超平台上限 */
export function isMenuNameValid(name: string, isTop: boolean): boolean {
    const trimmed = name.trim()
    const limit = isTop ? WECHAT_MENU_TOP_NAME_BYTES : WECHAT_MENU_SUB_NAME_BYTES
    return trimmed.length > 0 && readByteLength(trimmed) <= limit
}

/** 按坐标取节点：subIndex 缺省取一级，层级或索引失效返回 undefined */
export function readMenuButton(
    buttons: WechatMenuButton[],
    index: number,
    subIndex?: number,
): WechatMenuButton | undefined {
    const top = buttons[index]
    if (top === undefined) {
        return undefined
    }
    return subIndex === undefined ? top : top.subButton?.[subIndex]
}
