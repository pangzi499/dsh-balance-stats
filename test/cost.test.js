import assert from 'node:assert/strict'
import test from 'node:test'

import { __testing } from '../src/index.js'

const config = {
  prices: {
    'deepseek-chat': { cacheHit: 0.1, cacheMiss: 1, output: 2 },
  },
  defaultPrices: { cacheHit: 0.1, cacheMiss: 1, output: 2 },
}

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

test('rounded model costs reconcile to total cost', () => {
  const folder = __testing.makeSessionFolder({
    prices: {
      a: { cacheHit: 0.123, cacheMiss: 1.234, output: 2.345 },
      b: { cacheHit: 0.321, cacheMiss: 4.567, output: 8.901 },
    },
    defaultPrices: config.defaultPrices,
  })
  let seed = 1
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  for (let run = 0; run < 100; run++) {
    let state = folder.init()
    for (let step = 0; step < 30; step++) {
      const model = random() < 0.5 ? 'a' : 'b'
      state = folder.apply(state, { type: 'request/context', time: 1, data: { model } })
      state = folder.apply(state, {
        type: 'assistant/message', time: step + 2,
        data: { turn: Math.floor(step / 2), step: step % 2, usage: {
          inputTokens: Math.floor(random() * 1_000_000),
          cacheReadTokens: Math.floor(random() * 1_000_000),
          cacheWriteTokens: Math.floor(random() * 1_000_000),
          outputTokens: Math.floor(random() * 1_000_000),
        } },
      })
    }
    const view = folder.view(state)
    const modelSum = Math.round(Object.values(view.costByModel).reduce((sum, cost) => sum + cost, 0) * 1e6) / 1e6
    assert.equal(modelSum, view.cost)
  }
})
