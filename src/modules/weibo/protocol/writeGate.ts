/**
 * 微博写操作互斥闸门：并发重复提交会直接产生重复发博、重复评论等不可逆副作用。
 * 复用约定：路由层只在 handle 入口调用一次 run，各 handler 不感知闸门存在；
 * 键由「方法名 + 载荷 JSON」组成，只表示该动作当前是否在飞行中。
 * 关键约束：新增写方法必须同步登记，漏登记会让该方法绕过闸门；
 * 闸门在 finally 释放，异常路径不会把后续请求永久锁死；一次操作完成后允许再次点击。
 */
import { WEIBO_METHODS } from '@shared/types/weiboMethods'
import { WeiboWebError } from '../transport/httpClient'

/** 写操作方法集合：登记即受互斥保护 */
const WEIBO_WRITE_METHODS: ReadonlySet<string> = new Set([
    WEIBO_METHODS.publish,
    WEIBO_METHODS.commentCreate,
    WEIBO_METHODS.commentDestroy,
    WEIBO_METHODS.commentLike,
    WEIBO_METHODS.repost,
    WEIBO_METHODS.repostLike,
    WEIBO_METHODS.destroyStatus,
    WEIBO_METHODS.like,
    WEIBO_METHODS.authorFollow,
    WEIBO_METHODS.userGroupCreate,
    WEIBO_METHODS.userGroupSave,
    WEIBO_METHODS.userRemark,
    WEIBO_METHODS.citySave,
    WEIBO_METHODS.blockListSave,
    WEIBO_METHODS.credentialSave,
    WEIBO_METHODS.credentialClear,
])

/** 是否为受互斥保护的写方法 */
export function isWeiboWriteMethod(method: string): boolean {
    return WEIBO_WRITE_METHODS.has(method)
}

/** 写操作闸门：每个路由实例持有独立的一份在飞集合 */
export class WriteGate {
    /** 键为「方法 + 载荷」，只表示该动作当前正在处理 */
    private readonly inflightWrites = new Set<string>()

    /**
     * 写操作互斥：同一动作的相同载荷在飞行中只放行一次。
     * 关键约束：只做「飞行中去重」而不是时间窗去重——一次操作完成后用户的重复点击应当放行，
     * 真正要挡的是双击与网络重发。
     */
    public async run<T>(method: string, payload: unknown, action: () => Promise<T>): Promise<T> {
        const key = `${method}:${JSON.stringify(payload ?? null)}`
        if (this.inflightWrites.has(key)) {
            throw new WeiboWebError('rate-limited', '相同的操作正在处理中，请稍候再试')
        }
        this.inflightWrites.add(key)
        try {
            return await action()
        } finally {
            this.inflightWrites.delete(key)
        }
    }
}
