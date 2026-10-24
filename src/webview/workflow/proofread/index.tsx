/**
 * 校对页：以 app-page 骨架承载「目标信息 + 四类检查卡 + 免责提示」，承接写作管理页的校对分区。
 * 复用约定：外壳取 @webview/components/AppPage，检查卡与条目由 layout/ 承担，状态编排在 hooks/；
 * 目标以当前编辑器文档为准，页面不选章节也不读文件，打开作品只影响页面的重建时机（路由层按作品 key）。
 * 关键约束：本地检查先出结果、AI 检查随后补检，AI 失败只影响病句与风险段落两张卡；
 * 没有可校对目标时展示引导空态而不是报错；AI 阶段可取消，取消后保留已出的本地结果。
 */
import { SpellCheck } from 'lucide-react'
import { Alert, AlertDescription } from '@components/ui/alert'
import { Badge } from '@components/ui/badge'
import { Label } from '@components/ui/label'
import { Spinner } from '@components/ui/spinner'
import { Switch } from '@components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@components/ui/tooltip'
import {
    AppAction,
    AppContent,
    AppDescription,
    AppFooter,
    AppHeader,
    AppPage,
    AppTitle,
} from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { StateEmpty } from '@webview/components/StateEmpty'
import {
    ABORT_LABEL,
    ABORTING_LABEL,
    AI_DISABLED_LABEL,
    AI_DISCLAIMER,
    AI_TOGGLE_LABEL,
    DISCLAIMER,
    EMPTY_DESCRIPTION,
    EMPTY_TITLE,
    PAGE_DESCRIPTION_EMPTY,
    PAGE_DESCRIPTION_READY,
    PAGE_TITLE,
    RERUN_LABEL,
    RUN_LABEL,
    SELECTION_LABEL,
} from './constants'
import { useProofreadAiDetect } from './hooks/useProofreadAiDetect'
import { useProofreadLexicon } from './hooks/useProofreadLexicon'
import { useProofreadRun } from './hooks/useProofreadRun'
import { ProofreadAiDetectCard } from './layout/ProofreadAiDetectCard'
import { ProofreadCheckList } from './layout/ProofreadCheckList'
import { ProofreadLexiconDialog } from './layout/ProofreadLexiconDialog'
import type { JSX } from 'react'

export function ProofreadPage(): JSX.Element {
    const state = useProofreadRun()
    const lexicon = useProofreadLexicon()
    const detect = useProofreadAiDetect()
    const target = state.target
    const isAiRunning = state.aiStage === 'running'

    return (
        <AppPage>
            <AppHeader>
                <AppTitle>{PAGE_TITLE}</AppTitle>
                <AppDescription>{target === null ? PAGE_DESCRIPTION_EMPTY : PAGE_DESCRIPTION_READY}</AppDescription>
                {target === null ? null : (
                    <AppAction>
                        <Badge variant="outline" className="max-w-full truncate">
                            {target.title}
                        </Badge>
                        <Badge variant="secondary">{target.wordCount.toLocaleString('zh-CN')} 字</Badge>
                        {target.kind === 'selection' ? <Badge variant="secondary">选区</Badge> : null}
                        {target.truncated ? <Badge variant="destructive">正文过长已截断</Badge> : null}
                        <span className="text-xs text-muted-foreground">{lexicon.label}</span>
                    </AppAction>
                )}
            </AppHeader>
            <AppContent isScrollable>
                <div className="flex flex-col gap-3">
                    {state.errorText === null ? null : (
                        <Alert variant="destructive">
                            <AlertDescription>{state.errorText}</AlertDescription>
                        </Alert>
                    )}
                    {target === null ? (
                        state.status === 'loading' || state.status === 'running' ? (
                            <StateEmpty title={EMPTY_TITLE} isLoading loadingLabel="正在读取校对目标…" />
                        ) : (
                            <StateEmpty
                                title={EMPTY_TITLE}
                                description={EMPTY_DESCRIPTION}
                                icon={SpellCheck}
                                iconClassName="size-12 rounded-2xl"
                            >
                                <Button variant="outline" onClick={() => void state.run('local')}>
                                    重新读取
                                </Button>
                            </StateEmpty>
                        )
                    ) : (
                        <>
                            <ProofreadCheckList
                                issues={state.visibleIssues}
                                status={state.status}
                                aiStage={state.aiStage}
                                aiProgress={state.aiProgress}
                                aiError={state.aiError}
                                isAiEnabled={state.isAiEnabled}
                                uncoveredBatches={state.failedBatches + state.skippedBatches}
                                onApply={(issue) => void state.applyOne(issue)}
                                onReveal={(issue) => void state.reveal(issue)}
                                onIgnore={state.ignore}
                                onOpenLexicon={() => void lexicon.openDialog()}
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
                    {state.aiStage === 'done' ? (
                        <AppDescription className="text-center">{AI_DISCLAIMER}</AppDescription>
                    ) : null}
                    <AppDescription className="text-center">{DISCLAIMER}</AppDescription>
                </div>
            </AppContent>
            <AppFooter
                start={
                    <>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                {/* Trigger 的 data-state 会覆盖 Switch 自身的选中态，故用 span 承接 */}
                                <span className="inline-flex">
                                    <Switch
                                        id="proofread-selection"
                                        checked={state.shouldUseSelection}
                                        onCheckedChange={state.setShouldUseSelection}
                                    />
                                </span>
                            </TooltipTrigger>
                            <TooltipContent>开启后只检查编辑器中的选中文本</TooltipContent>
                        </Tooltip>
                        <Label htmlFor="proofread-selection" className="text-muted-foreground">
                            {SELECTION_LABEL}
                        </Label>
                        <Button
                            size="xs"
                            variant={state.isAiEnabled ? 'secondary' : 'ghost'}
                            tooltip={state.isAiEnabled ? '点击关闭 AI 语义检查，只跑本地规则' : '点击开启 AI 语义检查'}
                            onClick={() => state.setIsAiEnabled(!state.isAiEnabled)}
                        >
                            {state.isAiEnabled ? AI_TOGGLE_LABEL : AI_DISABLED_LABEL}
                        </Button>
                    </>
                }
            >
                <Button
                    variant="outline"
                    disabled={state.fixableCount === 0}
                    isLoading={state.isApplying}
                    onClick={() => void state.applyFixable()}
                >
                    应用 {state.fixableCount} 处修复
                </Button>
                {isAiRunning ? (
                    <Button variant="outline" disabled={state.isAborting} onClick={() => void state.abort()}>
                        {state.isAborting ? <Spinner /> : null}
                        {state.isAborting ? ABORTING_LABEL : ABORT_LABEL}
                    </Button>
                ) : (
                    <Button
                        isLoading={state.status === 'running'}
                        tooltip={
                            state.isAiEnabled
                                ? '执行本地规则与 AI 语义检查，AI 部分会消耗每日额度'
                                : '执行本地规则检查，AI 检查已关闭'
                        }
                        onClick={() => void state.run()}
                    >
                        {state.hasResult ? RERUN_LABEL : RUN_LABEL}
                    </Button>
                )}
            </AppFooter>
            <ProofreadLexiconDialog
                key={lexicon.sessionKey}
                open={lexicon.isOpen}
                lexicon={lexicon.lexicon}
                isSaving={lexicon.isSaving}
                onOpenChange={(isOpen) => {
                    if (!isOpen) {
                        lexicon.closeDialog()
                    }
                }}
                onSave={(input) => void lexicon.save(input)}
                onOpenFile={() => void lexicon.openFile()}
            />
        </AppPage>
    )
}
