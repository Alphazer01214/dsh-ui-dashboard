/**
 * Usage-dashboard plugin, browser half: contributes one sidebar footer
 * action that folds the session list's retained projection values
 * (`tokenUsage`, `sessionStats`) into cross-session totals. All data
 * arrives through the list mirror the runtime already keeps per session,
 * so the plugin issues no RPC and holds no state beyond dialog visibility.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { DashboardAction } from './DashboardAction.tsx'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { en, NS, zh, type DashboardKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Usage-dashboard copy. */
    'dashboard': DashboardKey
  }
}

export type { DashboardActionProps } from './DashboardAction.tsx'

/** Required services for locale registration and footer-slot contribution. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register the dictionaries and the footer action.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'usage-dashboard: dictionaries')
  ctx.slots.inject(
    'sidebar.footer.action',
    () => ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'usage-dashboard',
      // Before the cordis panel: reading totals precedes plugin management.
      order: 0,
      locale: NS,
    }, DashboardAction),
  )
}
