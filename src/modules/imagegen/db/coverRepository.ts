/**
 * 作品封面仓储：press.db 的 meta 表按作品记录选中的封面图片（相对存储根路径）。
 * 复用约定：与配额仓储共用 meta 表，键前缀 `cover:` 区分用途；生图页图片详情设封面与仪表盘读封面共用同一份读写逻辑。
 * 关键约束：值只接受 press/{作品名}/{图片目录}/{图片文件名} 形态且图片标识合法，写入前先校验，
 * 避免把手写路径或越界路径写进库；图片目录同时接受统一目录 Images 与只读兼容的 Cover / Portraits；
 * 作品删除后残留的键无害，读取时按当前作品路径取用。
 */
import { PRESS_MODULE_DIR } from '@modules/common/projectPath'
import { isPressImageId } from '@shared/types/imagegen'
import type Database from 'better-sqlite3'
import { IMAGE_DIR_NAMES } from '../constants'

/** 键前缀：后接作品相对路径 press/{作品名} */
const KEY_PREFIX = 'cover:'
/** 图片相对路径的段数：press/{作品名}/{目录}/{文件名} */
const IMAGE_SEGMENT_COUNT = 4

/**
 * 判断路径是否落在该作品的图片目录内：段数、模块、作品名与图片目录全部对齐才成立。
 * 放宽点：不校验文件名的标识规则——手工放入的孤儿图同样要被列举与删除，
 * 是否可设为封面由调用方再用 isPressImageId 判定。
 */
export function isProjectImagePath(dirPath: string, imagePath: string): boolean {
    const segments = imagePath.split('/')
    const dirName = segments[IMAGE_SEGMENT_COUNT - 2] ?? ''
    return (
        segments.length === IMAGE_SEGMENT_COUNT &&
        segments[0] === PRESS_MODULE_DIR &&
        `${segments[0]}/${segments[1] ?? ''}` === dirPath &&
        IMAGE_DIR_NAMES.includes(dirName)
    )
}

/** 从图片相对路径取图片标识：去掉目录与扩展名 */
export function readImageIdFromPath(imagePath: string): string {
    const fileName = imagePath.split('/').pop() ?? ''
    return fileName.replace(/\.[^.]+$/u, '')
}

export class PressCoverStore {
    public constructor(private readonly db: Database.Database) {}

    /** 读取作品选中的封面相对路径：未设置或记录不合规时返回 null */
    public read(dirPath: string): string | null {
        const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(`${KEY_PREFIX}${dirPath}`) as
            { value: string } | undefined
        if (row === undefined || !isProjectImagePath(dirPath, row.value)) {
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
        if (!isProjectImagePath(dirPath, coverPath) || !isPressImageId(readImageIdFromPath(coverPath))) {
            throw new Error(`图片路径非法：${coverPath}`)
        }
        this.db
            .prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
            .run(key, coverPath)
    }
}
