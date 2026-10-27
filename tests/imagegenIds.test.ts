/**
 * 生图标识与路径归属的单测：覆盖当前命名的解析、历史命名的拒绝，以及图片路径的归属校验。
 * 关注点：只认 portrait-{时间戳}-{角色标识} 与 photo-{时间戳}-{随机段}，
 * 旧角色图与旧封面命名一律归为孤儿图；路径校验只接受 press/{作品名}/Images/{文件名}。
 */
import { describe, expect, it } from 'vitest'
import {
    formatPhotoId,
    formatPortraitId,
    isImageRatio,
    isPressImageId,
    parseImageCharacterId,
    parseImageKind,
} from '@shared/types/imagegen'
import { isProjectImagePath } from '../src/modules/imagegen/db/coverRepository'

describe('图片标识解析', () => {
    it('角色图：时间戳在前、角色标识在后', () => {
        const id = 'portrait-20261025143000-10428736'
        expect(isPressImageId(id)).toBe(true)
        expect(parseImageKind(id)).toBe('portrait')
        expect(parseImageCharacterId(id)).toBe('10428736')
    })

    it('普通图片不带角色归属', () => {
        const id = 'photo-20261025143000-Ab3dK9xQ'
        expect(isPressImageId(id)).toBe(true)
        expect(parseImageKind(id)).toBe('photo')
        expect(parseImageCharacterId(id)).toBeNull()
    })

    it('历史命名一律归为孤儿图', () => {
        const samples = ['portrait-10428736-20261025143000', 'cover-20261025143000']
        for (const sample of samples) {
            expect(isPressImageId(sample)).toBe(false)
            expect(parseImageKind(sample)).toBe('orphan')
            expect(parseImageCharacterId(sample)).toBeNull()
        }
    })

    it('非法标识返回 orphan', () => {
        const samples = ['', 'my-image', 'portrait-20261025143000', 'photo-2026-Ab3dK9xQ', 'cover-2026']
        for (const sample of samples) {
            expect(isPressImageId(sample)).toBe(false)
            expect(parseImageKind(sample)).toBe('orphan')
            expect(parseImageCharacterId(sample)).toBeNull()
        }
    })

    it('格式化后的标识可以被解析回来', () => {
        const portraitId = formatPortraitId('20261025143000', '10428736')
        expect(parseImageCharacterId(portraitId)).toBe('10428736')
        expect(parseImageKind(portraitId)).toBe('portrait')
        const photoId = formatPhotoId('20261025143000', 'Ab3dK9xQ')
        expect(isPressImageId(photoId)).toBe(true)
        expect(parseImageKind(photoId)).toBe('photo')
    })
})

describe('比例白名单', () => {
    it('接受五种预设比例', () => {
        for (const ratio of ['1:1', '3:4', '4:3', '16:9', '9:16']) {
            expect(isImageRatio(ratio)).toBe(true)
        }
    })

    it('拒绝白名单外的值', () => {
        for (const ratio of ['2:3', '3:4 ', '', 43, null]) {
            expect(isImageRatio(ratio)).toBe(false)
        }
    })
})

describe('图片路径归属', () => {
    it('接受统一目录下的图片', () => {
        expect(isProjectImagePath('press/demo', 'press/demo/Images/photo-20261025143000-Ab3dK9xQ.png')).toBe(true)
    })

    it('接受目录内非标准命名的孤儿图', () => {
        expect(isProjectImagePath('press/demo', 'press/demo/Images/manual-shot.png')).toBe(true)
    })

    it('拒绝历史目录、跨作品与段数异常', () => {
        expect(isProjectImagePath('press/demo', 'press/demo/Cover/cover-20261025143000.png')).toBe(false)
        expect(isProjectImagePath('press/demo', 'press/demo/Portraits/portrait-20261025143000-10428736.png')).toBe(
            false,
        )
        expect(isProjectImagePath('press/demo', 'press/other/Images/photo-20261025143000-Ab3dK9xQ.png')).toBe(false)
        expect(isProjectImagePath('press/demo', 'press/demo/Chapters/photo-20261025143000-Ab3dK9xQ.png')).toBe(false)
        expect(isProjectImagePath('press/demo', 'press/demo/Images/nested/photo-20261025143000-Ab3dK9xQ.png')).toBe(
            false,
        )
        expect(isProjectImagePath('press/demo', 'press/demo/Images')).toBe(false)
    })
})
