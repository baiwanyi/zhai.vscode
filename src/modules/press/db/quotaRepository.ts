/**
 * AI 配额仓储：press.db 的 meta 表按天记录各任务的成功次数。
 * 复用约定：任务差异只体现在键前缀（press_ai_* / press_image_*），读写逻辑共用一份；
 * 关键约束：日期不一致一律视为 0；计数只在生成成功后递增，失败与取消不占用额度；
 * 键名由调用方以常量给定，不接受外部输入拼接，避免写坏 meta 表。
 */
import type Database from 'better-sqlite3'

export interface QuotaKeys {
    dateKey: string
    countKey: string
}

/** 今日日期键：本地时区的 YYYY-MM-DD */
function todayKey(): string {
    const now = new Date()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${now.getFullYear()}-${month}-${day}`
}

/** 读取某任务今日已用次数 */
export function readUsedToday(db: Database.Database, keys: QuotaKeys): number {
    const dateRow = db.prepare('SELECT value FROM meta WHERE key = ?').get(keys.dateKey) as
        { value: string } | undefined
    if (dateRow?.value !== todayKey()) {
        return 0
    }
    const countRow = db.prepare('SELECT value FROM meta WHERE key = ?').get(keys.countKey) as
        { value: string } | undefined
    const parsed = countRow ? Number.parseInt(countRow.value, 10) : 0
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/** 记录一次成功生成 */
export function consumeToday(db: Database.Database, keys: QuotaKeys): void {
    const used = readUsedToday(db, keys)
    const statement = db.prepare(
        'INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
    statement.run(keys.dateKey, todayKey())
    statement.run(keys.countKey, String(used + 1))
}
