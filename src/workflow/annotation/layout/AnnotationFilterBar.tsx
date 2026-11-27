/**
 * 标注筛选栏：类型页签、关键词搜索与划线颜色三组条件，只上报选择、不持有查询状态。
 * 复用约定：页签取 @webview/components/SegmentedRail、搜索取 @components/ui/input、
 * 颜色按钮取 @webview/components/Button，色板取 ../colors，页签定义取 ../kindTab。
 * 关键约束：「查询」视图整条筛选行收起——查询记录不吃标注侧条件，留着只会误导；
 * 颜色只有划线才有，非划线页签不渲染颜色组，避免留下看不见的筛选；
 * 选项表与色板都是模块级常量，不在组件体内新建。
 */
'use client'

import { Input } from '@components/ui/input'
import type { HighlightColor } from '@shared/types/editor'
import { AppMenu } from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { SegmentedRail } from '@webview/components/SegmentedRail'
import type { KindTab } from '../kindTab'
import type { JSX } from 'react'
import { ANNOTATION_COLORS } from '../colors'
import { KIND_TAB_OPTIONS } from '../kindTab'

export interface AnnotationFilterBarProps {
    activeKind: KindTab
    /** 查询视图：整条筛选行收起，不与标注侧条件混用 */
    isQueryView: boolean
    /** 划线页签：只有划线才有颜色 */
    isHighlightTab: boolean
    color: HighlightColor | null
    keyword: string
    onChangeKind: (next: KindTab) => void
    onChangeKeyword: (next: string) => void
    onChangeColor: (next: HighlightColor | null) => void
}

interface ColorFilterProps {
    color: HighlightColor | null
    /** 是否渲染：非划线页签整组不出现 */
    isVisible: boolean
    onChange: (next: HighlightColor | null) => void
}

/** 颜色筛选：选中即「只看该色」，再点一次取消 */
function ColorFilter({ color, isVisible, onChange }: ColorFilterProps): JSX.Element | null {
    if (!isVisible) {
        return null
    }

    return (
        <div className="flex items-center gap-1">
            {ANNOTATION_COLORS.map((option) => (
                <Button
                    key={option.value}
                    variant={color === option.value ? 'secondary' : 'ghost'}
                    size="icon-xs"
                    aria-label={`只看${option.label}划线`}
                    onClick={(): void => {
                        onChange(color === option.value ? null : option.value)
                    }}
                >
                    <span className="size-3 rounded-full" style={{ backgroundColor: option.css }} />
                </Button>
            ))}
        </div>
    )
}

export function AnnotationFilterBar({
    activeKind,
    isQueryView,
    isHighlightTab,
    color,
    keyword,
    onChangeKind,
    onChangeKeyword,
    onChangeColor,
}: AnnotationFilterBarProps): JSX.Element | null {
    // 查询记录只按关键词检索：整条筛选行收起，避免点了没有反应的控件
    if (isQueryView) {
        return null
    }

    return (
        <AppMenu className="flex-col items-start">
            <div className="flex w-full items-center gap-1">
                <SegmentedRail
                    items={KIND_TAB_OPTIONS}
                    label="标注类型"
                    variant="outline"
                    value={activeKind}
                    onChange={onChangeKind}
                />
                <Input
                    value={keyword}
                    placeholder="搜索划线 / 批注 / 查询..."
                    className="w-full"
                    onChange={(event): void => {
                        onChangeKeyword(event.target.value)
                    }}
                />
            </div>
            <ColorFilter color={color} isVisible={isHighlightTab} onChange={onChangeColor} />
        </AppMenu>
    )
}
