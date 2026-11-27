/**
 * AI 解释条目：一条「查询文本 + 解释结果」的摘要，点击整条打开弹窗看详情。
 * 复用约定：骨架取 @components/ui/item 的槽位，详情弹窗取同目录 QueryRecordDetailDialog，
 * 删除入口取 @webview/blocks/DeleteConfirmButton，时间走 shared/utils/format。
 * 关键约束：骨架与 AnnotationListItem 同构（媒体 / 内容 / 操作 / 页脚），两处列表的行高与文字起点一致；
 * 只关心文本与结果，不展示来源文档、也不提供跳转——解释的是文本本身，与在哪篇里查无关；
 * 删除走确认弹窗而不是行内二次点击：行内确认有超时，用户稍一犹豫就会重来，表现为「删不掉」；
 * 删除点击必须阻断冒泡，否则会顺带把详情弹窗打开；条目的按键处理只认自身，内部按钮的按键不上浮。
 */
'use client'

import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Item, ItemActions, ItemContent, ItemFooter, ItemMedia, ItemTitle } from '@components/ui/item'
import type { EditorQueryRecord } from '@shared/types/editor'
import { formatDateTime } from '@shared/utils/format'
import { DeleteConfirmButton } from '@webview/blocks/DeleteConfirmButton'
import { QueryRecordDetailDialog } from './QueryRecordDetailDialog'
import type { JSX, KeyboardEvent } from 'react'

export interface QueryRecordItemProps {
    item: EditorQueryRecord
    onRemove: (id: string) => Promise<void>
}

export function QueryRecordItem({ item, onRemove }: QueryRecordItemProps): JSX.Element {
    const [isDetailOpen, setIsDetailOpen] = useState(false)

    /**
     * 条目是 div，回车与空格要自己补上点击语义，键盘用户才能打开详情。
     * 只认条目自身：内部按钮的按键有自己的默认行为，冒泡上来会同时打开详情与删除确认框，
     * 两套模态互相抢焦点。
     */
    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        if (event.target !== event.currentTarget) {
            return
        }
        if (event.key !== 'Enter' && event.key !== ' ') {
            return
        }
        event.preventDefault()
        setIsDetailOpen(true)
    }

    return (
        <>
            <Item
                variant="outline"
                className="cursor-pointer"
                tabIndex={0}
                onKeyDown={handleKeyDown}
                onClick={(): void => {
                    setIsDetailOpen(true)
                }}
                aria-label={`查看 AI 解释：${item.quote}`}
            >
                <ItemMedia variant="icon">
                    <Sparkles className="text-muted-foreground" />
                </ItemMedia>
                <ItemContent className="min-w-0">
                    <ItemTitle className="line-clamp-2 wrap-break-word">{item.quote}</ItemTitle>
                </ItemContent>
                <ItemActions>
                    <DeleteConfirmButton
                        tooltip="删除 AI 解释"
                        title="删除这条 AI 解释？"
                        description="删除后不可恢复，同一段文本的解释缓存也会一并清掉。"
                        isStopPropagation
                        onConfirm={(): void => {
                            void onRemove(item.id)
                        }}
                    />
                </ItemActions>
                <ItemFooter className="text-xs text-muted-foreground">
                    <span className="max-w-[50%] truncate">{item.model}</span>
                    <span>{formatDateTime(item.createdAt)}</span>
                </ItemFooter>
            </Item>
            <QueryRecordDetailDialog record={item} isOpen={isDetailOpen} onOpenChange={setIsDetailOpen} />
        </>
    )
}
