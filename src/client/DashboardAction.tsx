/**
 * Sidebar-foot usage dashboard: a trigger row plus a modal that folds the
 * retained `tokenUsage` / `sessionStats` projection values of every session
 * list row into cross-session totals, a per-session usage trend chart, and a
 * per-session table (session, newest billed model, turns/steps, and the three
 * token columns). All figures are whole-log durable numbers, so paging and
 * compaction cannot change them.
 */

import { useMemo, useState } from 'react'
import type { SessionId, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import { IconDataOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: merges the tokenUsage / sessionStats keys into SessionProjectionMap.
import type {} from '@deepseek-ai/dsh-session-stats/client'
import type {} from '@deepseek-ai/dsh-token-meter/client'
// Type-only: merges the sidebar slot declarations the props derive from.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { NS } from './locales.ts'
import css from './DashboardAction.module.css'

/** One per-session table row, already display-shaped. */
export interface DashboardRow {
  id: SessionId
  title: string
  /** Provider-owned model id of the newest billed request, or null while the session serves no `tokenUsage` value. */
  model: string | null
  /** Closed turns, or null while the session serves no `sessionStats` value. */
  turns: number | null
  /** Closed steps, or null while the session serves no `sessionStats` value. */
  steps: number | null
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

/** Cross-session sums; zero fields mean "no session reported that figure". */
export interface DashboardTotals {
  sessions: number
  uncachedInputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  totalTokens: number
  turns: number
  steps: number
  llmMs: number
  toolMs: number
  decodeMs: number
  decodeTokens: number
}

const NO_USAGE: DashboardTotals = {
  sessions: 0, uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
  outputTokens: 0, totalTokens: 0, turns: 0, steps: 0, llmMs: 0, toolMs: 0,
  decodeMs: 0, decodeTokens: 0,
}

/** Compact token count shared in shape with the conversation stats strip. */
function formatTokens(value: number): string {
  const scaled = (next: number): string => next >= 100
    ? String(Math.round(next))
    : String(Math.round(next * 10) / 10)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${scaled(value / 1_000)}K`
  return `${scaled(value / 1_000_000)}M`
}

/**
 * Locale-driven duration: seconds under a minute, minutes-seconds under an
 * hour, hours-minutes from there on.
 * @param ms - duration in milliseconds.
 * @param t - the dashboard locale seat.
 * @returns display string.
 */
function formatDuration(ms: number, t: TranslateNS<typeof NS>): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1_000)
  if (totalSeconds < 60) return t('duration.seconds', { seconds: totalSeconds })
  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 60) {
    return t('duration.minutes', { minutes: totalMinutes, seconds: totalSeconds % 60 })
  }
  return t('duration.hours', { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 })
}

/**
 * Fold the session list into display rows: newest first, only sessions the
 * object layer retained at least one usage projection value for.
 * @param byId - the session list's byId map.
 * @returns display rows sorted by updatedAt descending.
 */
export function dashboardRows(byId: Readonly<Record<SessionId, SessionSummary>>): DashboardRow[] {
  return Object.values(byId)
    .filter(summary => summary.projectionValues?.tokenUsage !== undefined
      || summary.projectionValues?.sessionStats !== undefined)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((summary) => {
      const usage = summary.projectionValues?.tokenUsage
      const stats = summary.projectionValues?.sessionStats
      const inputTokens = usage === undefined
        ? 0
        : usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
      const outputTokens = usage?.outputTokens ?? 0
      return {
        id: summary.id,
        title: summary.displayTitle,
        model: usage?.model ?? null,
        turns: stats?.turns ?? null,
        steps: stats?.steps ?? null,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      }
    })
}

/**
 * Sum rows into the cross-session totals card set.
 * @param rows - display rows from {@link dashboardRows}.
 * @param byId - the session list's byId map (decode timing lives there).
 * @returns summed totals.
 */
export function dashboardTotals(
  rows: readonly DashboardRow[],
  byId: Readonly<Record<SessionId, SessionSummary>>,
): DashboardTotals {
  const totals = { ...NO_USAGE, sessions: rows.length }
  for (const row of rows) {
    const usage = byId[row.id]?.projectionValues?.tokenUsage
    if (usage !== undefined) {
      totals.uncachedInputTokens += usage.uncachedInputTokens
      totals.cacheReadTokens += usage.cacheReadTokens
      totals.cacheWriteTokens += usage.cacheWriteTokens
      totals.outputTokens += usage.outputTokens
      totals.totalTokens += row.totalTokens
    }
    const stats = byId[row.id]?.projectionValues?.sessionStats
    if (stats !== undefined) {
      totals.turns += stats.turns
      totals.steps += stats.steps
      totals.llmMs += stats.llmMs
      totals.toolMs += stats.toolMs
      totals.decodeMs += stats.decodeMs
      totals.decodeTokens += stats.decodeTokens
    }
  }
  return totals
}

/** Full props for the footer action: the sidebar column state plus the standard seats. */
export type DashboardActionProps =
  PropsRuntime<'sidebar.footer.action'> & PropsLocale<typeof NS>

interface StatCard {
  key: string
  label: string
  value: string
}

const TREND_HEIGHT = 120
const TREND_WIDTH = 600
const TREND_BAR_GAP = 2

/**
 * Per-session usage trend over the list's updatedAt order (oldest first): one
 * bar per row, height proportional to `totalTokens`, with the session title
 * and formatted count as each bar's tooltip. The list mirror carries no
 * time-bucketed series, so this is a per-session trend, never per-day.
 * @param rows - display rows, newest first as {@link dashboardRows} returns them.
 * @param title - section heading and accessible name for the chart image.
 * @returns the heading plus chart, or null when every row bills zero tokens.
 */
function TrendChart({ rows, title }: { rows: readonly DashboardRow[]; title: string }) {
  // The 0 floor doubles as the empty-rows case (Math.max of no spread args).
  const max = Math.max(...rows.map(row => row.totalTokens), 0)
  if (max === 0) return null
  const barWidth = Math.max(1, TREND_WIDTH / rows.length - TREND_BAR_GAP)
  return (
    <>
      <h3 className={css.trendTitle}>{title}</h3>
      <svg className={css.chart} viewBox={`0 0 ${TREND_WIDTH} ${TREND_HEIGHT}`} role="img" aria-label={title}>
        {rows.map((row, index) => {
          const barHeight = Math.max(1, Math.round(row.totalTokens / max * TREND_HEIGHT))
          return (
            <g key={row.id}>
              <title>{`${row.title} · ${formatTokens(row.totalTokens)}`}</title>
              <rect
                x={index * (barWidth + TREND_BAR_GAP)}
                y={TREND_HEIGHT - barHeight}
                width={barWidth}
                height={barHeight}
                className={css.bar}
              />
            </g>
          )
        })}
      </svg>
    </>
  )
}

/**
 * Render the sidebar footer trigger and the usage-dashboard modal.
 * @param props - composed slot props (wide column state, useSessions, locale).
 * @returns the trigger button and, while open, the dialog tree.
 */
export function DashboardAction({ wide, useSessions, t }: DashboardActionProps) {
  const [open, setOpen] = useState(false)
  const byId = useSessions(state => state.byId)
  const rows = useMemo(() => dashboardRows(byId), [byId])
  const totals = useMemo(() => dashboardTotals(rows, byId), [rows, byId])

  const billedInput = totals.uncachedInputTokens + totals.cacheReadTokens + totals.cacheWriteTokens
  const cacheHit = billedInput === 0
    ? null
    : Math.round(totals.cacheReadTokens / billedInput * 100)

  const cards: StatCard[] = [
    { key: 'total', label: t('token.total'), value: formatTokens(totals.totalTokens) },
    { key: 'input', label: t('token.input'), value: formatTokens(billedInput) },
    { key: 'output', label: t('token.output'), value: formatTokens(totals.outputTokens) },
  ]
  if (cacheHit !== null) {
    cards.push({ key: 'cacheHit', label: t('token.cacheHit'), value: t('cacheHit.value', { percent: cacheHit }) })
  }
  if (totals.cacheReadTokens > 0) {
    cards.push({ key: 'cacheRead', label: t('token.cacheRead'), value: formatTokens(totals.cacheReadTokens) })
  }
  if (totals.cacheWriteTokens > 0) {
    cards.push({ key: 'cacheWrite', label: t('token.cacheWrite'), value: formatTokens(totals.cacheWriteTokens) })
  }
  if (totals.turns > 0) cards.push({ key: 'turns', label: t('stat.turns'), value: String(totals.turns) })
  if (totals.steps > 0) cards.push({ key: 'steps', label: t('stat.steps'), value: String(totals.steps) })
  if (totals.llmMs > 0) cards.push({ key: 'llm', label: t('stat.llmTime'), value: formatDuration(totals.llmMs, t) })
  if (totals.toolMs > 0) cards.push({ key: 'tool', label: t('stat.toolTime'), value: formatDuration(totals.toolMs, t) })
  if (totals.decodeMs > 0) {
    cards.push({
      key: 'throughput',
      label: t('stat.throughput'),
      value: t('perSecond', { value: formatTokens(Math.round(totals.decodeTokens / (totals.decodeMs / 1_000))) }),
    })
  }

  return (
    <>
      <button
        type="button"
        className={wide ? css.trigger : `${css.trigger} ${css.rail}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('trigger')}
        onClick={() => { setOpen(true) }}
      >
        <IconDataOutline16 size={wide ? 16 : 18} />
        {wide && <span className={css.triggerLabel}>{t('trigger')}</span>}
      </button>
      <Modal
        open={open}
        onClose={() => { setOpen(false) }}
        title={t('title')}
        closeLabel={t('close')}
        className={css.dialog as string}
      >
        {rows.length === 0
          ? <p className={css.empty}>{t('empty')}</p>
          : (
            <>
              <p className={css.sessionCount}>{t('sessions', { count: rows.length })}</p>
              <div className={css.cards}>
                {cards.map(card => (
                  <div key={card.key} className={css.card}>
                    <div className={css.cardLabel}>{card.label}</div>
                    <div className={css.cardValue}>{card.value}</div>
                  </div>
                ))}
              </div>
              <TrendChart rows={rows} title={t('trend.title')} />
              <h3 className={css.tableTitle}>{t('table.title')}</h3>
              <div className={css.tableWrap}>
                <table className={css.table}>
                  <thead>
                    <tr>
                      <th>{t('table.session')}</th>
                      <th className={css.model}>{t('table.model')}</th>
                      <th>{t('table.turns')}</th>
                      <th>{t('table.input')}</th>
                      <th>{t('table.output')}</th>
                      <th>{t('table.total')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => (
                      <tr key={row.id}>
                        <td className={css.sessionName}>{row.title}</td>
                        <td className={css.model}>{row.model ?? '—'}</td>
                        <td>{row.turns === null || row.steps === null ? '—' : `${row.turns} / ${row.steps}`}</td>
                        <td>{formatTokens(row.inputTokens)}</td>
                        <td>{formatTokens(row.outputTokens)}</td>
                        <td>{formatTokens(row.totalTokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
      </Modal>
    </>
  )
}
