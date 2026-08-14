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
    type: 'assistant/message', turn: 1, step: 1, time: 2,
    data: { usage: { inputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 } },
  })
  state = folder.apply(state, {
    type: 'assistant/message', turn: 1, step: 1, time: 3,
    data: { usage: { inputTokens: 2_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 500_000 } },
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
    type: 'assistant/chunk', turn: 2, step: 1, time: 2,
    data: { chunk: { type: 'usage', usage: {
      inputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
      outputTokens: 1_000_000,
    } } },
  })

  assert.equal(folder.view(state).cost, 4.1)
})
