/**
 * 工具审批桥：把 SDK 的 canUseTool 回调转成一次宿主与 Webview 的往返，并负责超时与取消收口。
 * 复用约定：推送复用 stream 通道（携带 permission 字段），回包走 ai/permissionDecision；
 * 本层只做挂起与唤醒，权限判定留在工具守卫，避免两处规则分叉。
 * 关键约束：同一 id 只允许结算一次；超时按拒绝处理且不中断会话，避免一次无人应答拖死整轮；
 * 生成中止、会话切换或面板关闭必须调用 cancelAll，否则等待中的 Promise 会永久悬挂；
 * 超时按调用方给出的期限执行 —— 多题问卷需要远长于工具审批的等待窗口，写死单一常量会让它必超时；
 * 写入类被「用户主动拒绝」时要留下标记：那是正常操作，上层不得当成失败弹提示。
 */
import type { AiPermissionDecision, AiPermissionRequest } from '@shared/types/aiChat'

/** 工具审批默认超时：用户无响应时按拒绝处理，模型可继续换方案 */
const APPROVAL_TIMEOUT_MS = 60_000

/** 单个等待中的审批：resolve 由回包、超时或取消触发 */
interface PendingApproval {
    resolve: (decision: AiPermissionDecision) => void
    timer: ReturnType<typeof setTimeout>
    /** 事项类型：只有写入类被拒才代表用户否决了整轮工具调用 */
    kind: AiPermissionRequest['kind']
}

export class PermissionBroker {
    private readonly pending = new Map<string, PendingApproval>()

    /** 本轮是否出现过「用户主动拒绝写入」：超时与取消都不算 */
    private userDenied = false

    /** 用户是否主动拒绝过写入：上层据此把整轮结束归为正常停止而非失败 */
    public get hasUserDenied(): boolean {
        return this.userDenied
    }

    /**
     * @param emit 推送一次待确认事项
     * @param messageId 归属的助手消息 id：由会话服务在每轮生成时注入，通道层不感知消息
     */
    public constructor(
        private readonly emit: (request: AiPermissionRequest) => void,
        private readonly messageId: string | null = null,
    ) {}

    /**
     * 发起一次审批并等待用户决定：超时与取消都返回拒绝，调用方无需区分。
     * @param timeoutMs 等待期限：缺省为工具审批的固定值，提问类由守卫按题量给出
     */
    public request(
        request: AiPermissionRequest,
        timeoutMs: number = APPROVAL_TIMEOUT_MS,
    ): Promise<AiPermissionDecision> {
        return new Promise<AiPermissionDecision>((resolve) => {
            const timer = setTimeout(() => {
                this.pending.delete(request.id)
                resolve({ allowed: false })
            }, timeoutMs)
            this.pending.set(request.id, { resolve, timer, kind: request.kind })
            // 两类事项都在消息流内作答：归属消息用于挂到对应气泡下，截止时间用于提示剩余窗口
            this.emit({ ...request, messageId: this.messageId, expiresAt: Date.now() + timeoutMs })
        })
    }

    /** 结算一次审批：返回是否命中，未命中说明已超时或被取消 */
    public resolve(id: string, decision: AiPermissionDecision): boolean {
        const pending = this.pending.get(id)
        if (pending === undefined) {
            return false
        }
        clearTimeout(pending.timer)
        this.pending.delete(id)
        // 只认写入类：提问被跳过后模型会继续换个问法，不代表本轮被否决
        if (pending.kind === 'tool' && !decision.allowed) {
            this.userDenied = true
        }
        pending.resolve(decision)
        return true
    }

    /** 拒绝全部等待中的审批：中止生成、切换会话与释放面板时调用 */
    public cancelAll(): void {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer)
            pending.resolve({ allowed: false })
        }
        this.pending.clear()
    }
}
