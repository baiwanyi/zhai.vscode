/**
 * 设置弹窗：凭证卡常驻 + 同城城市 + 各入口取数口径。
 * 复用约定：外壳取 @components/ui/dialog（Title / Description 必填），城市下拉取 @components/ui/select，
 * 凭证卡复用同目录 CredentialCard，城市选项由 @shared/types/weibo 的 buildWeiboCityOptions 构造。
 * 关键约束：内容超出视口时在弹窗内滚动，不撑高页面；保存成功由 CredentialCard 回调收起首页的凭证卡；
 * 清除 Cookie 只发确认请求，确认框与清除动作都在面板层，本弹窗不自行删除；
 * 城市读取失败时在下拉上方给出提示，下拉仍按默认城市展示，口径与热搜同城页保持一致。
 */
import { Card, CardContent } from '@components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import { buildWeiboCityOptions, WEIBO_FEED_DEFAULT_COUNT } from '@shared/types/weibo'
import { CredentialCard } from './CredentialCard'
import type { JSX } from 'react'

interface SettingsDialogProps {
    isOpen: boolean
    onOpenChange: (isOpen: boolean) => void
    isConfigured: boolean
    isSaving: boolean
    /** 返回是否保存成功：失败时凭证卡保留输入，避免用户重贴一遍 */
    onSave: (cookie: string) => Promise<boolean>
    /** 请求清除 Cookie：只打开确认框，清除动作由面板层统一执行 */
    onRequestClear: () => void
    /** 保存成功后收起首页的凭证卡：设置弹窗里的卡片本身不可收起 */
    onCollapse: () => void
    /** 当前同城城市（四位代码）：空串表示尚未读取完成 */
    cityCode: string
    /** 城市配置读取失败的文案：非空时在下拉上方提示，避免静默回落默认城市 */
    cityError: string | null
    isCityLoading: boolean
    isCitySaving: boolean
    /** 保存同城城市：失败时下拉保留原选中值 */
    onSaveCity: (cityCode: string) => Promise<boolean>
}

export function SettingsDialog({
    isOpen,
    onOpenChange,
    isConfigured,
    isSaving,
    onSave,
    onRequestClear,
    onCollapse,
    cityCode,
    cityError,
    isCityLoading,
    isCitySaving,
    onSaveCity,
}: SettingsDialogProps): JSX.Element {
    const { effectiveCode: effectiveCityCode, options: cityOptions } = buildWeiboCityOptions(cityCode)

    /** 选择城市：保存成功后由上层状态回填，失败时下拉保持旧值 */
    function handleCityChange(next: string): void {
        void onSaveCity(next)
    }

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[calc(100vh-4rem)] flex-col gap-3 sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="text-lg">设置</DialogTitle>
                    <DialogDescription>登录 Cookie 只写入本机密钥库，不进日志、不进设置文件。</DialogDescription>
                </DialogHeader>
                <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
                    <CredentialCard
                        isConfigured={isConfigured}
                        isSaving={isSaving}
                        onSave={onSave}
                        onRequestClear={onRequestClear}
                        onCollapse={onCollapse}
                        canCollapse={false}
                    />
                    <Card>
                        <CardContent className="flex flex-col gap-2">
                            <h2 className="font-medium">同城热搜城市</h2>
                            <p className="text-muted-foreground text-xs">
                                「热搜 · 同城」按所选城市取榜：citycode 由固定前缀 80086 与四位行政区划代码拼接。
                            </p>
                            {cityError === null ? null : (
                                <p className="text-destructive text-xs">
                                    城市配置读取失败：{cityError}。下拉暂按默认城市展示，重新选择即可覆盖保存。
                                </p>
                            )}
                            <Select
                                value={effectiveCityCode}
                                onValueChange={handleCityChange}
                                disabled={isCityLoading || isCitySaving}
                            >
                                <SelectTrigger size="sm" className="w-40">
                                    <SelectValue placeholder="选择城市" />
                                </SelectTrigger>
                                <SelectContent>
                                    {cityOptions.map((option) => (
                                        <SelectItem key={option.code} value={option.code}>
                                            {option.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-muted-foreground text-xs">
                                城市集中在面板内调整，也可在设置里手填其它城市的四位代码。
                            </p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="flex flex-col gap-2">
                            <h2 className="font-medium">各入口的取数口径</h2>
                            <ul className="list-disc space-y-1 pl-5 text-muted-foreground text-xs">
                                <li>首页：unreadfriendstimeline，增量刷新只取上次之后的新微博。</li>
                                <li>时间线：friendstimeline，list_id 取默认分组里「最新微博」的 gid。</li>
                                <li>{`热门：hottimeline，固定频道 102803，首屏 ${WEIBO_FEED_DEFAULT_COUNT} 条。`}</li>
                                <li>分组：allGroups 取「我的分组」，选中后走 groupstimeline 拉该分组。</li>
                                <li>我的赞：likelist，uid 由宿主解析，只有页码分页，首屏 20 条。</li>
                                <li>热搜：我的 / 热搜 / 文娱 / 社会 / 科技 / 生活 / 体育 / ACG / 同城 各一张榜。</li>
                            </ul>
                            <p className="text-muted-foreground text-xs">
                                所有接口都是网页端内部 ajax：改版或风控升级后可能失效，届时重新粘贴 Cookie
                                或降低刷新频率再试。
                            </p>
                        </CardContent>
                    </Card>
                </div>
            </DialogContent>
        </Dialog>
    )
}
