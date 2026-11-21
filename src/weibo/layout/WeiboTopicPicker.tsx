/**
 * 话题选择器：发表框工具栏上的 Popover，顶部搜索、下方话题列表，点击把话题插入正文。
 * 复用约定：Popover 取 @components/ui/popover，搜索框取 @components/ui/input，
 * 取数走 hooks/useWeiboTopicSearch（q 为空即常用话题），按钮取 @webview/components/Button。
 * 关键约束：未配置 Cookie 时只给引导、不发请求；每次打开都回源取常用话题（热搜变化快，不做缓存）；
 * 选中后立即收起面板，焦点由调用方在 onCloseAutoFocus 里交回输入框。
 */
import { Hash } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Input } from '@components/ui/input'
import {
    Popover,
    PopoverContent,
    PopoverDescription,
    PopoverHeader,
    PopoverTitle,
    PopoverTrigger,
} from '@components/ui/popover'
import { Spinner } from '@components/ui/spinner'
import { Button } from '@webview/components/Button'
import type { ChangeEvent, JSX } from 'react'
import { useWeiboTopicSearch } from '../hooks/useWeiboTopicSearch'

interface WeiboTopicPickerProps {
    /** 是否具备取数条件：未配置 Cookie 时只给引导，不发请求 */
    isEnabled: boolean
    /** 选中话题：只回传纯文本话题名，由调用方决定插入形态 */
    onSelect: (topic: string) => void
}

export function WeiboTopicPicker({ isEnabled, onSelect }: WeiboTopicPickerProps): JSX.Element {
    const [isOpen, setIsOpen] = useState(false)
    const [keyword, setKeyword] = useState('')
    const { state, loadDefault, search } = useWeiboTopicSearch(isEnabled)

    const handleOpenChange = useCallback(
        (open: boolean): void => {
            setIsOpen(open)
            setKeyword('')
            if (open) {
                void loadDefault()
            }
        },
        [loadDefault],
    )

    const handleKeywordChange = useCallback(
        (event: ChangeEvent<HTMLInputElement>): void => {
            const value = event.target.value
            setKeyword(value)
            search(value)
        },
        [search],
    )

    const handleSelect = useCallback(
        (topic: string): void => {
            onSelect(topic)
            setIsOpen(false)
        },
        [onSelect],
    )

    /** 重试当前关键字：关键字为空即重取常用话题 */
    const handleRetry = useCallback((): void => {
        search(keyword)
    }, [keyword, search])

    /** 列表主体：加载 / 失败 / 空结果 / 话题行 */
    function renderList(): JSX.Element {
        if (state.isLoading && state.topics.length === 0) {
            return (
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <Spinner className="size-3.5" aria-hidden="true" />
                    正在读取话题...
                </div>
            )
        }
        if (state.errorMessage !== null && state.topics.length === 0) {
            return (
                <div className="flex flex-col gap-2">
                    <PopoverDescription>{state.errorMessage}</PopoverDescription>
                    <Button size="sm" variant="outline" onClick={handleRetry}>
                        重试
                    </Button>
                </div>
            )
        }
        if (state.topics.length === 0) {
            return (
                <PopoverDescription>
                    {keyword.trim().length > 0
                        ? '没有匹配到话题，换个关键字再试试。'
                        : '暂时没有常用话题，输入关键字搜索。'}
                </PopoverDescription>
            )
        }
        return (
            <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
                {state.topics.map((topic) => (
                    <button
                        key={topic}
                        type="button"
                        title={`插入 #${topic}#`}
                        className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => {
                            handleSelect(topic)
                        }}
                    >
                        <span className="truncate">#{topic}#</span>
                    </button>
                ))}
            </div>
        )
    }

    return (
        <Popover open={isOpen} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
                {/* 工具栏图标按钮：图标在上、文字在下，与表情按钮同形 */}
                <Button variant="ghost" title="插入话题" className="h-auto flex-col gap-0.5 px-2 py-1">
                    <Hash className="size-4" aria-hidden="true" />
                    <span className="text-xs">话题</span>
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                className="w-80"
                onCloseAutoFocus={(event) => {
                    // 选完话题焦点要交回输入框：阻止 Radix 把它还给触发按钮
                    event.preventDefault()
                }}
            >
                <PopoverHeader>
                    <PopoverTitle>插入话题</PopoverTitle>
                    <PopoverDescription>不填关键字时列出常用话题，点击插入到正文光标处。</PopoverDescription>
                </PopoverHeader>
                {isEnabled ? (
                    <>
                        <Input
                            value={keyword}
                            placeholder="搜索话题"
                            aria-label="搜索话题"
                            maxLength={50}
                            onChange={handleKeywordChange}
                        />
                        {renderList()}
                    </>
                ) : (
                    <PopoverDescription>先在「设置」里保存登录 Cookie，才能读取话题。</PopoverDescription>
                )}
            </PopoverContent>
        </Popover>
    )
}
