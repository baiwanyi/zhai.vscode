/**
 * 校对页：以 app-page 骨架承载「目标信息 + 四类检查卡 + 免责提示」，承接写作管理页的校对分区。
 * 复用约定：外壳取 @webview/components/AppPage，页头说明走 AppDescription、目标徽标行由 AppSummary 渲染，
 * 检查卡与条目由 layout/ 承担，状态编排在 hooks/；本文件只把目标折算成徽标数据，无目标空态
 * 收敛为同文件私有组件，其余只做状态编排与插槽装配。
 * 关键约束：始终检查整篇正文；本地检查先出结果、AI 检查随后补检，AI 失败只影响病句与风险段落两张卡；
 * 没有可校对目标时展示引导空态而不是报错；检查进行中只给加载态、不提供取消入口。
 */
import { SpellCheck } from 'lucide-react'
import { Alert, AlertDescription } from '@components/ui/alert'
import type { ProofreadTarget } from '@shared/types/proofread'
import { AppAction, AppContent, AppDescription, AppHeader, AppPage, AppTitle } from '@webview/components/AppPage'
import { AppSummary, type AppSummaryProps } from '@webview/components/AppSummary'
import { Button } from '@webview/components/Button'
import { StateEmpty } from '@webview/components/StateEmpty'
import { useProofreadAiDetect } from './hooks/useProofreadAiDetect'
import { useProofreadLexicon } from './hooks/useProofreadLexicon'
import { useProofreadRun } from './hooks/useProofreadRun'
import { ProofreadAiDetectCard } from './layout/ProofreadAiDetectCard'
import { ProofreadCheckList } from './layout/ProofreadCheckList'
import { ProofreadLexiconDialog } from './layout/ProofreadLexiconDialog'
import type { JSX } from 'react'

/** 标题区说明：无目标时给引导，有目标时给能力边界 */
const DESCRIPTION_EMPTY = '在编辑器中打开要校对的章节，回到本页即可开始'
const DESCRIPTION_READY = '检查错别字、标点与自定义词库命中，可逐条定位并一键写回'

/** 开始校对按钮的提示：本地规则与 AI 语义检查一起执行 */
const RUN_TOOLTIP = '执行本地规则与 AI 语义检查，AI 部分会消耗每日额度'

/** 免责提示：AI 结论必须逐条人工确认，底部另常驻一条通用说明 */
const AI_DISCLAIMER = 'AI 结果由模型判断，请逐条人工确认后再修改'
const DISCLAIMER = '智能识别，可能出现误差，仅供参考'

/** 目标信息：标题与字数常驻，选区 / 截断两种口径按需追加，词库摘要跟在行尾 */
function summarizeTarget(target: ProofreadTarget, lexiconLabel: string): AppSummaryProps {
    const wordCountLabel = `共 ${target.wordCount.toLocaleString('zh-CN')} 字`

    return {
        title: target.title,
        path: target.path,
        meta: target.kind === 'selection' ? `${wordCountLabel} · 选区` : wordCountLabel,
        alerts: target.truncated ? '正文过长已截断' : undefined,
        note: lexiconLabel,
    }
}

interface TargetMissingProps {
    /** 读取或重跑期间没有目标：只给加载态，避免「未打开文档」与「正在读取」同时出现 */
    isReading: boolean
    onReload: () => void
}

/** 无目标空态：读完仍为空才给引导与重新读取入口 */
function TargetMissing({ isReading, onReload }: TargetMissingProps): JSX.Element {
    if (isReading) {
        return <StateEmpty title="尚未读取到校对目标" isLoading loadingLabel="正在读取校对目标…" />
    }
    return (
        <StateEmpty
            title="尚未读取到校对目标"
            description="校对以当前编辑器中的文档为准，请先打开章节或笔记文档"
            icon={SpellCheck}
            iconClassName="size-12 rounded-2xl"
        >
            <Button variant="outline" onClick={onReload}>
                重新读取
            </Button>
        </StateEmpty>
    )
}

export function ProofreadPage(): JSX.Element {
    const state = useProofreadRun()
    const lexicon = useProofreadLexicon()
    const detect = useProofreadAiDetect()
    const { target } = state
    /** 页头目标信息：无目标时为 null，徽标行整行不渲染 */
    const targetSummary = target === null ? null : summarizeTarget(target, lexicon.label)
    /** 没有目标时的加载口径：首次读取与重跑都只给加载态 */
    const isReadingTarget = state.status === 'loading' || state.status === 'running'
    /** AI 未覆盖的批次数：失败与超时跳过都不能算作「未发现问题」 */
    const uncoveredBatches = state.failedBatches + state.skippedBatches

    const handleReload = (): void => {
        void state.run('local')
    }

    const handleRun = (): void => {
        void state.run()
    }

    const handleApplyFixable = (): void => {
        void state.applyFixable()
    }

    const handleOpenLexicon = (): void => {
        void lexicon.openDialog()
    }

    /** 弹窗只由「设置词库」入口打开：这里仅处理关闭，避免关闭动画期间状态来回切换 */
    const handleLexiconOpenChange = (isOpen: boolean): void => {
        if (!isOpen) {
            lexicon.closeDialog()
        }
    }

    return (
        <AppPage>
            <AppHeader>
                <AppTitle>校对</AppTitle>
                <AppAction>
                    <Button
                        variant="outline"
                        disabled={state.fixableCount === 0}
                        isLoading={state.isApplying}
                        onClick={handleApplyFixable}
                    >
                        应用 {state.fixableCount} 处修复
                    </Button>
                    <Button isLoading={state.isRunning} tooltip={RUN_TOOLTIP} onClick={handleRun}>
                        {state.hasResult ? '重新校对' : '开始校对'}
                    </Button>
                </AppAction>
                <AppDescription>{target === null ? DESCRIPTION_EMPTY : DESCRIPTION_READY}</AppDescription>
                <AppSummary
                    title={targetSummary?.title}
                    path={targetSummary?.path}
                    meta={targetSummary?.meta}
                    alerts={targetSummary?.alerts}
                    note={targetSummary?.note}
                />
            </AppHeader>
            <AppContent isScrollable>
                <div className="flex flex-col gap-3 pt-1">
                    {state.errorText !== null && (
                        <Alert variant="destructive">
                            <AlertDescription>{state.errorText}</AlertDescription>
                        </Alert>
                    )}
                    {target === null ? (
                        <TargetMissing isReading={isReadingTarget} onReload={handleReload} />
                    ) : (
                        <>
                            <ProofreadCheckList
                                issues={state.visibleIssues}
                                status={state.status}
                                aiStage={state.aiStage}
                                aiProgress={state.aiProgress}
                                aiError={state.aiError}
                                uncoveredBatches={uncoveredBatches}
                                onApply={(issue) => void state.applyOne(issue)}
                                onReveal={(issue) => void state.reveal(issue)}
                                onIgnore={state.ignore}
                                onOpenLexicon={handleOpenLexicon}
                            />
                            <ProofreadAiDetectCard
                                stage={detect.stage}
                                state={detect.state}
                                result={detect.result}
                                error={detect.error}
                                isConsentOpen={detect.isConsentOpen}
                                onDetect={() => void detect.detect()}
                                onConfigureKey={() => void detect.configureKey()}
                                onCloseConsent={detect.closeConsent}
                                onAcceptConsent={() => void detect.acceptConsent()}
                                onRevealSegment={(segment) => void state.revealRange(segment.start, segment.end)}
                            />
                        </>
                    )}
                    {state.aiStage === 'done' && (
                        <AppDescription className="text-center">{AI_DISCLAIMER}</AppDescription>
                    )}
                    <AppDescription className="text-center">{DISCLAIMER}</AppDescription>
                </div>
            </AppContent>

            <ProofreadLexiconDialog
                key={lexicon.sessionKey}
                open={lexicon.isOpen}
                lexicon={lexicon.lexicon}
                isSaving={lexicon.isSaving}
                onOpenChange={handleLexiconOpenChange}
                onSave={(input) => void lexicon.save(input)}
                onOpenFile={() => void lexicon.openFile()}
            />
        </AppPage>
    )
}
