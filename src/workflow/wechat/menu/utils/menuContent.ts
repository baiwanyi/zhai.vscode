/**
 * 菜单内容纯函数：创建各类型的空内容与判断内容是否达到发布下限。
 * 复用约定：类型取 shared/types/wechat，必填口径与宿主 readWechatMenuContent 保持一致；
 * 关键约束：不读状态、不发请求，仅供编辑对话框与内容编辑器共用，避免两处各写一套校验；
 * 图片取永久素材 mediaId，图文取发布后 articleId，小程序取 appid + pagepath + 兜底网页。
 */
import type {
    WechatIssueSummary,
    WechatMaterialSummary,
    WechatMenuButton,
    WechatMenuContent,
    WechatMenuContentKind,
} from '@shared/types/wechat'
import { isHttpUrl } from './linkUrl'

/** 切换类型时只保留新类型需要的字段，不让旧字段跟到保存请求里 */
export function createMenuContent(kind: WechatMenuContentKind): WechatMenuContent {
    if (kind === 'image') {
        return { kind: 'image', materialId: '', mediaId: '', url: '' }
    }
    if (kind === 'news') {
        return { kind: 'news', issueId: '', articleId: '', title: '' }
    }
    if (kind === 'link') {
        return { kind: 'link', linkUrl: '' }
    }
    return { kind: 'miniprogram', appid: '', pagepath: '', miniUrl: '' }
}

/** 内容是否可发布：与宿主收窄函数的必填口径一致，避免用户点了保存才被拒 */
export function isMenuContentComplete(content: WechatMenuContent): boolean {
    if (content.kind === 'image') {
        return (
            (content.materialId ?? '').length > 0 &&
            (content.mediaId ?? '').length > 0 &&
            (content.url ?? '').length > 0
        )
    }
    if (content.kind === 'news') {
        return (
            (content.issueId ?? '').length > 0 &&
            (content.articleId ?? '').length > 0 &&
            (content.title ?? '').length > 0
        )
    }
    if (content.kind === 'miniprogram') {
        if ((content.appid ?? '').length === 0 || (content.pagepath ?? '').length === 0) {
            return false
        }
        return isHttpUrl(content.miniUrl)
    }
    return isHttpUrl(content.linkUrl)
}

/** 图文选择结果的最小契约：与 NewsPicker 回传的批次字段同源 */
export type NewsSelectItem = Pick<WechatIssueSummary, 'id' | 'title' | 'articleCount' | 'articleId'>

/** 图片素材转菜单内容：只取平台下发需要的字段 */
export function toImageContent(material: WechatMaterialSummary): WechatMenuContent {
    return {
        kind: 'image',
        materialId: material.id,
        mediaId: material.mediaId,
        url: material.url,
        materialName: material.name,
    }
}

/** 图文批次转菜单内容：articleId 缺省时留空串，由完整性校验拦下 */
export function toNewsContent(issue: NewsSelectItem): WechatMenuContent {
    return {
        kind: 'news',
        issueId: issue.id,
        articleId: issue.articleId ?? '',
        title: issue.title,
        articleCount: issue.articleCount,
    }
}

/** 内容转平台下发字段：与宿主 CONTENT_KIND_BY_TYPE 的反向映射对称，本地 content 由调用方另行写入 */
export function toMenuPlatformPatch(content: WechatMenuContent): Partial<WechatMenuButton> {
    if (content.kind === 'link') {
        return { type: 'view', url: content.linkUrl }
    }
    if (content.kind === 'news') {
        return { type: 'article_id', articleId: content.articleId ?? '' }
    }
    if (content.kind === 'miniprogram') {
        return {
            type: 'miniprogram',
            appid: content.appid ?? '',
            pagepath: content.pagepath ?? '',
            url: content.miniUrl ?? '',
        }
    }
    return { type: 'media_id', mediaId: content.mediaId ?? '' }
}
