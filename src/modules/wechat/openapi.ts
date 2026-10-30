/**
 * 公众号运营类接口：自定义菜单、粉丝与标签、用户增长统计。
 * 复用约定：JSON 写入类接口走 client 的 postWechatJson（统一 errcode 归一与超时），
 * 查询类接口平台只提供 GET，这里补一个同口径的 getWechatJson；错误码文案复用 client 的错误表。
 * 关键约束：本层只做「发请求 + 收窄报文」，不写库、不拼装业务提示；
 * 报文里的字段名保持平台原样，转换成本模块类型的工作交给调用方服务，便于对照官方文档排查。
 */
import type { WechatMenuButton } from '@shared/types/wechat'
import { describeWechatError, postWechatJson, NETWORK_ERROR_CODE } from './client'

/** 菜单接口 */
const MENU_GET_ENDPOINT = 'https://api.weixin.qq.com/cgi-bin/menu/get'
const MENU_CREATE_ENDPOINT = 'https://api.weixin.qq.com/cgi-bin/menu/create'

/** 粉丝与标签接口 */
const USER_GET_ENDPOINT = 'https://api.weixin.qq.com/cgi-bin/user/get'
const USER_INFO_BATCH_ENDPOINT = 'https://api.weixin.qq.com/cgi-bin/user/info/batchget'
const TAGS_GET_ENDPOINT = 'https://api.weixin.qq.com/cgi-bin/tags/get'

/** 数据统计接口 */
const USERS_SUMMARY_ENDPOINT = 'https://api.weixin.qq.com/datacube/getusersummary'
const USERS_CUMULATE_ENDPOINT = 'https://api.weixin.qq.com/datacube/getusercumulate'

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
    nickname: string
    avatar?: string
    subscribeStatus: number
    subscribedAt?: string
}

/** 批量读取粉丝资料（昵称、头像、关注状态与时间） */
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
        return {
            openid: typeof candidate.openid === 'string' ? candidate.openid : '',
            nickname: typeof candidate.nickname === 'string' ? candidate.nickname : '',
            ...(typeof candidate.headimgurl === 'string' && candidate.headimgurl.length > 0
                ? { avatar: candidate.headimgurl }
                : {}),
            subscribeStatus: typeof candidate.subscribe === 'number' ? candidate.subscribe : 0,
            ...(subscribeTime > 0 ? { subscribedAt: new Date(subscribeTime * 1000).toISOString() } : {}),
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
const COMMENT_LIST_ENDPOINT = 'https://api.weixin.qq.com/cgi-bin/comment/list'
const COMMENT_REPLY_ENDPOINT = 'https://api.weixin.qq.com/cgi-bin/comment/reply'
const COMMENT_MARK_ENDPOINT = 'https://api.weixin.qq.com/cgi-bin/comment/markelect'
const COMMENT_UNMARK_ENDPOINT = 'https://api.weixin.qq.com/cgi-bin/comment/unmarkelect'
const COMMENT_DELETE_ENDPOINT = 'https://api.weixin.qq.com/cgi-bin/comment/delete'

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
