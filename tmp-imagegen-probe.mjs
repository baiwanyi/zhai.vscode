import { tmpdir } from 'node:os'
import { query } from '@tencent-ai/agent-sdk'

const started = Date.now()
const session = query({
    prompt: '画一只猫',
    options: { maxTurns: 1, cwd: tmpdir(), includePartialMessages: false },
})
let count = 0
try {
    for await (const message of session) {
        count += 1
        if (message.type === 'system') {
            console.log('SYSTEM', message.subtype, 'tools=', JSON.stringify(message.tools))
            continue
        }
        console.log(message.type, message.subtype ?? '', Date.now() - started)
        if (count > 20) break
    }
} catch (error) {
    console.error('ERR', error?.name, String(error?.message).slice(0, 300))
}
