import assert from 'node:assert/strict'
import test from 'node:test'

import { __testing } from '../src/index.js'

const { extractUserToken, parseInvoiceExport } = __testing

const LONG = 'abcdefghijklmnopqrstuvwxyz01'

test('extractUserToken accepts plain, quoted, and JSON-wrapped values', () => {
  assert.equal(extractUserToken(`  ${LONG}  \n`), LONG)
  assert.equal(extractUserToken(JSON.stringify(LONG)), LONG)
  assert.equal(extractUserToken(`"${LONG}"`), LONG)
  assert.equal(extractUserToken(JSON.stringify({ value: LONG })), LONG)
  assert.equal(extractUserToken(JSON.stringify({ token: LONG })), LONG)
  assert.equal(extractUserToken(JSON.stringify({ access_token: LONG })), LONG)
})

test('extractUserToken rejects short, spaced, and non-string values', () => {
  assert.equal(extractUserToken('short'), null)
  assert.equal(extractUserToken(''), null)
  assert.equal(extractUserToken(null), null)
  assert.equal(extractUserToken(12345), null)
  assert.equal(extractUserToken('aaaa bbbb cccc dddd eeee'), null)
  assert.equal(extractUserToken('{}'), null)
  assert.equal(extractUserToken('{"other": "abcdefghijklmnop"}'), null)
})

// 与客户端 parser(invoice.test.js)同 fixture 的对等性验证
test('server parseInvoiceExport mirrors client semantics', () => {
  const summary = parseInvoiceExport({
    data: { biz_data: { invoices: {
      payment_orders: [
        { payment_order_status: 'SUCCESS', amount: '20.25', currency: 'CNY' },
        { payment_order_status: 'FAILED', amount: '99', currency: 'CNY' },
        { payment_order_status: 'SUCCESS', amount: 49.75, currency: 'CNY' },
      ],
      bonus_orders: [
        { status: 'SUCCESS', amount: '3' },
        { bonus_order_status: 'FAILED', amount: '8' },
      ],
    } } },
  })
  assert.deepEqual(
    { ...summary, importedAt: 0 },
    {
      totalRecharge: 70,
      totalBonus: 3,
      currency: 'CNY',
      paymentOrderCount: 2,
      bonusOrderCount: 1,
      importedAt: 0,
    },
  )
})

test('server parseInvoiceExport throws invalid-structure on garbage', () => {
  assert.throws(() => parseInvoiceExport({}), /invalid-structure/)
  assert.throws(() => parseInvoiceExport(null), /invalid-structure/)
})
