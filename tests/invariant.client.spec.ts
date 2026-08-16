import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as DashboardInvariant from '@deepseek-ai/dsh-usage-dashboard/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(DashboardInvariant).await()).resolves.toBeDefined()
  })

  it('node-half apply is a no-op host placeholder', async () => {
    const { apply } = await import('@deepseek-ai/dsh-usage-dashboard')
    apply()
    expect(true).toBe(true) // reaching here without throw is the contract
  })
})
