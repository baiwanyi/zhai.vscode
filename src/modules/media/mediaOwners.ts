/**
 * 媒体关联归属：把引用行折算成「作品 / 笔记 / 公众号批次 / 外部文档」四个归属，供详情面板分组展示。
 * 复用约定：归属只由 ref_type 与 ref_path 推导，不新增表结构；路径口径与 mediaReferenceService 的写入侧一致。
 * 关键约束：作品下的章节、角色封面与条目封面全部归到同一个作品名，避免同一作品被拆成多行；
 * 公众号按批次目录聚合而不是按单篇文章；存储根外的文档单列 external，展示名取引用标题。
 */
import type { MediaOwner, MediaOwnerType, MediaUsageItem } from '@shared/types/media'

/** 作品路径的最小段数：press/{作品名} */
const PRESS_SEGMENTS = 2
/** 公众号批次路径：wechat/{appid}/post/{批次}/…，批次目录落在索引 3 */
const WECHAT_BATCH_INDEX = 3

/** 取路径最后一段，用作缺标题时的兜底展示名 */
function fileName(referencePath: string): string {
    return referencePath.split('/').pop() ?? referencePath
}

/** 由引用行推导归属标识与展示名 */
function resolveOwner(usage: MediaUsageItem): Pick<MediaOwner, 'type' | 'id' | 'label'> {
    const segments = usage.refPath.split('/')
    if (usage.refType === 'note') {
        return { type: 'note', id: usage.refPath, label: usage.refTitle ?? fileName(usage.refPath) }
    }
    if (usage.refType === 'article') {
        const batch = segments[WECHAT_BATCH_INDEX] ?? usage.refTitle ?? '未命名批次'
        return {
            type: 'wechat',
            id: segments.slice(0, WECHAT_BATCH_INDEX + 1).join('/'),
            label: `批次 ${batch}`,
        }
    }
    if (usage.refType === 'external') {
        return { type: 'external', id: usage.refPath, label: usage.refTitle ?? fileName(usage.refPath) }
    }
    // 作品封面、角色封面、条目封面与章节都在 press/{作品名} 之下：统一归到作品
    const projectName = segments.length >= PRESS_SEGMENTS ? (segments[1] ?? usage.refPath) : usage.refPath
    return { type: 'press', id: segments.slice(0, PRESS_SEGMENTS).join('/'), label: projectName }
}

/** 归属类型排序：作品 → 笔记 → 公众号 → 文档，跨类型阅读时顺序稳定 */
const OWNER_ORDER: readonly MediaOwnerType[] = ['press', 'note', 'wechat', 'external']

/**
 * 按归属聚合引用：同一归属只出一行，refs 保持宿主返回的顺序。
 * 关键约束：输出按类型排序，同类型内保持首次出现顺序，界面不会因扫描顺序变化而跳动。
 */
export function groupOwners(usages: readonly MediaUsageItem[]): MediaOwner[] {
    const buckets = new Map<string, MediaOwner>()
    for (const usage of usages) {
        const owner = resolveOwner(usage)
        const key = `${owner.type}:${owner.id}`
        const existing = buckets.get(key)
        if (existing === undefined) {
            buckets.set(key, { ...owner, refCount: 1, refs: [usage] })
            continue
        }
        existing.refs.push(usage)
        existing.refCount += 1
    }
    const rank = (type: MediaOwnerType): number => OWNER_ORDER.indexOf(type)
    return [...buckets.values()].sort((left, right) => rank(left.type) - rank(right.type))
}
