/**
 * 图片侧车单元测试：覆盖侧车路径推导、随图删除（含缺失静默）与随图迁移（含目标占用不覆盖）。
 * 虚拟磁盘由 vscode 测试桩承接，断言取删除记录与文件内容，不依赖真实磁盘。
 */
import * as path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import * as vscode from 'vscode'
import { readDeletedPaths, readFileContent, resetWorkspaceState, setDirectory, setFileContent } from './stubs/vscode'
import { deleteSidecarOf, moveSidecarOf, toSidecarUri, writeSidecarOf } from '../src/modules/imagegen/imageSidecar'

const IMAGE_DIR = path.join('d:', 'vault', 'press', '剑来', 'Images')
const IMAGE_NAME = 'photo-20260101010101-AbCd1234.png'

/** 图片绝对路径 */
function imageFsPath(fileName = IMAGE_NAME): string {
    return path.join(IMAGE_DIR, fileName)
}

beforeEach(() => {
    resetWorkspaceState()
    setDirectory(IMAGE_DIR)
    setFileContent(imageFsPath(), 'binary')
})

describe('toSidecarUri', () => {
    it('把图片扩展名替换为 .json，目录不变', () => {
        const sidecar = toSidecarUri(vscode.Uri.file(imageFsPath()))

        expect(sidecar.path).toBe(`${IMAGE_DIR.replaceAll('\\', '/')}/photo-20260101010101-AbCd1234.json`)
    })
})

describe('deleteSidecarOf', () => {
    it('侧车存在时删除，图片本身不动', async () => {
        setFileContent(imageFsPath('photo-20260101010101-AbCd1234.json'), '{"prompt":"雪夜"}')

        await deleteSidecarOf(vscode.Uri.file(imageFsPath()))

        expect(readDeletedPaths()).toEqual([imageFsPath('photo-20260101010101-AbCd1234.json')])
        expect(readFileContent(imageFsPath())).toBe('binary')
    })

    it('侧车不存在时静默跳过，不抛错也不产生删除', async () => {
        await expect(deleteSidecarOf(vscode.Uri.file(imageFsPath()))).resolves.toBeUndefined()

        expect(readDeletedPaths()).toEqual([])
    })
})

describe('writeSidecarOf', () => {
    it('写入同名 .json，字段与传入一致', async () => {
        const meta = {
            prompt: '雪夜',
            ratio: '768x1024',
            style: 'auto',
            characterId: '12345678',
            enhancedFrom: null,
            createdAt: '2026-10-25T00:00:00.000Z',
        }

        await writeSidecarOf(vscode.Uri.file(IMAGE_DIR), 'photo-20260101010101-AbCd1234', meta)

        expect(readFileContent(imageFsPath('photo-20260101010101-AbCd1234.json'))).toBe(JSON.stringify(meta))
    })
})

describe('moveSidecarOf', () => {
    it('侧车随图搬到新目录', async () => {
        const targetDir = path.join('d:', 'vault', 'press', '剑来', 'Images2')
        setDirectory(targetDir)
        setFileContent(imageFsPath('photo-20260101010101-AbCd1234.json'), '{"prompt":"雪夜"}')

        await moveSidecarOf(vscode.Uri.file(imageFsPath()), vscode.Uri.file(path.join(targetDir, IMAGE_NAME)))

        expect(readFileContent(path.join(targetDir, 'photo-20260101010101-AbCd1234.json'))).toBe('{"prompt":"雪夜"}')
        expect(readFileContent(imageFsPath('photo-20260101010101-AbCd1234.json'))).toBeUndefined()
    })

    it('目标已有同名侧车时不覆盖，源侧车保留', async () => {
        const targetDir = path.join('d:', 'vault', 'press', '剑来', 'Images2')
        setDirectory(targetDir)
        setFileContent(imageFsPath('photo-20260101010101-AbCd1234.json'), '旧')
        const targetSidecar = path.join(targetDir, 'photo-20260101010101-AbCd1234.json')
        setFileContent(targetSidecar, '新')

        await moveSidecarOf(vscode.Uri.file(imageFsPath()), vscode.Uri.file(path.join(targetDir, IMAGE_NAME)))

        expect(readFileContent(targetSidecar)).toBe('新')
        expect(readFileContent(imageFsPath('photo-20260101010101-AbCd1234.json'))).toBe('旧')
    })

    it('源侧车不存在时不做任何事', async () => {
        const targetDir = path.join('d:', 'vault', 'press', '剑来', 'Images2')
        setDirectory(targetDir)

        await expect(
            moveSidecarOf(vscode.Uri.file(imageFsPath()), vscode.Uri.file(path.join(targetDir, IMAGE_NAME))),
        ).resolves.toBeUndefined()

        expect(readFileContent(path.join(targetDir, 'photo-20260101010101-AbCd1234.json'))).toBeUndefined()
    })
})
