/**
 * 标签名索引：把标签数组预转换为按 id 查找的 Map。
 * 复用约定：纯函数，父层用 useMemo 调用一次后下传，行组件只做 O(1) 读取。
 * 关键约束：标签 id 取平台正整数，同 id 重复时后者覆盖前者，与标签数组顺序一致。
 */
import type { WechatFanTag } from '@shared/types/wechat'

/** 构造标签 id → 名称的查找表 */
export function buildTagNameById(tags: WechatFanTag[]): Map<number, string> {
    return new Map(tags.map((tag) => [tag.id, tag.name]))
}
