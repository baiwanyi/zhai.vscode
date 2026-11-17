/**
 * 在线图库话题清单：标签行的固定数据源，以及「推荐位 ↔ 协议话题」的两向折算。
 * 复用约定：条目直接取 SegmentedRailItem 形态喂给分段栏，不在此定义标签样式；
 * 标签值用 RECOMMEND_TOPIC 表达推荐位，协议侧用 null 表达「不带话题」，折算只走本文件。
 * 关键约束：value 取 Unsplash 官网 /t/{slug} 里的 slug，官网路由可能首字母大写（如 /t/Fall），
 * 但 API 与宿主校验只认小写，这里统一写成小写；写错只会静默回落到推荐位；
 * 数组顺序即标签顺序，首项恒为「推荐」，新增话题要同时给中文显示名。
 */
import type { SegmentedRailItem } from '@webview/components/SegmentedRail'

/** 推荐位标签值：对应「不带话题」的最新流，固定排在标签行首位 */
export const RECOMMEND_TOPIC = 'recommend'

/**
 * 常用话题标签：与 Unsplash 官网导航同序（Fall / Wallpapers / Nature / 3D Renders / Experimental /
 * Film / Street Photography / Architecture / Textures / Travel / People），点选即按话题浏览，不回源拉取。
 */
const TOPIC_ITEMS: readonly SegmentedRailItem<string>[] = [
    { value: 'fall', label: '秋日' },
    { value: 'wallpapers', label: '壁纸' },
    { value: 'nature', label: '自然' },
    { value: '3d-renders', label: '3D 渲染' },
    { value: 'experimental', label: '实验' },
    { value: 'film', label: '胶片' },
    { value: 'street-photography', label: '街头' },
    { value: 'architecture-interior', label: '建筑' },
    { value: 'textures-patterns', label: '纹理' },
    { value: 'travel', label: '旅行' },
    { value: 'people', label: '人物' },
]

/** 标签行：推荐固定置首，其余按常用话题清单排布，共 12 项 */
export const TOPIC_TAB_ITEMS: readonly SegmentedRailItem<string>[] = [
    { value: RECOMMEND_TOPIC, label: '推荐' },
    ...TOPIC_ITEMS,
]

/** 标签值 → 协议话题：推荐位折算成 null，即不向宿主传 topic */
export function toStockTopic(value: string): string | null {
    return value === RECOMMEND_TOPIC ? null : value
}

/** 协议话题 → 标签值：null 折算成推荐位，供受控分段栏回显 */
export function toTopicTabValue(topic: string | null): string {
    return topic ?? RECOMMEND_TOPIC
}
