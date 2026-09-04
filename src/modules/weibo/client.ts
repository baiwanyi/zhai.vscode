/**
 * 官方 Open API 基础请求客户端。
 * - 统一注入 access_token
 * - AbortSignal 超时
 * - 指数退避重试
 */

import { WEIBO_API_V2 } from './types'

export interface ApiOptions {
    method?: 'GET' | 'POST'
    accessToken?: string
    query?: Record<string, string>
    body?: URLSearchParams
    timeoutMs?: number
    retries?: number
}

export async function weiboFetch<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
    const { method = 'GET', accessToken, query, body, timeoutMs = 30_000, retries = 2 } = opts

    const url = new URL(`${WEIBO_API_V2}/${path}`)
    if (accessToken) url.searchParams.set('access_token', accessToken)
    if (query) {
        for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
    }

    let lastErr: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url.toString(), {
                method,
                headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
                body: body?.toString(),
                signal: AbortSignal.timeout(timeoutMs),
            })
            if (!res.ok) throw new Error(`微博接口 ${path} 失败: ${res.status}`)
            return (await res.json()) as T
        } catch (err) {
            lastErr = err
            if (attempt < retries) {
                await new Promise((r) => setTimeout(r, 2 ** attempt * 500))
            }
        }
    }
    throw lastErr
}
