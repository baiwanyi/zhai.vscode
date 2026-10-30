/**
 * 流内问卷卡片：把模型的多题提问渲染为消息流内的多步表单，答案经审批通道回传。
 * 复用 @components/ui/questionnaire 的问卷骨架（进度 / 题目 / 选项 / 导航），不自建单选与多选控件；
 * 多选合并规则与宿主约定一致（见 utils 的 ANSWER_SEPARATOR）。
 * 关键约束：问题原文同时是表单字段名与回传答案的键，不得改写、不得去重；
 * 提交前必须 preventDefault —— 问卷根是 form，webview 中的默认行为会触发导航；
 * 过期后只回传拒绝（宿主已按超时结算），不得再把答案送出去假装生效；
 * 只处理提问：写入类的是/否确认由 AiChatConfirmCard 承担，两者不合并到一个组件里。
 */
import {
    Questionnaire,
    QuestionnaireActions,
    QuestionnaireChoice,
    QuestionnaireChoiceDescription,
    QuestionnaireChoices,
    QuestionnaireDescription,
    QuestionnaireError,
    QuestionnaireItem,
    QuestionnaireNext,
    QuestionnairePrevious,
    QuestionnaireProgress,
    QuestionnaireSkip,
    QuestionnaireSubmit,
    QuestionnaireTitle,
} from '@components/ui/questionnaire'
import type { AiAskQuestion, AiPermissionDecision } from '@shared/types/aiChat'
import type { JSX, SubmitEvent } from 'react'
import { ANSWER_SEPARATOR } from '../utils'

interface AiChatQuestionnaireProps {
    /** 待回答的问题：至少一条 */
    questions: AiAskQuestion[]
    /** 提交截止时间（毫秒时间戳）：缺省表示宿主未给出期限 */
    expiresAt?: number
    /** 提交决定：允许时携带 answers，放弃时只传 allowed=false */
    onSubmit: (decision: AiPermissionDecision) => void
}

/** 截止时间快照：只在挂载时算一次，避免渲染期反复读时钟 */
interface QuestionnaireDeadline {
    isExpired: boolean
    /** 剩余时间提示：无期限时为空串 */
    hint: string
}

/** 计算截止提示：未给期限按不限时处理，由前端编造倒计时会与真实超时不一致 */
function readDeadline(expiresAt: number | undefined): QuestionnaireDeadline {
    if (typeof expiresAt !== 'number' || expiresAt <= 0) {
        return { isExpired: false, hint: '' }
    }
    const remaining = expiresAt - Date.now()
    if (remaining <= 0) {
        return { isExpired: true, hint: '已超时，请重新让模型提问' }
    }
    const minutes = Math.max(Math.ceil(remaining / 60_000), 1)
    return { isExpired: false, hint: `约 ${String(minutes)} 分钟内完成` }
}

/** 表单取值：文件项与空串一律丢弃，答案只保留有效文本 */
function readValues(formData: FormData, name: string): string[] {
    return formData.getAll(name).filter((item): item is string => typeof item === 'string' && item.length > 0)
}

export function AiChatQuestionnaire({ questions, expiresAt, onSubmit }: AiChatQuestionnaireProps): JSX.Element {
    const { isExpired, hint } = readDeadline(expiresAt)
    // items 只用于进度计算与选项值来源：题目标题与说明必须走 children，本地版本的定义里没有 prompt 字段
    const items = questions.map((question) => ({
        name: question.question,
        required: true,
        choices: question.options.map((option) => ({ value: option.label })),
    }))

    const handleSubmit = (event: SubmitEvent<HTMLFormElement>): void => {
        event.preventDefault()
        if (isExpired) {
            onSubmit({ allowed: false })
            return
        }
        const formData = new FormData(event.currentTarget)
        const answers: Record<string, string> = {}
        for (const question of questions) {
            const picked = readValues(formData, question.question)
            if (picked.length > 0) {
                answers[question.question] = picked.join(ANSWER_SEPARATOR)
            }
        }
        // 一题未答就提交等同放弃：宿主侧会按拒绝结算，不能让模型收到空答案
        onSubmit(Object.keys(answers).length > 0 ? { allowed: true, answers } : { allowed: false })
    }

    return (
        <div className="my-2 flex flex-col gap-2 rounded-xl border bg-muted/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>需要你补充信息</span>
                {hint.length > 0 ? <span>{hint}</span> : null}
            </div>
            <Questionnaire items={items} shortcuts={items.length > 1 ? 'numbers' : undefined} onSubmit={handleSubmit}>
                <QuestionnaireProgress />
                {questions.map((question) => (
                    <QuestionnaireItem
                        key={question.question}
                        name={question.question}
                        required
                        multiple={question.multiSelect}
                    >
                        <QuestionnaireTitle>{question.question}</QuestionnaireTitle>
                        {question.header.length > 0 ? (
                            <QuestionnaireDescription>{question.header}</QuestionnaireDescription>
                        ) : null}
                        <QuestionnaireChoices>
                            {question.options.map((option) => (
                                <QuestionnaireChoice key={option.label} value={option.label}>
                                    <span className="font-medium">{option.label}</span>
                                    {option.description.length > 0 ? (
                                        <QuestionnaireChoiceDescription>
                                            {option.description}
                                        </QuestionnaireChoiceDescription>
                                    ) : null}
                                </QuestionnaireChoice>
                            ))}
                        </QuestionnaireChoices>
                        <QuestionnaireError />
                    </QuestionnaireItem>
                ))}
                <QuestionnaireActions>
                    <QuestionnairePrevious />
                    <QuestionnaireSkip />
                    <QuestionnaireNext />
                    <QuestionnaireSubmit>{isExpired ? '已超时' : undefined}</QuestionnaireSubmit>
                </QuestionnaireActions>
            </Questionnaire>
        </div>
    )
}
