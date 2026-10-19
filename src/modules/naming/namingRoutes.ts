/**
 * 取名协议路由：把 naming/* 消息分发到 NamingService，并在此完成入参收窄。
 * 复用约定：由 AiChatViewProvider 统一接收 Webview 消息后按前缀委托，避免面板类继续膨胀；
 * 除 catalog 外的写操作只接受白名单字段（名称、分类、条数）。
 * 关键约束：名称长度与分类必须校验，超长或未知名片一律拒绝，防止异常载荷进入数据库。
 */
import { NAMING_CATEGORIES } from './data/catalog'
import type { NamingService } from './namingService'
import type { NamingCategory } from '../../shared/types/naming'

/** 收藏名称最大长度 */
const MAX_NAME_LENGTH = 16
/** 历史列表默认条数 */
const DEFAULT_HISTORY_LIMIT = 50

export class NamingRoutes {
    public constructor(private readonly service: NamingService) {}

    /** 处理取名协议方法 */
    public async handle(method: string, payload: unknown): Promise<unknown> {
        switch (method) {
            case 'naming/catalog':
                return this.service.getCatalog()
            case 'naming/generate':
                return this.service.generate(payload)
            case 'naming/aiGenerate':
                return this.service.generateWithAi(payload)
            case 'naming/abort':
                return this.service.abortAi()
            case 'naming/history':
                return this.service.listHistory(readLimit(payload))
            case 'naming/history/clear':
                return this.service.clearHistory()
            case 'naming/favorites':
                return this.service.listFavorites()
            case 'naming/favorite/toggle': {
                const { name, category } = readFavoritePayload(payload)
                return this.service.toggleFavorite(name, category)
            }
            default:
                throw new Error(`未知的取名协议方法：${method}`)
        }
    }
}

/** 历史条数：缺省或非法值回落 50 */
function readLimit(payload: unknown): number {
    if (typeof payload !== 'object' || payload === null) {
        return DEFAULT_HISTORY_LIMIT
    }
    const limit = (payload as { limit?: unknown }).limit
    return typeof limit === 'number' && Number.isFinite(limit) ? Math.floor(limit) : DEFAULT_HISTORY_LIMIT
}

/** 收藏入参：名称须为非空且不超长的字符串，分类须在枚举内 */
function readFavoritePayload(payload: unknown): { name: string; category: NamingCategory } {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('naming/favorite/toggle 缺少参数')
    }
    const value = payload as { name?: unknown; category?: unknown }
    const name = typeof value.name === 'string' ? value.name.trim() : ''
    if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
        throw new Error('naming/favorite/toggle 名称非法')
    }
    const category = NAMING_CATEGORIES.find((item) => item.value === value.category)?.value
    if (!category) {
        throw new Error('naming/favorite/toggle 分类非法')
    }
    return { name, category }
}
