/**
 * 统一出图服务单元测试：覆盖入参校验、配额、单任务锁、落盘与侧车、失败回滚。
 * 通道通过 ImageGenerator 接口替身注入，不触达真实 CLI；磁盘与配置由 vscode 测试桩承接，
 * 配额读写走真实的 quotaRepository（meta 表），因此断言的是实际扣减结果而非打桩值。
 */
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileContent, resetWorkspaceState, setConfigValue, setDirectory, setFileContent } from './stubs/vscode'
import type { AiProvider } from '../src/modules/ai/provider'
import type { ImageGenerator } from '../src/modules/imagegen/ai/imageProvider'
import { UsageRecorder } from '../src/modules/ai/usageRecorder'
import { readUsedToday } from '../src/modules/common/db/quotaRepository'
import { ensureSchema } from '../src/modules/common/db/schema'
import { IMAGE_QUOTA_KEYS } from '../src/modules/imagegen/constants'
import { ImageGenerateService } from '../src/modules/imagegen/imageGenerateService'
import { ImageSettingsService } from '../src/modules/imagegen/imageSettingsService'
import { PromptRuleService } from '../src/modules/imagegen/promptRuleService'

const STORAGE_ROOT = 'd:/vault'
const DIR_PATH = 'press/剑来'
const IMAGE_DIR = path.join(STORAGE_ROOT, 'press', '剑来', 'Images')
/** 通道替身产出的字节：落盘内容与断言保持一致 */
const ARTIFACT_BYTES = 'png-bytes'

let db: Database.Database
let settings: ImageSettingsService
let rules: PromptRuleService
let service: ImageGenerateService
/** 每次调用通道时收到的入参，用于断言提示词拼装与尺寸 */
let calls: { prompt: string; size: string }[]
/** 置位后下一次通道调用抛错，用于失败回滚用例 */
let shouldFail: boolean
/** 非空时通道调用挂起，用于单任务锁与取消用例 */
let hold: Promise<void> | null
/** 释放 hold 的钩子：取消用例需要在请求仍挂起时中断，再放行产物观察是否落盘 */
let releaseHold: (() => void) | null

/** 文本通道：出图测试不触达，调用即报错以暴露误用 */
const provider: AiProvider = {
    id: 'codebuddy',
    checkReady: () => Promise.resolve({ ready: true }),
    stream: () => {
        throw new Error('出图测试不应触达文本通道')
    },
}

/** 出图通道替身：记录入参，按开关失败或挂起 */
const generator: ImageGenerator = {
    generate: async (options) => {
        calls.push({ prompt: options.prompt, size: options.size })
        if (hold !== null) {
            await hold
        }
        if (shouldFail) {
            throw new Error('通道故障')
        }
        return { bytes: Buffer.from(ARTIFACT_BYTES), extension: 'png' }
    },
}

/** 出图入参：默认一张普通图，用例按需覆盖单项 */
function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { dirPath: DIR_PATH, prompt: '雪夜庭院', kind: 'photo', ratio: '3:4', style: 'auto', ...overrides }
}

/** 图片落盘后的绝对路径 */
function imageFsPath(id: string, extension = 'png'): string {
    return path.join(IMAGE_DIR, `${id}.${extension}`)
}

const toUri = (uri: { fsPath: string }): string => uri.fsPath

beforeEach(() => {
    resetWorkspaceState()
    setConfigValue('storage.rootPath', STORAGE_ROOT)
    setConfigValue('image.dailyLimit', 10)
    setDirectory(path.join(STORAGE_ROOT, 'press', '剑来'))
    db = new Database(':memory:')
    ensureSchema(db)
    settings = new ImageSettingsService()
    rules = new PromptRuleService()
    calls = []
    shouldFail = false
    hold = null
    releaseHold = null
    service = new ImageGenerateService(db, generator, new UsageRecorder(db), provider, settings, rules)
})

describe('入参校验', () => {
    it('提示词为空时拒绝，且不调用通道', async () => {
        await expect(service.generate(payload({ prompt: '   ' }), toUri)).rejects.toThrow('提示词不能为空')

        expect(calls).toHaveLength(0)
    })

    it('角色图必须携带合法角色标识', async () => {
        await expect(service.generate(payload({ kind: 'portrait' }), toUri)).rejects.toThrow('角色图缺少合法的角色标识')
        await expect(service.generate(payload({ kind: 'portrait', characterId: 'abc' }), toUri)).rejects.toThrow(
            '角色图缺少合法的角色标识',
        )
    })

    it('非角色图不允许携带角色标识', async () => {
        await expect(service.generate(payload({ characterId: '12345678' }), toUri)).rejects.toThrow(
            '非角色图不应携带角色标识',
        )
    })

    it('画面比例只接受白名单值', async () => {
        await expect(service.generate(payload({ ratio: '5:5' }), toUri)).rejects.toThrow('画面比例非法')
    })
})

describe('成功出图', () => {
    it('落盘到 Images 并写同名侧车，配额扣减一次', async () => {
        const result = await service.generate(payload(), toUri)

        expect(result.image.path).toBe(`press/剑来/Images/${result.image.id}.png`)
        expect(result.image.kind).toBe('photo')
        expect(result.image.characterId).toBeNull()
        expect(readFileContent(imageFsPath(result.image.id))).toBe(ARTIFACT_BYTES)
        expect(readFileContent(imageFsPath(result.image.id, 'json'))).toBe(
            JSON.stringify({
                prompt: '雪夜庭院',
                ratio: '3:4',
                style: 'auto',
                characterId: null,
                enhancedFrom: null,
                createdAt: result.image.createdAt,
            }),
        )
        expect(readUsedToday(db, IMAGE_QUOTA_KEYS)).toBe(1)
    })

    it('角色图按 portrait 前缀命名并带上角色标识', async () => {
        const result = await service.generate(payload({ kind: 'portrait', characterId: '12345678' }), toUri)

        expect(result.image.id.startsWith('portrait-')).toBe(true)
        expect(result.image.id.endsWith('-12345678')).toBe(true)
        expect(result.image.characterId).toBe('12345678')
    })

    it('同角色连续两次生成不会覆盖前一张', async () => {
        const first = await service.generate(payload({ kind: 'portrait', characterId: '12345678' }), toUri)
        const second = await service.generate(payload({ kind: 'portrait', characterId: '12345678' }), toUri)

        expect(second.image.path).not.toBe(first.image.path)
        expect(readFileContent(imageFsPath(first.image.id))).toBe(ARTIFACT_BYTES)
    })

    it('作品级 promptSuffix 叠加进通道提示词，尺寸取比例映射', async () => {
        await settings.save({ dirPath: DIR_PATH, settings: { promptSuffix: '柔和光线', negative: '文字水印' } })

        await service.generate(payload(), toUri)

        expect(calls[0]?.prompt).toContain('柔和光线')
        expect(calls[0]?.prompt).toContain('避免出现：文字水印')
        expect(calls[0]?.size).toBe('768x1024')
    })
})

describe('词条芯片', () => {
    it('按词条标识换取归一化文本，并与正文合并：词条在前、正文在后', async () => {
        await service.generate(
            payload({ prompt: '雨夜长街', promptTags: ['(female:1.3)', '[autumn maple forest]'] }),
            toUri,
        )

        expect(calls[0]?.prompt.startsWith('female, autumn maple forest, 雨夜长街')).toBe(true)
    })

    it('正文为空但挂了词条时照常出图，侧车记录合并后的提示词', async () => {
        const result = await service.generate(payload({ prompt: '', promptTags: ['(female:1.3)'] }), toUri)

        expect(calls[0]?.prompt.startsWith('female')).toBe(true)
        expect(readFileContent(imageFsPath(result.image.id, 'json'))).toContain('"prompt":"female"')
    })

    it('词条为空数组时行为与纯正文一致', async () => {
        await service.generate(payload({ promptTags: [] }), toUri)

        expect(calls[0]?.prompt.startsWith('雪夜庭院')).toBe(true)
    })
})

/** 规则文件的绝对路径：与宿主侧 prompt/rules 口径一致 */
function ruleFsPath(name: string): string {
    return path.join(STORAGE_ROOT, 'prompt', 'rules', `${name}.md`)
}

describe('规则芯片', () => {
    it('按规则标识读取 md 正文，排在正文之后、作品补充之前', async () => {
        setFileContent(ruleFsPath('冷色调'), '# 冷色调\n只用青蓝与灰白，不要暖色。\n')
        await settings.save({ dirPath: DIR_PATH, settings: { promptSuffix: '柔和光线' } })

        await service.generate(payload({ prompt: '雪夜庭院', promptRules: ['冷色调'] }), toUri)

        const prompt = calls[0]?.prompt ?? ''
        expect(prompt.startsWith('雪夜庭院')).toBe(true)
        expect(prompt).toContain('只用青蓝与灰白')
        expect(prompt.indexOf('只用青蓝与灰白')).toBeLessThan(prompt.indexOf('柔和光线'))
    })

    it('只有规则没有正文时照常出图', async () => {
        setFileContent(ruleFsPath('水墨留白'), '画面保持水墨留白。\n')

        await service.generate(payload({ prompt: '', promptRules: ['水墨留白'] }), toUri)

        expect(calls[0]?.prompt.startsWith('画面保持水墨留白')).toBe(true)
    })

    it('规则文件缺失时跳过，不阻断出图', async () => {
        await service.generate(payload({ prompt: '雪夜庭院', promptRules: ['不存在的规则'] }), toUri)

        expect(calls[0]?.prompt.startsWith('雪夜庭院')).toBe(true)
    })
})

describe('失败与并发', () => {
    it('通道失败时错误透传，不扣配额、不留文件', async () => {
        shouldFail = true

        await expect(service.generate(payload(), toUri)).rejects.toThrow('通道故障')

        expect(readUsedToday(db, IMAGE_QUOTA_KEYS)).toBe(0)
        expect(readFileContent(imageFsPath('photo-20260101010101-AbCd1234'))).toBeUndefined()
    })

    it('已有在途请求时拒绝新的生成，且只调用通道一次', async () => {
        hold = new Promise<void>((resolve) => {
            // 释放挂起的通道调用，让第一个请求正常收尾
            setTimeout(resolve, 0)
        })

        const first = service.generate(payload(), toUri)
        await expect(service.generate(payload(), toUri)).rejects.toThrow('已有生成中的图片请求')
        await first

        expect(calls).toHaveLength(1)
    })

    it('配额用尽后拒绝新请求', async () => {
        setConfigValue('image.dailyLimit', 1)
        await service.generate(payload(), toUri)

        await expect(service.generate(payload(), toUri)).rejects.toThrow('今日图片生成次数已用完')
    })

    it('无在途请求时 cancel 返回未取消', () => {
        expect(service.abort()).toEqual({ aborted: false })
    })

    it('取消后产物到达也不落盘、不扣配额', async () => {
        hold = new Promise<void>((resolve) => {
            releaseHold = resolve
        })
        const pending = service.generate(payload(), toUri)
        expect(service.abort()).toEqual({ aborted: true })

        // 放行通道：产物照常返回，但请求已被取消，副作用一律不该发生
        releaseHold?.()
        await expect(pending).rejects.toThrow('出图已取消')

        expect(readUsedToday(db, IMAGE_QUOTA_KEYS)).toBe(0)
    })
})
