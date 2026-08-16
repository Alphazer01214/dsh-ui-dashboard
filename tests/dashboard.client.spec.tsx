// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId, SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
// The component's d.ts drops empty type-only imports, so the test program
// loads the sessionStats projection-key merge itself.
import type {} from '@deepseek-ai/dsh-session-stats/client'
import { DashboardAction, dashboardRows, dashboardTotals, type DashboardActionProps } from '../src/client/DashboardAction.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
})

const t: DashboardActionProps['t'] = makeTranslate(zh)

function summary(
  id: SessionId,
  updatedAt: number,
  projectionValues: SessionSummary['projectionValues'] | undefined,
): SessionSummary {
  return {
    id,
    displayTitle: String(id),
    running: false,
    blank: false,
    updatedAt,
    ...(projectionValues === undefined ? {} : { projectionValues }),
  }
}

/** Object literals key on plain strings; the return type brands the keys. */
function record(map: Record<string, SessionSummary>): Record<SessionId, SessionSummary> {
  return map
}

function props(byId: Record<SessionId, SessionSummary>, wide = true) {
  const state = {
    ids: Object.keys(byId) as SessionId[],
    byId,
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  } satisfies SessionListState
  function useSessions<T>(select: (snapshot: SessionListState) => T): T {
    return select(state)
  }
  return { wide, useSessions, t } as unknown as DashboardActionProps
}

const USAGE_A = {
  uncachedInputTokens: 1_200,
  outputTokens: 340,
  cacheReadTokens: 8_000,
  cacheWriteTokens: 460,
  model: 'deepseek-chat',
}
const USAGE_B = {
  uncachedInputTokens: 800,
  outputTokens: 210,
  cacheReadTokens: 2_000,
  cacheWriteTokens: 0,
}
const STATS_A = {
  turns: 3, steps: 9, llmMs: 61_000, toolMs: 0, ttftMs: 0, ttftSteps: 0,
  decodeMs: 20_000, decodeTokens: 300,
}
// Megabyte-scale input exercises the >=100 scaled rounding and the M suffix.
const USAGE_M = {
  uncachedInputTokens: 150_000_000,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}
// Wall times across the seconds and hours format branches.
const STATS_CLOCK = {
  turns: 1, steps: 1, llmMs: 3_661_000, toolMs: 45_000, ttftMs: 0, ttftSteps: 0,
  decodeMs: 0, decodeTokens: 0,
}

describe('dashboardRows / dashboardTotals', () => {
  it('keeps only projected sessions, newest first, with billed-input totals', () => {
    const byId = record({
      a: summary('a' as SessionId, 2, { tokenUsage: USAGE_A, sessionStats: STATS_A }),
      b: summary('b' as SessionId, 3, { tokenUsage: USAGE_B }),
      fresh: summary('fresh' as SessionId, 9, undefined),
    })
    const rows = dashboardRows(byId)
    expect(rows.map(row => row.id)).toEqual(['b', 'a'])
    expect(rows[1]).toEqual({
      id: 'a', title: 'a', model: 'deepseek-chat', turns: 3, steps: 9,
      inputTokens: 1_200 + 8_000 + 460,
      outputTokens: 340,
      totalTokens: 1_200 + 8_000 + 460 + 340,
      updatedAt: 2,
    })
    expect(rows[0]!.turns).toBeNull()
    expect(rows[0]!.model).toBeNull()

    const totals = dashboardTotals(rows, byId)
    expect(totals).toEqual({
      sessions: 2,
      uncachedInputTokens: 2_000,
      cacheReadTokens: 10_000,
      cacheWriteTokens: 460,
      outputTokens: 550,
      totalTokens: 2_000 + 10_000 + 460 + 550,
      turns: 3,
      steps: 9,
      llmMs: 61_000,
      toolMs: 0,
      decodeMs: 20_000,
      decodeTokens: 300,
    })
  })

  it('counts a session serving only sessionStats', () => {
    const byId = record({
      statsOnly: summary('statsOnly' as SessionId, 1, { sessionStats: STATS_A }),
    })
    const rows = dashboardRows(byId)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.totalTokens).toBe(0)
    expect(dashboardTotals(rows, byId).turns).toBe(3)
  })
})

describe('DashboardAction', () => {
  it('opens the dialog with cross-session cards, the trend chart, and the per-session table', () => {
    const byId = record({
      a: summary('a' as SessionId, 2, { tokenUsage: USAGE_A, sessionStats: STATS_A }),
      b: summary('b' as SessionId, 3, { tokenUsage: USAGE_B }),
    })
    render(<DashboardAction {...props(byId)} />)
    fireEvent.click(screen.getByRole('button', { name: '用量仪表盘' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('2 个会话')
    // 总 token: four disjoint buckets across both sessions (13_010 -> 13K).
    expect(screen.getByText('总 token').parentElement!.textContent).toContain('13K')
    expect(screen.getByText('输入 token').parentElement!.textContent).toContain('12.5K')
    expect(screen.getByText('输出 token').parentElement!.textContent).toContain('550')
    // Billed-input cache hit: 10_000 / 12_460 -> 80%.
    expect(screen.getByText('缓存命中').parentElement!.textContent).toContain('80%')
    expect(screen.getByText('LLM 时间').parentElement!.textContent).toContain('1 分 1 秒')
    expect(screen.getByText('平均吞吐').parentElement!.textContent).toContain('15 tok/s')
    // The trend chart folds one bar per session, newest last. (The Modal
    // portals to document.body, so the chart is queried off the img role.)
    const chart = screen.getByRole('img', { name: '用量趋势' })
    expect(chart.querySelectorAll('rect')).toHaveLength(2)
    expect([...chart.querySelectorAll('title')].map(node => node.textContent))
      .toEqual(['b · 3K', 'a · 10K'])
    // Per-session rows newest-first; b has no sessionStats so turns stay blank,
    // and no tokenUsage model so the model cell is blank too.
    expect(screen.getByText('b')).toBeTruthy()
    expect(screen.getByText('a')).toBeTruthy()
    expect(screen.getByText('deepseek-chat')).toBeTruthy()
    expect(screen.getAllByText('—')).toHaveLength(2)
    // The zero toolMs card drops out whole.
    expect(screen.queryByText('工具时间')).toBeNull()
    // Escape closes the shared Modal.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders the empty state until a session serves a usage projection', () => {
    render(<DashboardAction {...props({})} />)
    fireEvent.click(screen.getByRole('button', { name: '用量仪表盘' }))
    expect(screen.getByRole('dialog').textContent).toContain('还没有可统计的用量')
    expect(screen.queryByText('按会话')).toBeNull()
    expect(screen.queryByRole('img', { name: '用量趋势' })).toBeNull()
  })

  it('hides the trend chart while no session bills any token', () => {
    const byId = record({
      statsOnly: summary('statsOnly' as SessionId, 1, { sessionStats: STATS_A }),
    })
    render(<DashboardAction {...props(byId)} />)
    fireEvent.click(screen.getByRole('button', { name: '用量仪表盘' }))
    expect(screen.getByRole('dialog').textContent).toContain('1 个会话')
    expect(screen.queryByRole('img', { name: '用量趋势' })).toBeNull()
    expect(screen.queryByText('用量趋势')).toBeNull()
  })

  it('keeps a minimum bar width when the list outgrows the chart width', () => {
    const byId: Record<SessionId, SessionSummary> = {}
    for (let i = 0; i < 201; i++) {
      const id = `s${i}` as SessionId
      byId[id] = summary(id, i, {
        tokenUsage: { uncachedInputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      })
    }
    const view = render(<DashboardAction {...props(byId)} />)
    fireEvent.click(screen.getByRole('button', { name: '用量仪表盘' }))
    const chart = screen.getByRole('img', { name: '用量趋势' })
    const widths = [...chart.querySelectorAll('rect')].map(rect => Number(rect.getAttribute('width')))
    expect(widths).toHaveLength(201)
    expect(widths.every(width => width === 2)).toBe(true)
    view.unmount()
  })

  it('re-scales the trend to the selected window and labels both axes', () => {
    const now = Date.now()
    const byId = record({
      recent: summary('recent' as SessionId, now - 3 * 86_400_000, {
        tokenUsage: { uncachedInputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      }),
      old: summary('old' as SessionId, now - 8 * 86_400_000, {
        tokenUsage: { uncachedInputTokens: 50, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      }),
    })
    render(<DashboardAction {...props(byId)} />)
    fireEvent.click(screen.getByRole('button', { name: '用量仪表盘' }))
    const chart = (): SVGElement => screen.getByRole('img', { name: '用量趋势' })
    const axisTexts = (): (string | null)[] =>
      [...chart().querySelectorAll('text')].map(node => node.textContent)
    // 全部 (default): both bars; the y axis ticks 0 / 50 / 100.
    expect(chart().querySelectorAll('rect')).toHaveLength(2)
    expect(axisTexts()).toContain('0')
    expect(axisTexts()).toContain('50')
    expect(axisTexts()).toContain('100')
    expect(screen.getByRole('button', { name: '全部' }).getAttribute('aria-pressed')).toBe('true')
    // 近 7 天 keeps only the recent session.
    fireEvent.click(screen.getByRole('button', { name: '近 7 天' }))
    expect(chart().querySelectorAll('rect')).toHaveLength(1)
    expect([...chart().querySelectorAll('title')].map(node => node.textContent)).toEqual(['recent · 100'])
    expect(screen.getByRole('button', { name: '近 7 天' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '全部' }).getAttribute('aria-pressed')).toBe('false')
    // 近 30 天 keeps both.
    fireEvent.click(screen.getByRole('button', { name: '近 30 天' }))
    expect(chart().querySelectorAll('rect')).toHaveLength(2)
  })

  it('notes an empty window instead of rendering an empty chart', () => {
    const byId = record({
      old: summary('old' as SessionId, Date.now() - 8 * 86_400_000, {
        tokenUsage: { uncachedInputTokens: 50, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      }),
      olderStats: summary('olderStats' as SessionId, Date.now() - 9 * 86_400_000, { sessionStats: STATS_A }),
    })
    render(<DashboardAction {...props(byId)} />)
    fireEvent.click(screen.getByRole('button', { name: '用量仪表盘' }))
    // 全部: both rows render; the zero-token bar keeps the 1px height floor.
    expect(screen.getByRole('img', { name: '用量趋势' }).querySelectorAll('rect')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '近 7 天' }))
    expect(screen.getByText('该时间尺度下没有可统计的会话')).toBeTruthy()
    expect(screen.queryByRole('img', { name: '用量趋势' })).toBeNull()
  })

  it('notes the window when only zero-token sessions fall inside it', () => {
    const byId = record({
      old: summary('old' as SessionId, Date.now() - 8 * 86_400_000, {
        tokenUsage: { uncachedInputTokens: 50, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      }),
      freshStats: summary('freshStats' as SessionId, Date.now() - 86_400_000, { sessionStats: STATS_A }),
    })
    render(<DashboardAction {...props(byId)} />)
    fireEvent.click(screen.getByRole('button', { name: '用量仪表盘' }))
    fireEvent.click(screen.getByRole('button', { name: '近 7 天' }))
    expect(screen.getByText('该时间尺度下没有可统计的会话')).toBeTruthy()
    expect(screen.queryByRole('img', { name: '用量趋势' })).toBeNull()
  })

  it('renders the chart for a single session without a time span', () => {
    const byId = record({
      solo: summary('solo' as SessionId, 7, {
        tokenUsage: { uncachedInputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      }),
    })
    render(<DashboardAction {...props(byId)} />)
    fireEvent.click(screen.getByRole('button', { name: '用量仪表盘' }))
    expect(screen.getByRole('img', { name: '用量趋势' }).querySelectorAll('rect')).toHaveLength(1)
  })

  it('renders the rail trigger without the visible label', () => {
    const byId = record({
      a: summary('a' as SessionId, 2, { tokenUsage: USAGE_A }),
    })
    const view = render(<DashboardAction {...props(byId, false)} />)
    const trigger = screen.getByRole('button', { name: '用量仪表盘' })
    expect(trigger.textContent).toBe('')
    view.unmount()
  })

  it('formats megabyte-scale tokens and the seconds/hours duration branches', () => {
    const byId = record({
      big: summary('big' as SessionId, 4, { tokenUsage: USAGE_M, sessionStats: STATS_CLOCK }),
      // 1 token beside 150M scales to a sub-pixel height: the bar keeps the
      // 1px floor so a tiny session stays visible on the chart.
      tiny: summary('tiny' as SessionId, 5, {
        tokenUsage: { uncachedInputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      }),
    })
    render(<DashboardAction {...props(byId)} />)
    fireEvent.click(screen.getByRole('button', { name: '用量仪表盘' }))
    // 150_000_001 -> scaled 150 (>= 100) -> "150M".
    expect(screen.getByText('总 token').parentElement!.textContent).toContain('150M')
    // 3_661_000 ms -> 1h 1m; 45_000 ms -> 45s.
    expect(screen.getByText('LLM 时间').parentElement!.textContent).toContain('1 时 1 分')
    expect(screen.getByText('工具时间').parentElement!.textContent).toContain('45 秒')
  })
})
