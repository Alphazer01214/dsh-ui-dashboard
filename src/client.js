// ---- usage-dashboard client: replaces the shipped footer action with the
// host-ledger-backed dashboard ----
//
// This file is the canonical browser-half module. It is NOT loaded directly:
// `node scripts/build.mjs` wraps it into lib/client.js, a
// window.__ModuleLoader__.load({ id, factory }) bundle whose factory provides
// `React` (require('react'), the platform seed word) before this body runs.
// Keep every render call as React.createElement(...); the wrapper owns the
// React binding.
//
// The browser half is a trusted composition row, so it reaches the host
// ledger over the same-origin webServer routes below (report / export /
// import) instead of the dynamic-runner's host.call channel.

const CSS = `
.ud-trigger { display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 8px; border: none; background: transparent; color: var(--dsw-alias-label-primary, #1a1a1a); border-radius: 6px; cursor: pointer; font-size: 13px; box-sizing: border-box; }
.ud-trigger:hover { background: var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.06)); }
.ud-rail { justify-content: center; width: 40px; padding: 6px 0; margin: 0 auto; }
.ud-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.ud-panel { width: 680px; max-width: 92vw; max-height: 86vh; overflow: auto; background: var(--dsw-alias-bg-overlay, #fff); color: var(--dsw-alias-label-primary, #1a1a1a); border: 1px solid var(--dsw-alias-border-l2, #ddd); border-radius: 10px; padding: 14px 18px 18px; font-size: 13px; }
.ud-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.ud-title { font-size: 16px; font-weight: 600; margin: 0; }
.ud-close { border: none; background: transparent; color: var(--dsw-alias-label-secondary, #666); font-size: 18px; cursor: pointer; padding: 2px 8px; border-radius: 6px; }
.ud-close:hover { background: var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.06)); }
.ud-section-title { font-size: 13px; font-weight: 600; margin: 14px 0 6px; }
.ud-hint { font-size: 12px; color: var(--dsw-alias-label-secondary, #666); margin: 2px 0 8px; }
.ud-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 8px; }
.ud-card { background: var(--dsw-alias-bg-layer-1, #f5f5f5); border: 1px solid var(--dsw-alias-border-l1, #e5e5e5); border-radius: 8px; padding: 8px 10px; }
.ud-card-label { font-size: 11px; color: var(--dsw-alias-label-secondary, #666); }
.ud-card-value { font-size: 15px; font-weight: 600; margin-top: 2px; }
.ud-table-wrap { overflow-x: auto; }
.ud-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.ud-table th { text-align: right; font-weight: 500; color: var(--dsw-alias-label-secondary, #666); padding: 4px 8px; border-bottom: 1px solid var(--dsw-alias-border-l2, #ddd); white-space: nowrap; }
.ud-table td { text-align: right; padding: 4px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1, #eee); }
.ud-table th:first-child, .ud-table td:first-child { text-align: left; }
.ud-badge { display: inline-block; font-size: 10px; color: var(--dsw-alias-state-success-primary, #2e7d32); border: 1px solid currentColor; border-radius: 4px; padding: 0 4px; margin-left: 4px; vertical-align: middle; }
.ud-btn { border: 1px solid var(--dsw-alias-border-l2, #ccc); background: var(--dsw-alias-bg-layer-1, #f5f5f5); color: var(--dsw-alias-label-primary, #1a1a1a); border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; margin-right: 8px; }
.ud-btn:hover { border-color: var(--dsw-alias-brand-primary, #4d6bfe); color: var(--dsw-alias-brand-primary, #4d6bfe); }
.ud-btn-active { border-color: var(--dsw-alias-brand-primary, #4d6bfe); color: var(--dsw-alias-brand-primary, #4d6bfe); }
.ud-legend { display: flex; gap: 12px; align-items: center; font-size: 11px; color: var(--dsw-alias-label-secondary, #666); margin: 2px 0 6px; }
.ud-legend-item { display: inline-flex; align-items: center; }
.ud-legend-dot { width: 8px; height: 8px; border-radius: 2px; display: inline-block; margin-right: 4px; }
.ud-textarea { width: 100%; min-height: 110px; box-sizing: border-box; font-family: ui-monospace, Consolas, monospace; font-size: 11px; background: var(--dsw-alias-bg-layer-1, #f5f5f5); color: var(--dsw-alias-label-primary, #1a1a1a); border: 1px solid var(--dsw-alias-border-l1, #e5e5e5); border-radius: 6px; padding: 6px; margin: 6px 0; }
.ud-scale-row { display: flex; gap: 6px; margin-bottom: 4px; }
.ud-error { color: var(--dsw-alias-state-error-primary, #c62828); font-size: 12px; margin: 8px 0; }
.ud-ok { color: var(--dsw-alias-state-success-primary, #2e7d32); font-size: 12px; margin: 8px 0; }
.ud-empty { color: var(--dsw-alias-label-secondary, #666); font-size: 12px; margin: 10px 0; }
`

// Same-origin JSON fetch against the host's webServer routes; rejects with
// the host's { error } message on failure.
function apiFetch(url, options) {
  return fetch(url, options).then((response) => {
    if (!response.ok) {
      return response.json().then(
        (body) => { throw new Error(body && typeof body.error === 'string' ? body.error : 'HTTP ' + response.status) },
        () => { throw new Error('HTTP ' + response.status) },
      )
    }
    return response.json()
  })
}

function formatTokens(value) {
  if (value < 1000) return String(Math.round(value))
  if (value < 1000000) return String(Math.round(value / 1000 * 10) / 10) + 'K'
  return String(Math.round(value / 1000000 * 10) / 10) + 'M'
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000)
  if (totalSeconds < 60) return totalSeconds + 's'
  const minutes = Math.floor(totalSeconds / 60)
  if (minutes < 60) return minutes + 'm' + String(totalSeconds % 60).padStart(2, '0') + 's'
  return Math.floor(minutes / 60) + 'h' + String(minutes % 60).padStart(2, '0') + 'm'
}

function timeLabel(ms) {
  const date = new Date(ms)
  return (date.getMonth() + 1) + '/' + date.getDate()
}

function inputTokensOf(point) {
  return point.uncachedInputTokens + point.cacheReadTokens + point.cacheWriteTokens
}

function totalTokensOf(point) {
  return inputTokensOf(point) + point.outputTokens
}

function Icon() {
  return React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': true },
    React.createElement('path', { d: 'M2 12h3V7H2v5Zm4.5 0h3V3h-3v9ZM11 12h3V5h-3v7Z', fill: 'currentColor' }))
}

// Per-day trend chart: stacked input/output bars with rounded corners, a
// cumulative line with a soft area fill, dashed gridlines, sparse date ticks,
// a legend, and selectable time windows (7 days / 30 days / all).
function TrendChart(props) {
  const days = props.days
  const now = props.now
  const [scale, setScale] = React.useState('all')
  if (days.length === 0) return null
  const windowStart = scale === 'all' ? undefined : now - (scale === 'week' ? 7 : 30) * 86400000
  const visible = windowStart === undefined ? days : days.filter(point => point.date >= windowStart)
  const maxTotal = Math.max(0, ...visible.map(totalTokensOf))
  const scaleButtons = React.createElement('div', { className: 'ud-scale-row', role: 'group' },
    ['week', 'month', 'all'].map(key => React.createElement('button', {
      key, type: 'button',
      className: 'ud-btn' + (scale === key ? ' ud-btn-active' : ''),
      'aria-pressed': scale === key,
      onClick: () => { setScale(key) },
    }, key === 'week' ? '近 7 天' : key === 'month' ? '近 30 天' : '全部')))
  const legend = React.createElement('div', { className: 'ud-legend' },
    React.createElement('span', { className: 'ud-legend-item' },
      React.createElement('span', { className: 'ud-legend-dot', style: { background: 'var(--dsw-alias-brand-primary, #4d6bfe)', opacity: 0.45 } }), '输入'),
    React.createElement('span', { className: 'ud-legend-item' },
      React.createElement('span', { className: 'ud-legend-dot', style: { background: 'var(--dsw-alias-brand-primary, #4d6bfe)' } }), '输出'),
    React.createElement('span', { className: 'ud-legend-item' },
      React.createElement('span', { className: 'ud-legend-dot', style: { background: 'var(--dsw-alias-state-warn-primary, #f9a825)' } }), '累计'))
  if (visible.length === 0 || maxTotal === 0) {
    return React.createElement('div', null, scaleButtons, React.createElement('p', { className: 'ud-empty' }, '该时间范围内暂无用量'))
  }
  const W = 600
  const H = 190
  const LEFT = 46
  const RIGHT = 14
  const TOP = 14
  const BOTTOM = 30
  const plotW = W - LEFT - RIGHT
  const plotH = H - TOP - BOTTOM
  const yOf = value => TOP + (1 - value / maxTotal) * plotH
  const ticks = [0, 0.25, 0.5, 0.75, 1]
    .map(fraction => Math.round(maxTotal * fraction))
    .filter((value, index, array) => array.indexOf(value) === index)
  const domainStart = windowStart === undefined ? visible[0].date : windowStart
  const domainEnd = windowStart === undefined ? visible[visible.length - 1].date : now
  const span = Math.max(domainEnd - domainStart, 86400000)
  const barW = Math.max(2, Math.min(20, Math.floor(plotW / visible.length * 0.6)))
  const xOf = point => LEFT + (point.date - domainStart) / span * plotW - barW / 2
  const xCenterOf = point => xOf(point) + barW / 2
  let cumulative = 0
  const linePoints = []
  for (const point of visible) {
    cumulative += totalTokensOf(point)
    linePoints.push([xCenterOf(point), yOf(Math.min(cumulative, maxTotal))])
  }
  const firstX = linePoints[0][0]
  const lastX = linePoints[linePoints.length - 1][0]
  const areaPoints = [[firstX, TOP + plotH], ...linePoints, [lastX, TOP + plotH]]
    .map(point => point[0] + ',' + point[1]).join(' ')
  const labelEvery = Math.max(1, Math.ceil(visible.length / 6))
  const xLabels = visible.filter((point, index) => index % labelEvery === 0 || index === visible.length - 1)
  let running = 0
  const barGroups = visible.map((point) => {
    running += totalTokensOf(point)
    const input = inputTokensOf(point)
    const inputH = Math.max(1, Math.round(input / maxTotal * plotH))
    const outputH = Math.max(0, Math.round(point.outputTokens / maxTotal * plotH))
    const x = xOf(point)
    const totalH = inputH + outputH
    return React.createElement('g', { key: point.day },
      React.createElement('title', null, point.day + ' · 输入 ' + formatTokens(input) + ' · 输出 ' + formatTokens(point.outputTokens) + ' · 累计 ' + formatTokens(running)),
      React.createElement('rect', { x, y: TOP + plotH - inputH, width: barW, height: inputH, rx: 1.5, fill: 'var(--dsw-alias-brand-primary, #4d6bfe)', opacity: 0.45 }),
      outputH > 0 ? React.createElement('rect', { x, y: TOP + plotH - totalH, width: barW, height: outputH, rx: 1.5, fill: 'var(--dsw-alias-brand-primary, #4d6bfe)' }) : null)
  })
  return React.createElement('div', null,
    scaleButtons,
    legend,
    React.createElement('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', style: { display: 'block', maxWidth: '100%' } },
      ticks.map(value => React.createElement('g', { key: value },
        React.createElement('line', {
          x1: LEFT, x2: LEFT + plotW, y1: yOf(value), y2: yOf(value),
          stroke: 'var(--dsw-alias-border-l1, #eee)', strokeDasharray: value === 0 ? '' : '3 3',
        }),
        React.createElement('text', { x: LEFT - 6, y: yOf(value) + 3, fill: 'var(--dsw-alias-label-secondary, #666)', fontSize: 9, textAnchor: 'end' }, formatTokens(value)))),
      React.createElement('line', { x1: LEFT, x2: LEFT + plotW, y1: yOf(0), y2: yOf(0), stroke: 'var(--dsw-alias-border-l2, #ddd)' }),
      React.createElement('polygon', { points: areaPoints, fill: 'var(--dsw-alias-state-warn-primary, #f9a825)', opacity: 0.10 }),
      React.createElement('polyline', { points: linePoints.map(point => point.join(',')).join(' '), fill: 'none', stroke: 'var(--dsw-alias-state-warn-primary, #f9a825)', strokeWidth: 1.5 }),
      React.createElement('circle', { cx: lastX, cy: linePoints[linePoints.length - 1][1], r: 2.5, fill: 'var(--dsw-alias-state-warn-primary, #f9a825)' }),
      barGroups,
      xLabels.map((point, index) => React.createElement('text', {
        key: 'x-' + point.day,
        x: xCenterOf(point),
        y: H - 8,
        fill: 'var(--dsw-alias-label-secondary, #666)',
        fontSize: 9,
        textAnchor: index === 0 ? 'start' : index === xLabels.length - 1 ? 'end' : 'middle',
      }, timeLabel(point.date)))))
}

function DashboardAction(props) {
  const wide = props.wide
  const useSessions = props.useSessions
  const load = props.load
  const exportBackup = props.exportBackup
  const importBackup = props.importBackup

  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState(null)
  const [report, setReport] = React.useState(null)
  const [backup, setBackup] = React.useState(null)
  const [importText, setImportText] = React.useState('')
  const [importResult, setImportResult] = React.useState(null)
  const [importError, setImportError] = React.useState(null)

  const byId = useSessions ? useSessions(state => state.byId) : {}

  const refresh = () => {
    setLoading(true)
    setError(null)
    load().then(
      (value) => { setReport(value); setLoading(false) },
      (failure) => { setError(String(failure && failure.message ? failure.message : failure)); setLoading(false) },
    )
  }
  const openDialog = () => { setOpen(true); refresh() }
  const closeDialog = () => { setOpen(false) }
  const doExport = () => {
    setBackup(null)
    exportBackup().then(
      (value) => { setBackup(JSON.stringify(value && value.document ? value.document : value, null, 2)) },
      (failure) => { setError(String(failure && failure.message ? failure.message : failure)) },
    )
  }
  const doImport = () => {
    setImportResult(null)
    setImportError(null)
    let document
    try {
      document = JSON.parse(importText)
    } catch (failure) {
      setImportError('JSON 解析失败：' + String(failure && failure.message ? failure.message : failure))
      return
    }
    importBackup(document).then(
      (value) => { setImportResult(value); refresh() },
      (failure) => { setImportError(String(failure && failure.message ? failure.message : failure)) },
    )
  }

  const trigger = React.createElement('button', {
    type: 'button',
    className: wide ? 'ud-trigger' : 'ud-trigger ud-rail',
    title: '用量仪表盘',
    onClick: openDialog,
  },
    React.createElement(Icon),
    wide ? React.createElement('span', null, '用量') : null)

  if (!open) return trigger

  let body = null
  if (loading && report === null) {
    body = React.createElement('p', { className: 'ud-hint' }, '加载中…')
  } else if (error !== null && report === null) {
    body = React.createElement('div', null,
      React.createElement('p', { className: 'ud-error' }, '加载失败：' + error),
      React.createElement('button', { type: 'button', className: 'ud-btn', onClick: refresh }, '重试'))
  } else if (report !== null) {
    const totals = report.totals
    const billedInput = totals.uncachedInputTokens + totals.cacheReadTokens + totals.cacheWriteTokens
    const cacheHit = billedInput === 0 ? null : Math.round(totals.cacheReadTokens / billedInput * 100)
    const cards = [
      { key: 'total', label: '总 Token', value: formatTokens(billedInput + totals.outputTokens) },
      { key: 'input', label: '输入', value: formatTokens(billedInput) },
      { key: 'output', label: '输出', value: formatTokens(totals.outputTokens) },
    ]
    if (cacheHit !== null) cards.push({ key: 'hit', label: '缓存命中率', value: cacheHit + '%' })
    if (totals.cacheReadTokens > 0) cards.push({ key: 'read', label: '缓存读', value: formatTokens(totals.cacheReadTokens) })
    if (totals.cacheWriteTokens > 0) cards.push({ key: 'write', label: '缓存写', value: formatTokens(totals.cacheWriteTokens) })
    if (totals.sessions > 0) cards.push({ key: 'sessions', label: '会话数', value: String(totals.sessions) })
    if (totals.turns > 0) cards.push({ key: 'turns', label: '轮次', value: String(totals.turns) })
    if (totals.steps > 0) cards.push({ key: 'steps', label: '步数', value: String(totals.steps) })
    if (totals.llmMs > 0) cards.push({ key: 'llm', label: 'LLM 耗时', value: formatDuration(totals.llmMs) })
    if (totals.toolMs > 0) cards.push({ key: 'tool', label: '工具耗时', value: formatDuration(totals.toolMs) })
    if (totals.decodeMs > 0) cards.push({ key: 'throughput', label: '解码吞吐', value: formatTokens(Math.round(totals.decodeTokens / (totals.decodeMs / 1000))) + '/s' })

    const sessionTitle = (row) => {
      const summary = byId[row.sessionId]
      if (summary !== undefined && summary.displayTitle) return summary.displayTitle
      return String(row.sessionId).slice(0, 8)
    }

    body = React.createElement('div', null,
      React.createElement('p', { className: 'ud-hint' }, '统计覆盖 ' + totals.sessions + ' 个会话（含子代理），与是否展开无关；删除会话不会使数字减少。'),
      React.createElement('div', { className: 'ud-cards' },
        cards.map(card => React.createElement('div', { key: card.key, className: 'ud-card' },
          React.createElement('div', { className: 'ud-card-label' }, card.label),
          React.createElement('div', { className: 'ud-card-value' }, card.value)))),
      report.days.length > 0
        ? React.createElement('div', null,
          React.createElement('h3', { className: 'ud-section-title' }, '用量趋势（按天）'),
          React.createElement(TrendChart, { days: report.days, now: Date.now() }))
        : null,
      report.models.length > 0
        ? React.createElement('div', null,
          React.createElement('h3', { className: 'ud-section-title' }, '模型用量（含子代理所用模型）'),
          React.createElement('div', { className: 'ud-table-wrap' },
            React.createElement('table', { className: 'ud-table' },
              React.createElement('thead', null,
                React.createElement('tr', null,
                  React.createElement('th', null, '模型'),
                  React.createElement('th', null, '会话数'),
                  React.createElement('th', null, '输入'),
                  React.createElement('th', null, '输出'),
                  React.createElement('th', null, '总 Token'))),
              React.createElement('tbody', null,
                report.models.map(row => React.createElement('tr', { key: row.model },
                  React.createElement('td', null, row.model === '' ? '（无模型记录）' : row.model),
                  React.createElement('td', null, String(row.sessions)),
                  React.createElement('td', null, formatTokens(inputTokensOf(row))),
                  React.createElement('td', null, formatTokens(row.outputTokens)),
                  React.createElement('td', null, formatTokens(totalTokensOf(row)))))))))
        : null,
      report.sessions.length > 0
        ? React.createElement('div', null,
          React.createElement('h3', { className: 'ud-section-title' }, '会话明细'),
          React.createElement('div', { className: 'ud-table-wrap' },
            React.createElement('table', { className: 'ud-table' },
              React.createElement('thead', null,
                React.createElement('tr', null,
                  React.createElement('th', null, '会话'),
                  React.createElement('th', null, '模型'),
                  React.createElement('th', null, '轮次 / 步数'),
                  React.createElement('th', null, '输入'),
                  React.createElement('th', null, '输出'),
                  React.createElement('th', null, '总 Token'))),
              React.createElement('tbody', null,
                report.sessions.map(row => React.createElement('tr', { key: row.sessionId },
                  React.createElement('td', null,
                    sessionTitle(row),
                    row.origin === 'subagent' ? React.createElement('span', { className: 'ud-badge' }, '子代理') : null),
                  React.createElement('td', null, row.model || '—'),
                  React.createElement('td', null, row.turns + ' / ' + row.steps),
                  React.createElement('td', null, formatTokens(inputTokensOf(row))),
                  React.createElement('td', null, formatTokens(row.outputTokens)),
                  React.createElement('td', null, formatTokens(totalTokensOf(row)))))))))
        : null,
      React.createElement('h3', { className: 'ud-section-title' }, '备份与迁移'),
      React.createElement('p', { className: 'ud-hint' }, '导出为 JSON 备份文件，可在新的 DeepSeek Harness 部署中导入；重复导入同一备份不会重复计数。'),
      React.createElement('button', { type: 'button', className: 'ud-btn', onClick: doExport }, '导出备份'),
      React.createElement('button', { type: 'button', className: 'ud-btn', onClick: refresh }, '刷新'),
      backup !== null
        ? React.createElement('div', null,
          React.createElement('p', { className: 'ud-hint' }, '复制以下全部内容并保存为 .json 文件：'),
          React.createElement('textarea', { className: 'ud-textarea', readOnly: true, value: backup }))
        : null,
      React.createElement('p', { className: 'ud-hint', style: { marginTop: 10 } }, '导入备份：粘贴备份 JSON 后点击导入。'),
      React.createElement('textarea', {
        className: 'ud-textarea',
        value: importText,
        placeholder: '粘贴备份 JSON…',
        onChange: event => { setImportText(event.target.value) },
      }),
      React.createElement('div', null,
        React.createElement('button', { type: 'button', className: 'ud-btn', onClick: doImport }, '导入备份')),
      importResult !== null
        ? React.createElement('p', { className: 'ud-ok' }, '导入完成：新增或更新 ' + importResult.imported + ' 条记录，跳过 ' + importResult.skipped + ' 条。')
        : null,
      importError !== null ? React.createElement('p', { className: 'ud-error' }, '导入失败：' + importError) : null)
  } else {
    body = React.createElement('p', { className: 'ud-empty' }, '暂无用量数据。')
  }

  return React.createElement('div', null,
    trigger,
    React.createElement('div', { className: 'ud-backdrop', onClick: closeDialog },
      React.createElement('div', {
        className: 'ud-panel',
        onClick: event => { event.stopPropagation() },
      },
        React.createElement('div', { className: 'ud-head' },
          React.createElement('h2', { className: 'ud-title' }, '用量仪表盘'),
          React.createElement('button', { type: 'button', className: 'ud-close', onClick: closeDialog, title: '关闭' }, '×')),
        error !== null ? React.createElement('p', { className: 'ud-error' }, '操作失败：' + error) : null,
        body)))
}

export const name = 'usage-dashboard-client'
export const inject = ['slots']

export function apply(ctx) {
  const slots = ctx.get('slots')
  if (slots === undefined) {
    console.error('[usage-dashboard] slots service is absent; the sidebar action is disabled')
    return
  }
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-usage-dashboard'
    tag.dataset.pluginCss = 'dsh-usage-dashboard'
    tag.textContent = CSS
    document.head.appendChild(tag)
    return () => { if (tag.isConnected) tag.remove() }
  }, 'usage-dashboard: styles')
  slots.inject('sidebar.footer.action', () => slots.register({
    name: 'sidebar.footer.action',
    id: 'usage-dashboard',
    order: 0,
    label: '用量',
    inject: () => ({
      load: () => apiFetch('/usage-dashboard/report'),
      exportBackup: () => apiFetch('/usage-dashboard/export'),
      importBackup: (document) => apiFetch('/usage-dashboard/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ document }),
      }),
    }),
  }, DashboardAction))
}
