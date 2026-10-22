/**
 * CodeBuddy 站点解析：把配置里的站点映射成 SDK 认证环境、CLI 登录方式与授权域名。
 * 复用约定：登录（commands）与调用（文本通道、图像通道）共用本模块，保证两侧落在同一站点；
 * 站点取值与 zhai.ai.codebuddySite 一一对应，auth 环境名与 SDK 的 AuthEnvironment 对齐。
 * 关键约束：仅开放中国站与国际站，两者授权页分属不同域名（copilot.tencent.com / codebuddy.ai），
 * 登录方式与授权域名必须同时与站点一致；切换站点后旧凭证不会复用，必须重新登录。
 * 国际站不设置 CODEBUDDY_INTERNET_ENVIRONMENT（SDK 以缺省值表示该站点）。
 */
import type { CodebuddySite } from '../../common/config'
import type { AuthEnvironment } from '@tencent-ai/agent-sdk'

/** 支持的站点：仅中国站与国际站，企业专享版需自定义 endpoint，暂不开放 */
export type { CodebuddySite }

/** 站点展示名：用于登录提示与错误文案 */
export const CODEBUDDY_SITE_LABELS: Readonly<Record<CodebuddySite, string>> = {
    china: '中国站',
    international: '国际站',
}

/**
 * 站点 → 授权页域名。
 * 依据官方文档：中国站经 copilot.tencent.com 认证，国际站经 codebuddy.ai 认证；
 * 域名按后缀匹配，覆盖 CLI 产品配置里的各站点认证域名（含 .cn 变体）。
 */
export const CODEBUDDY_SITE_AUTH_HOSTS: Readonly<Record<CodebuddySite, readonly string[]>> = {
    china: ['copilot.tencent.com', 'codebuddy.cn', 'workbuddy.cn'],
    international: ['codebuddy.ai', 'staging-codebuddy.tencent.com'],
}

/** 站点 → SDK 认证环境（internal 对应中国站） */
export function toAuthEnvironment(site: CodebuddySite): AuthEnvironment {
    return site === 'china' ? 'internal' : 'external'
}

/** 站点 → CLI 登录方式标识；与 CLI 登录方式选择面板一致（internal 中国站 / external 国际站） */
export function toAuthMethodId(site: CodebuddySite): string {
    return site === 'china' ? 'internal' : 'external'
}

/** 判断授权页是否落在该站点的域名下；用于登录时发现站点与环境错配 */
export function isSiteAuthUrl(site: CodebuddySite, authUrl: string): boolean {
    let host: string
    try {
        host = new URL(authUrl).hostname.toLowerCase()
    } catch {
        return false
    }
    return CODEBUDDY_SITE_AUTH_HOSTS[site].some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
}

/** 组装子进程环境：站点变量 + 可选 API Key；两者皆空时返回 undefined，交由 CLI 使用自身登录态 */
export function buildCodebuddyEnv(site: CodebuddySite, apiKey?: string): Record<string, string> | undefined {
    const env = toSiteEnvironment(site)
    if (apiKey !== undefined && apiKey.length > 0) {
        env.CODEBUDDY_API_KEY = apiKey
    }
    return Object.keys(env).length > 0 ? env : undefined
}

/** 站点 → 子进程环境变量；国际站返回空对象，交由 SDK 走缺省站点 */
export function toSiteEnvironment(site: CodebuddySite): Record<string, string> {
    if (site === 'china') {
        return { CODEBUDDY_INTERNET_ENVIRONMENT: 'internal' }
    }
    return {}
}
