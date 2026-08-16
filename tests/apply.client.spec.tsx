/** Usage-dashboard footer-action registration over the slots service. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-usage-dashboard/client'

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const slots = ctx.get('slots') as SlotRegistry
  slots.register(
    { name: 'root', children: { 'sidebar': { kind: 'single', scope: 'root' } } } as never,
    () => null,
  )
  if (declare) {
    // The sidebar shell's declaration: the footer-action hole exists only
    // while its owner entry is mounted.
    slots.register(
      { name: 'sidebar', children: { 'sidebar.footer.action': { kind: 'list', scope: 'root' } } } as never,
      () => null,
    )
  }
  return { ctx, slots }
}

describe('usage-dashboard apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('registers the footer action beside Settings', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entries = b.slots.entries('sidebar.footer.action')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.options.id).toBe('usage-dashboard')
    // Copy rides the standard locale seat, not the inject face.
    expect(entries[0]!.locale).toBe('dashboard')
  })

  it('stays pending while no live owner declared the footer-action slot', async () => {
    const b = await bench(false)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('sidebar.footer.action')).toHaveLength(0)
    await fiber.dispose()
    // A later declaration never resurrects a disposed injection.
    b.slots.register(
      { name: 'sidebar', children: { 'sidebar.footer.action': { kind: 'list', scope: 'root' } } } as never,
      () => null,
    )
    expect(b.slots.entries('sidebar.footer.action')).toHaveLength(0)
  })

  it('removes the entry on teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
    expect(b.slots.entries('sidebar.footer.action')).toHaveLength(0)
  })
})
