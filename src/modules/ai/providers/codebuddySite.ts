/**
 * CodeBuddy 站点解析：把配置里的站点选择映射成 SDK 认证环境与环境变量。
 * 复用约定：登录（commands）与调用（文本通道、图像通道）共用本模块，保证两侧落在同一站点；
 * 站点取值与 zhai.ai.codebuddySite 一一对应，auth 环境名与 SDK 的 AuthEnvironment 对齐。
 * 关键约束：凭证按站点缓存，切换站点后必须重新登录，否则会拿旧站点的 token 请求新站点；
 * 国际站不设置 CODEBUDDY_INTERNET_ENVIRONMENT（SDK 以缺省值表示该站点）。
 */
import type { CodebuddySite } from '../../common/config'
import type { AuthEnvironment } from '@tencent-ai/agent-sdk'

/** 支持的站点：企业专享版需自定义 endpoint，暂不开放 */
export type { CodebuddySite }

/** 站点展示名：用于登录提示与错误文案 */
export const CODEBUDDY_SITE_LABELS: Readonly<Record<CodebuddySite, string>> = {
    international: '国际站',
    china: '中国站',
    ioa: 'iOA 企业版',
}

/** 站点 → SDK 认证环境（external 对应国际站） */
export function toAuthEnvironment(site: CodebuddySite): AuthEnvironment {
    if (site === 'china') {
        return 'internal'
    }
    if (site === 'ioa') {
        return 'ioa'
    }
    return 'external'
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
    if (site === 'ioa') {
        return { CODEBUDDY_INTERNET_ENVIRONMENT: 'ioa' }
    }
    return {}
}
