/**
 * 作品封面仓储：press.db 的 meta 表按作品记录选中的封面图片（相对存储根路径）。
 * 复用约定：与配额仓储共用 meta 表，键前缀 `cover:` 区分用途；仪表盘、设定页与媒体页共用同一份读写逻辑；
 * 路径形态由 @shared/types/media 的 isMediaPath 判定，避免媒体模块反向依赖生图模块。
 * 关键约束：封面只接受 images/{YYYYMM}/{文件}——旧目录 press/{作品名}/Images/ 已由一次性迁移收编，
 * 读端不再为它留兼容分支，库里残留的旧值一律按「未选择封面」处理；
 * 其它形态同样拒绝，防止把手写路径或越界路径写进库；作品删除后残留的键无害，读取时按当前作品路径取用。
 */
import { isMediaPath } from '@shared/types/media'
import type Database from 'better-sqlite3'

/** 键前缀：后接作品相对路径 press/{作品名} */
const KEY_PREFIX = 'cover:'

/** 从图片相对路径取图片标识：去掉目录与扩展名 */
export function readImageIdFromPath(imagePath: string): string {
    const fileName = imagePath.split('/').pop() ?? ''
    return fileName.replace(/\.[^.]+$/u, '')
}

/** 封面路径是否可用：只认媒体路径 images/{YYYYMM}/{文件} */
function isCoverPath(coverPath: string): boolean {
    return isMediaPath(coverPath)
}

export class PressCoverStore {
    public constructor(private readonly db: Database.Database) {}

    /** 读取作品选中的封面相对路径：未设置或记录不合规时返回 null */
    public read(dirPath: string): string | null {
        const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(`${KEY_PREFIX}${dirPath}`) as
            { value: string } | undefined
        if (row === undefined || !isCoverPath(row.value)) {
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
        if (!isCoverPath(coverPath)) {
            throw new Error(`图片路径非法：${coverPath}`)
        }
        this.db
            .prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
            .run(key, coverPath)
    }
}
