/**
 * AI 对话底部区域的共享类型：参考菜单动作、上下文选择视图与上下文添加回调基座。
 * 复用约定：参考菜单的动作联合类型放在此处，页面与菜单共用同一份定义，不必反向依赖展示组件；
 * 上下文添加的回调基座同样落在这里——入口清单、子菜单壳与内容层共用一份签名，组件之间不互相 import 类型。
 * 关键约束：这些类型只描述交互契约，不含展示逻辑、请求细节与落盘口径。
 */

import type { AiContextItemKind, AiContextScope, AiContextSourceScope } from '@shared/types/aiChat'

/** 参考菜单动作：检索语料（弹窗）或打开语料目录（目录不存在时由宿主创建） */
export type AiReferenceAction = 'search' | 'openDir'

/** 上下文查询目标：内容分类 + 可选来源过滤，来源 id 由宿主产生 */
export interface AiContextTarget {
    kind: AiContextItemKind
    sourceId?: string
}

/** 作品下的分类标签：章节走索引，人物与大纲走文档分节，设定按字段与条目多选 */
export type AiContextProjectTab = 'chapter' | 'character' | 'outline' | 'setting'

/**
 * 「添加上下文」面板的内容：来源列表（笔记本 / 作品）与候选列表（笔记 / 文章 / 作品的章节人物大纲）两态。
 * 关键约束：根列表就是下拉菜单本身，面板内只做单向深入（作品面板提供「返回」回入口清单）；
 * 作品内容复用候选列表这一态——选中作品后由外壳把菜单内容换成作品面板，按分类传 kind 与作品目录即可。
 */
export type AiContextPickerView =
    { mode: 'source'; scope: AiContextSourceScope } | { mode: 'items'; target: AiContextTarget }

/** 上下文添加的结果回调：内容层（候选列表、设定面板）只需要这两个出口 */
export interface AiChatContextAddCallbacks {
    /** 添加成功后由页面重拉上下文清单 */
    onAdded: () => void
    /** 读取与添加失败的提示出口 */
    onError: (error: string) => void
}

/** 入口清单与子菜单逐层透传的回调：三层共用一份签名，新增回调只改这里 */
export interface AiChatContextSubMenuCallbacks extends AiChatContextAddCallbacks {
    /** 待发送上下文的作用域：对话按会话隔离，生图面板固定一份 */
    scope: AiContextScope
    /** 收起菜单 */
    onClose: () => void
    /** 选中作品：由外壳把菜单内容切到作品面板 */
    onPickProject: (dirPath: string) => void
}
