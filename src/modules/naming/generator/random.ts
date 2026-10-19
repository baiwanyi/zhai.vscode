/**
 * 取名随机源：可注入种子的伪随机数工具，供生成器抽样与单测复现。
 * 复用约定：只暴露 next / int / pick，生成器不直接调用 Math.random，便于测试固定结果。
 * 关键约束：mulberry32 为 32 位状态算法，种子相同则序列相同；不使用加密随机，仅用于取名场景。
 */

export interface RandomSource {
    /** [0, 1) 均匀随机 */
    next: () => number
    /** [0, maxExclusive) 整数 */
    int: (maxExclusive: number) => number
    /** 数组等概率抽样，空数组抛错由调用方保证非空 */
    pick: <T>(items: readonly T[]) => T
}

/** mulberry32：轻量确定性随机数生成器 */
export function createRandom(seed: number = Date.now()): RandomSource {
    let state = seed >>> 0
    const next = (): number => {
        state = (state + 0x6d2b79f5) >>> 0
        let value = state
        value = Math.imul(value ^ (value >>> 15), value | 1)
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296
    }
    return {
        next,
        int: (maxExclusive) => Math.floor(next() * maxExclusive),
        pick: <T>(items: readonly T[]): T => {
            const value = items[Math.floor(next() * items.length)]
            if (value === undefined) {
                throw new Error('随机抽样集合为空')
            }
            return value
        },
    }
}

/** 按权重抽样并返回下标；权重全为 0 时退化为等概率 */
export function pickWeightedIndex(weights: readonly number[], random: RandomSource): number {
    const total = weights.reduce((sum, weight) => sum + Math.max(weight, 0), 0)
    if (total <= 0) {
        return random.int(weights.length)
    }
    let cursor = random.next() * total
    for (let index = 0; index < weights.length; index += 1) {
        cursor -= Math.max(weights[index] ?? 0, 0)
        if (cursor < 0) {
            return index
        }
    }
    return weights.length - 1
}
