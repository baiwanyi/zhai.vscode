/**
 * 人物取名：按地域（中国 / 西方 / 日本）、时代、性别、字数与参考典籍组合姓氏与名字。
 * 复用约定：姓氏与名用字全部取自 ../data，随机源由调用方注入（可固定种子复现）；
 * 中国名字的双字名保证不取重复字（不叠字、不重字），西方与日本使用现成名字词表。
 * 关键约束：姓氏优先取用户输入，其次按单姓 / 复姓池随机；同名由调用方传入的 exclude 集合过滤。
 */
import type { RandomSource } from './random'
import type { NamingCandidate, NamingRequest } from '../../../shared/types/naming'
import {
    CN_NAME_POOLS,
    JP_FEMALE_GIVEN,
    JP_MALE_GIVEN,
    REFERENCE_CHARS,
    WEST_FEMALE_GIVEN,
    WEST_MALE_GIVEN,
} from '../data/nameChars'
import { CN_COMPOUND_SURNAMES, CN_SINGLE_SURNAMES, JP_SURNAMES, WEST_SURNAMES } from '../data/surnames'

/** 单个名字的最大尝试次数，避免池过小时死循环 */
const MAX_ATTEMPTS_PER_NAME = 40

/** 生成一批人物名：数量不足时返回实际生成数 */
export function generatePersonNames(
    request: NamingRequest,
    random: RandomSource,
    exclude: ReadonlySet<string>,
): NamingCandidate[] {
    const surname = resolveSurname(request, random)
    const items: NamingCandidate[] = []
    const used = new Set(exclude)
    const limit = request.count * MAX_ATTEMPTS_PER_NAME

    for (let attempt = 0; attempt < limit && items.length < request.count; attempt += 1) {
        const given = buildGivenName(request, random)
        if (given.length === 0) {
            continue
        }
        const name = composeFullName(request.variant, surname, given)
        if (used.has(name)) {
            continue
        }
        used.add(name)
        items.push({ id: `c${items.length}`, name, surname, suffix: null })
    }
    return items
}

/** 解析姓氏：用户输入优先，否则按地域与单姓 / 复姓池随机 */
function resolveSurname(request: NamingRequest, random: RandomSource): string {
    const explicit = request.surname.trim()
    if (explicit.length > 0) {
        return explicit
    }
    if (request.variant === 'west') {
        return random.pick(WEST_SURNAMES)
    }
    if (request.variant === 'jp') {
        return random.pick(JP_SURNAMES)
    }
    return random.pick(request.surnameKind === 'compound' ? CN_COMPOUND_SURNAMES : CN_SINGLE_SURNAMES)
}

/** 构建名字部分：中国按字数取字，西方 / 日本取现成名 */
function buildGivenName(request: NamingRequest, random: RandomSource): string {
    if (request.variant === 'west') {
        return random.pick(pickGenderPool(WEST_MALE_GIVEN, WEST_FEMALE_GIVEN, request.gender))
    }
    if (request.variant === 'jp') {
        return random.pick(pickGenderPool(JP_MALE_GIVEN, JP_FEMALE_GIVEN, request.gender))
    }
    const pool = buildCnCharPool(request)
    const length = resolveNameLength(request, random)
    return pickDistinctChars(pool, length, random)
}

/** 按性别选池：中性时男女合并 */
function pickGenderPool(
    male: readonly string[],
    female: readonly string[],
    gender: NamingRequest['gender'],
): readonly string[] {
    if (gender === 'male') {
        return male
    }
    if (gender === 'female') {
        return female
    }
    return [...male, ...female]
}

/** 中国名用字池：基础池叠加参考典籍字池（参考字权重约为基础字的 1/3） */
function buildCnCharPool(request: NamingRequest): readonly string[] {
    const eraPools = CN_NAME_POOLS[request.era === 'ancient' ? 'ancient' : 'modern']
    const base = uniqueChars(eraPools[request.gender])
    if (request.reference === 'none') {
        return base
    }
    return [...base, ...base, ...uniqueChars(REFERENCE_CHARS[request.reference])]
}

/** 字数：不限时随机 1 或 2 字 */
function resolveNameLength(request: NamingRequest, random: RandomSource): number {
    if (request.length === 'one') {
        return 1
    }
    if (request.length === 'two') {
        return 2
    }
    return random.next() < 0.5 ? 1 : 2
}

/** 取指定数量的不重复字 */
function pickDistinctChars(pool: readonly string[], count: number, random: RandomSource): string {
    const picked: string[] = []
    const guard = count * MAX_ATTEMPTS_PER_NAME
    for (let attempt = 0; attempt < guard && picked.length < count; attempt += 1) {
        const char = random.pick(pool)
        if (!picked.includes(char)) {
            picked.push(char)
        }
    }
    return picked.join('')
}

/** 姓名拼装：中国 / 日本为「姓 + 名」，西方为「名 姓」 */
function composeFullName(variant: string, surname: string, given: string): string {
    return variant === 'west' ? `${given} ${surname}` : `${surname}${given}`
}

/** 字池去重：数据表可能存在同一字重复出现 */
function uniqueChars(pool: readonly string[]): readonly string[] {
    return [...new Set(pool)]
}
