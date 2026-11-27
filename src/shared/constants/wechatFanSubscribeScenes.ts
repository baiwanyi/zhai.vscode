/**
 * 公众号粉丝关注来源场景常量：把平台返回的 ADD_SCENE_* 值映射为可读中文。
 * 复用约定：沿用 @shared/constants 的只读常量表风格，查询函数为纯函数，未知值原样回退。
 * 关键约束：场景值按平台原始字符串匹配，大小写敏感；不改写存储层数据，仅用于展示层。
 */

/** 关注来源场景值 → 中文标签 */
export const WECHAT_FAN_SUBSCRIBE_SCENES: Readonly<Record<string, string>> = {
    ADD_SCENE_SEARCH: '公众号搜索',
    ADD_SCENE_ACCOUNT_MIGRATION: '公众号迁移',
    ADD_SCENE_PROFILE_CARD: '名片分享',
    ADD_SCENE_QR_CODE: '扫描二维码',
    ADD_SCENE_PROFILE_LINK: '图文页内名称点击',
    ADD_SCENE_PROFILE_ITEM: '图文页右上角菜单',
    ADD_SCENE_PAID: '支付后关注',
    ADD_SCENE_WECHAT_ADVERTISEMENT: '微信广告',
    ADD_SCENE_REPRINT: '他人转载',
    ADD_SCENE_LIVESTREAM: '视频号直播',
    ADD_SCENE_CHANNELS: '视频号',
    ADD_SCENE_WXA: '小程序关注',
    ADD_SCENE_OTHERS: '其他',
}

/** 查询关注来源展示文案：未知场景值回退原始值，避免脏数据显示为空 */
export function describeFanSubscribeScene(scene: string | undefined): string {
    if (scene === undefined || scene.length === 0) return ''
    return WECHAT_FAN_SUBSCRIBE_SCENES[scene] ?? scene
}
