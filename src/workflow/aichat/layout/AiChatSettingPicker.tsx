/**
 * 设定多选面板：按「基本信息 / 世界观 / 金手指 / 势力 / 地点 / 物品」分组勾选字段与条目。
 * 复用约定：分组文案、文件名与分级依据取自 press 的 SETTING_SECTIONS 与 isLoreSection，
 * 分节行区间由宿主 ai/context/sections 提供，添加走 ai/context/add 批量提交。
 * 关键约束：字段型分组按三级标题取字段，条目型分组按二级标题取条目；整篇与单项互斥，
 * 整篇已选时该组单项全部禁用，避免同一文档既整篇又切片；底部实时汇总项数与字数。
 */
import { useEffect, useMemo, useState } from 'react'
import { Checkbox } from '@components/ui/checkbox'
import type { AiContextAddResult, AiDocSection, AiDocSectionsResult } from '@shared/types/aiChat'
import type { PressDocKey } from '@shared/types/press'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'
import { Button } from '@webview/components/Button'
import { isLoreSection, SETTING_SECTIONS, SETTING_SECTION_ORDER } from '@webview/workflow/press/setting/sections'
import type { SettingSectionKey } from '@webview/workflow/press/setting/sections'
import { AiChatSearchField } from './AiChatSearchField'
import type { JSX } from 'react'

interface AiChatSettingPickerProps {
    /** 作品目录：press/{作品名} */
    dirPath: string
    onClose: () => void
    onAdded: () => void
    onError: (error: string) => void
}

/** 分组加载结果：sections 已按该分组的选取粒度过滤 */
interface SettingGroup {
    key: SettingSectionKey
    sections: readonly AiDocSection[]
}

/** 单项选择键：文档键 + 起始行，同一文档内行号唯一 */
function buildItemKey(doc: PressDocKey, startLine: number): string {
    return `${doc}|${String(startLine)}`
}

export function AiChatSettingPicker({ dirPath, onClose, onAdded, onError }: AiChatSettingPickerProps): JSX.Element {
    const [groups, setGroups] = useState<readonly SettingGroup[]>([])
    const [selectedKeys, setSelectedKeys] = useState((): ReadonlySet<string> => new Set())
    const [wholeDocs, setWholeDocs] = useState((): ReadonlySet<PressDocKey> => new Set())
    const [keyword, setKeyword] = useState('')
    const [isLoading, setIsLoading] = useState(true)
    const [isSaving, setIsSaving] = useState(false)

    useEffect((): (() => void) => {
        let isActive = true
        const requests = SETTING_SECTION_ORDER.map((key) => {
            const doc = SETTING_SECTIONS[key].docKey
            const level = isLoreSection(key) ? 2 : 3
            return request<AiDocSectionsResult>('ai/context/sections', { dirPath, doc }).then((result) => ({
                key,
                sections: result.sections.filter((section) => section.level === level),
            }))
        })
        void Promise.all(requests)
            .then((loaded) => {
                if (isActive) {
                    setGroups(loaded)
                }
            })
            .catch((cause: unknown) => {
                if (isActive) {
                    setGroups([])
                    onError(toErrorText(cause))
                }
            })
            .finally(() => {
                if (isActive) {
                    setIsLoading(false)
                }
            })
        return (): void => {
            isActive = false
        }
    }, [dirPath, onError])

    /** 关键词过滤：分组标题与条目名都参与匹配，命中分组才展示 */
    const visibleGroups = useMemo((): readonly SettingGroup[] => {
        const normalized = keyword.trim().toLowerCase()
        if (normalized.length === 0) {
            return groups
        }
        return groups
            .map((group) => ({
                key: group.key,
                sections: group.sections.filter((section) => section.title.toLowerCase().includes(normalized)),
            }))
            .filter((group) => group.sections.length > 0)
    }, [groups, keyword])

    const selectedCount = selectedKeys.size
    const selectedChars = useMemo((): number => {
        let total = 0
        for (const group of groups) {
            const doc = SETTING_SECTIONS[group.key].docKey
            for (const section of group.sections) {
                if (selectedKeys.has(buildItemKey(doc, section.startLine))) {
                    total += section.charCount
                }
            }
        }
        return total
    }, [groups, selectedKeys])

    const toggleItem = (doc: PressDocKey, section: AiDocSection, isChecked: boolean): void => {
        const key = buildItemKey(doc, section.startLine)
        setSelectedKeys((current) => {
            const next = new Set(current)
            if (isChecked) {
                next.add(key)
            } else {
                next.delete(key)
            }
            return next
        })
    }

    const toggleWhole = (doc: PressDocKey, isChecked: boolean): void => {
        setWholeDocs((current) => {
            const next = new Set(current)
            if (isChecked) {
                next.add(doc)
                return next
            }
            next.delete(doc)
            return next
        })
    }

    const submit = async (): Promise<void> => {
        const items: { path: string; startLine?: number; endLine?: number }[] = []
        for (const key of SETTING_SECTION_ORDER) {
            const meta = SETTING_SECTIONS[key]
            if (wholeDocs.has(meta.docKey)) {
                items.push({ path: `${dirPath}/${meta.fileName}` })
                continue
            }
            const group = groups.find((item) => item.key === key)
            for (const section of group?.sections ?? []) {
                if (selectedKeys.has(buildItemKey(meta.docKey, section.startLine))) {
                    items.push({
                        path: `${dirPath}/${meta.fileName}`,
                        startLine: section.startLine,
                        endLine: section.endLine,
                    })
                }
            }
        }
        if (items.length === 0) {
            return
        }
        setIsSaving(true)
        try {
            const result = await request<AiContextAddResult>('ai/context/add', { items })
            if (result.added === 0) {
                onError(
                    result.failed[0]?.reason ??
                        (result.isFull ? '上下文已达上限，请先移除部分引用' : '这些条目已在上下文中'),
                )
                return
            }
            onAdded()
            onClose()
        } catch (cause) {
            onError(toErrorText(cause))
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <div className="flex max-h-96 flex-col">
            <div className="px-1 pb-1">
                <AiChatSearchField isSearching={false} onSubmit={setKeyword} placeholder="搜索设定字段或条目" />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {visibleGroups.length === 0 ? (
                    <div className="px-2 py-3 text-xs text-muted-foreground">
                        {isLoading ? '读取中…' : '没有可选的设定项'}
                    </div>
                ) : (
                    visibleGroups.map((group) => {
                        const meta = SETTING_SECTIONS[group.key]
                        const isWhole = wholeDocs.has(meta.docKey)
                        return (
                            <div key={group.key} className="border-b border-border/60 pb-1 last:border-b-0">
                                <div className="flex items-center gap-2 px-2 pt-1.5">
                                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{meta.label}</span>
                                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                                        <Checkbox
                                            checked={isWhole}
                                            onCheckedChange={(next) => toggleWhole(meta.docKey, next === true)}
                                        />
                                        整篇
                                    </label>
                                </div>
                                {isWhole ? (
                                    <div className="px-2 py-1 text-xs text-muted-foreground">已按整篇引用</div>
                                ) : (
                                    group.sections.map((section) => (
                                        <label
                                            key={buildItemKey(meta.docKey, section.startLine)}
                                            className="flex items-center gap-2 px-2 py-1 text-sm"
                                        >
                                            <Checkbox
                                                checked={selectedKeys.has(buildItemKey(meta.docKey, section.startLine))}
                                                onCheckedChange={(next) =>
                                                    toggleItem(meta.docKey, section, next === true)
                                                }
                                            />
                                            <span className="min-w-0 flex-1 truncate">{section.title}</span>
                                            <span className="shrink-0 text-xs text-muted-foreground">
                                                {section.charCount} 字
                                            </span>
                                        </label>
                                    ))
                                )}
                            </div>
                        )
                    })
                )}
            </div>
            <div className="flex items-center gap-2 border-t border-border px-2 py-2">
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    已选 {selectedCount + wholeDocs.size} 项
                    {selectedChars > 0 ? ` · 约 ${(selectedChars / 1000).toFixed(1)}k 字` : ''}
                </span>
                <Button
                    size="sm"
                    variant="secondary"
                    disabled={isSaving || (selectedCount === 0 && wholeDocs.size === 0)}
                    onClick={() => void submit()}
                >
                    {isSaving ? '添加中…' : '添加'}
                </Button>
            </div>
        </div>
    )
}
