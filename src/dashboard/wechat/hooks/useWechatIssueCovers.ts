/**
 * 文章封面地址：把批次内每篇文章的本地封面换成 Webview 可加载的 URI。
 * 复用约定：路径来自文章的 coverPath（用户指定或导入时带出），转换走宿主 wechat/cover/preview；
 * 结果按路径缓存，批次列表重拉后只对新增路径发请求。
 * 关键约束：一张卡片最多渲染 8 篇文章的封面，宿主单次只接受 20 条，故按上限分批并发后合并；
 * 未指定封面或转换失败的文章不在结果里，卡片对该篇回落占位图而不是报错。
 */
import { useEffect, useMemo, useState } from 'react'
import { WECHAT_COVER_PREVIEW_LIMIT } from '@shared/types/wechat'
import type { WechatCoverPreviewRequest, WechatCoverPreviewResult, WechatIssueSummary } from '@shared/types/wechat'
import { request } from '@shared/utils/bridge'

/** 把待请求路径按宿主上限切成多批，避免超过 20 条被整体拒绝 */
function toChunks(paths: readonly string[]): string[][] {
    const chunks: string[][] = []
    for (let index = 0; index < paths.length; index += WECHAT_COVER_PREVIEW_LIMIT) {
        chunks.push(paths.slice(index, index + WECHAT_COVER_PREVIEW_LIMIT))
    }
    return chunks
}

export function useWechatIssueCovers(issues: WechatIssueSummary[]): Record<string, string> {
    /** 收集全批次文章的封面路径并去重：顺序稳定，便于作为 effect 依赖 */
    const paths = useMemo(() => {
        const collected: string[] = []
        for (const issue of issues) {
            for (const article of issue.articles) {
                const coverPath = article.coverPath
                if (coverPath !== undefined && coverPath.length > 0 && !collected.includes(coverPath)) {
                    collected.push(coverPath)
                }
            }
        }
        return collected
    }, [issues])

    const [uris, setUris] = useState<Record<string, string>>({})

    useEffect(() => {
        if (paths.length === 0) {
            setUris({})
            return
        }
        let isActive = true
        void Promise.all(
            toChunks(paths).map((chunk) => {
                const payload: WechatCoverPreviewRequest = { paths: chunk }
                return request<WechatCoverPreviewResult>('wechat/cover/preview', payload)
                    .then((result) => result.uris)
                    .catch((): Record<string, string> => ({}))
            }),
        ).then((results) => {
            // 组件已卸载或路径已变化时丢弃迟到结果，避免覆盖新一轮数据
            if (!isActive) {
                return
            }
            const merged: Record<string, string> = {}
            for (const result of results) {
                Object.assign(merged, result)
            }
            setUris(merged)
        })
        return (): void => {
            isActive = false
        }
    }, [paths])

    return uris
}
