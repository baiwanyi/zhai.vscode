/**
 * 规则菜单编排：把「列举、读文、增删改」与表单 / 删除确认的开关收在一处，
 * 供 ImageCommandMenus 在子菜单与弹窗两处共用同一份状态。
 * 复用约定：数据与协议走 ./usePromptRules，类型取 @shared/types/imagegen；
 * 表单与确认框只由调用方渲染，本 hook 不产出 JSX。
 * 关键约束：编辑与删除前必须调 onCloseMenu 收起外层菜单，否则两层浮层会叠在一起，
 * 且弹窗随菜单卸载会一起消失；新建成功后直接挂芯片，编辑只在改名时同步芯片；
 * 关闭回调用途只是清空待处理项，落盘与列表刷新由 usePromptRules 负责，不在此重复。
 */
import { useState } from 'react'
import type { PromptRule, PromptRuleDetail } from '@shared/types/imagegen'
import { usePromptRules } from './usePromptRules'

/** 规则表单状态：null 表示关闭，original 为 null 表示新建 */
export interface RuleFormState {
    original: PromptRuleDetail | null
}

interface UseRuleMenuOptions {
    /** 点选规则：由输入卡片切换对应芯片 */
    onToggleRule: (rule: PromptRule) => void
    /** 规则改名：由输入卡片把已挂芯片换到新标识上 */
    onRenameRule: (previousId: string, rule: PromptRule) => void
    /** 规则被删除：由输入卡片摘掉对应芯片 */
    onRemoveRule: (ruleId: string) => void
    /** 收起外层菜单：编辑与删除都要先关菜单再弹窗 */
    onCloseMenu: () => void
}

interface UseRuleMenuResult {
    rules: readonly PromptRule[]
    /** 规则目录绝对路径：新建表单据此说明 md 落在哪里 */
    dirPath: string
    isLoading: boolean
    /** 写操作进行中：新建、改写与删除共用，弹窗据此禁用提交 */
    isSaving: boolean
    formState: RuleFormState | null
    pendingDelete: PromptRule | null
    /** 打开菜单时重读目录：用户中途往目录里补 md，再开一次即可见 */
    reload: () => Promise<void>
    /** 提交表单：新建后直接挂芯片，改名时同步芯片 */
    submit: (name: string, content: string) => void
    /** 进入编辑：先收菜单再读正文，读到才弹窗，避免空表单覆盖原文 */
    edit: (rule: PromptRule) => void
    /** 打开新建表单 */
    create: () => void
    /** 请求删除：先收菜单再弹确认框 */
    requestDelete: (rule: PromptRule) => void
    /** 表单关闭：清空编辑目标 */
    closeForm: () => void
    /** 删除确认关闭：清空待删项 */
    closeDelete: () => void
    /** 确认删除：落盘后摘掉芯片 */
    confirmDelete: () => void
    /** 打开规则目录并同步最新列表 */
    openDir: () => void
}

export function useRuleMenu({
    onToggleRule,
    onRenameRule,
    onRemoveRule,
    onCloseMenu,
}: UseRuleMenuOptions): UseRuleMenuResult {
    const {
        rules,
        dirPath,
        isLoading,
        isSaving,
        reload,
        read,
        save,
        update,
        remove,
        openDir: openRuleDir,
    } = usePromptRules()
    const [formState, setFormState] = useState<RuleFormState | null>(null)
    const [pendingDelete, setPendingDelete] = useState<PromptRule | null>(null)

    const runSubmit = async (name: string, content: string): Promise<void> => {
        const original = formState?.original ?? null
        if (original === null) {
            const created = await save({ name, content })
            if (created === null) {
                return
            }
            setFormState(null)
            onToggleRule(created)
            return
        }
        const updated = await update({ previousName: original.name, name, content })
        if (updated === null) {
            return
        }
        setFormState(null)
        if (updated.id !== original.name) {
            onRenameRule(original.name, updated)
        }
    }

    const runEdit = async (rule: PromptRule): Promise<void> => {
        const detail = await read(rule.name)
        if (detail !== null) {
            setFormState({ original: detail })
        }
    }

    const runDelete = async (): Promise<void> => {
        if (pendingDelete === null) {
            return
        }
        const isRemoved = await remove(pendingDelete.name)
        if (isRemoved) {
            onRemoveRule(pendingDelete.name)
        }
        setPendingDelete(null)
    }

    const submit = (name: string, content: string): void => {
        void runSubmit(name, content)
    }

    const edit = (rule: PromptRule): void => {
        onCloseMenu()
        void runEdit(rule)
    }

    const create = (): void => {
        setFormState({ original: null })
    }

    const requestDelete = (rule: PromptRule): void => {
        onCloseMenu()
        setPendingDelete(rule)
    }

    const closeForm = (): void => {
        setFormState(null)
    }

    const closeDelete = (): void => {
        setPendingDelete(null)
    }

    const confirmDelete = (): void => {
        void runDelete()
    }

    const openDir = (): void => {
        void openRuleDir()
    }

    return {
        rules,
        dirPath,
        isLoading,
        isSaving,
        formState,
        pendingDelete,
        reload,
        submit,
        edit,
        create,
        requestDelete,
        closeForm,
        closeDelete,
        confirmDelete,
        openDir,
    }
}
