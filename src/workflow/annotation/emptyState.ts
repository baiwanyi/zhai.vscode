/**
 * 标注总览的空态文案：把「加载中 / 被筛空 / 确实没有」的措辞规则从组件里抽出来。
 * 复用约定：返回标题与描述成对的文案，调用方直接交给 StateEmpty，不再各自判断。
 * 关键约束：标题与描述必须同源——「被筛空」的标题只能配「换个条件」的描述，
 * 分开判断会拼出「没有符合筛选条件的标注 / 在编辑区选中文字」这类自相矛盾的文案；
 * 加载态的描述给空串，StateEmpty 在加载态本就不渲染说明。
 */

export interface EmptyCopy {
    title: string
    /** 空态说明：加载态为空串，由 StateEmpty 自行隐藏 */
    description: string
}

export interface AnnotationListEmptyParams {
    isLoading: boolean
    /** 是否有生效筛选：区分「被筛空」与「确实没有标注」 */
    hasActiveFilter: boolean
}

/** 标注列表空态：三档措辞，混用会让用户以为标注丢了 */
export function describeAnnotationListEmpty({ isLoading, hasActiveFilter }: AnnotationListEmptyParams): EmptyCopy {
    if (isLoading) {
        return { title: '正在读取标注', description: '' }
    }
    if (hasActiveFilter) {
        return { title: '没有符合筛选条件的标注', description: '换个条件或清除筛选试试' }
    }
    return { title: '还没有标注', description: '在编辑区选中文字，即可划线或添加批注' }
}

/** AI 解释列表空态：只有「加载中」与「没有记录」两档，不存在筛选维度 */
export function describeQueryListEmpty(isLoading: boolean): EmptyCopy {
    if (isLoading) {
        return { title: '正在读取 AI 解释', description: '' }
    }
    return { title: '还没有 AI 解释', description: '在编辑区选中文字或点块把手，选择「询问 AI」' }
}
