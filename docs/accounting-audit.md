# Local usage accounting audit (2026-09-07)

The current implementation already accumulated `costByModel` at event time.
That behavior is retained. Invoice import, account spending, balance fetching,
credentials, stale-while-error and the browser response fields are unchanged.

## Confirmed defects and corrections

- Cross-day replacements previously posted only the cost difference to the new
  day. They now remove the old sample's full cost from its original day and add
  the replacement's full cost to its own day.
- Equal token buckets previously skipped replacements even when their timestamp
  changed. Timestamp now participates in the equality check, including peak/off-peak
  and day changes.
- Per-event six-decimal rounding lost small charges. Internal accumulators now
  retain precision; rounding occurs when publishing session views. Global cost
  sums those published session amounts, so the sum of session costs equals the
  global cost. Both breakdowns reconcile at the same precision. When many tiny
  groups round upward, residual removal spans groups instead of making one negative.
- Missing or invalid event times previously used the viewing clock. The fold now
  uses the last valid persisted event timestamp in log order. With no such time,
  it uses configured base/legacy prices and the `unknown` day key. Unknown dates
  remain in total cost and are excluded from date windows. This is an explicit
  deterministic estimate, not recovery of the actual missing billing time.
- All daily buckets and Today/7d/30d windows now use UTC+08:00, including today.
  One captured clock value serves all three windows in each response.
- Invalid token fields previously poisoned aggregates. Nonnegative safe integer
  numbers and numeric strings are accepted; missing, null, fractional, negative,
  non-finite and other malformed fields become zero. Invalid whole usage records
  are ignored. Cache reads are not subtracted from `inputTokens`.
- `llm/retry-started` now closes the matching replacement slot, preserving the
  cost of an earlier attempt. Without this, a later attempt on the same step
  overwrote already-consumed usage.
- A finalized message's persisted `message.source.model`, when present, takes
  priority over request header/context fallback. Ordinary request model switches
  retain the existing event-order behavior.

The session projection state version is bumped from 2 to 3, requiring old cached
folds to be rebuilt. No service restart or installed-package deployment is part
of this repository change.

## Harness evidence and ordering contract

The installed CLI is `@deepseek-ai/dsh@0.1.2-rc.1`. Its dependencies under
`node_modules/@deepseek-ai/` provide the inspected runtime source:

- `dsh-llm/lib/types/types.d.ts`: TokenUsage explicitly defines disjoint uncached
  input, cache reads and cache writes.
- `dsh-token-meter/lib/types/usage-projection.js`: documents adjacent usage reports
  within an attempt and resets `last` on `llm/retry-started`.

The existing upstream checkout at commit
`99f6f02fecdb7dff40c3fbc9470f5907c29f74ca` additionally shows:

- [Token schema](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/llm/llm/src/types.ts): `inputTokens` is uncached input.
- [Session events](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/core/session/src/types.ts): `time` is Unix epoch milliseconds.
- [Session append](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/core/session/src/index.ts): timestamp is recorded when appending, not when viewing.
- [Agent loop](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/core/agent-loop/src/agent.ts): records request header/context before consuming the stream and settles the assistant message before advancing the step.
- [Token fold](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/llm/token-meter/src/usage-projection.ts): explicitly documents that a legal log cannot report an earlier step after a later step starts.

Therefore the existing constant-space `last` slot is retained. The proposed
step1/step2/step1 interleaving is outside the inspected producer contract; no map
or invented attribution for that sequence is introduced. Non-usage events may
intervene and do not clear the slot. Older logs without explicit retry markers
cannot distinguish retry consumption from replacement and retain last-wins behavior.

Upstream `master` inspected during this audit has moved to embedded assistant
streams and `assistant/attempt` settlements, unlike the installed release. Its
full event/projection API migration is not claimed as supported by this patch;
compatibility here is verified against the installed chunk/message contract.

## Verification

`test/cost.test.js` covers historical peak plus off-peak cost, both v4 models at
all eight schedule boundaries, the exact August 17 cutoff, chunk/message
replacement, model/date/price changes, retry boundaries, persisted-time fallback,
malformed usage, small-cost rounding and seeded random replacements with an
independent surviving-sample token/cost oracle. Peak scheduling uses UTC arithmetic.

`test/endpoint.test.js` also folds 12 sessions through the real endpoint with
out-of-order async read completion, checking published session/global/model/day
totals, tokens, Beijing windows and the registered session projection.

Run `npm test`; the package has no lint or additional check script. Also run
`TZ=UTC npm test`, `TZ=Asia/Shanghai npm test`, and
`TZ=America/Los_Angeles npm test` to verify independence from host timezone/DST.
