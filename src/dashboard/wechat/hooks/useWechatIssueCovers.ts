/**
 * 批次封面地址：把每批次首篇文章的本地封面换成 Webview 可加载的 URI。
 * 复用约定：路径来自文章的 coverPath（用户指定或导入时带出），转换走宿主 wechat/cover/preview；
 * 结果按路径缓存，批次列表重拉后只对新增路径发请求。
 * 关键约束：只取首篇文章的封面——一个批次对应一次群发，卡片上展示一张代表图即可；
 * 一次最多请求 20 条（与宿主侧上限一致），超出的批次回落占位图而不是报错；
 * 转换失败静默忽略，卡片显示灰底占位，不影响列表本身。
 */
import { useEffect, useMemo, useState } from 'react'
import { WECHAT_COVER_PREVIEW_LIMIT } from '@shared/types/wechat'
import type { WechatCoverPreviewRequest, WechatCoverPreviewResult, WechatIssueSummary } from '@shared/types/wechat'
import { request } from '@shared/utils/bridge'

export function useWechatIssueCovers(issues: WechatIssueSummary[]): Record<string, string> {
    /** 收集各批次首图的去重路径：顺序稳定，便于作为 effect 依赖 */
    const paths = useMemo(() => {
        const collected: string[] = []
        for (const issue of issues) {
            const coverPath = issue.articles[0]?.coverPath
            if (coverPath !== undefined && coverPath.length > 0 && !collected.includes(coverPath)) {
                collected.push(coverPath)
            }
        }
        return collected.slice(0, WECHAT_COVER_PREVIEW_LIMIT)
    }, [issues])

    const [uris, setUris] = useState<Record<string, string>>({})

    useEffect(() => {
        if (paths.length === 0) {
            setUris({})
            return
        }
        const payload: WechatCoverPreviewRequest = { paths }
        let isActive = true
        void request<WechatCoverPreviewResult>('wechat/cover/preview', payload)
            .then((result) => {
                // 组件已卸载或路径已变化时丢弃迟到结果，避免覆盖新一轮数据
                if (isActive) {
                    setUris(result.uris)
                }
            })
            .catch(() => undefined)
        return (): void => {
            isActive = false
        }
    }, [paths])

    return uris
}
