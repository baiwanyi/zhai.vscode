/**
 * 公众号 API 地址总表：开放平台基址与各业务端点集中在此，避免同一域名散落在服务模块。
 * 复用约定：上层只 import 本文件的常量并直接传给请求函数，不再自行拼接域名或复制完整 URL；
 * 协议方法名（wechat/*）属跨端契约，由 shared/types/messages 定义，不放这里。
 * 关键约束：基址只在文件顶部声明一次，端点变动只改本文件；后台地址仅放行固定管理页，
 * 不接受外部传入任意地址。
 */

/** 开放平台基址：cgi-bin 与 datacube 端点共用 */
export const WECHAT_API_ORIGIN = 'https://api.weixin.qq.com'

/** 公众号后台基址：仅用于打开固定管理页 */
export const WECHAT_MP_ORIGIN = 'https://mp.weixin.qq.com'

/** 鉴权端点：换取 access_token 的全局唯一入口 */
export const TOKEN_ENDPOINT = `${WECHAT_API_ORIGIN}/cgi-bin/token`

/** 菜单端点 */
export const MENU_GET_ENDPOINT = `${WECHAT_API_ORIGIN}/cgi-bin/menu/get`
export const MENU_CREATE_ENDPOINT = `${WECHAT_API_ORIGIN}/cgi-bin/menu/create`
export const MENU_DELETE_ENDPOINT = `${WECHAT_API_ORIGIN}/cgi-bin/menu/delete`

/** 粉丝与标签端点 */
export const USER_GET_ENDPOINT = `${WECHAT_API_ORIGIN}/cgi-bin/user/get`
export const USER_INFO_BATCH_ENDPOINT = `${WECHAT_API_ORIGIN}/cgi-bin/user/info/batchget`
export const USER_INFO_UPDATEREMARK_ENDPOINT = `${WECHAT_API_ORIGIN}/cgi-bin/user/info/updateremark`
export const TAGS_GET_ENDPOINT = `${WECHAT_API_ORIGIN}/cgi-bin/tags/get`
export const TAGS_CREATE_ENDPOINT = `${WECHAT_API_ORIGIN}/cgi-bin/tags/create`
export const TAGS_UPDATE_ENDPOINT = `${WECHAT_API_ORIGIN}/cgi-bin/tags/update`
export const TAGS_DELETE_ENDPOINT = `${WECHAT_API_ORIGIN}/cgi-bin/tags/delete`
export const TAGS_MEMBERS_TAGGING_ENDPOINT = `${WECHAT_API_ORIGIN}/cgi-bin/tags/members/batchtagging`
export const TAGS_MEMBERS_UNTAGGING_ENDPOINT = `${WECHAT_API_ORIGIN}/cgi-bin/tags/members/batchuntagging`
export const TAGS_MEMBERS_BLACKLIST_ENDPOINT = `${WECHAT_API_ORIGIN}/cgi-bin/tags/members/batchblacklist`
export const TAGS_MEMBERS_UNBLACKLIST_ENDPOINT = `${WECHAT_API_ORIGIN}/cgi-bin/tags/members/batchunblacklist`
export const TAGS_MEMBERS_GET_BLACKLIST_ENDPOINT = `${WECHAT_API_ORIGIN}/cgi-bin/tags/members/getblacklist`

/** 数据统计端点：按用户、图文、消息与接口四类分组 */
export const USERS_SUMMARY_ENDPOINT = `${WECHAT_API_ORIGIN}/datacube/getusersummary`
export const USERS_CUMULATE_ENDPOINT = `${WECHAT_API_ORIGIN}/datacube/getusercumulate`
export const ARTICLE_SUMMARY_ENDPOINT = `${WECHAT_API_ORIGIN}/datacube/getarticlesummary`
export const USER_READ_HOUR_ENDPOINT = `${WECHAT_API_ORIGIN}/datacube/getuserreadhour`
export const USER_SHARE_HOUR_ENDPOINT = `${WECHAT_API_ORIGIN}/datacube/getusersharehour`
export const USER_READ_ENDPOINT = `${WECHAT_API_ORIGIN}/datacube/getuserread`
export const USER_SHARE_ENDPOINT = `${WECHAT_API_ORIGIN}/datacube/getusershare`
export const ARTICLE_TOTAL_ENDPOINT = `${WECHAT_API_ORIGIN}/datacube/getarticletotal`
export const BIZ_SUMMARY_ENDPOINT = `${WECHAT_API_ORIGIN}/datacube/getbizsummary`
export const ARTICLE_READ_ENDPOINT = `${WECHAT_API_ORIGIN}/datacube/getarticleread`
export const ARTICLE_SHARE_ENDPOINT = `${WECHAT_API_ORIGIN}/datacube/getarticleshare`
export const ARTICLE_TOTAL_DETAIL_ENDPOINT = `${WECHAT_API_ORIGIN}/datacube/getarticletotaldetail`
export const UPSTREAM_MSG_ENDPOINT = `${WECHAT_API_ORIGIN}/datacube/getupstreammsg`
export const UPSTREAM_MSG_HOUR_ENDPOINT = `${WECHAT_API_ORIGIN}/datacube/getupstreammsghour`
export const UPSTREAM_MSG_WEEK_ENDPOINT = `${WECHAT_API_ORIGIN}/datacube/getupstreammsgweek`
export const UPSTREAM_MSG_MONTH_ENDPOINT = `${WECHAT_API_ORIGIN}/datacube/getupstreammsgmonth`
export const UPSTREAM_MSG_DIST_ENDPOINT = `${WECHAT_API_ORIGIN}/datacube/getupstreammsgdist`
export const UPSTREAM_MSG_DIST_WEEK_ENDPOINT = `${WECHAT_API_ORIGIN}/datacube/getupstreammsgdistweek`
export const UPSTREAM_MSG_DIST_MONTH_ENDPOINT = `${WECHAT_API_ORIGIN}/datacube/getupstreammsgdistmonth`
export const INTERFACE_SUMMARY_ENDPOINT = `${WECHAT_API_ORIGIN}/datacube/getinterfacesummary`
export const INTERFACE_SUMMARY_HOUR_ENDPOINT = `${WECHAT_API_ORIGIN}/datacube/getinterfacesummaryhour`

/** 素材端点 */
export const MATERIAL_ENDPOINT = `${WECHAT_API_ORIGIN}/cgi-bin/material/add_material`
export const MATERIAL_DELETE_ENDPOINT = `${WECHAT_API_ORIGIN}/cgi-bin/material/del_material`

/** 草稿与发布端点 */
export const DRAFT_ADD_ENDPOINT = `${WECHAT_API_ORIGIN}/cgi-bin/draft/add`
export const DRAFT_UPDATE_ENDPOINT = `${WECHAT_API_ORIGIN}/cgi-bin/draft/update`
export const FREEPUBLISH_SUBMIT_ENDPOINT = `${WECHAT_API_ORIGIN}/cgi-bin/freepublish/submit`
export const FREEPUBLISH_GET_ENDPOINT = `${WECHAT_API_ORIGIN}/cgi-bin/freepublish/get`

/** 留言端点 */
export const COMMENT_LIST_ENDPOINT = `${WECHAT_API_ORIGIN}/cgi-bin/comment/list`
export const COMMENT_REPLY_ENDPOINT = `${WECHAT_API_ORIGIN}/cgi-bin/comment/reply`
export const COMMENT_MARK_ENDPOINT = `${WECHAT_API_ORIGIN}/cgi-bin/comment/markelect`
export const COMMENT_UNMARK_ENDPOINT = `${WECHAT_API_ORIGIN}/cgi-bin/comment/unmarkelect`
export const COMMENT_DELETE_ENDPOINT = `${WECHAT_API_ORIGIN}/cgi-bin/comment/delete`

/** 关注二维码端点：创建票据与按票据取图 */
export const QRCODE_CREATE_ENDPOINT = `${WECHAT_API_ORIGIN}/cgi-bin/qrcode/create`
export const QRCODE_SHOW_ENDPOINT = `${WECHAT_API_ORIGIN}/cgi-bin/showqrcode`

/** 公众号后台地址：只用于打开固定管理页，不接受外部传入任意地址 */
export const WECHAT_MP_URL = `${WECHAT_MP_ORIGIN}/`
