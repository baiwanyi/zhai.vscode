/**
 * 出图规则钩子：列举 {存储根}/prompt/rules 下的 md 规则，并支持读取、新建、改写、删除与打开目录。
 * 复用约定：协议走 pressAi/listPromptRules、pressAi/readPromptRule、pressAi/savePromptRule、
 * pressAi/updatePromptRule、pressAi/deletePromptRule、pressAi/openPromptRuleDir，
 * 类型取 @shared/types/imagegen；请求经 @shared/utils/bridge，失败统一 toastError。
 * 关键约束：宿主只回报标识与显示名，正文仅在编辑时按需读取——规则改文无需前端刷新；
 * 新建只允许新增、改写允许换名，重名一律由宿主拒绝，本 hook 不做预判；
 * 列表按中文名排序，与宿主列举口径一致；改写换名后必须先剔除旧标识，否则列表会残留一条指向已不存在文件的条目；
 * 本 hook 不自动加载，由调用方在菜单打开时调 reload，用户手写 md 后重新开菜单即可见。
 */
import { useCallback, useState } from 'react'
import type {
    PromptRule,
    PromptRuleDetail,
    PromptRuleListResult,
    PromptRuleSaveRequest,
    PromptRuleUpdateRequest,
} from '@shared/types/imagegen'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

/** 规则读写兜底超时：单个 md 文件的读写，正常远低于默认值 */
const RULE_TIMEOUT_MS = 30_000

interface UsePromptRulesResult {
    rules: readonly PromptRule[]
    /** 规则目录绝对路径：空态据此提示用户把 md 放到哪里 */
    dirPath: string
    isLoading: boolean
    /** 写操作进行中：新建、改写与删除共用，弹窗据此禁用提交 */
    isSaving: boolean
    reload: () => Promise<void>
    /** 读取正文：编辑弹窗回填用，失败返回 null（错误已提示） */
    read: (name: string) => Promise<PromptRuleDetail | null>
    /** 新建规则：成功返回新条目，失败返回 null（错误已提示） */
    save: (input: PromptRuleSaveRequest) => Promise<PromptRule | null>
    /** 改写规则：成功后用新条目替换列表，失败返回 null（错误已提示） */
    update: (input: PromptRuleUpdateRequest) => Promise<PromptRule | null>
    /** 删除规则：成功后以最新列表覆盖，失败返回 false（错误已提示） */
    remove: (name: string) => Promise<boolean>
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

    const read = useCallback(async (name: string): Promise<PromptRuleDetail | null> => {
        try {
            return await request<PromptRuleDetail>('pressAi/readPromptRule', { name }, RULE_TIMEOUT_MS)
        } catch (cause) {
            toastError(cause)
            return null
        }
    }, [])

    const save = useCallback(async (input: PromptRuleSaveRequest): Promise<PromptRule | null> => {
        setIsSaving(true)
        try {
            const rule = await request<PromptRule>('pressAi/savePromptRule', input, RULE_TIMEOUT_MS)
            setRules((current) => sortRules([...current.filter((item) => item.id !== rule.id), rule]))
            return rule
        } catch (cause) {
            toastError(cause)
            return null
        } finally {
            setIsSaving(false)
        }
    }, [])

    const update = useCallback(async (input: PromptRuleUpdateRequest): Promise<PromptRule | null> => {
        setIsSaving(true)
        try {
            const rule = await request<PromptRule>('pressAi/updatePromptRule', input, RULE_TIMEOUT_MS)
            setRules((current) =>
                sortRules([...current.filter((item) => item.id !== input.previousName && item.id !== rule.id), rule]),
            )
            return rule
        } catch (cause) {
            toastError(cause)
            return null
        } finally {
            setIsSaving(false)
        }
    }, [])

    const remove = useCallback(
        async (name: string): Promise<boolean> => {
            setIsSaving(true)
            try {
                applyResult(await request<PromptRuleListResult>('pressAi/deletePromptRule', { name }, RULE_TIMEOUT_MS))
                return true
            } catch (cause) {
                toastError(cause)
                return false
            } finally {
                setIsSaving(false)
            }
        },
        [applyResult],
    )

    const openDir = useCallback(async (): Promise<void> => {
        try {
            applyResult(await request<PromptRuleListResult>('pressAi/openPromptRuleDir'))
        } catch (cause) {
            toastError(cause)
        }
    }, [applyResult])

    return { rules, dirPath, isLoading, isSaving, reload, read, save, update, remove, openDir }
}
