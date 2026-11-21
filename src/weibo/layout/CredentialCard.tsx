/**
 * Cookie 配置卡：说明获取路径与存储方式，提供粘贴与保存入口。
 * 复用约定：卡片取 @components/ui/card，字段组合取 @components/ui/field
 * （FieldGroup / Field / FieldLabel / FieldDescription），Cookie 输入取 @components/ui/textarea，
 * 按钮取 @webview/components/Button，读取失败提示取 @webview/components/ListErrorAlert；
 * 本组件只做输入与保存编排，写入动作通过 props 交回面板层执行；
 * 上次读取失败的原因由调用方经 errorMessage 传入，本组件只展示、不推断原因。
 * 关键约束：输入为普通文本框但不回填历史值，明文只存在于输入瞬间；
 * 清除不在此卡片内，只由账号菜单负责，避免出现两套入口；卡片是否显示由页面按登录态判定，
 * 保存成功后由登录态变化自然收起，本组件不提供收起按钮。
 */
import { useCallback, useState } from 'react'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@components/ui/field'
import { Textarea } from '@components/ui/textarea'
import { Button } from '@webview/components/Button'
import { ListErrorAlert } from '@webview/components/ListErrorAlert'
import type { JSX } from 'react'

interface CredentialCardProps {
    isSaving: boolean
    /** 上次读取失败的原因：非空时在表单上方提示，说明为什么会退回这张卡 */
    errorMessage?: string
    /** 返回是否保存成功：失败时保留输入，避免用户重贴一遍 */
    onSave: (cookie: string) => Promise<boolean>
}

export function CredentialCard({ isSaving, errorMessage, onSave }: CredentialCardProps): JSX.Element {
    const [cookieInput, setCookieInput] = useState('')

    const handleSave = useCallback((): void => {
        // 从浏览器复制的 Cookie 常带首尾换行与空白：存前统一去掉，避免拼出非法的 Cookie 头
        void onSave(cookieInput.trim()).then((isSaved) => {
            if (!isSaved) {
                return
            }
            setCookieInput('')
        })
    }, [cookieInput, onSave])

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">微博登录 Cookie</CardTitle>
                <CardDescription>
                    Cookie 等同于账号登录态，请勿分享；该接口是网页端内部 ajax，改版后可能失效。
                </CardDescription>
            </CardHeader>
            <CardContent>
                {errorMessage === undefined || errorMessage.length === 0 ? null : (
                    <div className="mb-2">
                        <ListErrorAlert title="上次读取失败" error={errorMessage} />
                    </div>
                )}
                <FieldGroup>
                    <Field>
                        <FieldLabel htmlFor="weibo-login-cookie">完整 Cookie</FieldLabel>
                        <FieldDescription className="text-xs">
                            在浏览器登录 weibo.com，打开开发者工具的「网络」面板；刷新页面后任选一条 weibo.com/ajax
                            开头的请求，复制请求头里的完整 Cookie 粘贴到下方并保存。
                        </FieldDescription>
                        <Textarea
                            id="weibo-login-cookie"
                            className="resize-none font-mono text-xs"
                            rows={3}
                            placeholder="SUB=...; SUBP=...; 其它 Cookie 一并保留"
                            value={cookieInput}
                            autoComplete="off"
                            spellCheck={false}
                            onChange={(event) => {
                                setCookieInput(event.target.value)
                            }}
                        />
                        <FieldDescription className="text-xs">
                            Cookie 只写入本机 SecretStorage（系统加密），不进日志、不进设置文件。
                        </FieldDescription>
                    </Field>
                </FieldGroup>
            </CardContent>
            <CardFooter className="justify-end">
                <Button
                    variant="primary"
                    onClick={handleSave}
                    isLoading={isSaving}
                    disabled={cookieInput.trim().length === 0}
                >
                    保存
                </Button>
            </CardFooter>
        </Card>
    )
}
