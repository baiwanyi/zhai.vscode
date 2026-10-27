/**
 * 图片命名单元测试：覆盖三类标识格式与「同名顺延不覆盖」。
 * 虚拟磁盘由 vscode 测试桩承接，预置文件即可构造冲突；断言只取标识本身，不依赖真实时间戳。
 */
import * as path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import * as vscode from 'vscode'
import { resetWorkspaceState, setFileContent } from './stubs/vscode'
import { nextImageId } from '../../src/modules/imagegen/imageNaming'

const IMAGE_DIR = path.join('d:', 'vault', 'press', '剑来', 'Images')

/** 本地时间戳：与实现同口径，仅用于构造已占用的文件名 */
function stampOf(date: Date): string {
    const pad = (value: number): string => String(value).padStart(2, '0')
    return [
        String(date.getFullYear()),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds()),
    ].join('')
}

beforeEach(() => {
    resetWorkspaceState()
})

describe('nextImageId', () => {
    it('普通图命名为 photo-{14 位时间戳}-{8 位随机串}', async () => {
        const id = await nextImageId(vscode.Uri.file(IMAGE_DIR), 'photo', null, 'png')

        expect(id).toMatch(/^photo-\d{14}-[A-Za-z0-9]{8}$/u)
    })

    it('角色图命名为 portrait-{14 位时间戳}-{角色标识}', async () => {
        const id = await nextImageId(vscode.Uri.file(IMAGE_DIR), 'portrait', '12345678', 'png')

        expect(id).toMatch(/^portrait-\d{14}-12345678$/u)
    })

    it('同秒已有同名文件时顺延时间戳，不返回已占用的标识', async () => {
        const now = Date.now()
        // 覆盖执行瞬间可能落到的秒：前后各留一格，避免测试跨秒导致偶发失败
        const reserved = [-1, 0, 1, 2].map((offset) => `portrait-${stampOf(new Date(now + offset * 1000))}-12345678`)
        for (const id of reserved) {
            setFileContent(path.join(IMAGE_DIR, `${id}.png`), 'old')
        }

        const id = await nextImageId(vscode.Uri.file(IMAGE_DIR), 'portrait', '12345678', 'png')

        expect(reserved).not.toContain(id)
        expect(id).toMatch(/^portrait-\d{14}-12345678$/u)
    })

    it('不同扩展名互不冲突', async () => {
        const id = await nextImageId(vscode.Uri.file(IMAGE_DIR), 'photo', null, 'png')
        setFileContent(path.join(IMAGE_DIR, `${id}.png`), 'old')

        const next = await nextImageId(vscode.Uri.file(IMAGE_DIR), 'photo', null, 'webp')

        expect(next).toMatch(/^photo-\d{14}-[A-Za-z0-9]{8}$/u)
    })
})
