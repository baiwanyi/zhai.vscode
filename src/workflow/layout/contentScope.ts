/**
 * 内容归属：把宿主下发的当前文档事实归到「作品 / 笔记 / 公众号」三类之一，决定专属分区组与对话作用域。
 * 复用约定：笔记模块键取 shared/types/workflow 的 NOTES_MODULE_KEY，作品目录以 projectDir 为准
 * （宿主只从 press/{作品名}/... 推导），前端不自行拼接路径；归属为 null 表示文档不属于任何已接入模块。
 * 关键约束：归属、专属分区、作用域目录都由本文件推导，导航、内容区与对话页不得各自判断，避免口径漂移；
 * 作品归属以 projectDir 存在为准——press 一级目录下的散文档不算作品文档，只显示常驻分区；
 * 公众号既可能来自「打开了 wechat/ 目录下的文档」，也可能来自「用户在仪表盘选了公众号」，
 * 后者用 selectedModule 判定：选模块是持久意图，不依赖当前打开哪个文件。
 */
import { NOTES_MODULE_KEY } from '@shared/types/workflow'
import type { WorkflowContextState } from '@shared/types/workflow'
import type { WorkflowPressSection } from './pressSections'

/** 公众号模块的一级目录名：与宿主 wechat.db 及模块键一致 */
export const WECHAT_MODULE_KEY = 'wechat'

/** 内容归属：null 表示文档不属于任何已接入模块 */
export type ContentScope = 'press' | 'note' | 'wechat'

/** 归属 → 专属分区：公众号的六项运营分区与写作管理的四项并列 */
export const SCOPE_SECTIONS: Readonly<Record<ContentScope, readonly WorkflowPressSection[]>> = {
    press: ['setting', 'character', 'outline', 'naming'],
    note: [],
    wechat: ['menu', 'material', 'stats', 'comment', 'fans', 'push'],
}

/** 常驻分区：与内容归属无关，任何文档下都可用 */
export const RESIDENT_SECTIONS: readonly WorkflowPressSection[] = ['chat', 'media', 'proofread', 'snapshot', 'usage']

/**
 * 读取当前文档的内容归属：笔记与公众号看一级目录名，作品看 projectDir，其余为 null。
 * 关键约束：笔记/公众号判定排在作品之前——当前文档事实（module）优先于作品选定，
 * 否则在作品内打开笔记时会因 projectDir 尚未清空而判成作品归属，专属分区与对话作用域都切不过去；
 * 公众号在「选了模块但没打开该模块文档」时也要成立，故 module 之后再看 selectedModule。
 */
export function readContentScope(context: WorkflowContextState): ContentScope | null {
    if (context.module === NOTES_MODULE_KEY) {
        return 'note'
    }
    if (context.module === WECHAT_MODULE_KEY || context.selectedModule === WECHAT_MODULE_KEY) {
        return 'wechat'
    }
    if (context.projectDir !== null) {
        return 'press'
    }
    return null
}

/**
 * 当前内容的数据与对话作用域目录：作品取 projectDir，笔记与公众号取模块目录，其余文档没有作用域。
 * 作用域直接作为 AiChat 的 projectDir 使用，同一目录共用一份对话记录。
 * 关键约束：公众号在「选模块」场景下 module 可能仍是 root，作用域要回落到模块键本身，
 * 否则公众号对话会与管理面板落到同一个 root 作用域。
 */
export function readScopeDir(context: WorkflowContextState, scope: ContentScope | null): string | null {
    if (scope === 'press') {
        return context.projectDir
    }
    if (scope === null) {
        return null
    }
    if (scope === 'wechat') {
        return context.module === WECHAT_MODULE_KEY ? context.module : WECHAT_MODULE_KEY
    }
    return context.module
}

/** 当前归属下可用的分区：常驻分区 + 该归属的专属分区 */
export function readAvailableSections(scope: ContentScope | null): readonly WorkflowPressSection[] {
    if (scope === null) {
        return RESIDENT_SECTIONS
    }
    return [...RESIDENT_SECTIONS, ...SCOPE_SECTIONS[scope]]
}
