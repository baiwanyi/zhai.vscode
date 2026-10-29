/**
 * 出图产物的结构化解析测试：验证 SDK 结构化输出（outputFormat）的形状收窄与回落边界。
 * 复用约定：只测纯函数，不发请求、不读配置、不落盘；真实产物的取图与回落链路由用户在扩展宿主中核对。
 * 关键约束：非对象、缺字段与空串都必须返回 null —— 返回空串会让后续候选解析误判成「已取到路径」。
 */
import { describe, expect, it } from 'vitest'
import { readStructuredPath } from '../../src/modules/imagegen/ai/codebuddyImageProvider'

describe('readStructuredPath', () => {
    it('取到合法路径并裁掉首尾空白', () => {
        expect(readStructuredPath({ path: '  D:/images/a.png  ' })).toBe('D:/images/a.png')
    })

    it('空串与纯空白视为没取到，交给后续候选回落', () => {
        expect(readStructuredPath({ path: '' })).toBeNull()
        expect(readStructuredPath({ path: '   ' })).toBeNull()
    })

    it('非对象、缺字段或类型不符时返回 null', () => {
        expect(readStructuredPath(null)).toBeNull()
        expect(readStructuredPath(undefined)).toBeNull()
        expect(readStructuredPath('D:/images/a.png')).toBeNull()
        expect(readStructuredPath({})).toBeNull()
        expect(readStructuredPath({ path: 123 })).toBeNull()
    })
})
