/**
 * 公众号运营类接口：自定义菜单、粉丝与标签、用户增长统计、留言与关注二维码。
 * 复用约定：JSON 写入类接口走 client 的 postWechatJson（统一 errcode 归一与超时），
 * 查询类接口平台只提供 GET，这里补一个同口径的 getWechatJson；错误码文案复用 client 的错误表。
 * 关键约束：本层只做「发请求 + 收窄报文」，不写库、不拼装业务提示；
 * 报文里的字段名保持平台原样，转换成本模块类型的工作交给调用方服务，便于对照官方文档排查；
 * 二维码图片下载后内联为 data URI，只放行平台返回的 jpeg/png 并限制体积。
 */
import type { WechatMenuButton } from '@shared/types/wechat'
import { describeWechatError, postWechatJson, NETWORK_ERROR_CODE } from './client'
import {
    COMMENT_DELETE_ENDPOINT,
    COMMENT_LIST_ENDPOINT,
    COMMENT_MARK_ENDPOINT,
    COMMENT_REPLY_ENDPOINT,
    COMMENT_UNMARK_ENDPOINT,
    MATERIAL_DELETE_ENDPOINT,
    MENU_CREATE_ENDPOINT,
    MENU_GET_ENDPOINT,
    QRCODE_CREATE_ENDPOINT,
    QRCODE_SHOW_ENDPOINT,
    TAGS_CREATE_ENDPOINT,
    TAGS_DELETE_ENDPOINT,
    TAGS_GET_ENDPOINT,
    TAGS_MEMBERS_BLACKLIST_ENDPOINT,
    TAGS_MEMBERS_GET_BLACKLIST_ENDPOINT,
    TAGS_MEMBERS_TAGGING_ENDPOINT,
    TAGS_MEMBERS_UNBLACKLIST_ENDPOINT,
    TAGS_MEMBERS_UNTAGGING_ENDPOINT,
    TAGS_UPDATE_ENDPOINT,
    USER_GET_ENDPOINT,
    USER_INFO_BATCH_ENDPOINT,
    USER_INFO_UPDATEREMARK_ENDPOINT,
    USERS_CUMULATE_ENDPOINT,
    USERS_SUMMARY_ENDPOINT,
} from './endpoints'

/** 二维码图片体积上限：平台返回的是小尺寸图，超限按异常处理 */
const QRCODE_MAX_BYTES = 2 * 1024 * 1024

/** 菜单尚未配置时平台返回的错误码：按「无菜单」处理，不算失败 */
const MENU_NOT_EXIST_CODE = 46003

/** 查询类接口结果 */
export type WechatApiResult<T> = { ok: true; data: T } | { ok: false; errorCode: number; message: string }

/** GET 请求的超时：与 JSON 写接口一致 */
const GET_TIMEOUT_MS = 15_000

/** 收窄错误文本：与 client 同口径，不依赖前端 utils */
function errorText(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause)
}

/**
 * 通用 GET JSON：平台只对查询类接口提供 GET，报文形状与 POST 一致。
 * 关键约束：与 postWechatJson 一样只返回 errcode 为 0 的报文。
 */
async function getWechatJson(
    token: string,
    endpoint: string,
    params: Record<string, string> = {},
): Promise<WechatApiResult<Record<string, unknown>>> {
    const url = new URL(endpoint)
    url.searchParams.set('access_token', token)
    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value)
    }

    let response: Response
    try {
        response = await fetch(url, { signal: AbortSignal.timeout(GET_TIMEOUT_MS) })
    } catch (cause) {
        return { ok: false, errorCode: NETWORK_ERROR_CODE, message: `无法连接微信接口：${errorText(cause)}` }
    }
    if (!response.ok) {
        return { ok: false, errorCode: NETWORK_ERROR_CODE, message: `微信接口返回 HTTP ${String(response.status)}` }
    }

    let raw: unknown
    try {
        raw = await response.json()
    } catch (cause) {
        return { ok: false, errorCode: NETWORK_ERROR_CODE, message: `微信接口返回无法解析：${errorText(cause)}` }
    }
    if (typeof raw !== 'object' || raw === null) {
        return { ok: false, errorCode: -1, message: '微信接口返回格式异常' }
    }

    const candidate = raw as Record<string, unknown>
    const errorCode = typeof candidate.errcode === 'number' ? candidate.errcode : 0
    if (errorCode !== 0) {
        return { ok: false, errorCode, message: describeWechatError(errorCode).hint }
    }
    return { ok: true, data: candidate }
}

/** 读取菜单：未配置时返回空数组而不是错误 */
export async function fetchWechatMenu(token: string): Promise<WechatApiResult<WechatMenuButton[]>> {
    const outcome = await getWechatJson(token, MENU_GET_ENDPOINT)
    if (!outcome.ok) {
        if (outcome.errorCode === MENU_NOT_EXIST_CODE) {
            return { ok: true, data: [] }
        }
        return outcome
    }
    const buttons = readRemoteButtons(outcome.data.button)
    return { ok: true, data: buttons }
}

/**
 * 收窄平台返回的菜单结构：只保留本模块支持的动作字段。
 * 关键约束：平台可能返回超出本期支持的动作（scancode_push 等），这里保留其 name 与 type，
 * 由服务层在保存前提示用户改成本期支持的动作，而不是静默丢弃导致菜单「消失」。
 */
function readRemoteButtons(value: unknown): WechatMenuButton[] {
    if (!Array.isArray(value)) {
        return []
    }
    const readOne = (item: unknown): WechatMenuButton | null => {
        if (typeof item !== 'object' || item === null) {
            return null
        }
        const candidate = item as Record<string, unknown>
        const name = typeof candidate.name === 'string' ? candidate.name : ''
        if (name.length === 0) {
            return null
        }
        if (Array.isArray(candidate.sub_button) && candidate.sub_button.length > 0) {
            const children = candidate.sub_button
                .map(readOne)
                .filter((child): child is WechatMenuButton => child !== null)
            return { name, subButton: children }
        }
        const type = typeof candidate.type === 'string' ? candidate.type : ''
        if (type === 'click') {
            return { name, type: 'click', key: typeof candidate.key === 'string' ? candidate.key : '' }
        }
        if (type === 'view') {
            return { name, type: 'view', url: typeof candidate.url === 'string' ? candidate.url : '' }
        }
        if (type === 'miniprogram') {
            return {
                name,
                type: 'miniprogram',
                url: typeof candidate.url === 'string' ? candidate.url : '',
                appid: typeof candidate.appid === 'string' ? candidate.appid : '',
                pagepath: typeof candidate.pagepath === 'string' ? candidate.pagepath : '',
            }
        }
        // 其它动作：先按 click 保留名称，服务层保存前会要求用户重新选择动作
        return { name, type: 'click', key: typeof candidate.key === 'string' ? candidate.key : '' }
    }
    return value.map(readOne).filter((item): item is WechatMenuButton => item !== null)
}

/** 覆盖保存菜单：平台是整棵覆盖，没有增量更新 */
export async function saveWechatMenu(token: string, buttons: WechatMenuButton[]): Promise<WechatApiResult<null>> {
    const payload = buttons.map((button) => toPlatformButton(button))
    const outcome = await postWechatJson(token, MENU_CREATE_ENDPOINT, { button: payload })
    return outcome.ok ? { ok: true, data: null } : outcome
}

/** 转为平台字段名：sub_button 为下划线写法，目录节点不带动作字段 */
function toPlatformButton(button: WechatMenuButton): Record<string, unknown> {
    if (button.subButton !== undefined) {
        return { name: button.name, sub_button: button.subButton.map((child) => toPlatformButton(child)) }
    }
    const payload: Record<string, unknown> = { name: button.name, type: button.type ?? 'click' }
    if (button.key !== undefined) {
        payload.key = button.key
    }
    if (button.url !== undefined) {
        payload.url = button.url
    }
    if (button.appid !== undefined) {
        payload.appid = button.appid
    }
    if (button.pagepath !== undefined) {
        payload.pagepath = button.pagepath
    }
    return payload
}

/** 拉取一页关注者 openid：nextOpenid 为空表示从头开始 */
export interface WechatFanPage {
    openids: string[]
    nextOpenid?: string
    total: number
}

/** 读取关注者 openid 列表（单页最多 1 万） */
export async function fetchWechatFanPage(token: string, nextOpenid?: string): Promise<WechatApiResult<WechatFanPage>> {
    const params: Record<string, string> = nextOpenid === undefined ? {} : { next_openid: nextOpenid }
    const outcome = await getWechatJson(token, USER_GET_ENDPOINT, params)
    if (!outcome.ok) {
        return outcome
    }
    const data = outcome.data.data
    const openids =
        typeof data === 'object' && data !== null && Array.isArray((data as { openid?: unknown }).openid)
            ? ((data as { openid: unknown[] }).openid.filter((item): item is string => typeof item === 'string') ?? [])
            : []
    return {
        ok: true,
        data: {
            openids,
            ...(typeof outcome.data.next_openid === 'string' && outcome.data.next_openid.length > 0
                ? { nextOpenid: outcome.data.next_openid }
                : {}),
            total: typeof outcome.data.total === 'number' ? outcome.data.total : openids.length,
        },
    }
}

/** 粉丝资料：平台批量接口一次最多 100 个 openid */
export interface WechatFanProfile {
    openid: string
    unionid?: string
    nickname: string
    avatar?: string
    subscribeStatus: number
    subscribedAt?: string
    remark?: string
    country?: string
    province?: string
    city?: string
    language?: string
    subscribeScene?: string
    qrScene?: string
    tagIds: number[]
}

/** 收窄平台标签 id 数组：只保留正整数 */
function readProfileTagIds(value: unknown): number[] {
    if (!Array.isArray(value)) {
        return []
    }
    const ids = value.filter((item): item is number => typeof item === 'number' && Number.isInteger(item) && item > 0)
    return ids.sort((left, right) => left - right)
}

/** 批量读取粉丝资料：UnionID 仅在账号绑定开放平台时由平台返回 */
export async function fetchWechatFanProfiles(
    token: string,
    openids: string[],
): Promise<WechatApiResult<WechatFanProfile[]>> {
    if (openids.length === 0) {
        return { ok: true, data: [] }
    }
    const body = { user_list: openids.map((openid) => ({ openid, lang: 'zh_CN' })) }
    const outcome = await postWechatJson(token, USER_INFO_BATCH_ENDPOINT, body)
    if (!outcome.ok) {
        return outcome
    }
    const list = outcome.payload.user_info_list
    if (!Array.isArray(list)) {
        return { ok: true, data: [] }
    }
    const profiles = list.map((item): WechatFanProfile => {
        const candidate = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
        const subscribeTime = typeof candidate.subscribe_time === 'number' ? candidate.subscribe_time : 0
        const qrScene =
            typeof candidate.qr_scene === 'number' && candidate.qr_scene > 0
                ? String(candidate.qr_scene)
                : typeof candidate.qr_scene_str === 'string' && candidate.qr_scene_str.length > 0
                  ? candidate.qr_scene_str
                  : undefined
        return {
            openid: typeof candidate.openid === 'string' ? candidate.openid : '',
            ...(typeof candidate.unionid === 'string' && candidate.unionid.length > 0
                ? { unionid: candidate.unionid }
                : {}),
            nickname: typeof candidate.nickname === 'string' ? candidate.nickname : '',
            ...(typeof candidate.headimgurl === 'string' && candidate.headimgurl.length > 0
                ? { avatar: candidate.headimgurl }
                : {}),
            subscribeStatus: typeof candidate.subscribe === 'number' ? candidate.subscribe : 0,
            ...(subscribeTime > 0 ? { subscribedAt: new Date(subscribeTime * 1000).toISOString() } : {}),
            ...(typeof candidate.remark === 'string' && candidate.remark.length > 0
                ? { remark: candidate.remark }
                : {}),
            ...(typeof candidate.country === 'string' && candidate.country.length > 0
                ? { country: candidate.country }
                : {}),
            ...(typeof candidate.province === 'string' && candidate.province.length > 0
                ? { province: candidate.province }
                : {}),
            ...(typeof candidate.city === 'string' && candidate.city.length > 0 ? { city: candidate.city } : {}),
            ...(typeof candidate.language === 'string' && candidate.language.length > 0
                ? { language: candidate.language }
                : {}),
            ...(typeof candidate.subscribe_scene === 'string' && candidate.subscribe_scene.length > 0
                ? { subscribeScene: candidate.subscribe_scene }
                : {}),
            ...(qrScene === undefined ? {} : { qrScene }),
            tagIds: readProfileTagIds(candidate.tagids),
        }
    })
    return { ok: true, data: profiles.filter((profile) => profile.openid.length > 0) }
}

/** 平台标签原样结构：count 为该标签下的粉丝数 */
export interface WechatTagRow {
    id: number
    name: string
    count: number
}

/** 读取账号标签列表 */
export async function fetchWechatTags(token: string): Promise<WechatApiResult<WechatTagRow[]>> {
    const outcome = await getWechatJson(token, TAGS_GET_ENDPOINT)
    if (!outcome.ok) {
        return outcome
    }
    const tags = outcome.data.tags
    if (!Array.isArray(tags)) {
        return { ok: true, data: [] }
    }
    const rows = tags.map((item): WechatTagRow => {
        const candidate = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
        return {
            id: typeof candidate.id === 'number' ? candidate.id : 0,
            name: typeof candidate.name === 'string' ? candidate.name : '',
            count: typeof candidate.count === 'number' ? candidate.count : 0,
        }
    })
    return { ok: true, data: rows.filter((row) => row.id > 0) }
}

/** 运营接口专属错误码：与鉴权错误分开，不透出英文 errmsg */
const FAN_ERROR_HINTS: Readonly<Record<string, string>> = {
    '40164': '调用方 IP 不在公众号后台的 IP 白名单内，请把当前出口 IP 加入白名单',
    '45009': '接口调用超过当日额度，请稍后再试',
    '48001': '该账号未获得此接口权限，请确认主体类型与后台权限',
    '45104': '单个粉丝最多打 20 个标签，请先取消部分标签',
    '40003': 'openid 无效，该用户可能已取关或不属于此账号',
    '45016': '标签名不合法，须为 1~30 个字符',
    '45017': '标签数量已达平台上限（100 个）',
    '45018': '平台内置标签不可删除',
}

/** 用户管理错误码 → 可执行中文提示，未登记的码走兜底 */
export function describeFanError(errorCode: number): string {
    return FAN_ERROR_HINTS[String(errorCode)] ?? '操作失败，请稍后重试'
}

/** 平台新建标签返回的标识 */
export interface WechatCreatedTag {
    id: number
    name: string
}

/** 新建标签：平台成功报文里带回标签 id */
export async function createWechatTag(token: string, name: string): Promise<WechatApiResult<WechatCreatedTag>> {
    const outcome = await postWechatJson(token, TAGS_CREATE_ENDPOINT, { tag: { name } })
    if (!outcome.ok) {
        return outcome
    }
    const tag = (
        typeof outcome.payload.tag === 'object' && outcome.payload.tag !== null ? outcome.payload.tag : {}
    ) as Record<string, unknown>
    return {
        ok: true,
        data: {
            id: typeof tag.id === 'number' ? tag.id : 0,
            name: typeof tag.name === 'string' && tag.name.length > 0 ? tag.name : name,
        },
    }
}

/** 重命名标签 */
export async function updateWechatTag(token: string, id: number, name: string): Promise<WechatApiResult<boolean>> {
    const outcome = await postWechatJson(token, TAGS_UPDATE_ENDPOINT, { tag: { id, name } })
    return outcome.ok ? { ok: true, data: true } : outcome
}

/** 删除标签：平台内置标签会返回专属错误码 */
export async function deleteWechatTag(token: string, id: number): Promise<WechatApiResult<boolean>> {
    const outcome = await postWechatJson(token, TAGS_DELETE_ENDPOINT, { tag: { id } })
    return outcome.ok ? { ok: true, data: true } : outcome
}

/** 批量打标或取消：action 由调用方映射到对应平台接口 */
export async function changeWechatTagMembers(
    token: string,
    openids: string[],
    tagId: number,
    action: 'add' | 'remove',
): Promise<WechatApiResult<boolean>> {
    const endpoint = action === 'add' ? TAGS_MEMBERS_TAGGING_ENDPOINT : TAGS_MEMBERS_UNTAGGING_ENDPOINT
    const outcome = await postWechatJson(token, endpoint, { openid_list: openids, tagid: tagId })
    return outcome.ok ? { ok: true, data: true } : outcome
}

/** 修改备注：空串表示清除 */
export async function updateWechatRemark(
    token: string,
    openid: string,
    remark: string,
): Promise<WechatApiResult<boolean>> {
    const outcome = await postWechatJson(token, USER_INFO_UPDATEREMARK_ENDPOINT, { openid, remark })
    return outcome.ok ? { ok: true, data: true } : outcome
}

/** 拉黑或解除：action 由调用方映射到对应平台接口 */
export async function changeWechatBlacklist(
    token: string,
    openids: string[],
    action: 'block' | 'unblock',
): Promise<WechatApiResult<boolean>> {
    const endpoint = action === 'block' ? TAGS_MEMBERS_BLACKLIST_ENDPOINT : TAGS_MEMBERS_UNBLACKLIST_ENDPOINT
    const outcome = await postWechatJson(token, endpoint, { openid_list: openids })
    return outcome.ok ? { ok: true, data: true } : outcome
}

/** 黑名单分页：平台每次最多返回 1000 个 openid */
export interface WechatBlacklistPage {
    openids: string[]
    nextOpenid?: string
    total: number
}

/** 读取一页黑名单：beginOpenid 为空表示从头开始，用 nextOpenid 续拉下一页 */
export async function fetchWechatBlacklist(
    token: string,
    beginOpenid?: string,
): Promise<WechatApiResult<WechatBlacklistPage>> {
    const body: Record<string, string> =
        beginOpenid === undefined || beginOpenid.length === 0 ? {} : { begin_openid: beginOpenid }
    const outcome = await postWechatJson(token, TAGS_MEMBERS_GET_BLACKLIST_ENDPOINT, body)
    if (!outcome.ok) {
        return outcome
    }
    const data = outcome.payload.data
    const openids =
        typeof data === 'object' && data !== null && Array.isArray((data as { openid?: unknown }).openid)
            ? ((data as { openid: unknown[] }).openid.filter((item): item is string => typeof item === 'string') ?? [])
            : []
    return {
        ok: true,
        data: {
            openids,
            ...(typeof outcome.payload.next_openid === 'string' && outcome.payload.next_openid.length > 0
                ? { nextOpenid: outcome.payload.next_openid }
                : {}),
            total: typeof outcome.payload.total === 'number' ? outcome.payload.total : openids.length,
        },
    }
}

/** 用户增长原始行：按来源分组，同一天可能多行 */
export interface WechatUserSummaryRow {
    date: string
    newUsers: number
    cancelUsers: number
}

/** 累计关注原始行 */
export interface WechatUserCumulateRow {
    date: string
    cumulateUsers: number
}

/**
 * 读取区间内的新增与取消关注。
 * 关键约束：平台按来源拆成多行，这里按日期合并求和，调用方拿到的是「一天的净数」。
 */
export async function fetchWechatUserSummary(
    token: string,
    beginDate: string,
    endDate: string,
): Promise<WechatApiResult<WechatUserSummaryRow[]>> {
    const outcome = await postWechatJson(token, USERS_SUMMARY_ENDPOINT, { begin_date: beginDate, end_date: endDate })
    if (!outcome.ok) {
        return outcome
    }
    const list = outcome.payload.list
    if (!Array.isArray(list)) {
        return { ok: true, data: [] }
    }
    const byDate = new Map<string, WechatUserSummaryRow>()
    for (const item of list) {
        const candidate = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
        const date = typeof candidate.ref_date === 'string' ? candidate.ref_date : ''
        if (date.length === 0) {
            continue
        }
        const current = byDate.get(date) ?? { date, newUsers: 0, cancelUsers: 0 }
        current.newUsers += typeof candidate.new_user === 'number' ? candidate.new_user : 0
        current.cancelUsers += typeof candidate.cancel_user === 'number' ? candidate.cancel_user : 0
        byDate.set(date, current)
    }
    return { ok: true, data: [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date)) }
}

/** 读取区间内的累计关注人数 */
export async function fetchWechatUserCumulate(
    token: string,
    beginDate: string,
    endDate: string,
): Promise<WechatApiResult<WechatUserCumulateRow[]>> {
    const outcome = await postWechatJson(token, USERS_CUMULATE_ENDPOINT, { begin_date: beginDate, end_date: endDate })
    if (!outcome.ok) {
        return outcome
    }
    const list = outcome.payload.list
    if (!Array.isArray(list)) {
        return { ok: true, data: [] }
    }
    const rows = list.map((item): WechatUserCumulateRow => {
        const candidate = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
        return {
            date: typeof candidate.ref_date === 'string' ? candidate.ref_date : '',
            cumulateUsers: typeof candidate.cumulate_user === 'number' ? candidate.cumulate_user : 0,
        }
    })
    return { ok: true, data: rows.filter((row) => row.date.length > 0) }
}

/** 留言接口：全部按「群发消息 msg_data_id + 文章序号 index」定位 */
/** 平台留言行：reply 可能是对象或数组，收窄后在服务层统一 */
export interface WechatCommentRow {
    commentId: number
    openid: string
    /** 平台返回的秒级时间戳 */
    createTime: number
    content: string
    isElected: boolean
    replyContent?: string
}

/** 留言定位参数：index 为文章在本次群发中的序号（0 基） */
export interface WechatCommentTarget {
    msgDataId: string
    index: number
}

/** 读取一页留言：begin 为偏移量，count 为条数 */
export async function fetchWechatComments(
    token: string,
    target: WechatCommentTarget,
    begin: number,
    count: number,
): Promise<WechatApiResult<{ total: number; comments: WechatCommentRow[] }>> {
    const body = {
        msg_data_id: target.msgDataId,
        index: target.index,
        begin,
        count,
        // 0 表示全部留言，避免只看到「精选」而误以为读者没说话
        type: 0,
    }
    const outcome = await postWechatJson(token, COMMENT_LIST_ENDPOINT, body)
    if (!outcome.ok) {
        return outcome
    }
    const list = outcome.payload.comment
    const total = typeof outcome.payload.total === 'number' ? outcome.payload.total : 0
    if (!Array.isArray(list)) {
        return { ok: true, data: { total, comments: [] } }
    }
    const comments = list.map((item): WechatCommentRow => {
        const candidate = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
        return {
            commentId: typeof candidate.user_comment_id === 'number' ? candidate.user_comment_id : 0,
            openid: typeof candidate.openid === 'string' ? candidate.openid : '',
            createTime: typeof candidate.create_time === 'number' ? candidate.create_time : 0,
            content: typeof candidate.content === 'string' ? candidate.content : '',
            isElected: candidate.comment_type === 1,
            ...readReplyContent(candidate.reply),
        }
    })
    return { ok: true, data: { total, comments: comments.filter((row) => row.commentId > 0) } }
}

/** 收窄回复字段：平台可能给对象（单条）或数组（多条），取最后一条作为展示内容 */
function readReplyContent(reply: unknown): { replyContent?: string } {
    if (Array.isArray(reply)) {
        // 先断言成 unknown[]：Array.isArray 收窄出的是 any[]，直接取元素会把 any 带进后续判断
        const items = reply as unknown[]
        const last: unknown = items[items.length - 1]
        const content = typeof last === 'object' && last !== null ? (last as { content?: unknown }).content : undefined
        return typeof content === 'string' && content.length > 0 ? { replyContent: content } : {}
    }
    if (typeof reply === 'object' && reply !== null) {
        const content = (reply as { content?: unknown }).content
        return typeof content === 'string' && content.length > 0 ? { replyContent: content } : {}
    }
    return {}
}

/** 回复留言 */
export async function replyWechatComment(
    token: string,
    target: WechatCommentTarget,
    commentId: number,
    content: string,
): Promise<WechatApiResult<null>> {
    const body = {
        msg_data_id: target.msgDataId,
        index: target.index,
        user_comment_id: commentId,
        content,
    }
    const outcome = await postWechatJson(token, COMMENT_REPLY_ENDPOINT, body)
    return outcome.ok ? { ok: true, data: null } : outcome
}

/** 设为 / 取消精选：两个接口只差地址 */
export async function markWechatComment(
    token: string,
    target: WechatCommentTarget,
    commentId: number,
    elected: boolean,
): Promise<WechatApiResult<null>> {
    const body = { msg_data_id: target.msgDataId, index: target.index, user_comment_id: commentId }
    const outcome = await postWechatJson(token, elected ? COMMENT_MARK_ENDPOINT : COMMENT_UNMARK_ENDPOINT, body)
    return outcome.ok ? { ok: true, data: null } : outcome
}

/** 删除留言：不可撤销，界面须二次确认 */
export async function deleteWechatComment(
    token: string,
    target: WechatCommentTarget,
    commentId: number,
): Promise<WechatApiResult<null>> {
    const body = { msg_data_id: target.msgDataId, index: target.index, user_comment_id: commentId }
    const outcome = await postWechatJson(token, COMMENT_DELETE_ENDPOINT, body)
    return outcome.ok ? { ok: true, data: null } : outcome
}

/** 永久素材删除接口 */

/** 素材不存在的错误码：本地记录本就该清理，重复删除不该报错 */
const MATERIAL_NOT_FOUND_CODE = 40007

/**
 * 删除永久素材。
 * 关键约束：删除后已发布文章里对这张图的引用会失效，界面必须二次确认并写清后果；
 * 40007 视为已删除——平台侧早就没了，这时让用户卡在「删不掉」毫无意义。
 */
export async function deleteWechatMaterialByMediaId(token: string, mediaId: string): Promise<WechatApiResult<null>> {
    const outcome = await postWechatJson(token, MATERIAL_DELETE_ENDPOINT, { media_id: mediaId })
    if (outcome.ok) {
        return { ok: true, data: null }
    }
    if (outcome.errorCode === MATERIAL_NOT_FOUND_CODE) {
        return { ok: true, data: null }
    }
    return outcome
}

/**
 * 创建永久字符串场景二维码：scene 固定时票据稳定，可用于关注入口。
 * 关键约束：只取 ticket 字段，平台报文里可能附带其它字段，不原样透给上层。
 */
export async function fetchWechatQrcodeTicket(token: string, scene: string): Promise<WechatApiResult<string>> {
    const outcome = await postWechatJson(token, QRCODE_CREATE_ENDPOINT, {
        action_name: 'QR_LIMIT_STR_SCENE',
        action_info: { scene: { scene_str: scene } },
    })
    if (!outcome.ok) {
        return outcome
    }
    const ticket = outcome.payload.ticket
    return typeof ticket === 'string' && ticket.length > 0
        ? { ok: true, data: ticket }
        : { ok: false, errorCode: -1, message: '微信接口返回的二维码票据格式异常' }
}

/**
 * 取二维码图片并内联：Webview 的 CSP 不放行微信图片域名，不能直接回传远程地址。
 * 关键约束：票据只作为查询参数，不写日志；只接受 jpeg/png 且限制体积，避免把异常响应当图片送出。
 */
export async function fetchWechatQrcodeImage(ticket: string): Promise<WechatApiResult<string>> {
    const url = new URL(QRCODE_SHOW_ENDPOINT)
    url.searchParams.set('ticket', ticket)

    let response: Response
    try {
        response = await fetch(url, { signal: AbortSignal.timeout(GET_TIMEOUT_MS) })
    } catch (cause) {
        return { ok: false, errorCode: NETWORK_ERROR_CODE, message: `无法连接微信接口：${errorText(cause)}` }
    }
    if (!response.ok) {
        return { ok: false, errorCode: NETWORK_ERROR_CODE, message: `微信接口返回 HTTP ${String(response.status)}` }
    }
    const mimeType = (response.headers.get('content-type') ?? '').split(';')[0] ?? ''
    if (mimeType !== 'image/jpeg' && mimeType !== 'image/png') {
        return { ok: false, errorCode: -1, message: '微信二维码图片格式异常' }
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > QRCODE_MAX_BYTES) {
        return { ok: false, errorCode: -1, message: '微信二维码图片体积异常' }
    }
    const base64 = Buffer.from(bytes).toString('base64')
    return { ok: true, data: `data:${mimeType};base64,${base64}` }
}
