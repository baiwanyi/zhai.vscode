/**
 * 菜单仓储：一个账号一行，存整棵菜单 JSON（结构 + 本地内容），读取时本地草稿优先。
 * 复用约定：SQL 走 better-sqlite3 预编译语句，按 accountId 定位；写入前由服务层用 readWechatMenuButtons 收窄；
 * 关键约束：平台保存成功后才写库，平台失败不留半截数据；账号删除或删除整棵菜单时须同步清理，避免残留。
 */
import type Database from 'better-sqlite3'

/** 读取账号最近一次保存的菜单内容树：从未保存过返回 null */
export function readWechatMenuJson(db: Database.Database, accountId: string): string | null {
    const row = db.prepare('SELECT menu_json FROM wechat_menus WHERE account_id = ?').get(accountId) as
        | { menu_json: string }
        | undefined
    return row?.menu_json ?? null
}

/** 覆盖写入账号菜单内容树：由服务层在平台保存成功后调用 */
export function saveWechatMenuJson(
    db: Database.Database,
    accountId: string,
    menuJson: string,
    updatedAt: string,
): void {
    db.prepare(
        `INSERT INTO wechat_menus (account_id, menu_json, updated_at)
            VALUES (@accountId, @menuJson, @updatedAt)
            ON CONFLICT(account_id) DO UPDATE SET menu_json = excluded.menu_json, updated_at = excluded.updated_at`,
    ).run({ accountId, menuJson, updatedAt })
}

/** 删除账号的本地菜单内容：账号删除时由服务层一并调用 */
export function deleteWechatMenuJson(db: Database.Database, accountId: string): void {
    db.prepare('DELETE FROM wechat_menus WHERE account_id = ?').run(accountId)
}
