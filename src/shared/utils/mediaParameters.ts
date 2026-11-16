/**
 * 生图参数解析：把磁盘或请求里的原始记录收窄为合法的 MediaParameters。
 * 复用约定：比例与画风白名单取自 @shared/types 的 isImageRatio / isPortraitStyle，
 * 存储层读取与旧库迁移共用本函数，收窄口径只此一处。
 * 关键约束：任一必填字段非法即整条丢弃，绝不写入猜测值；
 * enhancedFrom 缺失或非字符串一律记为 null，调用方不得赋予其它语义。
 */
import { isImageRatio } from '@shared/types/imageRatio'
import { isPortraitStyle } from '@shared/types/imageStyle'
import type { MediaParameters } from '@shared/types/mediaParameters'

/** 单条参数收窄：任一必填字段不合法即整条丢弃，避免把脏数据写回界面 */
export function parseMediaParameters(value: unknown): MediaParameters | null {
    if (typeof value !== 'object' || value === null) {
        return null
    }
    const record = value as Record<string, unknown>
    if (typeof record.prompt !== 'string' || !isImageRatio(record.ratio)) {
        return null
    }
    if (!isPortraitStyle(record.style)) {
        return null
    }
    return {
        prompt: record.prompt,
        ratio: record.ratio,
        style: record.style,
        enhancedFrom: typeof record.enhancedFrom === 'string' ? record.enhancedFrom : null,
    }
}
