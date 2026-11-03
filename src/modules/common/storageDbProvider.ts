/**
 * 按存储根打开数据库的工厂：把「每次取值都重新解析存储根再打开」的固定写法收在一处。
 * 复用约定：连接缓存由各库的 db/connection 自行维护，本文件只负责把 resolveStorageRoot 与
 * cacheRoot 拼成调用方需要的零参函数，不持有连接、不做降级判断。
 * 关键约束：必须每次调用都即时解析存储根——用户改 zhai.storage.rootPath 后要立刻指向新目录。
 */
import { resolveStorageRoot } from './config'
import type * as vscode from 'vscode'

/** 打开函数：入参为当前存储根与扩展缓存目录 */
export type StorageDatabaseOpener<T> = (root: vscode.Uri, cacheRoot: vscode.Uri) => T

/** 造一个「按当前存储根打开」的零参函数，供各服务以依赖注入方式持有 */
export function createStorageDatabaseProvider<T>(open: StorageDatabaseOpener<T>, cacheRoot: vscode.Uri): () => T {
    return (): T => open(resolveStorageRoot(), cacheRoot)
}
