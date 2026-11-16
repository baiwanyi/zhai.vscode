/**
 * 检索输入行：关键词输入 + 回车提交 + 检索按钮，供提及与参考资料两个检索弹窗共用。
 * 复用约定：输入取 @components/ui/input，按钮取 @webview/components/Button；
 * 关键词草稿只存在本层，弹窗关闭后随内容区一并卸载，不会残留上一轮的关键词。
 * 关键约束：只有回车或点按钮才发请求，不随输入逐字检索；关键词为空白时只清空输入、不发请求。
 */
import { useState } from 'react'
import { Input } from '@components/ui/input'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

interface AiChatSearchFieldProps {
    /** 检索进行中：按钮展示加载文案并禁用 */
    isSearching: boolean
    /** 提交检索关键词 */
    onSubmit: (keyword: string) => void
}

export function AiChatSearchField({ isSearching, onSubmit }: AiChatSearchFieldProps): JSX.Element {
    const [keyword, setKeyword] = useState('')

    /** 检索：关键词为空时只清空输入，不发请求 */
    const submit = (): void => {
        if (keyword.trim().length === 0) {
            return
        }
        onSubmit(keyword)
    }

    return (
        <div className="flex items-center gap-2">
            <Input
                autoFocus
                value={keyword}
                placeholder="输入关键词后回车"
                onChange={(event) => setKeyword(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        submit()
                    }
                }}
            />
            <Button variant="secondary" disabled={isSearching} onClick={submit}>
                {isSearching ? '检索中…' : '检索'}
            </Button>
        </div>
    )
}
