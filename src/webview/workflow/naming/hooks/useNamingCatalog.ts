/**
 * 取名选项摘要：挂载时向宿主请求 naming/catalog，取得分类、枚举、后缀候选与姓氏样本。
 * 复用约定：请求经 webview 公共 bridge，错误统一转文案交由页面展示；只加载一次。
 * 关键约束：组件卸载后不再回写状态，避免切换分区时的过期 setState。
 */
import { useEffect, useState } from 'react'
import type { NamingCatalog } from '@/shared/types/naming'
import { request } from '../../../bridge'
import { toErrorText } from '../utils'

/** 选项摘要 hook 的对外状态 */
export interface NamingCatalogState {
    catalog: NamingCatalog | null
    error: string | null
    isLoading: boolean
}

export function useNamingCatalog(): NamingCatalogState {
    const [catalog, setCatalog] = useState<NamingCatalog | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    useEffect(() => {
        let cancelled = false
        const run = async (): Promise<void> => {
            try {
                const result = await request<NamingCatalog>('naming/catalog')
                if (!cancelled) {
                    setCatalog(result)
                    setError(null)
                }
            } catch (cause) {
                if (!cancelled) {
                    setError(toErrorText(cause))
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false)
                }
            }
        }
        void run()
        return (): void => {
            cancelled = true
        }
    }, [])

    return { catalog, error, isLoading }
}
