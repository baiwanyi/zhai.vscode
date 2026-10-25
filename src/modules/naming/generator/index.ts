/**
 * 取名生成入口：按分类分发到人物或实体生成器，并统一处理去重集合与随机源。
 * 复用约定：生成结果只含展示所需字段（id/name/surname/suffix），条件快照与落库由 namingService 负责；
 * 导入 exclude 用于跨批次去重（历史已出现过的名字）。
 * 关键约束：seed 相同且 exclude 相同时结果可复现；本函数为纯函数，不读写数据库、不发起网络请求。
 */
import type { NamingCandidate, NamingRequest } from '@shared/types/naming'
import { generateEntityNames } from './entity'
import { generatePersonNames } from './person'
import { createRandom } from './random'

/** 生成入参 */
export interface GenerateNamesInput {
    request: NamingRequest
    /** 固定种子便于复现与单测 */
    seed?: number
    /** 需要排除的已有名字 */
    exclude?: readonly string[]
}

/** 生成一批候选名 */
export function generateNames({ request, seed, exclude }: GenerateNamesInput): NamingCandidate[] {
    const random = createRandom(seed)
    const used = new Set(exclude ?? [])
    const items =
        request.category === 'person'
            ? generatePersonNames(request, random, used)
            : generateEntityNames(request, random, used)
    return items
}
