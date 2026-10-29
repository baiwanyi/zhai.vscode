/**
 * 工具审批桥：把 SDK 的 canUseTool 回调转成一次宿主与 Webview 的往返，并负责超时与取消收口。
 * 复用约定：推送复用 stream 通道（携带 permission 字段），回包走 ai/permissionDecision；
 * 本层只做挂起与唤醒，权限判定留在工具守卫，避免两处规则分叉。
 * 关键约束：同一 id 只允许结算一次；超时按拒绝处理且不中断会话，避免一次无人应答拖死整轮；
 * 生成中止、会话切换或面板关闭必须调用 cancelAll，否则等待中的 Promise 会永久悬挂。
 */
import type { AiPermissionDecision, AiPermissionRequest } from '@shared/types/aiChat'

/** 审批默认超时：用户无响应时按拒绝处理，模型可继续换方案 */
const APPROVAL_TIMEOUT_MS = 60_000

/** 单个等待中的审批：resolve 由回包、超时或取消触发 */
interface PendingApproval {
    resolve: (decision: AiPermissionDecision) => void
    timer: ReturnType<typeof setTimeout>
}

export class PermissionBroker {
    private readonly pending = new Map<string, PendingApproval>()

    public constructor(private readonly emit: (request: AiPermissionRequest) => void) {}

    /** 发起一次审批并等待用户决定：超时与取消都返回拒绝，调用方无需区分 */
    public request(request: AiPermissionRequest): Promise<AiPermissionDecision> {
        return new Promise<AiPermissionDecision>((resolve) => {
            const timer = setTimeout(() => {
                this.pending.delete(request.id)
                resolve({ allowed: false })
            }, APPROVAL_TIMEOUT_MS)
            this.pending.set(request.id, { resolve, timer })
            this.emit(request)
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
