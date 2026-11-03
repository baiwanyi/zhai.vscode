/**
 * 媒体入库写入器：出图落盘后把记录写进媒体索引，由装配处以函数注入方式交给出图模块。
 * 复用约定：媒体表结构只在这里与 ./mediaRepository 出现，装配方不必知道 insertMedia 与库句柄；
 * 库按当前存储根懒打开，写入时才取值，切换存储根后自然跟随。
 * 关键约束：打开或写入失败照原样上抛，由出图链路的失败提示承接，本文件不吞异常。
 */
import { insertMedia, type MediaRecord } from './mediaRepository'
import type { MediaDatabase } from './db/connection'

/** 媒体记录写入器：与出图模块的 MediaRecorder 契约一致 */
export type MediaWriter = (record: MediaRecord) => void

/** 造一个写入器：每次写入都取当前存储根对应的媒体索引库 */
export function createMediaRecorder(openDatabase: () => MediaDatabase): MediaWriter {
    return (record: MediaRecord): void => insertMedia(openDatabase().db, record)
}
