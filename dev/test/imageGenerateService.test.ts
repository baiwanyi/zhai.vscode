/**
 * 统一出图服务单元测试：覆盖入参校验、配额、单任务锁、落盘与媒体入库、失败回滚。
 * 通道通过 ImageGenerator 接口替身注入，不触达真实 CLI；磁盘与配置由 vscode 测试桩承接，
 * 媒体入库以收集回调替身承接，断言的是交给索引的记录而非磁盘侧车；
 * 配额读写走真实的 quotaRepository（meta 表），因此断言的是实际扣减结果而非打桩值。
 */
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileContent, resetWorkspaceState, setConfigValue, setDirectory, setFileContent } from './stubs/vscode'
import type { AiProvider } from '../../src/modules/ai/provider'
import type { ImageGenerator } from '../../src/modules/imagegen/ai/imageProvider'
import type { MediaRecord } from '../../src/modules/media/mediaRepository'
import { UsageRecorder } from '../../src/modules/ai/usageRecorder'
import { readUsedToday } from '../../src/modules/common/db/quotaRepository'
import { ensureSchema } from '../../src/modules/common/db/schema'
import { IMAGE_QUOTA_KEYS } from '../../src/modules/imagegen/constants'
import { ImageGenerateService } from '../../src/modules/imagegen/imageGenerateService'
import { ImageSettingsService } from '../../src/modules/imagegen/imageSettingsService'
import { PromptRuleService, PromptTagService } from '../../src/modules/imagegen/prompt'
import { ReferenceImageService } from '../../src/modules/imagegen/referenceImageService'

const STORAGE_ROOT = 'd:/vault'
const DIR_PATH = 'press/剑来'
/** 媒体根目录：落盘位置从「作品目录/Images」改为全库统一的 images/{YYYYMM} */
const IMAGE_DIR = path.join(STORAGE_ROOT, 'images')
/** 通道替身产出的字节：落盘内容与断言保持一致 */
const ARTIFACT_BYTES = 'png-bytes'

let db: Database.Database
let settings: ImageSettingsService
let rules: PromptRuleService
let tags: PromptTagService
let referenceImages: ReferenceImageService
let service: ImageGenerateService
/** 每次调用通道时收到的入参，用于断言提示词拼装与尺寸 */
let calls: { prompt: string; size: string }[]
/** 置位后下一次通道调用抛错，用于失败回滚用例 */
let shouldFail: boolean
/** 非空时通道调用挂起，用于单任务锁与取消用例 */
let hold: Promise<void> | null
/** 释放 hold 的钩子：取消用例需要在请求仍挂起时中断，再放行产物观察是否落盘 */
let releaseHold: (() => void) | null
/** 每次落盘后交给媒体索引的记录：断言出处与出图参数 */
let recorded: MediaRecord[]

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

/** 图片落盘后的绝对路径：id 前 6 位即年月目录 */
function imageFsPath(id: string, extension = 'png'): string {
    return path.join(IMAGE_DIR, id.slice(0, 6), `${id}.${extension}`)
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
    tags = new PromptTagService()
    referenceImages = new ReferenceImageService()
    calls = []
    shouldFail = false
    hold = null
    releaseHold = null
    recorded = []
    service = new ImageGenerateService(
        db,
        generator,
        new UsageRecorder(db),
        provider,
        settings,
        rules,
        tags,
        referenceImages,
        // 媒体入库由装配处注入：用例收集记录，断言出处与出图参数是否正确落到索引
        (record) => recorded.push(record),
    )
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

    it('普通图片不允许携带归属标识', async () => {
        await expect(service.generate(payload({ characterId: '12345678' }), toUri)).rejects.toThrow(
            '普通图片不应携带归属标识',
        )
        await expect(service.generate(payload({ loreKind: 'faction' }), toUri)).rejects.toThrow(
            '普通图片不应携带归属标识',
        )
    })

    it('条目图缺少分类或条目标识时拒绝', async () => {
        await expect(service.generate(payload({ kind: 'lore', loreId: '10428736' }), toUri)).rejects.toThrow(
            '条目图缺少合法的条目分类',
        )
        await expect(service.generate(payload({ kind: 'lore', loreKind: 'faction' }), toUri)).rejects.toThrow(
            '条目图缺少合法的条目标识',
        )
    })

    it('画面比例只接受白名单值', async () => {
        await expect(service.generate(payload({ ratio: '5:5' }), toUri)).rejects.toThrow('画面比例非法')
    })

    it('参考图未经过选择流程时拒绝请求，且不调用通道', async () => {
        await expect(
            service.generate(payload({ prompt: '', referenceImages: ['d:/vault/pic.png'] }), toUri),
        ).rejects.toThrow('参考图未经过选择流程')

        expect(calls).toHaveLength(0)
    })
})

describe('成功出图', () => {
    it('落盘到 images/{YYYYMM}，并把出处与出图参数交给索引，配额扣减一次', async () => {
        const result = await service.generate(payload(), toUri)

        expect(result.image.path).toBe(`images/${result.image.id.slice(0, 6)}/${result.image.id}.png`)
        expect(result.image.id).toMatch(/^\d{14}[A-Za-z0-9]{6}$/)
        expect(result.image.kind).toBe('photo')
        expect(result.image.characterId).toBeNull()
        expect(readFileContent(imageFsPath(result.image.id))).toBe(ARTIFACT_BYTES)
        expect(recorded).toHaveLength(1)
        expect(recorded[0]).toMatchObject({
            path: result.image.path,
            scope: 'press',
            origin: 'generate',
            pressName: '剑来',
            prompt: '雪夜庭院',
            ratio: '3:4',
            style: 'auto',
            characterId: null,
            loreId: null,
        })
        expect(readUsedToday(db, IMAGE_QUOTA_KEYS)).toBe(1)
    })

    it('角色图写入角色标识与名称快照', async () => {
        const result = await service.generate(
            payload({ kind: 'portrait', characterId: '12345678', characterName: '林清' }),
            toUri,
        )

        expect(result.image.characterId).toBe('12345678')
        expect(result.image.characterName).toBe('林清')
        expect(recorded[0]).toMatchObject({ kind: 'portrait', characterId: '12345678', characterName: '林清' })
    })

    it('条目图写入条目分类、标识与名称快照', async () => {
        const result = await service.generate(
            payload({ kind: 'lore', loreKind: 'faction', loreId: '10428736', loreName: '青云宗' }),
            toUri,
        )

        expect(result.image.kind).toBe('lore')
        expect(result.image.loreKind).toBe('faction')
        expect(result.image.loreId).toBe('10428736')
        expect(result.image.characterId).toBeNull()
        expect(recorded[0]).toMatchObject({ kind: 'lore', loreKind: 'faction', loreId: '10428736', loreName: '青云宗' })
    })

    it('同角色连续两次生成不会覆盖前一张', async () => {
        const first = await service.generate(payload({ kind: 'portrait', characterId: '12345678' }), toUri)
        const second = await service.generate(payload({ kind: 'portrait', characterId: '12345678' }), toUri)

        expect(second.image.id).not.toBe(first.image.id)
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

/** 词库目录的绝对路径：与宿主侧 prompt/tags 口径一致 */
function tagDirPath(): string {
    return path.join(STORAGE_ROOT, 'prompt', 'tags')
}

/** 词库 md 的绝对路径：与宿主侧 prompt/tags 口径一致 */
function tagFsPath(object: string): string {
    return path.join(tagDirPath(), `${object}.md`)
}

/** 造一份词库 md：一条带权重写法，一条带方括号写法，用于验证宿主侧的归一化口径 */
function writeTagFile(): void {
    setDirectory(tagDirPath())
    setFileContent(
        tagFsPath('人物'),
        ['# 人物', '', '## 基础', '', '### 女性', '(female:1.3)', '', '### 秋林', '[autumn maple forest]', ''].join(
            '\n',
        ),
    )
}

describe('词条芯片', () => {
    it('按词条标识回查 md 并归一化，与正文合并：词条在前、正文在后', async () => {
        writeTagFile()

        await service.generate(
            payload({ prompt: '雨夜长街', promptTags: ['人物::基础::女性', '人物::基础::秋林'] }),
            toUri,
        )

        expect(calls[0]?.prompt.startsWith('female, autumn maple forest, 雨夜长街')).toBe(true)
    })

    it('正文为空但挂了词条时照常出图，索引记录合并后的提示词', async () => {
        writeTagFile()

        await service.generate(payload({ prompt: '', promptTags: ['人物::基础::女性'] }), toUri)

        expect(calls[0]?.prompt.startsWith('female')).toBe(true)
        expect(recorded[0]?.prompt).toBe('female')
    })

    it('词条标识查不到时跳过，不阻断出图', async () => {
        writeTagFile()

        await service.generate(payload({ prompt: '雨夜长街', promptTags: ['人物::基础::不存在'] }), toUri)

        expect(calls[0]?.prompt.startsWith('雨夜长街')).toBe(true)
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

describe('上下文段', () => {
    it('排在正文之后、规则之前', async () => {
        setFileContent(ruleFsPath('冷色调'), '只用青蓝与灰白。\n')

        await service.generate(
            payload({ prompt: '雪夜庭院', contexts: ['书名：剑来'], promptRules: ['冷色调'] }),
            toUri,
        )

        const prompt = calls[0]?.prompt ?? ''
        expect(prompt.startsWith('雪夜庭院')).toBe(true)
        expect(prompt.indexOf('书名：剑来')).toBeGreaterThan(prompt.indexOf('雪夜庭院'))
        expect(prompt.indexOf('书名：剑来')).toBeLessThan(prompt.indexOf('只用青蓝与灰白'))
    })

    it('只挂上下文也能出图', async () => {
        await service.generate(payload({ prompt: '', contexts: ['书名：剑来'] }), toUri)

        expect(calls[0]?.prompt.startsWith('书名：剑来')).toBe(true)
    })

    it('索引只记录正文，上下文不进提示词字段', async () => {
        await service.generate(payload({ prompt: '雪夜庭院', contexts: ['书名：剑来'] }), toUri)

        expect(recorded[0]?.prompt).toBe('雪夜庭院')
        expect(calls[0]?.prompt).toContain('书名：剑来')
    })
})

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
    it('通道失败时错误透传，不扣配额、不入索引', async () => {
        shouldFail = true

        await expect(service.generate(payload(), toUri)).rejects.toThrow('通道故障')

        expect(readUsedToday(db, IMAGE_QUOTA_KEYS)).toBe(0)
        expect(recorded).toHaveLength(0)
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
