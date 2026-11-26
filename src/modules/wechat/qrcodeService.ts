/**
 * 关注二维码服务：按账号生成永久场景二维码，回传可直接渲染的内联图片。
 * 复用约定：账号与 Token 取用走 accountToken，票据与图片下载走 openapi，结果类型取 shared/types/wechat；
 * 图片内联为 data URI，与封面原图同口径，绕开 Webview CSP 对微信图片域名的限制。
 * 关键约束：每个账号的 scene 固定且结果按账号缓存——永久二维码有创建配额，重复点击不得反复创建；
 * 失败结果不缓存以便重试，票据与图片都不落盘，密钥不进入返回值。
 */
import type { WechatAccountQrcodeResult } from '@shared/types/wechat'
import { requireWechatToken } from './accountToken'
import { fetchWechatQrcodeImage, fetchWechatQrcodeTicket } from './openapi'
import type { WechatTokenAccessDeps } from './accountToken'

/** 关注场景前缀：与账号 id 拼成固定 scene_str，同一账号始终对应同一张二维码 */
const FOLLOW_SCENE_PREFIX = 'zhai-follow-'

export class WechatQrcodeService {
    /** 账号 id → 二维码 data URI：有效期与宿主进程一致 */
    private readonly cache = new Map<string, string>()

    public constructor(private readonly deps: WechatTokenAccessDeps) {}

    /** 取关注二维码：命中缓存直接返回，未命中才走平台创建与下载 */
    public async get(accountId: string): Promise<WechatAccountQrcodeResult> {
        const cached = this.cache.get(accountId)
        if (cached !== undefined) {
            return { dataUrl: cached }
        }
        const { accessToken } = await requireWechatToken(this.deps, accountId)
        const ticket = await fetchWechatQrcodeTicket(accessToken, `${FOLLOW_SCENE_PREFIX}${accountId}`)
        if (!ticket.ok) {
            throw new Error(ticket.message)
        }
        const image = await fetchWechatQrcodeImage(ticket.data)
        if (!image.ok) {
            throw new Error(image.message)
        }
        this.cache.set(accountId, image.data)
        return { dataUrl: image.data }
    }
}
