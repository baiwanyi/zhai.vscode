/**
 * 标注记录查询：按块号与类型筛选当前文档的标注，供段末弹层与划线 toggle 共用。
 * 复用约定：纯函数，输入输出都是 AnnotationRecord 集合，不判断除 orphaned 之外的任何状态。
 * 关键约束：orphaned 的条目不参与展示与 toggle 命中，筛选必须默认排除；
 * 这里只按 kind + blockIndex 取，quote 等更细的匹配留给调用方，避免塞入谓词参数。
 */
import type { AnnotationRecord } from '@shared/types/editor'

/** 取某一块下指定类型的有效标注（按传入顺序） */
export function selectBlockAnnotations(
    items: readonly AnnotationRecord[],
    blockIndex: number,
    kind: AnnotationRecord['kind'],
): readonly AnnotationRecord[] {
    return items.filter((item) => item.kind === kind && item.blockIndex === blockIndex && !item.orphaned)
}
