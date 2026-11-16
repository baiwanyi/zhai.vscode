/**
 * 出图会话契约：生成意图、出图阶段、进度、在途快照与成功回执。
 * 复用约定：生成结果直接复用 ./media 的 MediaItem，不另立图库契约；
 * 图库的列举、删除、设封面与详情全部由 media/* 协议承担，本文件不定义图片标识规则。
 * 关键约束：进度只用于界面提示，不参与流程判定，终态一律以请求回执为准；
 * 在途快照的 dirPath 是归属判定依据，作用域不一致时前端不得当作本页进度。
 */
import type { MediaItem } from './media'

/**
 * 生成意图：角色卡、设定条目与其他图片三种，只用于标注出处类别。
 * 「作品封面」不是生成意图——任意一张非角色图都可以在媒体页设为封面。
 */
export type ImageGenerateKind = 'portrait' | 'lore' | 'photo'

/** 出图阶段：thinking 表示模型在准备提示，generating 表示已开始调用 ImageGen */
export type ImageGenerateStage = 'thinking' | 'generating'

/**
 * 出图进度：经 state 消息的 imagegen 通道下发。
 * 关键约束：只用于界面提示，不参与流程判定——进度丢失不得影响最终结果，终态一律以请求回执为准。
 */
export interface ImageGenerateProgress {
    stage: ImageGenerateStage
}

/**
 * 最近一次成功出图的回执：随在途快照下发，供视图重建后的接管态补做封面认领与列表回填。
 * 关键约束：只在内存里留存最后一轮，finishedAt 用于前端过滤过旧回执，别把它当历史来源。
 */
export interface ImageGenerateCompleted {
    /** 出图归属：作品目录，null 为通用素材 */
    dirPath: string | null
    /** 完成时刻（毫秒时间戳） */
    finishedAt: number
    result: ImageGenerateResult
}

/**
 * 在途出图快照：视图重建（切分区 / 切作品）后据此恢复骨架、阶段文案与取消入口。
 * 关键约束：dirPath 是归属判定依据——作用域不一致时前端不得把它当成本页的进度，
 * 单任务锁只会让发送被拒绝，不能展示别人的进度条。
 */
export interface ImageGenerateState {
    /** 是否有在途出图请求 */
    generating: boolean
    /** 在途请求的作用域（作品目录），null 表示通用素材；generating 为 false 时无意义 */
    dirPath: string | null
    /** 已进入的出图阶段：尚未收到任何进度时为 null */
    stage: ImageGenerateStage | null
    /** 最近一次成功出图的回执（无论此刻是否在生成）：没有出过图为 null */
    lastResult: ImageGenerateCompleted | null
}

/**
 * 生成结果：只回传新图本身，生成不影响作品封面。
 * 角色封面不在此回传——前端在生成回执后按「该角色尚无封面」自行写回人物卡，避免两套写回口径。
 */
export interface ImageGenerateResult {
    image: MediaItem
}
