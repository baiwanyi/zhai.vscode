/**
 * 设置弹窗：同城热搜城市 + 信息流屏蔽名单（用户名 / 关键字）。
 * 复用约定：骨架取 @webview/components/FormDialog（标题 / 说明 / 取消与保存），字段区显式用
 * @components/ui/field 的 FieldGroup 分组、组内用 Field / FieldLabel / FieldDescription / FieldError；
 * 城市下拉取 @components/ui/select，名单输入取 @components/ui/textarea，
 * 文案解析与还原走 @shared/utils/weiboBlock，城市选项由 @shared/types/weibo 的 buildWeiboCityOptions 构造。
 * 关键约束：所有改动先落在本地草稿，点「保存」才提交，没改动时保存按钮禁用；
 * 关闭（含取消）丢弃草稿，下次打开从已保存值起稿，不在 effect 里同步状态；
 * 屏蔽名单与城市用同一个提交按钮，两者都改动时先存城市、成功后再存名单，任一失败都保留草稿供重试；
 * 保存成功只弹一条「设置已保存」，具体子项的成功提示由各自的控制器让位给这里；
 * Cookie 的保存与清除不在此弹窗内，只由首页凭证卡与账号菜单负责，避免出现两套入口；
 * 城市读取失败时把 Field 与下拉标记为 invalid，并在下拉下方给出 FieldError，
 * 下拉仍按默认城市展示，口径与热搜同城页保持一致；名单保存后由取数 hook 即时过滤。
 */
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import { Textarea } from '@components/ui/textarea'
import { buildWeiboCityOptions, type WeiboBlockRules } from '@shared/types/weibo'
import { formatWeiboBlockListText, parseWeiboBlockListText } from '@shared/utils/weiboBlock'
import { FormDialog } from '@webview/components/FormDialog'
import type { WeiboBlockListController } from '../hooks/useWeiboBlockList'
import type { JSX } from 'react'

interface SettingsDialogProps {
    isOpen: boolean
    onOpenChange: (isOpen: boolean) => void
    /** 当前同城城市（四位代码）：空串表示尚未读取完成 */
    cityCode: string
    /** 城市配置读取失败的文案：非空时在下拉下方给出 FieldError，避免静默回落默认城市 */
    cityError: string | null
    isCityLoading: boolean
    isCitySaving: boolean
    /** 保存同城城市：失败时下拉保留原选中值 */
    onSaveCity: (cityCode: string) => Promise<boolean>
    /** 屏蔽名单控制器：设置弹窗与卡片「屏蔽该博主」共用同一份状态 */
    blockList: WeiboBlockListController
}

export function SettingsDialog({
    isOpen,
    onOpenChange,
    cityCode,
    cityError,
    isCityLoading,
    isCitySaving,
    onSaveCity,
    blockList,
}: SettingsDialogProps): JSX.Element {
    /** 城市选项要排序几百项：只在城市码变化时重建，避免名单输入框每敲一个字都重排一遍 */
    const { effectiveCode: effectiveCityCode, options: cityOptions } = useMemo(
        () => buildWeiboCityOptions(cityCode),
        [cityCode],
    )
    /** 未提交的选择：null 表示跟随已保存值，避免配置读取完成后的回填与草稿互相覆盖 */
    const [draftCityCode, setDraftCityCode] = useState<string | null>(null)
    /** 名单草稿：同样用 null 表示跟随已保存名单，异步读取完成后不必再写一遍 state */
    const [draftBlockedUsers, setDraftBlockedUsers] = useState<string | null>(null)
    const [draftBlockedKeywords, setDraftBlockedKeywords] = useState<string | null>(null)

    const selectedCityCode = draftCityCode ?? effectiveCityCode
    const blockedUsersText = draftBlockedUsers ?? formatWeiboBlockListText(blockList.state.blockedUsers)
    const blockedKeywordsText = draftBlockedKeywords ?? formatWeiboBlockListText(blockList.state.blockedKeywords)

    const isCityChanged = selectedCityCode !== effectiveCityCode
    // 比较归一化后的口径：多打空行、多余空格与顺序不变的重排不算改动
    const isBlockListChanged =
        formatWeiboBlockListText(parseWeiboBlockListText(blockedUsersText)) !==
            formatWeiboBlockListText(blockList.state.blockedUsers) ||
        formatWeiboBlockListText(parseWeiboBlockListText(blockedKeywordsText)) !==
            formatWeiboBlockListText(blockList.state.blockedKeywords)
    const isChanged = isCityChanged || isBlockListChanged
    const isBusy = isCityLoading || isCitySaving || blockList.state.isLoading || blockList.state.isSaving

    /** 关闭弹窗：未提交的改动一并丢弃，下次打开回到已保存值；保存成功也走这里，清理只有一处 */
    const handleOpenChange = useCallback(
        (next: boolean): void => {
            if (!next) {
                setDraftCityCode(null)
                setDraftBlockedUsers(null)
                setDraftBlockedKeywords(null)
            }
            onOpenChange(next)
        },
        [onOpenChange],
    )

    /** 保存：先城市后名单，全部成功才关闭；任一失败都保留草稿让用户直接重试 */
    const handleSubmit = useCallback((): void => {
        if (!isChanged) {
            return
        }
        const nextRules: WeiboBlockRules = {
            blockedUsers: parseWeiboBlockListText(blockedUsersText),
            blockedKeywords: parseWeiboBlockListText(blockedKeywordsText),
        }
        const submit = async (): Promise<boolean> => {
            if (isCityChanged && !(await onSaveCity(selectedCityCode))) {
                return false
            }
            if (isBlockListChanged) {
                return blockList.save(nextRules)
            }
            return true
        }
        void submit().then((isSaved) => {
            if (!isSaved) {
                return
            }
            // 走统一关闭路径：草稿清理与下次打开的初始值只有一处
            handleOpenChange(false)
            // 一次提交可能同时改了城市与名单：统一给一条回执，不按子项各弹一条
            toast.success('设置已保存')
        })
    }, [
        blockList,
        blockedKeywordsText,
        blockedUsersText,
        handleOpenChange,
        isBlockListChanged,
        isChanged,
        isCityChanged,
        onSaveCity,
        selectedCityCode,
    ])

    return (
        <FormDialog
            open={isOpen}
            title="设置"
            description="同城热搜城市与信息流屏蔽名单都在这里调整。"
            submitLabel="保存更改"
            isSubmitting={isCitySaving || blockList.state.isSaving}
            isSubmitDisabled={!isChanged || isCityLoading || blockList.state.isLoading}
            contentClassName="max-h-[calc(100vh-4rem)] overflow-y-auto"
            onOpenChange={handleOpenChange}
            onSubmit={handleSubmit}
        >
            <FieldGroup>
                <Field data-invalid={cityError !== null} data-disabled={isBusy}>
                    <FieldLabel htmlFor="weibo-city-code">同城热搜城市</FieldLabel>
                    <FieldDescription className="text-xs">
                        「热搜 · 同城」按所选城市取榜：citycode 由固定前缀 80086 与四位行政区划代码拼接。
                    </FieldDescription>
                    <Select value={selectedCityCode} onValueChange={setDraftCityCode} disabled={isBusy}>
                        <SelectTrigger id="weibo-city-code" aria-invalid={cityError !== null}>
                            <SelectValue placeholder="选择城市" />
                        </SelectTrigger>
                        {/* 城市列表有几百项：限高 16rem 并在列表内滚动。必须配 popper——
                            item-aligned 的定位写在父级 wrapper 的内联样式上，子元素覆盖不到，
                            直接限高会把菜单压到错误位置 */}
                        <SelectContent position="popper" sideOffset={4} className="max-h-64">
                            <SelectGroup>
                                {cityOptions.map((option) => (
                                    <SelectItem key={option.code} value={option.code}>
                                        {option.name}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                    {cityError === null ? null : (
                        <FieldError className="text-xs">
                            {`城市配置读取失败：${cityError}。下拉暂按默认城市展示，重新选择即可覆盖保存。`}
                        </FieldError>
                    )}
                    <FieldDescription className="text-xs">
                        选好城市后点「保存」生效，榜单会按新城市重新取数。
                    </FieldDescription>
                </Field>
                <Field
                    data-invalid={blockList.state.errorMessage !== null}
                    data-disabled={blockList.state.isLoading || blockList.state.isSaving}
                >
                    <FieldLabel htmlFor="weibo-blocked-users">屏蔽用户</FieldLabel>
                    <Textarea
                        id="weibo-blocked-users"
                        rows={4}
                        className="font-mono text-xs"
                        placeholder={'每行一个用户名，例如：\n某博主'}
                        value={blockedUsersText}
                        spellCheck={false}
                        disabled={blockList.state.isLoading || blockList.state.isSaving}
                        onChange={(event) => {
                            setDraftBlockedUsers(event.target.value)
                        }}
                    />
                    <FieldDescription className="text-xs">
                        命中作者名的整条微博不再出现在信息流里（忽略首尾空白与英文大小写）；
                        也可在卡片「更多」菜单里直接屏蔽该博主。
                    </FieldDescription>
                </Field>
                <Field
                    data-invalid={blockList.state.errorMessage !== null}
                    data-disabled={blockList.state.isLoading || blockList.state.isSaving}
                >
                    <FieldLabel htmlFor="weibo-blocked-keywords">屏蔽关键字</FieldLabel>
                    <Textarea
                        id="weibo-blocked-keywords"
                        rows={4}
                        className="font-mono text-xs"
                        placeholder={'每行一个关键字，例如：\n抽奖'}
                        value={blockedKeywordsText}
                        spellCheck={false}
                        disabled={blockList.state.isLoading || blockList.state.isSaving}
                        onChange={(event) => {
                            setDraftBlockedKeywords(event.target.value)
                        }}
                    />
                    <FieldDescription className="text-xs">
                        正文（含转发正文）包含任一关键字的整条微博会被隐藏，保存后当前列表立即过滤。
                    </FieldDescription>
                </Field>
                {blockList.state.errorMessage === null ? null : (
                    <FieldError className="text-xs">{`屏蔽名单读取或保存失败：${blockList.state.errorMessage}`}</FieldError>
                )}
            </FieldGroup>
        </FormDialog>
    )
}
