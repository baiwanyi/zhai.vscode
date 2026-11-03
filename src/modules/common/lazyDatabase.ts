/**
 * 惰性库句柄：装配期只登记打开方式，首次取值时才真正建连接与补 schema。
 * 复用约定：各库把「打开 + 建表」封成 open 回调传入，服务侧把 get 当依赖持有，
 * 句柄本身登记到 context.subscriptions 即可随扩展退出释放。
 * 关键约束：get 必须返回同一实例（多实例会争同一库文件）；dispose 容忍「从未打开」的状态。
 */
import type Database from 'better-sqlite3'

/** 惰性库句柄：get 首次取值时才建连接与补 schema，dispose 容忍「从未打开」的状态 */
export interface LazyDatabase {
    get: () => Database.Database
    dispose: () => void
}

/** 惰性打开数据库：激活期只登记打开方式，首次取值时才真正建连接 */
export function lazyDatabase(open: () => Database.Database): LazyDatabase {
    let instance: Database.Database | null = null
    return {
        get: (): Database.Database => {
            instance ??= open()
            return instance
        },
        dispose: (): void => {
            instance?.close()
            instance = null
        },
    }
}
