import assert from 'node:assert/strict'
import test from 'node:test'

import { apply } from '../src/index.js'

test('forced refresh returns one fresh balance and cost snapshot', async () => {
  const originalFetch = globalThis.fetch
  let route = null
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        is_available: true,
        balance_infos: [{
          currency: 'CNY', total_balance: '15', topped_up_balance: '10', granted_balance: '5',
        }],
      }
    },
  })
  const events = [
    { type: 'request/context', time: 1, data: { model: 'deepseek-chat' } },
    {
      type: 'assistant/message', time: 2,
      data: { turn: 1, step: 1, usage: { inputTokens: 1_000_000, outputTokens: 2_000_000 } },
    },
  ]
  const sessionQuery = {
    async listSessions() { return [{ id: 'session-1' }] },
    async readSession() { return { events } },
  }
  const webCtx = {
    effect(fn) { return fn() },
    webServer: {
      register(value) {
        route = value
        return () => {}
      },
    },
  }
  const ctx = {
    effect() {},
    get(key) { return key === 'sessionQuery' ? sessionQuery : undefined },
    inject(deps, callback) {
      if (deps.includes('webServer')) callback(webCtx)
    },
    logger: { warn() {} },
  }

  try {
    apply(ctx, { apiKey: 'test-key' })
    assert.notEqual(route, null)
    let body = ''
    const res = {
      writeHead() {},
      end(value) { body = value?.toString() ?? '' },
    }
    await route.handler({ method: 'GET', url: '/balance-stats?force=1' }, res)
    const payload = JSON.parse(body)

    assert.equal(payload.balances[0].total, 15)
    assert.equal(payload.stats.totalCost, 5)
    assert.equal(payload.stats.percent, 25)
    assert.deepEqual(payload.stats.costByModel, { 'deepseek-chat': 5 })
  } finally {
    globalThis.fetch = originalFetch
  }
})
