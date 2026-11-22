/**
 * 微博模块门面：扩展入口与仪表盘只从这里取能力，不再深层导入内部实现文件。
 * 复用约定：面板、卡片动作、预热与凭证 / 缓存的构造入口统一在此转出，内部目录调整不影响调用方。
 * 关键约束：门面只做转出，不承载业务逻辑；新增对外能力须先在此登记，避免调用方绕过门面。
 */

export { EMPTY_COOKIE_STORE, createWeiboCookieStore } from './store/credential'
export { createWeiboAvatarGateway } from './media/avatar'
export { createWeiboCache } from './store/metadataCache'
export { openWeiboPanel } from './app/panel'
export { createWeiboMediaResolver } from './app/config'
export { createWeiboPostActions } from './app/postActions'
export { warmWeiboMetadata } from './app/warmup'
export type { WeiboEnhancePrompt } from './app/panel'
export type { WeiboPostActions } from './app/postActions'
export type { WeiboAvatarGateway } from './media/avatar'
export type { WeiboCache } from './store/metadataCache'
export type { WeiboCookieStore } from './store/credential'
