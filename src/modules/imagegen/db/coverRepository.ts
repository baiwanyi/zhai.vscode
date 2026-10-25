/**
 * 封面选择仓储：press.db 的 meta 表按作品记录选中的封面（相对存储根路径）。
 * 复用约定：与配额仓储共用 meta 表，键前缀 `cover:` 区分用途；工作台设封面与仪表盘读封面共用同一份读写逻辑。
 * 关键约束：值只接受 press/{作品名}/Cover/cover-{14 位时间戳}.{ext} 形态，写入前先校验，
 * 避免把手写路径或越界路径写进库；作品删除后残留的键无害，读取时按当前作品路径取用。
 */
import type Database from 'better-sqlite3'
import { isPressCoverId } from '../../../shared/types/press'
import { PRESS_MODULE_DIR } from '../../press/projectFactory'
import { COVER_DIR } from '../constants'

/** 键前缀：后接作品相对路径 press/{作品名} */
const KEY_PREFIX = 'cover:'
/** 封面相对路径的段数：press/{作品名}/Cover/{文件名} */
const COVER_SEGMENT_COUNT = 4

/** 判断路径是否为该作品下的封面文件：段数、模块、作品名与文件名规则全部对齐才成立 */
export function isProjectCoverPath(dirPath: string, coverPath: string): boolean {
    const segments = coverPath.split('/')
    const id = segments[COVER_SEGMENT_COUNT - 1]?.replace(/\.[^.]+$/u, '') ?? ''
    return (
        segments.length === COVER_SEGMENT_COUNT &&
        segments[0] === PRESS_MODULE_DIR &&
        `${segments[0]}/${segments[1] ?? ''}` === dirPath &&
        segments[2] === COVER_DIR &&
        isPressCoverId(id)
    )
}

export class PressCoverStore {
    public constructor(private readonly db: Database.Database) {}

    /** 读取作品选中的封面相对路径：未设置或记录不合规时返回 null */
    public read(dirPath: string): string | null {
        const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(`${KEY_PREFIX}${dirPath}`) as
            { value: string } | undefined
        if (row === undefined || !isProjectCoverPath(dirPath, row.value)) {
            return null
        }
        return row.value
    }

    /** 写入或清除作品选中的封面：传 null 表示取消选择 */
    public write(dirPath: string, coverPath: string | null): void {
        const key = `${KEY_PREFIX}${dirPath}`
        if (coverPath === null) {
            this.db.prepare('DELETE FROM meta WHERE key = ?').run(key)
            return
        }
        if (!isProjectCoverPath(dirPath, coverPath)) {
            throw new Error(`封面路径非法：${coverPath}`)
        }
        this.db
            .prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
            .run(key, coverPath)
    }
}
