import assert from 'node:assert/strict'
import test from 'node:test'

import { __testing } from '../src/index.js'

const config = {
  prices: {
    'deepseek-chat': { cacheHit: 0.1, cacheMiss: 1, output: 2 },
  },
  defaultPrices: { cacheHit: 0.1, cacheMiss: 1, output: 2 },
}

const message = (time, usage, turn = 1, step = 1) => ({
  type: 'assistant/message', time: typeof time === 'string' ? Date.parse(time) : time,
  data: { turn, step, usage: { inputTokens: 0, outputTokens: 0, ...usage } },
})
const context = (model, time) => ({ type: 'request/context', time, data: { model } })
const fold = (events, cfg = config) => {
  const folder = __testing.makeSessionFolder(cfg)
  return folder.view(events.reduce((state, event) => folder.apply(state, event), folder.init()))
}

test('replacement moves the whole cost to its new Beijing day', () => {
  const view = fold([
    message('2026-09-06T23:59:00+08:00', { inputTokens: 1e6 }),
    message('2026-09-07T00:01:00+08:00', { inputTokens: 2e6 }),
  ])
  assert.equal(view.cost, 2)
  assert.equal(view.costByDay['2026-09-06'] ?? 0, 0)
  assert.equal(view.costByDay['2026-09-07'], 2)
})

test('identical tokens still replace the event-time price and date', () => {
  const view = fold([
    context('deepseek-v4-flash'),
    message('2026-09-06T10:00:00+08:00', { outputTokens: 1e6 }),
    message('2026-09-07T22:00:00+08:00', { outputTokens: 1e6 }),
  ])
  assert.equal(view.cost, 4.5)
  assert.equal(view.costByModel['deepseek-v4-flash'], 4.5)
  assert.equal(view.costByDay['2026-09-06'] ?? 0, 0)
  assert.equal(view.costByDay['2026-09-07'], 4.5)
})

test('sub-micro costs accumulate before rounding', () => {
  const view = fold([context('deepseek-v4-flash'), ...Array.from({ length: 100 }, (_, i) =>
    message('2026-08-16T22:00:00+08:00', { outputTokens: 1 }, i))])
  assert.equal(view.cost, 0.00002)
  assert.equal(view.costByModel['deepseek-v4-flash'], view.cost)
})

test('peak and off-peak history stays at 13.5 across wall clocks', (t) => {
  const events = [context('deepseek-v4-flash'),
    message('2026-09-06T10:00:00+08:00', { outputTokens: 1e6 }),
    message('2026-09-06T22:00:00+08:00', { outputTokens: 1e6 }, 2)]
  t.mock.method(Date, 'now', () => Date.parse('2026-09-07T10:00:00+08:00'))
  const first = fold(events)
  Date.now.mock.mockImplementation(() => Date.parse('2027-01-01T22:00:00+08:00'))
  assert.deepEqual(fold(events), first)
  assert.equal(first.cost, 13.5)
  assert.equal(first.costByModel['deepseek-v4-flash'], 13.5)
})

for (const [time, peak] of [
  ['08:59:59', false], ['09:00:00', true], ['11:59:59', true], ['12:00:00', false],
  ['13:59:59', false], ['14:00:00', true], ['17:59:59', true], ['18:00:00', false],
]) {
  test(`Beijing peak boundary ${time}`, () => {
    for (const [model, rate] of [['deepseek-v4-flash', 9], ['deepseek-v4-pro', 27]]) {
      assert.equal(fold([context(model), message(`2026-09-06T${time}+08:00`, { outputTokens: 1e6 })]).cost,
        peak ? rate : rate / 2)
    }
  })
}

test('cutoff is exactly midnight Beijing on August 17', () => {
  for (const [time, expected] of [['2026-08-16T23:59:59+08:00', 0.2], ['2026-08-17T00:00:00+08:00', 4.5]]) {
    assert.equal(fold([context('deepseek-v4-flash'), message(time, { outputTokens: 1e6 })]).cost, expected)
  }
})

test('chunk is replaced by message across intervening non-usage events', () => {
  const chunk = message(1, { inputTokens: 500000 })
  chunk.type = 'assistant/chunk'
  chunk.data = { turn: 1, step: 1, chunk: { type: 'usage', usage: chunk.data.usage } }
  const view = fold([chunk, { type: 'tool/result', time: 2, data: {} }, message(3, { inputTokens: 1e6 })])
  assert.equal(view.cost, 1)
  assert.equal(view.tokens.uncachedInput, 1e6)
})

test('explicit retry boundary retains prior attempt usage', () => {
  const view = fold([context('deepseek-chat'), message(1, { inputTokens: 1e6 }),
    { type: 'llm/retry-started', time: 2, data: { turn: 1, step: 1 } },
    message(3, { inputTokens: 2e6 }), message(4, { inputTokens: 3e6 })])
  assert.equal(view.cost, 4)
  assert.equal(view.tokens.uncachedInput, 4e6)
})

test('header/context switching and message source attribution', () => {
  const sourced = message(4, { inputTokens: 2e6 }, 2)
  sourced.data.message = { source: { model: 'deepseek-chat' } }
  const view = fold([
    { type: 'request/header', time: 0, data: { header: { config: { model: 'deepseek-chat' } } } },
    message(1, { inputTokens: 1e6 }), context('deepseek-reasoner', 2),
    message(3, { inputTokens: 1e6 }, 2), sourced,
  ], { ...config, prices: { ...config.prices, 'deepseek-reasoner': { cacheHit: 1, cacheMiss: 4, output: 16 } } })
  assert.deepEqual(view.costByModel, { 'deepseek-chat': 3 })
  assert.equal(view.tokens.uncachedInput, 3e6)
})

test('missing and invalid times replay deterministically using persisted context', (t) => {
  t.mock.method(Date, 'now', () => 1)
  const events = [context('deepseek-v4-flash', Date.parse('2026-09-06T10:00:00+08:00')),
    ...[undefined, null, NaN, Infinity, 'invalid', 9e15].map((time, i) => message(time, { outputTokens: 1e6 }, i))]
  const first = fold(events)
  Date.now.mock.mockImplementation(() => Date.parse('2027-01-01T22:00:00+08:00'))
  assert.deepEqual(fold(events), first)
  assert.equal(first.cost, 54)
  assert.equal(first.costByDay['2026-09-06'], 54)
  const unknown = fold([context('deepseek-v4-flash'), message(undefined, { outputTokens: 1e6 })])
  assert.equal(unknown.cost, 0.2)
  assert.deepEqual(unknown.costByDay, { unknown: 0.2 })
  assert.equal(__testing.sumLastDays(unknown.costByDay, 30), 0)
  assert.equal(fold([message(0, { inputTokens: 1e6 })]).costByDay['1970-01-01'], 1)
})

test('malformed usage is isolated and numeric strings remain compatible', () => {
  const events = [null, {}, ...[null, undefined, 'bad', [], 42].map(usage => ({ type: 'assistant/message', data: { usage } }))]
  for (const [i, value] of [undefined, null, NaN, Infinity, -1, 'bad', {}, true, 0.5, Number.MAX_VALUE].entries()) {
    events.push(message(1, { inputTokens: value, cacheReadTokens: value, cacheWriteTokens: value, outputTokens: value }, i))
  }
  events.push(message(1, { inputTokens: '1000000', cacheReadTokens: '1000000', cacheWriteTokens: '1000000', outputTokens: '1000000' }, 20))
  const view = fold(events)
  assert.equal(view.cost, 4.1)
  assert.deepEqual(view.tokens, { uncachedInput: 1e6, cacheRead: 1e6, cacheWrite: 1e6, output: 1e6 })
})

test('Today/7d/30d use Beijing days including today, across host DST', () => {
  const now = Date.parse('2026-11-02T00:30:00+08:00')
  const days = { '2026-11-02': 1, '2026-11-01': 2, '2026-10-27': 4,
    '2026-10-26': 8, '2026-10-04': 16, '2026-10-03': 32, '2026-11-03': 64, unknown: 128 }
  assert.equal(__testing.sumLastDays(days, 1, now), 1)
  assert.equal(__testing.sumLastDays(days, 7, now), 7)
  assert.equal(__testing.sumLastDays(days, 30, now), 31)
})

test('many tiny model groups reconcile without negative costs', () => {
  const view = fold(Array.from({ length: 100 }, (_, i) => [context(`model-${i}`),
    message(1, { inputTokens: 1 }, i)]).flat(), { prices: {}, defaultPrices: { cacheHit: 0, cacheMiss: 0.6, output: 0 } })
  assert.equal(view.cost, 0.00006)
  assert.ok(Object.values(view.costByModel).every(x => x >= 0))
  assert.equal(Math.round(Object.values(view.costByModel).reduce((a, b) => a + b, 0) * 1e6) / 1e6, view.cost)
})

test('session folder replaces repeated usage for the same turn and step', () => {
  const folder = __testing.makeSessionFolder(config)
  let state = folder.init()
  state = folder.apply(state, { type: 'request/context', data: { model: 'deepseek-chat' }, time: 1 })
  state = folder.apply(state, {
    type: 'assistant/message', time: 2,
    data: { turn: 1, step: 1, usage: { inputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 } },
  })
  state = folder.apply(state, {
    type: 'assistant/message', time: 3,
    data: { turn: 1, step: 1, usage: { inputTokens: 2_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 500_000 } },
  })

  const view = folder.view(state)
  assert.equal(view.cost, 3)
  assert.deepEqual(view.tokens, { uncachedInput: 2_000_000, cacheRead: 0, cacheWrite: 0, output: 500_000 })
  assert.equal(view.costByModel['deepseek-chat'], 3)
})

test('session folder applies cache hit, cache write and output prices', () => {
  const folder = __testing.makeSessionFolder(config)
  let state = folder.init()
  state = folder.apply(state, { type: 'request/header', data: { header: { config: { model: 'deepseek-chat' } } }, time: 1 })
  state = folder.apply(state, {
    type: 'assistant/chunk', time: 2,
    data: { turn: 2, step: 1, chunk: { type: 'usage', usage: {
      inputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
      outputTokens: 1_000_000,
    } } },
  })

  assert.equal(folder.view(state).cost, 4.1)
})

test('historical per-model costs keep their event-time price', () => {
  const folder = __testing.makeSessionFolder(config)
  let state = folder.init()
  state = folder.apply(state, {
    type: 'request/context',
    data: { model: 'deepseek-v4-flash' },
    time: Date.parse('2026-08-16T20:00:00+08:00'),
  })
  state = folder.apply(state, {
    type: 'assistant/message',
    time: Date.parse('2026-08-16T20:00:01+08:00'),
    data: { turn: 1, step: 1, usage: { inputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 } },
  })

  const view = folder.view(state)
  assert.equal(view.cost, 0.1)
  assert.equal(Object.values(view.costByModel).reduce((sum, cost) => sum + cost, 0), view.cost)
})

test('session folder replaces per-model costs when a usage sample changes model', () => {
  const folder = __testing.makeSessionFolder({
    prices: {
      'model-a': { cacheHit: 0.1, cacheMiss: 1, output: 2 },
      'model-b': { cacheHit: 0.1, cacheMiss: 4, output: 2 },
    },
    defaultPrices: config.defaultPrices,
  })
  let state = folder.init()
  state = folder.apply(state, { type: 'request/context', data: { model: 'model-a' }, time: 1 })
  state = folder.apply(state, {
    type: 'assistant/message', time: 2,
    data: { turn: 1, step: 1, usage: { inputTokens: 1_000_000, outputTokens: 0 } },
  })
  state = folder.apply(state, { type: 'request/context', data: { model: 'model-b' }, time: 3 })
  state = folder.apply(state, {
    type: 'assistant/message', time: 4,
    data: { turn: 1, step: 1, usage: { inputTokens: 1_000_000, outputTokens: 0 } },
  })

  const view = folder.view(state)
  assert.equal(view.cost, 4)
  assert.deepEqual(view.costByModel, { 'model-b': 4 })
})

test('pre-cutoff and scheduled v4 prices are configurable', () => {
  const folder = __testing.makeSessionFolder({
    prices: { 'deepseek-v4-flash': { cacheHit: 0.02, cacheMiss: 0.25, output: 0.5 } },
    v4PeakPrices: { 'deepseek-v4-flash': { cacheHit: 0.2, cacheMiss: 7, output: 10 } },
    defaultPrices: config.defaultPrices,
  })
  const usage = { inputTokens: 1_000_000, outputTokens: 0 }
  let state = folder.init()
  state = folder.apply(state, { type: 'request/context', data: { model: 'deepseek-v4-flash' }, time: 1 })
  state = folder.apply(state, {
    type: 'assistant/message', time: Date.parse('2026-08-16T20:00:00+08:00'),
    data: { turn: 1, step: 1, usage },
  })
  state = folder.apply(state, {
    type: 'assistant/message', time: Date.parse('2026-08-20T16:00:00+08:00'),
    data: { turn: 2, step: 1, usage },
  })

  assert.equal(folder.view(state).cost, 7.25)
})

test('estimated percent uses total available balance including grants', () => {
  assert.equal(__testing.estimatedUsedPercent(5, 15), 25)
})

test('random replacements reconcile model/day costs and surviving tokens', () => {
  const prices = {
    prices: {
      a: { cacheHit: 0.123, cacheMiss: 1.234, output: 2.345 },
      b: { cacheHit: 0.321, cacheMiss: 4.567, output: 8.901 },
    },
    defaultPrices: config.defaultPrices,
  }
  const folder = __testing.makeSessionFolder(prices)
  let seed = 1
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  for (let run = 0; run < 100; run++) {
    let state = folder.init()
    const surviving = new Map()
    for (let step = 0; step < 30; step++) {
      const model = random() < 0.5 ? 'a' : 'b'
      state = folder.apply(state, { type: 'request/context', time: 1, data: { model } })
      const event = {
        type: 'assistant/message', time: Date.parse('2026-09-01T00:00:00+08:00') + step * 86400000,
        data: { turn: Math.floor(step / 2), step: 1, usage: {
          inputTokens: Math.floor(random() * 1_000_000),
          cacheReadTokens: Math.floor(random() * 1_000_000),
          cacheWriteTokens: Math.floor(random() * 1_000_000),
          outputTokens: Math.floor(random() * 1_000_000),
        } },
      }
      state = folder.apply(state, event)
      surviving.set(event.data.turn, { model, usage: event.data.usage })
    }
    const view = folder.view(state)
    const modelSum = Math.round(Object.values(view.costByModel).reduce((sum, cost) => sum + cost, 0) * 1e6) / 1e6
    assert.equal(modelSum, view.cost)
    const daySum = Math.round(Object.values(view.costByDay).reduce((sum, cost) => sum + cost, 0) * 1e6) / 1e6
    assert.equal(daySum, view.cost)
    const tokens = { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
    let cost = 0
    for (const { model, usage: u } of surviving.values()) {
      tokens.uncachedInput += u.inputTokens
      tokens.cacheRead += u.cacheReadTokens
      tokens.cacheWrite += u.cacheWriteTokens
      tokens.output += u.outputTokens
      const p = prices.prices[model]
      cost += ((u.inputTokens + u.cacheWriteTokens) * p.cacheMiss + u.cacheReadTokens * p.cacheHit + u.outputTokens * p.output) / 1e6
    }
    assert.deepEqual(view.tokens, tokens)
    assert.equal(view.cost, Math.round(cost * 1e6) / 1e6)
  }
})
