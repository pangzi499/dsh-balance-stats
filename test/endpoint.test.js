import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, __testing } from '../src/index.js'

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

test('all-session totals reconcile with session views and Beijing windows', async (t) => {
  const now = Date.parse('2026-09-07T00:01:00+08:00')
  t.mock.method(Date, 'now', () => now)
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, async json() {
    return { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '15' }] }
  } }))
  const config = { prices: { a: { cacheHit: 0.123, cacheMiss: 1.234, output: 2.345 } },
    defaultPrices: { cacheHit: 0.1, cacheMiss: 1, output: 2 } }
  const logs = Array.from({ length: 12 }, (_, i) => [
    { type: 'request/context', time: now, data: { model: 'a' } },
    ...[now - 86400000, now].map((time, j) => ({ type: 'assistant/message', time,
      data: { turn: 1, step: 1, usage: { inputTokens: 123 + i + j, outputTokens: 321 + i } } })),
  ])
  const folder = __testing.makeSessionFolder(config)
  const views = logs.map(events => folder.view(events.reduce(folder.apply, folder.init())))
  let route
  let projection
  apply({
    effect() {}, logger: { warn() {} },
    get(key) { return key === 'sessionQuery' ? {
      async listSessions() { return logs.map((_, i) => ({ header: { id: String(i) } })) },
      async readSession(id) {
        await new Promise(resolve => setTimeout(resolve, (12 - Number(id)) % 4))
        return { events: logs[Number(id)] }
      },
    } : undefined },
    inject(deps, callback) {
      if (deps.includes('webServer')) callback({ effect(fn) { fn() }, webServer: { register(value) { route = value } } })
      if (deps.includes('sessionProjections')) callback({ sessionProjections: { register(value) { projection = value } } })
    },
  }, { ...config, apiKey: 'test-key' })
  const projected = projection.view(logs[0].reduce(projection.apply, projection.init()))
  assert.equal(projection.stateVersion, 3)
  assert.equal(projected.cost, views[0].cost)
  let payload
  await route.handler({ method: 'GET', url: '/balance-stats?force=1&s=0' }, {
    writeHead() {}, end(body) { payload = JSON.parse(body) },
  })
  const round = n => Math.round(n * 1e6) / 1e6
  const sum = values => round(values.reduce((a, b) => a + b, 0))
  const stats = payload.stats
  assert.equal(stats.sessions, logs.length)
  assert.equal(stats.totalCost, sum(views.map(v => v.cost)))
  assert.equal(stats.totalCost, sum(Object.values(stats.costByModel)))
  assert.equal(stats.totalCost, sum(Object.values(stats.costByDay)))
  assert.equal(stats.today, stats.totalCost)
  assert.equal(stats.day7, stats.totalCost)
  assert.equal(stats.day30, stats.totalCost)
  assert.equal(payload.currentSession.cost, projected.cost)
  for (const key of Object.keys(stats.tokens)) {
    assert.equal(stats.tokens[key], views.reduce((sum, v) => sum + v.tokens[key], 0))
  }
})

test('session-only read skips balance network and all-session enumeration', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('balance refresh must not run') })
  let route
  const reads = []
  apply({
    effect() {}, logger: { warn() {} },
    get(key) { return key === 'sessionQuery' ? {
      async listSessions() { assert.fail('switch must not scan all sessions') },
      async readSession(id) {
        reads.push(id)
        return { events: [
          { type: 'request/context', time: 1, data: { model: 'deepseek-chat' } },
          { type: 'assistant/message', time: 2,
            data: { turn: 1, step: 1, usage: { inputTokens: 1_000_000 } } },
        ] }
      },
    } : undefined },
    inject(deps, callback) {
      if (deps.includes('webServer')) callback({ effect(fn) { fn() }, webServer: { register(value) { route = value } } })
    },
  }, { apiKey: 'test-key' })
  let payload
  await route.handler({ method: 'GET', url: '/balance-stats?s=workspace-B-session' }, {
    writeHead() {}, end(body) { payload = JSON.parse(body) },
  })
  assert.deepEqual(reads, ['workspace-B-session'])
  assert.equal(payload.currentSession.cost, 1)
})
