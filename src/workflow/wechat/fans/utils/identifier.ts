/**
 * 用户标识脱敏：列表、详情与检索提示统一只展示尾部片段。
 * 复用约定：唯一入口 readIdentifierTail，默认保留 6 位，调用方可按场景调整长度；
 * 纯字符串处理，不依赖 React 与宿主协议，可在界面与测试里直接复用。
 * 关键约束：短串原样返回而不是补前缀，避免短 openid 被打码后反而更难辨认；
 * 本函数只用于展示，完整 OpenID / UnionID 的复制必须走各自的按需复制通道。
 */

/** 默认保留的尾部字符数：足以区分用户，又不至于还原完整标识 */
export const IDENTIFIER_TAIL_LENGTH = 6

/** 只保留尾部片段：超长时前置省略号，短串原样返回 */
export function readIdentifierTail(value: string, tailLength: number = IDENTIFIER_TAIL_LENGTH): string {
    return value.length > tailLength ? `…${value.slice(-tailLength)}` : value
}
