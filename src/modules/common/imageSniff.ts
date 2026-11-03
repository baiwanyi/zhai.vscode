/**
 * 图片格式嗅探：按文件头魔数判定真实类型，扩展名与文件名一律不参与判断。
 * 复用约定：媒体上传与参考图选择共用这一份判定，落盘扩展名由 mime 反查，
 * 与 @shared/types/media 的图片扩展名白名单（png / jpeg / webp / gif）保持同一口径。
 * 关键约束：只看前 12 字节，不读全量数据；无法识别返回 null，由调用方拒绝该文件而不是猜测格式。
 */

/** 受支持的图片 MIME */
export type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** 落盘扩展名：统一小写、不带点 */
export type ImageExtension = 'png' | 'jpg' | 'webp' | 'gif'

/** 按文件头判定图片类型：顺序即优先级，先命中先返回 */
export function sniffImageMime(bytes: Uint8Array): ImageMimeType | null {
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
        return 'image/png'
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return 'image/jpeg'
    }
    if (
        bytes.length >= 12 &&
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
    ) {
        return 'image/webp'
    }
    if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
        return 'image/gif'
    }
    return null
}

/** MIME 转落盘扩展名：统一小写，不带点 */
export function toImageExtension(mime: ImageMimeType): ImageExtension {
    if (mime === 'image/jpeg') {
        return 'jpg'
    }
    if (mime === 'image/webp') {
        return 'webp'
    }
    if (mime === 'image/gif') {
        return 'gif'
    }
    return 'png'
}
