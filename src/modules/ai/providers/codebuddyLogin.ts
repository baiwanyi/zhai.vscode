/**
 * CodeBuddy 登录态记忆：记录各站点是否已完成过登录，供 AI 面板区分登录引导与正常空态。
 * 复用约定：登录、登出命令与对话服务共用本模块，键按站点分开（与 zhai.ai.codebuddySite 一致）；
 * 关键约束：只在确认可用后写入（登录成功、或一次生成完整走通），失败不清除既有记录；
 * 登出是本模块唯一允许主动清除的入口，清除后必须与 CLI 侧的 logout 成对执行，否则会出现
 * 「面板显示未登录、生成却仍能走通」的假阴性；未注入 globalState 时一律按未登录处理，不臆造登录态。
 */
import type { CodebuddySite } from '@modules/common/config'
import type * as vscode from 'vscode'

/** 登录态确认标记的键前缀 */
const AUTHED_KEY_PREFIX = 'ai.codebuddyAuthed.'
/** 已登录账号名的键前缀 */
const USER_KEY_PREFIX = 'ai.codebuddyUser.'

/** 站点登录态：账号名未知但已确认可用时 userName 为 null */
export interface CodebuddyLoginState {
    loggedIn: boolean
    userName: string | null
}

let memento: vscode.Memento | null = null

/** 激活时注入 globalState；不注入时读到的登录态恒为未登录 */
export function initCodebuddyLogin(state: vscode.Memento): void {
    memento = state
}

/** 读取指定站点的登录态：站点切换后互不串用 */
export function readCodebuddyLogin(site: CodebuddySite): CodebuddyLoginState {
    if (memento === null) {
        return { loggedIn: false, userName: null }
    }
    const userName = memento.get<string>(`${USER_KEY_PREFIX}${site}`)
    return {
        loggedIn: memento.get<boolean>(`${AUTHED_KEY_PREFIX}${site}`, false) === true,
        userName: typeof userName === 'string' && userName.length > 0 ? userName : null,
    }
}

/** 记住登录可用：userName 为空表示「已确认可用但没有账号名」，不覆盖此前记录的账号名 */
export function rememberCodebuddyLogin(site: CodebuddySite, userName: string | null): void {
    if (memento === null) {
        return
    }
    void memento.update(`${AUTHED_KEY_PREFIX}${site}`, true)
    if (userName !== null && userName.length > 0) {
        void memento.update(`${USER_KEY_PREFIX}${site}`, userName)
    }
}

/** 清除登录态：两个键一并清掉，避免残留账号名让面板把「已登出」显示成「已登录」 */
export function clearCodebuddyLogin(site: CodebuddySite): void {
    if (memento === null) {
        return
    }
    void memento.update(`${AUTHED_KEY_PREFIX}${site}`, false)
    void memento.update(`${USER_KEY_PREFIX}${site}`, undefined)
}
