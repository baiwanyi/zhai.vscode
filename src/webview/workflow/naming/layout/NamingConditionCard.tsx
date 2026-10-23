/**
 * 取名条件卡片：分类字段 + 具体要求，底部一行依次为「生成方式（Switch）| 随机取名 | 数量」。
 * 复用约定：卡片复用 ui/card，字段布局复用 ui/field-group + ui/field，生成方式复用 ui/switch，
 * 数量下拉复用 ui/select，生成中状态用 ui/spinner + 按钮兼作取消。
 * 关键约束：AI 通道在未配置密钥时禁用；数量只接受宿主下发的候选值；生成中点击按钮即取消，不重复提交。
 */
import { Dices } from 'lucide-react'
import { Button } from '@components/ui/button'
import { Card, CardContent } from '@components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@components/ui/field'
import { Label } from '@components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import { Spinner } from '@components/ui/spinner'
import { Switch } from '@components/ui/switch'
import { Textarea } from '@components/ui/textarea'
import type { NamingCatalog, NamingRequest, NamingSurnameKind } from '@shared/types/naming'
import { NamingEntityFields } from './NamingEntityFields'
import { NamingPersonFields } from './NamingPersonFields'
import type { JSX } from 'react'
import { GENERATE_LABEL, MAX_REQUIREMENT_LENGTH } from '../constants'
import { readCategoryMeta } from '../utils'

interface NamingConditionCardProps {
    catalog: NamingCatalog
    request: NamingRequest
    isGenerating: boolean
    onChange: (patch: Partial<NamingRequest>) => void
    onSurnameKindChange: (kind: NamingSurnameKind) => void
    onRandomSurname: () => void
    onRandomSuffix: () => void
    onGenerate: () => void
    onAbort: () => void
}

export function NamingConditionCard({
    catalog,
    request,
    isGenerating,
    onChange,
    onSurnameKindChange,
    onRandomSurname,
    onRandomSuffix,
    onGenerate,
    onAbort,
}: NamingConditionCardProps): JSX.Element {
    const meta = readCategoryMeta(catalog, request.category)
    return (
        <Card className="w-full shrink-0 gap-3 py-3">
            <CardContent className="px-3">
                <FieldGroup className="gap-3">
                    {meta?.isPerson ? (
                        <NamingPersonFields
                            catalog={catalog}
                            request={request}
                            onChange={onChange}
                            onSurnameKindChange={onSurnameKindChange}
                            onRandomSurname={onRandomSurname}
                        />
                    ) : (
                        <NamingEntityFields
                            catalog={catalog}
                            request={request}
                            onChange={onChange}
                            onRandomSuffix={onRandomSuffix}
                        />
                    )}
                    <Field>
                        <FieldLabel htmlFor="naming-requirement">具体要求</FieldLabel>
                        <Textarea
                            id="naming-requirement"
                            value={request.requirement}
                            maxLength={MAX_REQUIREMENT_LENGTH}
                            rows={3}
                            placeholder="选填，如「靠海、偏远、破败」"
                            className="resize-none"
                            onChange={(event) => onChange({ requirement: event.target.value })}
                        />
                        <FieldDescription className="text-right">
                            {request.requirement.length} / {MAX_REQUIREMENT_LENGTH}
                        </FieldDescription>
                    </Field>
                </FieldGroup>
                <div className="mt-3 flex items-center gap-2">
                    <div
                        className="flex shrink-0 items-center gap-1.5"
                        title={
                            catalog.aiAvailable
                                ? '生成方式：开启为 AI 生成，关闭为本地生成'
                                : 'AI 通道未就绪，AI 生成不可用'
                        }
                    >
                        <Switch
                            id="naming-source"
                            checked={request.source === 'ai'}
                            disabled={!catalog.aiAvailable}
                            onCheckedChange={(checked) => onChange({ source: checked ? 'ai' : 'local' })}
                        />
                        <Label htmlFor="naming-source" className="text-muted-foreground">
                            AI 生成
                        </Label>
                    </div>
                    <Button
                        className="min-w-0 flex-1"
                        size="sm"
                        variant={isGenerating ? 'outline' : 'default'}
                        onClick={isGenerating ? onAbort : onGenerate}
                    >
                        {isGenerating ? <Spinner data-icon="inline-start" /> : <Dices data-icon="inline-start" />}
                        {isGenerating ? '取消' : GENERATE_LABEL}
                    </Button>
                    <Select value={String(request.count)} onValueChange={(value) => onChange({ count: Number(value) })}>
                        <SelectTrigger className="w-20 shrink-0" size="sm" aria-label="生成数量">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {catalog.counts.map((count) => (
                                    <SelectItem key={count} value={String(count)}>
                                        {count} 个
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </div>
            </CardContent>
        </Card>
    )
}
