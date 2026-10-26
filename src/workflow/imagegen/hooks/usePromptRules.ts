/**
 * 出图规则钩子：列举 {存储根}/prompt/rules 下的 md 规则，并支持新建与打开目录。
 * 复用约定：协议走 pressAi/listPromptRules、pressAi/savePromptRule、pressAi/openPromptRuleDir，
 * 类型取 @shared/types/imagegen；请求经 @shared/utils/bridge，失败统一 toastError。
 * 关键约束：宿主只回报标识与显示名，正文不进前端——规则改文无需前端刷新；
 * 新建只允许新增，重名由宿主拒绝，本 hook 不做预判；列表按中文名排序，与宿主列举口径一致；
 * 本 hook 不自动加载，由调用方在菜单打开时调 reload，用户手写 md 后重新开菜单即可见。
 */
import { useCallback, useState } from 'react'
import type { PromptRule, PromptRuleListResult, PromptRuleSaveRequest } from '@shared/types/imagegen'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

/** 保存规则的兜底超时：写入单个 md 文件，正常远低于默认值 */
const SAVE_TIMEOUT_MS = 30_000

interface UsePromptRulesResult {
    rules: readonly PromptRule[]
    /** 规则目录绝对路径：空态据此提示用户把 md 放到哪里 */
    dirPath: string
    isLoading: boolean
    isSaving: boolean
    reload: () => Promise<void>
    /** 新建规则：成功返回新条目，失败返回 null（错误已提示） */
    save: (input: PromptRuleSaveRequest) => Promise<PromptRule | null>
    /** 打开规则目录并同步最新列表 */
    openDir: () => Promise<void>
}

/** 按中文名排序：与宿主列举口径一致，新增条目插进去也不会打乱顺序 */
function sortRules(list: readonly PromptRule[]): PromptRule[] {
    return [...list].sort((left, right) => left.name.localeCompare(right.name, 'zh'))
}

export function usePromptRules(): UsePromptRulesResult {
    const [rules, setRules] = useState<PromptRule[]>([])
    const [dirPath, setDirPath] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [isSaving, setIsSaving] = useState(false)

    const applyResult = useCallback((result: PromptRuleListResult): void => {
        setRules(sortRules(result.rules))
        setDirPath(result.dirPath)
    }, [])

    const reload = useCallback(async (): Promise<void> => {
        setIsLoading(true)
        try {
            applyResult(await request<PromptRuleListResult>('pressAi/listPromptRules'))
        } catch (cause) {
            toastError(cause)
        } finally {
            setIsLoading(false)
        }
    }, [applyResult])

    const save = useCallback(async (input: PromptRuleSaveRequest): Promise<PromptRule | null> => {
        setIsSaving(true)
        try {
            const rule = await request<PromptRule>('pressAi/savePromptRule', input, SAVE_TIMEOUT_MS)
            setRules((current) => sortRules([...current.filter((item) => item.id !== rule.id), rule]))
            return rule
        } catch (cause) {
            toastError(cause)
            return null
        } finally {
            setIsSaving(false)
        }
    }, [])

    const openDir = useCallback(async (): Promise<void> => {
        try {
            applyResult(await request<PromptRuleListResult>('pressAi/openPromptRuleDir'))
        } catch (cause) {
            toastError(cause)
        }
    }, [applyResult])

    return { rules, dirPath, isLoading, isSaving, reload, save, openDir }
}
