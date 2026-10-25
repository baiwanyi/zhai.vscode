/**
 * 实体取名：地点 / 势力 / 招式 / 装备 / 怪物 / 道具，按「意象词素 + 后缀」组合，词素取自 ../data 的池。
 * 复用约定：用户指定后缀优先，未指定才从后缀池随机；「具体要求」按词素标签命中加权（命中越多权重越高），
 * 权重抽样复用 ./random 的 pickWeightedIndex，两段式组合由分类规则 ENTITY_RULES 限定。
 * 关键约束：两段词素不重复；整体长度受分类 maxLength 约束，超出时自动降为一段词素。
 */
import type { NamingCandidate, NamingRequest } from '@shared/types/naming'
import { pickWeightedIndex } from './random'
import type { RandomSource } from './random'
import type { NamingCorePool } from '../data/cores'
import { ENTITY_RULES } from '../data/catalog'
import { ENTITY_CORES } from '../data/cores'
import { ENTITY_SUFFIXES } from '../data/suffixes'

/** 空池兜底词素：内容库键缺失时至少产出合法名称 */
const FALLBACK_CORES = ['玄', '灵', '青'] as const
/** 单批最大尝试次数，避免词素池不足时死循环 */
const MAX_ATTEMPTS_PER_NAME = 40
/** 用户输入后缀的最大长度（汉字） */
const MAX_SUFFIX_LENGTH = 4
/** 关键词最大数量 */
const MAX_KEYWORDS = 8

/** 加权词素：weight 由标签命中数决定 */
interface WeightedCore {
    text: string
    weight: number
}

/** 生成一批实体名 */
export function generateEntityNames(
    request: NamingRequest,
    random: RandomSource,
    exclude: ReadonlySet<string>,
): NamingCandidate[] {
    const poolKey = `${request.category}:${request.variant}`
    const corePool: NamingCorePool = ENTITY_CORES[poolKey] ?? { plain: FALLBACK_CORES, tagged: [] }
    const suffixes = ENTITY_SUFFIXES[poolKey] ?? []
    const rules = ENTITY_RULES[request.category]
    const cores = buildWeightedCores(corePool, readRequirementKeywords(request.requirement))
    const fixedSuffix = normalizeSuffix(request.suffix)
    const items: NamingCandidate[] = []
    const used = new Set(exclude)
    const limit = request.count * MAX_ATTEMPTS_PER_NAME

    for (let attempt = 0; attempt < limit && items.length < request.count; attempt += 1) {
        const suffix = fixedSuffix.length > 0 ? fixedSuffix : suffixes.length > 0 ? random.pick(suffixes) : ''
        const picked = pickCores(cores, pickCoreCount(rules.coreCount, random), random)
        const body = composeEntityName(picked, suffix, rules.maxLength)
        if (body.length === 0 || used.has(body)) {
            continue
        }
        used.add(body)
        items.push({ id: `c${items.length}`, name: body, surname: null, suffix: suffix.length > 0 ? suffix : null })
    }
    return items
}

/** 构建加权词素表：plain 权重 1，tagged 按关键词命中数加权 */
function buildWeightedCores(pool: NamingCorePool, keywords: readonly string[]): WeightedCore[] {
    const plain = pool.plain.map((text) => ({ text, weight: 1 }))
    const tagged = pool.tagged.map((core) => ({ text: core.text, weight: 1 + countHits(core.tags, keywords) * 4 }))
    const merged = [...plain, ...tagged].filter((core) => core.text.length > 0)
    return merged.length > 0 ? merged : FALLBACK_CORES.map((text) => ({ text, weight: 1 }))
}

/** 抽取指定数量的不重复词素 */
function pickCores(cores: readonly WeightedCore[], count: number, random: RandomSource): string[] {
    const available = [...cores]
    const picked: string[] = []
    for (let index = 0; index < count && available.length > 0; index += 1) {
        const cursor = pickWeightedIndex(
            available.map((core) => core.weight),
            random,
        )
        const pickedCore = available[cursor]
        if (!pickedCore) {
            break
        }
        picked.push(pickedCore.text)
        available.splice(cursor, 1)
    }
    return picked
}

/** 组合规则给出的段数：区间内随机（如 [1,2] 时各半概率） */
function pickCoreCount(range: readonly [number, number], random: RandomSource): number {
    const [min, max] = range
    return min === max ? min : min + random.int(max - min + 1)
}

/** 拼装名称：后缀已在词素末尾时不重复拼接，超长时退回更少段数 */
function composeEntityName(cores: readonly string[], suffix: string, maxLength: number): string {
    for (let take = cores.length; take >= 1; take -= 1) {
        const body = cores.slice(0, take).join('')
        const name = suffix.length === 0 || body.endsWith(suffix) ? body : `${body}${suffix}`
        if (name.length <= maxLength) {
            return name
        }
    }
    return ''
}

/** 后缀归一化：只保留汉字并限长，空串表示交给随机池 */
function normalizeSuffix(suffix: string): string {
    return suffix
        .replace(/[^\u4e00-\u9fa5]/g, '')
        .slice(0, MAX_SUFFIX_LENGTH)
        .trim()
}

/** 从「具体要求」提取关键词：按非汉字切分，用于氛围标签匹配 */
export function readRequirementKeywords(requirement: string): string[] {
    return requirement
        .split(/[^\u4e00-\u9fa5]+/)
        .map((word) => word.trim())
        .filter((word) => word.length > 0)
        .slice(0, MAX_KEYWORDS)
}

/** 统计标签命中数：双向包含即可命中（「靠海」命中标签「海」） */
function countHits(tags: readonly string[], keywords: readonly string[]): number {
    return tags.filter((tag) => keywords.some((keyword) => keyword.includes(tag) || tag.includes(keyword))).length
}
