/**
 * 生图参数服务单元测试：覆盖默认值回落、只存与默认不同的键、null 取消覆盖、
 * 非法值不写入以及文件损坏时的兜底。
 * 参数文件落在虚拟磁盘 press/{作品名}/.zhai/image.json，需用 vscode 测试桩承接读写。
 */
import * as path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_IMAGE_SETTINGS } from '@shared/types/imagegen'
import { readFileContent, resetWorkspaceState, setConfigValue, setDirectory, setFileContent } from './stubs/vscode'
import { ImageSettingsService } from '../../src/modules/imagegen/imageSettingsService'

const STORAGE_ROOT = 'd:/vault'
const DIR_PATH = 'press/剑来'
const SETTINGS_DIR = path.join(STORAGE_ROOT, 'press', '剑来', '.zhai')
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'image.json')

let service: ImageSettingsService

beforeEach(() => {
    resetWorkspaceState()
    setConfigValue('storage.rootPath', STORAGE_ROOT)
    setDirectory(path.join(STORAGE_ROOT, 'press', '剑来'))
    service = new ImageSettingsService()
})

describe('get', () => {
    it('没有参数文件时返回默认值且无覆盖项', async () => {
        const result = await service.get({ dirPath: DIR_PATH })

        expect(result.settings).toEqual(DEFAULT_IMAGE_SETTINGS)
        expect(result.overrides).toEqual([])
    })

    it('参数文件损坏时回落默认值', async () => {
        setFileContent(SETTINGS_FILE, '{不是 JSON')

        const result = await service.get({ dirPath: DIR_PATH })

        expect(result.settings).toEqual(DEFAULT_IMAGE_SETTINGS)
        expect(result.overrides).toEqual([])
    })
})

describe('save', () => {
    it('只写入与默认不同的键，并回传最新状态', async () => {
        const result = await service.save({ dirPath: DIR_PATH, settings: { defaultRatio: '3:4', negative: '低模' } })

        expect(result.overrides).toEqual(['defaultRatio', 'negative'])
        expect(result.settings.defaultRatio).toBe('3:4')
        expect(result.settings.negative).toBe('低模')
        expect(readFileContent(SETTINGS_FILE)).toBe('{\n    "defaultRatio": "3:4",\n    "negative": "低模"\n}')
    })

    it('值为 null 时取消覆盖，回落默认', async () => {
        await service.save({ dirPath: DIR_PATH, settings: { defaultRatio: '3:4' } })

        const result = await service.save({ dirPath: DIR_PATH, settings: { defaultRatio: null } })

        expect(result.overrides).toEqual([])
        expect(result.settings.defaultRatio).toBe(DEFAULT_IMAGE_SETTINGS.defaultRatio)
    })

    it('非法值不写入，回传的是保存后的真实状态', async () => {
        const result = await service.save({
            dirPath: DIR_PATH,
            settings: { defaultRatio: '5:5', portraitStyle: '不存在的画风' },
        })

        expect(result.overrides).toEqual([])
        expect(result.settings).toEqual(DEFAULT_IMAGE_SETTINGS)
    })

    it('缺少 settings 字段时拒绝', async () => {
        await expect(service.save({ dirPath: DIR_PATH })).rejects.toThrow('缺少参数')
    })

    it('文本项超长时截断到上限', async () => {
        const result = await service.save({ dirPath: DIR_PATH, settings: { promptSuffix: '描'.repeat(260) } })

        expect(result.settings.promptSuffix).toHaveLength(200)
    })
})
