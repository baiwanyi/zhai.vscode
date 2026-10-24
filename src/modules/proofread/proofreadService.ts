/**
 * 校对服务：读取当前目标、执行本地检查与 AI 语义检查、批量写回、区间定位与词库入口，供 proofread/* 协议调用。
 * 复用约定：目标读取与文档编辑在 ./target，本地规则在 ./local，AI 分批与解析在 ./ai，
 * 写回留底与用量记账复用扩展入口注入的快照服务与 UsageRecorder。
 * 关键约束：每次检查都重新从编辑器取正文，不复用前端缓存；AI 结果带回文档版本号，
 * 前端据此判断结果是否与当前文档错位；配额只在 AI 检查成功后递增，取消与失败不占用额度；
 * 同一时刻只允许一个 AI 检查任务，重复发起直接拒绝，避免并发消耗与进度广播错乱。
 */
import * as vscode from 'vscode'
import { runAiProofread } from './ai/aiProofreader'
import {
    isSameTarget,
    readDetectCache,
    readProofreadCache,
    toCachedTarget,
    writeDetectCache,
    writeProofreadCache,
} from './cache/resultCache'
import { detectAiContent } from './detect/aiDetector'
import { ensureLexiconFile, readLexicon, readLexiconState, writeLexicon } from './lexicon/lexiconStore'
import { runLocalChecks } from './local/localChecker'
import { applyProofreadEdits, revealProofreadRange } from './target/documentEditor'
import { readProofreadTarget } from './target/targetReader'
import type {
    ProofreadAiDetectResult,
    ProofreadAiDetectState,
    ProofreadAiResult,
    ProofreadAbortResult,
    ProofreadApplyRequest,
    ProofreadApplyResult,
    ProofreadCache,
    ProofreadDetectCache,
    ProofreadLexicon,
    ProofreadLexiconState,
    ProofreadLocalResult,
    ProofreadRevealRequest,
    ProofreadRevealResult,
    ProofreadRunResult,
    ProofreadTarget,
} from '../../shared/types/proofread'
import type { AiProvider } from '../ai/provider'
import type { UsageRecorder } from '../ai/usageRecorder'
import type { SecretsService } from '../common/secrets'
import type { QuotaKeys } from '../press/db/quotaRepository'
import type Database from 'better-sqlite3'
import { getSelectedCodebuddyModel } from '../ai/providers/codebuddyModels'
import { getZhaiConfig } from '../common/config'
import { consumeToday, readUsedToday } from '../press/db/quotaRepository'

/** 写回前留底回调：内容为文档全文，交由快照服务保存 */
export type BeforeWriteHandler = (uri: vscode.Uri, content: string) => Promise<void>

/** AI 校对的每日次数键：与出图、取名分账 */
const AI_QUOTA: QuotaKeys = { dateKey: 'proofread_ai_date', countKey: 'proofread_ai_count' }

/** AI 特征检测的每日次数键：第三方额度单独计数 */
const DETECT_QUOTA: QuotaKeys = { dateKey: 'proofread_zhuque_date', countKey: 'proofread_zhuque_count' }

/** 同意上传第三方的标记键：存在 globalState，避免每次检测都弹窗 */
const CONSENT_KEY = 'proofread.zhuqueConsent'

export interface ProofreadServiceDeps {
    provider: AiProvider
    usageRecorder: UsageRecorder
    db: Database.Database
    /** 密钥读取：朱雀 API Key 只存 SecretStorage，前端不接触明文 */
    secrets: SecretsService
    /** 同意标记的存储：插件全局状态 */
    state: vscode.Memento
    /** 写回前留底，未注入时跳过留底 */
    beforeWrite?: BeforeWriteHandler
}

export class ProofreadService {
    /** 进行中的 AI 检查：用于取消与并发保护 */
    private activeAiRequest: AbortController | null = null

    public constructor(private readonly deps: ProofreadServiceDeps) {}

    /** 读取当前目标：不执行检查，供页面显示章节标题与字数；无活跃编辑器时返回 null */
    public async readTarget(useSelection: boolean): Promise<ProofreadTarget | null> {
        if (vscode.window.activeTextEditor === undefined) {
            return null
        }
        return readProofreadTarget({ useSelection, maxChars: getZhaiConfig().proofreadMaxChars })
    }

    /** 执行本地检查：目标与结果同批返回并写入结果缓存；无活跃编辑器时返回 null */
    public async runLocal(useSelection: boolean): Promise<ProofreadRunResult | null> {
        const target = await this.readTarget(useSelection)
        if (target === null) {
            return null
        }
        const lexicon = await readLexicon()
        const local: ProofreadLocalResult = runLocalChecks(target.text, {
            entries: lexicon.entries,
            ignores: lexicon.ignores,
        })
        // 本地重跑意味着旧 AI 结果已与本次结果同源失效，缓存里只留本地结果
        await writeProofreadCache(this.deps.state, {
            savedAt: new Date().toISOString(),
            target: toCachedTarget(target),
            local,
            ai: null,
        })
        return { target, local }
    }

    /** 读取校对结果缓存：只有与当前编辑器正文签名一致时才返回，否则视为无缓存 */
    public async getCachedResult(): Promise<ProofreadCache | null> {
        return this.readMatchingCache()
    }

    /** 读取检测结果缓存：同样按当前正文签名校验 */
    public async getCachedDetect(): Promise<ProofreadDetectCache | null> {
        const cached = readDetectCache(this.deps.state)
        if (cached === null) {
            return null
        }
        const target = await this.readTarget(cached.target.kind === 'selection')
        if (target === null || !isSameTarget(cached.target, target)) {
            return null
        }
        return cached
    }

    /** 执行 AI 检查：分批串行，失败批次只计数；无活跃编辑器时返回 null */
    public async runAi(
        useSelection: boolean,
        onProgress?: (completed: number, total: number) => void,
    ): Promise<ProofreadAiResult | null> {
        if (this.activeAiRequest !== null) {
            throw new Error('已有 AI 校对在进行中，请等待完成或取消')
        }
        const target = await this.readTarget(useSelection)
        if (target === null) {
            return null
        }
        const status = await this.deps.provider.checkReady()
        if (!status.ready) {
            throw new Error(status.reason ?? 'AI 通道未就绪，请先完成登录或配置 API Key')
        }
        this.assertAiQuota()
        const cfg = getZhaiConfig()
        const controller = new AbortController()
        this.activeAiRequest = controller
        const startedAt = Date.now()
        try {
            const outcome = await runAiProofread({
                provider: this.deps.provider,
                model: getSelectedCodebuddyModel(),
                target,
                batchChars: cfg.proofreadBatchChars,
                signal: controller.signal,
                onProgress,
            })
            consumeToday(this.deps.db, AI_QUOTA)
            this.deps.usageRecorder.record({
                module: 'proofread',
                model: getSelectedCodebuddyModel(),
                usage: outcome.usage,
                meta: outcome.meta,
                prompt: outcome.prompt,
                startedAt,
                status: 'completed',
            })
            const result: ProofreadAiResult = {
                issues: outcome.issues,
                path: target.path,
                version: target.version,
                mtime: target.mtime,
                batches: outcome.batches,
                failedBatches: outcome.failedBatches,
                usageTokens: outcome.usage?.totalTokens ?? 0,
            }
            await this.attachAiToCache(target, result)
            return result
        } catch (error) {
            if (controller.signal.aborted) {
                throw new Error('AI 校对已取消', { cause: error })
            }
            throw error instanceof Error ? error : new Error('AI 校对失败', { cause: error })
        } finally {
            this.activeAiRequest = null
        }
    }

    /** 取消进行中的 AI 检查 */
    public abortAi(): ProofreadAbortResult {
        if (this.activeAiRequest === null) {
            return { aborted: false }
        }
        this.activeAiRequest.abort()
        return { aborted: true }
    }

    /** AI 特征检测可用状态：是否已配置 Key、是否已同意上传、今日剩余次数 */
    public async getDetectState(): Promise<ProofreadAiDetectState> {
        const apiKey = (await this.deps.secrets.get('zhuqueApiKey')) ?? ''
        const hasConsent = this.deps.state.get<boolean>(CONSENT_KEY, false) === true
        const limit = getZhaiConfig().proofreadZhuqueDailyLimit
        const used = readUsedToday(this.deps.db, DETECT_QUOTA)
        return {
            hasKey: apiKey.trim().length > 0,
            hasConsent,
            remaining: limit <= 0 ? null : Math.max(0, limit - used),
        }
    }

    /** 记录上传同意：只在用户明确确认后写入，撤销同样走这里 */
    public async setDetectConsent(accepted: boolean): Promise<ProofreadAiDetectState> {
        await this.deps.state.update(CONSENT_KEY, accepted)
        return this.getDetectState()
    }

    /**
     * 执行 AI 特征检测：正文会上传至腾讯云朱雀检测服务。
     * 关键约束：未配置 Key、未同意上传、当日超额都直接拒绝且不发出请求；
     * 只有检测成功才消耗额度，网络失败不占用次数。
     */
    public async runDetect(useSelection: boolean): Promise<ProofreadAiDetectResult | null> {
        const target = await this.readTarget(useSelection)
        if (target === null) {
            return null
        }
        const apiKey = ((await this.deps.secrets.get('zhuqueApiKey')) ?? '').trim()
        if (apiKey.length === 0) {
            throw new Error('尚未配置朱雀 API Key，请先点击「配置密钥」')
        }
        if (this.deps.state.get<boolean>(CONSENT_KEY, false) !== true) {
            throw new Error('请先确认将正文发送至腾讯云朱雀检测服务')
        }
        const limit = getZhaiConfig().proofreadZhuqueDailyLimit
        if (limit > 0 && readUsedToday(this.deps.db, DETECT_QUOTA) >= limit) {
            throw new Error(`今日 AI 特征检测次数已用完（${String(limit)} 次），可在设置中调整上限`)
        }
        const result = await detectAiContent({ target, apiKey })
        consumeToday(this.deps.db, DETECT_QUOTA)
        await writeDetectCache(this.deps.state, {
            savedAt: new Date().toISOString(),
            target: toCachedTarget(target),
            result,
        })
        return result
    }

    /** 读取与当前正文签名一致的校对缓存：签名不符时返回 null，由调用方重跑 */
    private async readMatchingCache(): Promise<ProofreadCache | null> {
        const cached = readProofreadCache(this.deps.state)
        if (cached === null) {
            return null
        }
        const target = await this.readTarget(cached.target.kind === 'selection')
        if (target === null || !isSameTarget(cached.target, target)) {
            return null
        }
        return cached
    }

    /** 把 AI 结果附加到同一份正文的缓存上：签名不同说明本地结果已过期，宁可不写也不落错位结果 */
    private async attachAiToCache(target: ProofreadTarget, result: ProofreadAiResult): Promise<void> {
        const cached = readProofreadCache(this.deps.state)
        if (cached === null || !isSameTarget(cached.target, target)) {
            return
        }
        await writeProofreadCache(this.deps.state, {
            ...cached,
            ai: result,
            savedAt: new Date().toISOString(),
        })
    }

    /** 批量写回：仅接受确定性替换，逐条回查原文后应用 */
    public async apply(request: ProofreadApplyRequest): Promise<ProofreadApplyResult> {
        return applyProofreadEdits(request, this.deps.beforeWrite)
    }

    /** 定位到命中区间 */
    public async reveal(request: ProofreadRevealRequest): Promise<ProofreadRevealResult> {
        return revealProofreadRange(request)
    }

    /** 词库状态：前端据此展示入口文案 */
    public async getLexiconState(): Promise<ProofreadLexiconState> {
        return readLexiconState()
    }

    /** 打开词库文件：缺失时先落骨架，再在编辑器中打开 */
    public async openLexicon(): Promise<ProofreadLexiconState> {
        const uri = await ensureLexiconFile()
        await vscode.window.showTextDocument(uri, { preview: false })
        return readLexiconState()
    }

    /** 读取词库完整内容：供「设置词库」弹窗编辑 */
    public async readLexiconContent(): Promise<ProofreadLexicon> {
        return readLexicon()
    }

    /** 保存词库内容：先按读取口径收窄再原子写盘，返回最新状态 */
    public async saveLexiconContent(lexicon: ProofreadLexicon): Promise<ProofreadLexiconState> {
        await writeLexicon(lexicon)
        return readLexiconState()
    }

    /** 校验今日 AI 校对额度：上限为 0 或负数表示不限 */
    private assertAiQuota(): void {
        const limit = getZhaiConfig().proofreadAiDailyLimit
        if (limit <= 0) {
            return
        }
        const used = readUsedToday(this.deps.db, AI_QUOTA)
        if (used >= limit) {
            throw new Error(`今日 AI 校对次数已用完（${String(limit)} 次），可在设置中调整上限`)
        }
    }
}
