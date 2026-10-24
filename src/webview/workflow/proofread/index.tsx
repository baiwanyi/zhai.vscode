/**
 * 校对页：以 app-page 骨架承载「目标信息 + 四类检查卡 + 免责提示」，承接写作管理页的校对分区。
 * 复用约定：外壳取 @webview/components/AppPage，检查卡与条目由 layout/ 承担，状态编排在 hooks/；
 * 目标以当前编辑器文档为准，页面不选章节也不读文件，打开作品只影响页面的重建时机（路由层按作品 key）。
 * 关键约束：始终检查整篇正文；本地检查先出结果、AI 检查随后补检，AI 失败只影响病句与风险段落两张卡；
 * 没有可校对目标时展示引导空态而不是报错；检查进行中只给加载态、不提供取消入口。
 */
import { SpellCheck } from 'lucide-react'
import { Alert, AlertDescription } from '@components/ui/alert'
import { Badge } from '@components/ui/badge'
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
import { Switch } from '@webview/components/Switch'
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

    return (
        <AppPage>
            <AppHeader>
                <AppTitle>校对</AppTitle>
                <AppDescription>
                    {target === null
                        ? '在编辑器中打开要校对的章节，回到本页即可开始'
                        : '检查错别字、标点与自定义词库命中，可逐条定位并一键写回'}
                </AppDescription>
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
                            <StateEmpty title="尚未读取到校对目标" isLoading loadingLabel="正在读取校对目标…" />
                        ) : (
                            <StateEmpty
                                title="尚未读取到校对目标"
                                description="校对以当前编辑器中的文档为准，请先打开章节或笔记文档"
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
                        <AppDescription className="text-center">
                            AI 结果由模型判断，请逐条人工确认后再修改
                        </AppDescription>
                    ) : null}
                    <AppDescription className="text-center">智能识别，可能出现误差，仅供参考</AppDescription>
                </div>
            </AppContent>
            <AppFooter className="justify-between">
                <Switch
                    id="proofread-ai"
                    label="AI 检查"
                    checked={state.isAiEnabled}
                    tooltip="关闭后只跑本地规则，不再调用 AI"
                    onCheckedChange={state.setIsAiEnabled}
                />
                <div className="flex items-center gap-1.5">
                    <Button
                        variant="outline"
                        disabled={state.fixableCount === 0}
                        isLoading={state.isApplying}
                        onClick={() => void state.applyFixable()}
                    >
                        应用 {state.fixableCount} 处修复
                    </Button>
                    <Button
                        isLoading={state.isRunning}
                        tooltip={
                            state.isAiEnabled
                                ? '执行本地规则与 AI 语义检查，AI 部分会消耗每日额度'
                                : '执行本地规则检查，AI 检查已关闭'
                        }
                        onClick={() => void state.run()}
                    >
                        {state.hasResult ? '重新校对' : '开始校对'}
                    </Button>
                </div>
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
