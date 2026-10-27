/**
 * 词库服务的单测：覆盖按分类分文件的列举、预览图两种命中、增删改落盘与重名拒绝。
 * 复用约定：虚拟磁盘取 dev/test/stubs/vscode，存储根经 zhai.storage.rootPath 注入，与出图服务同一口径。
 * 关键约束：改名或换组必须整块移动且不留空文件；同组重名一律拒绝；分类删空时 md 一并删除。
 */
import { createHash } from 'node:crypto'
import * as path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
    hasDirectory,
    readFileContent,
    resetWorkspaceState,
    setConfigValue,
    setDirectory,
    setFileContent,
} from './stubs/vscode'
import { PromptTagService } from '../../src/modules/imagegen/prompt'

const STORAGE_ROOT = 'd:/vault'
const TAG_DIR = path.join(STORAGE_ROOT, 'prompt', 'tags')
const IMAGE_DIR = path.join(STORAGE_ROOT, 'prompt', 'images')

let service: PromptTagService

/** 分类 md 的绝对路径 */
function tagPath(object: string): string {
    return path.join(TAG_DIR, `${object}.md`)
}

/** 预览图的绝对路径 */
function imagePath(...segments: string[]): string {
    return path.join(IMAGE_DIR, ...segments)
}

/** 哈希兜底名：sha1(分类-分组-名称) 前 10 位 */
function hashName(object: string, attribute: string, name: string): string {
    return createHash('sha1').update(`${object}-${attribute}-${name}`, 'utf8').digest('hex').slice(0, 10)
}

beforeEach(() => {
    resetWorkspaceState()
    setConfigValue('storage.rootPath', STORAGE_ROOT)
    service = new PromptTagService()
})

describe('词库列举', () => {
    it('目录缺失时返回空库，并带上目录路径供空态提示', async () => {
        const result = await service.list()

        expect(result.objects).toEqual([])
        expect(result.tags).toEqual([])
        expect(result.dirPath).toBe(TAG_DIR)
        expect(result.imageDirPath).toBe(IMAGE_DIR)
    })

    it('按 md 解析分类、分组与词条，分组计数与 md 内顺序一致', async () => {
        setDirectory(TAG_DIR)
        setFileContent(
            tagPath('人物'),
            [
                '# 人物',
                '',
                '## 基础',
                '',
                '### 女性',
                'female',
                '',
                '### 男性',
                'male',
                '',
                '## 身份',
                '',
                '### 救生员',
                'lifeguard',
                '',
            ].join('\n'),
        )

        const result = await service.list()

        expect(result.objects).toEqual([
            {
                name: '人物',
                attributes: [
                    { name: '基础', count: 2 },
                    { name: '身份', count: 1 },
                ],
            },
        ])
        expect(result.tags.map((tag) => tag.id)).toEqual(['人物::基础::女性', '人物::基础::男性', '人物::身份::救生员'])
        expect(result.tags[0]?.preview).toBeNull()
    })

    it('分类清单把「预设」置顶，其余按中文名排序', async () => {
        setDirectory(TAG_DIR)
        setFileContent(tagPath('人物'), '# 人物\n\n## 基础\n\n### 女性\nfemale\n')
        setFileContent(tagPath('表情'), '# 表情\n\n## 笑\n\n### 微笑\nsmile\n')
        setFileContent(tagPath('预设'), '# 预设\n\n## 构图\n\n### 全身\nfull body\n')

        const names = (await service.list()).objects.map((item) => item.name)

        expect(names).toEqual(['预设', '表情', '人物'])
    })

    it('文件内分类标题与文件名不一致时，以文件名为准', async () => {
        setDirectory(TAG_DIR)
        setFileContent(tagPath('人物'), '# 别的分类\n\n## 基础\n\n### 女性\nfemale\n')

        const [tag] = (await service.list()).tags

        expect(tag?.id).toBe('人物::基础::女性')
    })

    it('同组重名只保留第一条，分组计数不虚高', async () => {
        setDirectory(TAG_DIR)
        setFileContent(tagPath('人物'), '# 人物\n\n## 皮肤\n\n### 黑皮肤\ndark_skin\n\n### 黑皮肤\nblack_skin\n')

        const result = await service.list()

        expect(result.tags).toHaveLength(1)
        expect(result.tags[0]?.prompt).toBe('dark_skin')
        expect(result.objects[0]?.attributes).toEqual([{ name: '皮肤', count: 1 }])
    })

    it('预览图先按分类/分组/名称镜像命中', async () => {
        setDirectory(TAG_DIR)
        setDirectory(IMAGE_DIR)
        setDirectory(path.join(IMAGE_DIR, '人物'))
        setDirectory(path.join(IMAGE_DIR, '人物', '基础'))
        setFileContent(tagPath('人物'), '# 人物\n\n## 基础\n\n### 女性\nfemale\n')
        setFileContent(imagePath('人物', '基础', '女性.webp'), '')

        const [tag] = (await service.list()).tags

        expect(tag?.preview).toBe('人物/基础/女性.webp')
    })

    it('镜像缺失时回落 sha1 前 10 位', async () => {
        setDirectory(TAG_DIR)
        setDirectory(IMAGE_DIR)
        setFileContent(tagPath('人物'), '# 人物\n\n## 基础\n\n### 女性\nfemale\n')
        setFileContent(imagePath(`${hashName('人物', '基础', '女性')}.jpg`), '')

        const [tag] = (await service.list()).tags

        expect(tag?.preview).toBe(`${hashName('人物', '基础', '女性')}.jpg`)
    })
})

describe('新建词条', () => {
    it('分类文件不存在时创建，并按 md 格式落盘', async () => {
        const tag = await service.save({ object: '人物', attribute: '基础', name: '女性', prompt: 'female' })

        expect(tag.id).toBe('人物::基础::女性')
        expect(hasDirectory(TAG_DIR)).toBe(true)
        expect(readFileContent(tagPath('人物'))).toBe('# 人物\n\n## 基础\n\n### 女性\nfemale\n')
    })

    it('追加到已有分类，保留原有内容', async () => {
        setDirectory(TAG_DIR)
        setFileContent(tagPath('人物'), '# 人物\n\n## 基础\n\n### 女性\nfemale\n')

        await service.save({ object: '人物', attribute: '基础', name: '男性', prompt: 'male' })

        const text = readFileContent(tagPath('人物'))
        expect(text).toContain('### 女性\nfemale')
        expect(text).toContain('### 男性\nmale')
    })

    it('同组重名直接拒绝，不静默覆盖', async () => {
        setDirectory(TAG_DIR)
        setFileContent(tagPath('人物'), '# 人物\n\n## 基础\n\n### 女性\nfemale\n')

        await expect(
            service.save({ object: '人物', attribute: '基础', name: '女性', prompt: 'another' }),
        ).rejects.toThrow('同名词条已存在')
    })

    it('分类含路径分隔符或原文为空时拒绝', async () => {
        await expect(
            service.save({ object: '人物/基础', attribute: '基础', name: '女性', prompt: 'female' }),
        ).rejects.toThrow('分类名称非法')
        await expect(service.save({ object: '人物', attribute: '基础', name: '女性', prompt: '   ' })).rejects.toThrow(
            '提示词原文不能为空',
        )
    })
})

describe('改写词条', () => {
    it('改名后整块替换，旧词条不残留', async () => {
        setDirectory(TAG_DIR)
        setFileContent(tagPath('人物'), '# 人物\n\n## 基础\n\n### 女性\nfemale\n')

        const updated = await service.update({
            previousId: '人物::基础::女性',
            object: '人物',
            attribute: '基础',
            name: '少女',
            prompt: 'little_girl',
        })

        expect(updated.id).toBe('人物::基础::少女')
        const text = readFileContent(tagPath('人物'))
        expect(text).toContain('### 少女\nlittle_girl')
        expect(text).not.toContain('### 女性')
    })

    it('换分类时移动整块，源文件删空即移除', async () => {
        setDirectory(TAG_DIR)
        setFileContent(tagPath('人物'), '# 人物\n\n## 基础\n\n### 女性\nfemale\n')

        await service.update({
            previousId: '人物::基础::女性',
            object: '环境',
            attribute: '室内',
            name: '窗边人',
            prompt: 'female',
        })

        expect(readFileContent(tagPath('人物'))).toBeUndefined()
        expect(readFileContent(tagPath('环境'))).toContain('### 窗边人\nfemale')
    })

    it('目标标识已存在时拒绝，避免把两条合成一条', async () => {
        setDirectory(TAG_DIR)
        setFileContent(tagPath('人物'), '# 人物\n\n## 基础\n\n### 女性\nfemale\n\n### 男性\nmale\n')

        await expect(
            service.update({
                previousId: '人物::基础::女性',
                object: '人物',
                attribute: '基础',
                name: '男性',
                prompt: 'female',
            }),
        ).rejects.toThrow('同名词条已存在')
    })
})

describe('删除词条', () => {
    it('删除最后一条时分类文件一并移除', async () => {
        setDirectory(TAG_DIR)
        setFileContent(tagPath('人物'), '# 人物\n\n## 基础\n\n### 女性\nfemale\n')

        const result = await service.remove({ id: '人物::基础::女性' })

        expect(result.tags).toEqual([])
        expect(readFileContent(tagPath('人物'))).toBeUndefined()
    })

    it('标识不存在时拒绝', async () => {
        setDirectory(TAG_DIR)

        await expect(service.remove({ id: '人物::基础::女性' })).rejects.toThrow('词条不存在')
    })
})

describe('出图取文', () => {
    it('按标识顺序回传原文，非法与缺失的标识跳过', async () => {
        setDirectory(TAG_DIR)
        setFileContent(tagPath('人物'), '# 人物\n\n## 基础\n\n### 女性\n(female:1.3)\n\n### 男性\nmale\n')

        const prompts = await service.readForPrompt(['人物::基础::女性', '人物::缺失', 'bad-id', '人物::基础::男性'])

        expect(prompts).toEqual(['(female:1.3)', 'male'])
    })
})
