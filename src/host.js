// ---- usage-dashboard host: durable cross-session usage ledger ----
// Reads only public harness services (storageDomain, sessionPersistence,
// sessions, sessionProjections for cross-checks) and the committed-event
// feed. No harness code changes.
//
// IMPORTANT: the session/event listeners register with { global: true }.
// A dynamic package mounts inside the requesting session's agent scope, so a
// plain listener would only see THAT session's committed events and every
// other conversation's usage would be missed. The global flag makes the
// ledger fold every session's events regardless of scope.

// FOLD_VERSION 2: the fold math is unchanged; the bump is a REPAIR marker.
// v1 could double-count a fork child by folding its inherited seed prefix
// (a live child's first own event dropped the strict seq check, then the
// catch-up refolded from seq 0). v2 makes every activation heal refold all
// records from each session's seed boundary and clears the poisoned ones.
const FOLD_VERSION = 2
const WRITE_EVERY_EVENTS = 200
const WRITE_INTERVAL_MS = 5000
const BACKUP_FORMAT = 'dsh-usage-dashboard-backup'

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function isNonNegInt(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}
function isNonNegNum(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
function zeroBuckets() {
  return { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
}
function bucketsFrom(usage) {
  return {
    uncachedInputTokens: typeof usage.inputTokens === 'number' ? usage.inputTokens : 0,
    outputTokens: typeof usage.outputTokens === 'number' ? usage.outputTokens : 0,
    cacheReadTokens: typeof usage.cacheReadTokens === 'number' ? usage.cacheReadTokens : 0,
    cacheWriteTokens: typeof usage.cacheWriteTokens === 'number' ? usage.cacheWriteTokens : 0,
  }
}
function bucketsEqual(a, b) {
  return a.uncachedInputTokens === b.uncachedInputTokens
    && a.outputTokens === b.outputTokens
    && a.cacheReadTokens === b.cacheReadTokens
    && a.cacheWriteTokens === b.cacheWriteTokens
}
function isZeroBuckets(b) {
  return b.uncachedInputTokens === 0 && b.outputTokens === 0 && b.cacheReadTokens === 0 && b.cacheWriteTokens === 0
}
function addBuckets(total, delta) {
  return {
    uncachedInputTokens: total.uncachedInputTokens + delta.uncachedInputTokens,
    outputTokens: total.outputTokens + delta.outputTokens,
    cacheReadTokens: total.cacheReadTokens + delta.cacheReadTokens,
    cacheWriteTokens: total.cacheWriteTokens + delta.cacheWriteTokens,
  }
}
function subtractBuckets(total, delta) {
  return {
    uncachedInputTokens: total.uncachedInputTokens - delta.uncachedInputTokens,
    outputTokens: total.outputTokens - delta.outputTokens,
    cacheReadTokens: total.cacheReadTokens - delta.cacheReadTokens,
    cacheWriteTokens: total.cacheWriteTokens - delta.cacheWriteTokens,
  }
}
function addInto(total, delta) {
  total.uncachedInputTokens += delta.uncachedInputTokens
  total.outputTokens += delta.outputTokens
  total.cacheReadTokens += delta.cacheReadTokens
  total.cacheWriteTokens += delta.cacheWriteTokens
}
function totalOf(b) {
  return b.uncachedInputTokens + b.outputTokens + b.cacheReadTokens + b.cacheWriteTokens
}
function dayKey(time) {
  const date = new Date(time)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return date.getFullYear() + '-' + month + '-' + day
}
function dayDate(day) {
  const parts = day.split('-').map(Number)
  return new Date(parts[0] || 0, (parts[1] || 1) - 1, parts[2] || 1).getTime()
}
function isTokenDelta(chunk) {
  if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') return chunk.text !== ''
  if (chunk.type === 'tool-call-delta') return chunk.argumentsDelta !== '' || chunk.name !== undefined
  return false
}
function outputTokensOf(usage) {
  if (!isPlainObject(usage)) return null
  const value = usage.outputTokens
  return isNonNegNum(value) ? value : null
}
function initState() {
  return {
    model: undefined,
    last: null,
    days: {},
    models: {},
    turns: 0,
    steps: 0,
    llmMs: 0,
    toolMs: 0,
    ttftMs: 0,
    ttftSteps: 0,
    decodeMs: 0,
    decodeTokens: 0,
    lastTurn: null,
    openStep: null,
    pendingCalls: {},
  }
}

// One committed event through the ledger fold. Mirrors the harness's own
// tokenUsage/sessionStats fold semantics (same-step replace, seed-skip,
// turn/step boundaries) so the numbers stay exact. Uninteresting events
// return the same reference.
function applyEvent(state, event) {
  const type = event.type
  let next = state

  if (type === 'request/header') {
    const model = event.data.header.config.model
    if (model !== state.model) next = { ...next, model }
  } else {
    let usage = null
    let turn = 0
    let step = 0
    if (type === 'assistant/chunk' && event.data.chunk.type === 'usage') {
      usage = event.data.chunk.usage
      turn = event.data.turn
      step = event.data.step
    } else if (type === 'assistant/message' && event.data.usage != null) {
      usage = event.data.usage
      turn = event.data.turn
      step = event.data.step
    }
    if (usage !== null) {
      const buckets = bucketsFrom(usage)
      const day = dayKey(event.time)
      const model = state.model || ''
      const prev = next.last
      if (prev !== null && prev.turn === turn && prev.step === step) {
        if (!bucketsEqual(prev.buckets, buckets) || prev.day !== day || prev.model !== model) {
          next = {
            ...next,
            last: { turn, step, day, model, buckets },
            days: replaceBucket(next.days, prev.day, day, prev.buckets, buckets),
            models: replaceBucket(next.models, prev.model, model, prev.buckets, buckets),
          }
        }
      } else {
        next = {
          ...next,
          last: { turn, step, day, model, buckets },
          days: { ...next.days, [day]: addBuckets(next.days[day] || zeroBuckets(), buckets) },
          models: { ...next.models, [model]: addBuckets(next.models[model] || zeroBuckets(), buckets) },
        }
      }
    }
  }

  switch (type) {
    case 'step/start':
      next = { ...next, openStep: { turn: event.data.turn, step: event.data.step, startTime: event.time, firstTokenTime: null } }
      break
    case 'assistant/chunk': {
      const open = next.openStep
      if (open === null || open.turn !== event.data.turn || open.step !== event.data.step) break
      if (open.firstTokenTime !== null || !isTokenDelta(event.data.chunk)) break
      next = { ...next, openStep: { ...open, firstTokenTime: event.time } }
      break
    }
    case 'assistant/message': {
      const open = next.openStep
      if (open === null || open.turn !== event.data.turn || open.step !== event.data.step) break
      next = { ...next, llmMs: next.llmMs + Math.max(0, event.time - open.startTime), openStep: null }
      if (open.firstTokenTime !== null) {
        next = { ...next, ttftMs: next.ttftMs + Math.max(0, open.firstTokenTime - open.startTime), ttftSteps: next.ttftSteps + 1 }
        const outputTokens = outputTokensOf(event.data.usage)
        if (outputTokens !== null) {
          next = { ...next, decodeMs: next.decodeMs + Math.max(0, event.time - open.firstTokenTime), decodeTokens: next.decodeTokens + outputTokens }
        }
      }
      break
    }
    case 'tool/call':
      next = { ...next, pendingCalls: { ...next.pendingCalls, [event.data.callId]: event.time } }
      break
    case 'tool/result': {
      const source = event.data.message && event.data.message.source
      const callId = source ? source.callId : undefined
      if (callId !== undefined && Object.prototype.hasOwnProperty.call(next.pendingCalls, callId)) {
        const dispatched = next.pendingCalls[callId]
        const pendingCalls = { ...next.pendingCalls }
        delete pendingCalls[callId]
        next = { ...next, toolMs: next.toolMs + Math.max(0, event.time - dispatched), pendingCalls }
      }
      break
    }
    case 'step/end':
      next = {
        ...next,
        turns: next.lastTurn === event.data.turn ? next.turns : next.turns + 1,
        steps: next.steps + 1,
        lastTurn: event.data.turn,
        openStep: null,
      }
      break
    case 'turn/end':
      next = Object.keys(next.pendingCalls).length === 0 ? next : { ...next, pendingCalls: {} }
      break
    default:
      break
  }
  return next
}

function replaceBucket(map, fromKey, toKey, prevBuckets, nextBuckets) {
  const moved = {}
  for (const key of Object.keys(map)) moved[key] = map[key]
  moved[fromKey] = subtractBuckets(moved[fromKey] || zeroBuckets(), prevBuckets)
  moved[toKey] = addBuckets(moved[toKey] || zeroBuckets(), nextBuckets)
  if (fromKey !== toKey && isZeroBuckets(moved[fromKey])) delete moved[fromKey]
  return moved
}

function sumDays(days) {
  let total = zeroBuckets()
  if (!isPlainObject(days)) return total
  for (const key of Object.keys(days)) total = addBuckets(total, days[key] || zeroBuckets())
  return total
}

function validateBuckets(buckets) {
  if (!isPlainObject(buckets)) throw new Error('buckets must be an object')
  if (!isNonNegInt(buckets.uncachedInputTokens)) throw new Error('uncachedInputTokens must be a non-negative integer')
  if (!isNonNegInt(buckets.outputTokens)) throw new Error('outputTokens must be a non-negative integer')
  if (!isNonNegInt(buckets.cacheReadTokens)) throw new Error('cacheReadTokens must be a non-negative integer')
  if (!isNonNegInt(buckets.cacheWriteTokens)) throw new Error('cacheWriteTokens must be a non-negative integer')
}
function validateBucketMap(map, label) {
  if (!isPlainObject(map)) throw new Error(label + ' must be an object')
  for (const key of Object.keys(map)) validateBuckets(map[key])
}
function validateState(state) {
  if (!isPlainObject(state)) throw new Error('state must be an object')
  if (state.model !== undefined && typeof state.model !== 'string') throw new Error('state model must be a string')
  if (state.last !== null && state.last !== undefined) {
    const last = state.last
    if (!isPlainObject(last)) throw new Error('state last must be an object or null')
    if (!isNonNegInt(last.turn)) throw new Error('state last.turn must be a non-negative integer')
    if (!isNonNegInt(last.step)) throw new Error('state last.step must be a non-negative integer')
    if (typeof last.day !== 'string') throw new Error('state last.day must be a string')
    if (typeof last.model !== 'string') throw new Error('state last.model must be a string')
    validateBuckets(last.buckets)
  }
  validateBucketMap(state.days, 'state days')
  validateBucketMap(state.models, 'state models')
  if (!isNonNegInt(state.turns)) throw new Error('state turns must be a non-negative integer')
  if (!isNonNegInt(state.steps)) throw new Error('state steps must be a non-negative integer')
  if (!isNonNegNum(state.llmMs)) throw new Error('state llmMs must be a non-negative number')
  if (!isNonNegNum(state.toolMs)) throw new Error('state toolMs must be a non-negative number')
  if (!isNonNegNum(state.ttftMs)) throw new Error('state ttftMs must be a non-negative number')
  if (!isNonNegInt(state.ttftSteps)) throw new Error('state ttftSteps must be a non-negative integer')
  if (!isNonNegNum(state.decodeMs)) throw new Error('state decodeMs must be a non-negative number')
  if (!isNonNegInt(state.decodeTokens)) throw new Error('state decodeTokens must be a non-negative integer')
  if (state.openStep !== null && state.openStep !== undefined) {
    const open = state.openStep
    if (!isPlainObject(open)) throw new Error('state openStep must be an object or null')
    if (!isNonNegInt(open.turn)) throw new Error('state openStep.turn must be a non-negative integer')
    if (!isNonNegInt(open.step)) throw new Error('state openStep.step must be a non-negative integer')
    if (!isNonNegNum(open.startTime)) throw new Error('state openStep.startTime must be a non-negative number')
    if (open.firstTokenTime !== null && !isNonNegNum(open.firstTokenTime)) throw new Error('state openStep.firstTokenTime must be a number or null')
  }
  if (!isPlainObject(state.pendingCalls)) throw new Error('state pendingCalls must be an object')
}
function validateRecord(value) {
  if (!isPlainObject(value)) throw new Error('record must be an object')
  if (typeof value.id !== 'string' || value.id.length === 0) throw new Error('record id must be a non-empty string')
  if (!isNonNegInt(value.createdAt)) throw new Error('record createdAt must be a non-negative integer')
  if (value.cwd !== undefined && typeof value.cwd !== 'string') throw new Error('record cwd must be a string')
  if (value.parentSessionId !== undefined && typeof value.parentSessionId !== 'string') throw new Error('record parentSessionId must be a string')
  if (value.origin !== undefined && value.origin !== 'subagent') throw new Error('record origin must be "subagent"')
  if (!Number.isInteger(value.seq) || value.seq < -1) throw new Error('record seq must be an integer >= -1')
  if (!isNonNegInt(value.firstSeen)) throw new Error('record firstSeen must be a non-negative integer')
  if (!isNonNegInt(value.lastSeen)) throw new Error('record lastSeen must be a non-negative integer')
  if (!Number.isInteger(value.v) || value.v < 0) throw new Error('record v must be a non-negative integer')
  validateState(value.state)
  return value
}

return {
  name: 'usage-dashboard',
  inject: ['timer'],
  async apply(ctx) {
    const storageDomain = ctx.get('storageDomain')
    if (storageDomain === undefined) {
      console.error('[usage-dashboard] storageDomain service is absent; the ledger is disabled')
      return
    }
    const domain = await storageDomain.open({
      name: 'usage_dashboard',
      version: 1,
      tables: { sessions: { valueSchema: { parse: validateRecord } } },
    })
    ctx.effect(() => () => domain.close(), 'usage-dashboard: domain lifecycle')
    const table = domain.table('sessions')
    const timer = ctx.timer

    const liveCells = new Map()
    const writeChains = new Map()
    const recordKey = (id, createdAt) => String(id) + '@' + String(createdAt)

    function makeCell(id, createdAt, cwd, parentSessionId, origin) {
      return {
        id: String(id),
        createdAt,
        cwd,
        parentSessionId,
        origin,
        seq: -1,
        firstSeen: 0,
        lastSeen: 0,
        state: initState(),
        dirty: false,
        pending: 0,
        timer: null,
      }
    }
    function adoptRecord(cell, record) {
      cell.seq = record.seq
      cell.firstSeen = record.firstSeen
      cell.lastSeen = record.lastSeen
      cell.state = record.state
      cell.dirty = false
    }
    function foldOne(cell, event) {
      const first = cell.seq < 0
      const next = applyEvent(cell.state, event)
      const changed = next !== cell.state
      cell.state = next
      cell.seq = event.seq
      cell.lastSeen = event.time
      if (first) cell.firstSeen = event.time
      if (changed) cell.dirty = true
    }
    function foldEvents(cell, events, uptoSeq) {
      for (const event of events) {
        if (!event || event.seq > uptoSeq) break
        if (event.seq <= cell.seq) continue
        foldOne(cell, event)
      }
    }
    function foldUpTo(cell, session, uptoSeq) {
      // The seed floor is load-bearing: a fork child's log starts with its
      // inherited ancestor prefix, which the ancestor's own record already
      // counts. Folding from cell.seq+1 alone could refold the seed when the
      // cell was created mid-suffix (first own event), double-counting it.
      const from = Math.max(cell.seq + 1, session.header.seedLength || 0)
      if (uptoSeq < from) return
      const events = session.events
      for (let index = from; index < events.length; index += 1) {
        const event = events[index]
        if (!event || event.seq > uptoSeq) break
        foldOne(cell, event)
      }
    }
    function cellForLive(session, uptoSeq) {
      const key = recordKey(session.id, session.header.createdAt)
      const existing = liveCells.get(key)
      if (existing !== undefined) {
        foldUpTo(existing, session, uptoSeq)
        return existing
      }
      const record = table.get(key)
      const usable = record !== undefined
        && record.v === FOLD_VERSION
        && record.createdAt === session.header.createdAt
        && record.cwd === session.header.cwd
      const cell = makeCell(session.id, session.header.createdAt, session.header.cwd, session.header.parentSession, session.header.origin)
      if (usable) {
        adoptRecord(cell, record)
        foldEvents(cell, session.events.slice(cell.seq + 1), uptoSeq)
      } else {
        if (record !== undefined) console.error('[usage-dashboard] session ' + session.id + ' has a mismatched stored record; folding fresh')
        foldEvents(cell, session.events.slice(session.header.seedLength || 0), uptoSeq)
        cell.dirty = cell.seq >= 0
      }
      liveCells.set(key, cell)
      return cell
    }

    function crossCheck(cell, session) {
      const projections = ctx.get('sessionProjections')
      if (projections === undefined) return
      try {
        const snapshot = projections.snapshot(session)
        const usage = snapshot && snapshot.values ? snapshot.values.tokenUsage : undefined
        if (usage === undefined) return
        const mine = sumDays(cell.state.days)
        if (mine.uncachedInputTokens !== usage.uncachedInputTokens
          || mine.outputTokens !== usage.outputTokens
          || mine.cacheReadTokens !== usage.cacheReadTokens
          || mine.cacheWriteTokens !== usage.cacheWriteTokens) {
          console.error('[usage-dashboard] bucket mismatch for session ' + session.id + ': ledger=' + JSON.stringify(mine) + ' tokenUsage=' + JSON.stringify(usage))
        }
      } catch (error) {
        // the cross-check must never break the write path
      }
    }

    function recordOf(cell) {
      return {
        id: cell.id,
        createdAt: cell.createdAt,
        ...(cell.cwd !== undefined ? { cwd: cell.cwd } : {}),
        ...(cell.parentSessionId !== undefined ? { parentSessionId: cell.parentSessionId } : {}),
        ...(cell.origin !== undefined ? { origin: cell.origin } : {}),
        seq: cell.seq,
        firstSeen: cell.firstSeen,
        lastSeen: cell.lastSeen,
        v: FOLD_VERSION,
        state: cell.state,
      }
    }
    function writeCell(key, cell) {
      const job = async () => {
        const current = table.get(key)
        const record = recordOf(cell)
        if (current !== undefined && current.seq >= record.seq && current.createdAt === record.createdAt) return false
        await table.put(key, record)
        return true
      }
      const previous = writeChains.get(key) || Promise.resolve()
      const next = previous.then(job)
      writeChains.set(key, next.then(() => {}, () => {}))
      return next
    }
    async function flushSoft(cell, session, trigger) {
      try {
        if (cell.timer !== null) { cell.timer(); cell.timer = null }
        cell.pending = 0
        crossCheck(cell, session)
        await writeCell(recordKey(cell.id, cell.createdAt), cell)
        cell.dirty = false
      } catch (error) {
        console.error('[usage-dashboard] ' + trigger + ' write for "' + cell.id + '" failed: ' + String(error))
      }
    }

    // Global listeners: see the header comment. Without the flag the ledger
    // would only fold the requesting session's events and under-count every
    // other conversation's usage.
    ctx.on('session/event', (session, event) => {
      const cell = cellForLive(session, event.seq - 1)
      // Tolerant advance check: for a fork child the first own event has seq
      // = seedLength (>= 1), so the strict === cell.seq + 1 check (cell.seq is
      // still -1) must not drop it.
      if (event.seq <= cell.seq) return
      foldOne(cell, event)
      cell.pending += 1
      if (event.type === 'turn/end') {
        void flushSoft(cell, session, 'turn/end')
        return
      }
      if (cell.pending >= WRITE_EVERY_EVENTS) {
        void flushSoft(cell, session, 'count threshold')
        return
      }
      if (cell.timer === null) {
        cell.timer = timer.timeout(() => { void flushSoft(cell, session, 'interval') }, WRITE_INTERVAL_MS)
      }
    }, { global: true })
    ctx.on('session/disposed', (session) => {
      const key = recordKey(session.id, session.header.createdAt)
      const cell = liveCells.get(key)
      if (cell === undefined) return
      foldUpTo(cell, session, session.events.length - 1)
      void flushSoft(cell, session, 'dispose')
      if (cell.timer !== null) { cell.timer(); cell.timer = null }
      cell.pending = 0
      liveCells.delete(key)
    }, { global: true })
    ctx.effect(() => () => {
      for (const cell of liveCells.values()) {
        if (cell.timer !== null) cell.timer()
      }
      liveCells.clear()
    }, 'usage-dashboard: timers')

    // ---- heal: fold every committed tail and every never-seen session
    // straight from the stored logs, and MATERIALIZE live cells into the
    // table so idle attached sessions appear without waiting for a flush ----
    async function heal() {
      const persistence = ctx.get('sessionPersistence')
      const sessionsService = ctx.get('sessions')
      const liveIds = new Set()
      if (sessionsService !== undefined) {
        try {
          for (const session of sessionsService.list()) {
            liveIds.add(session.id)
            const cell = cellForLive(session, session.events.length - 1)
            try {
              await writeCell(recordKey(cell.id, cell.createdAt), cell)
            } catch (error) {
              console.error('[usage-dashboard] heal write for live "' + cell.id + '" failed: ' + String(error))
            }
          }
        } catch (error) {
          console.error('[usage-dashboard] live-session heal failed: ' + String(error))
        }
      }
      if (persistence === undefined) return
      let metas
      try {
        metas = await persistence.list()
      } catch (error) {
        console.error('[usage-dashboard] persistence.list failed: ' + String(error))
        return
      }
      for (const meta of metas) {
        if (liveIds.has(meta.id)) continue
        const key = recordKey(meta.id, meta.createdAt)
        const record = table.get(key)
        const usable = record !== undefined
          && record.v === FOLD_VERSION
          && record.createdAt === meta.createdAt
          && record.cwd === meta.cwd
        const from = usable ? record.seq + 1 : (meta.seedLength || 0)
        let events
        try {
          const read = await persistence.readFrom(meta.id, from)
          events = read.events
        } catch (error) {
          // deleted or unreadable log: the stored record stays authoritative
          continue
        }
        if (!Array.isArray(events) || events.length === 0) continue
        const cell = makeCell(meta.id, meta.createdAt, meta.cwd, meta.parentSession, meta.origin)
        if (usable) adoptRecord(cell, record)
        foldEvents(cell, events, Number.MAX_SAFE_INTEGER)
        if (cell.seq < 0) continue
        try {
          await writeCell(key, cell)
        } catch (error) {
          console.error('[usage-dashboard] heal write for "' + meta.id + '" failed: ' + String(error))
        }
      }
    }

    // ---- report / backup ----
    // The report overlays the live cells over the durable table, so in-flight
    // usage is visible immediately; live cells never outrank a newer record.
    function mergedRecords() {
      const records = new Map()
      for (const pair of table.entries()) records.set(pair[0], pair[1])
      for (const entry of liveCells) {
        const key = entry[0]
        const cell = entry[1]
        const current = records.get(key)
        if (current === undefined || cell.seq > current.seq) records.set(key, recordOf(cell))
      }
      return records
    }
    function buildReport() {
      const totals = { sessions: 0, uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 }
      const dayPoints = new Map()
      const modelRows = new Map()
      const sessionRows = []
      for (const record of mergedRecords().values()) {
        try {
          validateRecord(record)
        } catch (error) {
          console.error('[usage-dashboard] skipping invalid record for "' + String(record && record.id) + '": ' + String(error))
          continue
        }
        const state = record.state
        const buckets = sumDays(state.days)
        if (isZeroBuckets(buckets) && state.turns === 0 && state.steps === 0) continue
        totals.sessions += 1
        addInto(totals, buckets)
        totals.turns += state.turns
        totals.steps += state.steps
        totals.llmMs += state.llmMs
        totals.toolMs += state.toolMs
        totals.ttftMs += state.ttftMs
        totals.ttftSteps += state.ttftSteps
        totals.decodeMs += state.decodeMs
        totals.decodeTokens += state.decodeTokens
        for (const day of Object.keys(state.days)) {
          const bucketsOfDay = state.days[day]
          const point = dayPoints.get(day)
          if (point !== undefined) addInto(point, bucketsOfDay)
          else dayPoints.set(day, { day, date: dayDate(day), ...bucketsOfDay })
        }
        for (const model of Object.keys(state.models)) {
          const bucketsOfModel = state.models[model]
          const row = modelRows.get(model)
          if (row !== undefined) {
            addInto(row, bucketsOfModel)
            row.sessionSet.add(record.id)
          } else {
            modelRows.set(model, { model, sessionSet: new Set([record.id]), ...bucketsOfModel })
          }
        }
        sessionRows.push({
          sessionId: record.id,
          ...(record.parentSessionId !== undefined ? { parentSessionId: record.parentSessionId } : {}),
          ...(record.origin !== undefined ? { origin: record.origin } : {}),
          ...(state.model !== undefined ? { model: state.model } : {}),
          turns: state.turns,
          steps: state.steps,
          llmMs: state.llmMs,
          toolMs: state.toolMs,
          ttftMs: state.ttftMs,
          ttftSteps: state.ttftSteps,
          decodeMs: state.decodeMs,
          decodeTokens: state.decodeTokens,
          firstSeen: record.firstSeen,
          lastSeen: record.lastSeen,
          ...buckets,
        })
      }
      sessionRows.sort((left, right) => right.lastSeen - left.lastSeen)
      const days = [...dayPoints.values()].sort((left, right) => left.date - right.date)
      const models = [...modelRows.values()]
        .map((row) => ({
          model: row.model,
          sessions: row.sessionSet.size,
          uncachedInputTokens: row.uncachedInputTokens,
          outputTokens: row.outputTokens,
          cacheReadTokens: row.cacheReadTokens,
          cacheWriteTokens: row.cacheWriteTokens,
        }))
        .sort((left, right) => totalOf(right) - totalOf(left))
      return { totals, days, models, sessions: sessionRows }
    }
    function exportDocument() {
      const records = []
      for (const record of mergedRecords().values()) records.push(record)
      return { format: BACKUP_FORMAT, version: 1, exportedAt: Date.now(), records }
    }
    // Light backfill for sessions the ledger has never seen (created while the
    // plugin was stopped, or missed before the global listeners): cheap on
    // repeat because only record-less sessions are read.
    async function backfillUnknown() {
      const persistence = ctx.get('sessionPersistence')
      if (persistence === undefined) return
      let metas
      try {
        metas = await persistence.list()
      } catch (error) {
        console.error('[usage-dashboard] persistence.list failed: ' + String(error))
        return
      }
      for (const meta of metas) {
        const key = recordKey(meta.id, meta.createdAt)
        if (table.get(key) !== undefined || liveCells.has(key)) continue
        let events
        try {
          const read = await persistence.readFrom(meta.id, meta.seedLength || 0)
          events = read.events
        } catch (error) {
          continue
        }
        if (!Array.isArray(events) || events.length === 0) continue
        const cell = makeCell(meta.id, meta.createdAt, meta.cwd, meta.parentSession, meta.origin)
        foldEvents(cell, events, Number.MAX_SAFE_INTEGER)
        if (cell.seq < 0) continue
        try {
          await writeCell(key, cell)
        } catch (error) {
          console.error('[usage-dashboard] backfill write for "' + meta.id + '" failed: ' + String(error))
        }
      }
    }
    async function importDocument(document) {
      if (!isPlainObject(document) || document.format !== BACKUP_FORMAT || document.version !== 1 || !Array.isArray(document.records)) {
        throw new TypeError('usage backup document is invalid')
      }
      let imported = 0
      let skipped = 0
      for (const record of document.records) {
        let valid = true
        try {
          validateRecord(record)
        } catch (error) {
          valid = false
        }
        if (!valid) {
          skipped += 1
          continue
        }
        const key = recordKey(record.id, record.createdAt)
        const cell = makeCell(record.id, record.createdAt, record.cwd, record.parentSessionId, record.origin)
        adoptRecord(cell, record)
        const written = await writeCell(key, cell)
        if (written) {
          imported += 1
          const live = liveCells.get(key)
          if (live !== undefined && live.seq < record.seq) adoptRecord(live, record)
        } else {
          skipped += 1
        }
      }
      return { imported, skipped }
    }

    harness.handle('usage.report', async () => {
      await backfillUnknown()
      return buildReport()
    })
    harness.handle('usage.export', () => ({ document: exportDocument() }))
    harness.handle('usage.import', async (args) => {
      const document = args && typeof args === 'object' ? args.document : undefined
      return importDocument(document)
    })

    await heal()
  },
}