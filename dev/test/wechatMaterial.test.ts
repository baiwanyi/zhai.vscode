/**
 * 公众号图片定位的单元测试：覆盖外链判定、相对路径基准与越界拦截。
 * 纯函数测试，不读盘、不联网；上传流程依赖微信接口与真实文件，留待接入推送链路时人工验证。
 * 断言用 path.join 构造期望值，避免 Windows 与 POSIX 的分隔符差异让结论随平台漂移。
 */
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { locateWechatImage } from '../../src/modules/wechat/materialService'

/** 存储根：取一个固定的绝对路径作为基准 */
const ROOT = path.resolve('/tmp/zhai-root')

describe('locateWechatImage', () => {
    it('外链与协议相对地址都判为 external', () => {
        expect(locateWechatImage('https://example.com/a.png', null, ROOT)).toEqual({ kind: 'external' })
        expect(locateWechatImage('//cdn.example.com/a.png', null, ROOT)).toEqual({ kind: 'external' })
        expect(locateWechatImage('HTTP://example.com/a.png', null, ROOT)).toEqual({ kind: 'external' })
    })

    it('以斜杠开头按存储根相对路径解析', () => {
        const located = locateWechatImage('/images/a.png', null, ROOT)
        expect(located).toEqual({ kind: 'local', filePath: path.join(ROOT, 'images/a.png') })
    })

    it('普通相对路径以源文档目录为基准', () => {
        const located = locateWechatImage('images/a.png', 'notes/202610/note.md', ROOT)
        expect(located).toEqual({
            kind: 'local',
            filePath: path.join(ROOT, 'notes/202610/images/a.png'),
        })
    })

    it('没有源文档（手写稿）时相对存储根解析', () => {
        const located = locateWechatImage('images/a.png', null, ROOT)
        expect(located).toEqual({ kind: 'local', filePath: path.join(ROOT, 'images/a.png') })
    })

    it('去掉查询串并解码百分号转义', () => {
        const located = locateWechatImage('images/%E5%B0%81%E9%9D%A2.png?raw=1#x', null, ROOT)
        expect(located).toEqual({ kind: 'local', filePath: path.join(ROOT, 'images/封面.png') })
    })

    it('越出存储根的相对路径一律拒绝', () => {
        const located = locateWechatImage('../../etc/passwd', 'notes/note.md', ROOT)
        expect(located.kind).toBe('invalid')
    })

    it('空地址与 data URI 判为不可用', () => {
        expect(locateWechatImage('   ', null, ROOT).kind).toBe('invalid')
        expect(locateWechatImage('data:image/png;base64,AAA', null, ROOT).kind).toBe('invalid')
    })
})
