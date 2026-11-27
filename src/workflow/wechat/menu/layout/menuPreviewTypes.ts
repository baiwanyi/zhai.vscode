/**
 * 手机预览的交互出口：集中定义六个编辑动作，避免逐层透传十余个回调。
 * 复用约定：索引语义与页面 EditTarget 保持一致，父组件负责坐标有效性与草稿落库；
 * 关键约束：只声明契约不含实现，子组件不得在此执行增删改。
 */

export interface MenuPreviewActions {
    selectTop: (index: number) => void
    editTop: (index: number) => void
    addTop: () => void
    editSub: (index: number, subIndex: number) => void
    addSub: (index: number) => void
    retry: () => void
}
