/**
 * Cookie 配置卡：说明获取路径与存储方式，提供保存与清除入口。
 * 复用约定：卡片取 @components/ui/card，按钮取 @webview/components/Button；
 * 本组件只做输入与按钮编排，保存与清除都通过 props 交回面板层执行。
 * 关键约束：输入为普通文本框但不回填历史值，明文只存在于输入瞬间；
 * 清除是破坏性操作，卡片只发请求，确认框与宿主清除都在面板层，避免出现两套入口。
 */
import { useCallback, useState } from 'react'
import { Card, CardContent } from '@components/ui/card'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

interface CredentialCardProps {
    isConfigured: boolean
    isSaving: boolean
    /** 返回是否保存成功：失败时保留输入，避免用户重贴一遍 */
    onSave: (cookie: string) => Promise<boolean>
    /** 请求清除 Cookie：只发信号，二次确认与宿主清除由调用方统一处理 */
    onRequestClear: () => void
    onCollapse: () => void
    canCollapse: boolean
}

export function CredentialCard({
    isConfigured,
    isSaving,
    onSave,
    onRequestClear,
    onCollapse,
    canCollapse,
}: CredentialCardProps): JSX.Element {
    const [cookieInput, setCookieInput] = useState('')

    const handleSave = useCallback((): void => {
        // 从浏览器复制的 Cookie 常带首尾换行与空白：存前统一去掉，避免拼出非法的 Cookie 头
        void onSave(cookieInput.trim()).then((isSaved) => {
            if (!isSaved) {
                return
            }
            setCookieInput('')
            onCollapse()
        })
    }, [cookieInput, onCollapse, onSave])

    return (
        <Card>
            <CardContent className="flex flex-col gap-2">
                <h2 className="font-medium">微博登录 Cookie</h2>
                <ol className="list-decimal space-y-1 pl-5 text-muted-foreground text-xs">
                    <li>在浏览器登录 weibo.com，打开开发者工具的「网络」面板。</li>
                    <li>刷新页面，任选一条 weibo.com/ajax 开头的请求，复制请求头里的完整 Cookie。</li>
                    <li>粘贴到下方并保存：Cookie 只写入本机 SecretStorage（系统加密），不进日志、不进设置文件。</li>
                </ol>
                <textarea
                    className="h-20 w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring"
                    placeholder="SUB=...; SUBP=...; 其它 Cookie 一并保留"
                    value={cookieInput}
                    spellCheck={false}
                    onChange={(event) => {
                        setCookieInput(event.target.value)
                    }}
                />
                <div className="flex items-center gap-2">
                    <Button
                        size="sm"
                        onClick={handleSave}
                        isLoading={isSaving}
                        disabled={cookieInput.trim().length === 0}
                    >
                        保存
                    </Button>
                    {isConfigured ? (
                        <Button size="sm" variant="ghost" onClick={onRequestClear} disabled={isSaving}>
                            清除
                        </Button>
                    ) : null}
                    {canCollapse ? (
                        <Button size="sm" variant="ghost" className="ml-auto" onClick={onCollapse}>
                            收起
                        </Button>
                    ) : null}
                </div>
                <p className="text-muted-foreground text-xs">
                    提示：Cookie 等同于账号登录态，请勿分享；该接口是网页端内部 ajax，改版后可能失效。
                </p>
            </CardContent>
        </Card>
    )
}
