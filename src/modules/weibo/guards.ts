/**
 * 微博取数层的通用类型守卫：把上游不可信 JSON 收敛成确定类型，供各网页版 ajax 适配层复用。
 * 复用约定：只放与业务无关的判空与类型收窄，不引入任何模块内依赖，避免形成新的横向耦合。
 * 关键约束：isRecord 排除数组与 null；toText 只接受 string/number（布尔与对象按空串）；
 * toCount 只认正有限数并向下取整，数字字符串不在此处理，转发列表另有口径须自行实现。
 */

/** 是否为普通对象：数组与 null 都排除在外 */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 仅接受字符串与数字并转文本，其余类型返回空串，避免对象被隐式转成 [object Object] */
export function toText(value: unknown): string {
    return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

/** 计数取值：非正数或非有限数一律按 0 */
export function toCount(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
}
