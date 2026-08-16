# @deepseek-ai/dsh-usage-dashboard

English | [中文](README.zh.md)

Usage dashboard for the web sidebar: one footer action beside Settings that folds the session list's retained projection values â€?the durable `tokenUsage` buckets and the whole-log `sessionStats` counts â€?into cross-session totals. The trigger renders the sidebar's compact row while the column is wide and the rail circle while collapsed; both open the same modal dialog. The modal shows a session count, a stat-card grid, a per-session usage trend chart, and a per-session table sorted newest first: session, newest billed model, turns/steps, and the three token columns. The trend chart places one bar per session at its real `updatedAt` position, scaled to the tallest session inside a selectable time window (7 days / 30 days / all), with labeled axes: the y ticks read 0 / half / max in compact token form and the x labels name the window's start and end dates. Cards cover total, billed input, output, cache-hit share, cache read/write, turns, steps, LLM and tool wall time, and average decode throughput; a card whose figure is zero or unavailable drops out whole, and a list with no projected session shows the empty state instead. Per-session turns/steps stay blank (`â€”`) while a session serves no `sessionStats` value, and the model cell stays blank while a session serves no `tokenUsage` value. All figures are whole-log durable numbers, so paging and compaction cannot change them. The plugin issues no RPC and holds no state beyond dialog visibility and the trend window selection: every read goes through the standard `useSessions` hook over the list mirror the runtime already keeps, and it registers one entry in the `sidebar.footer.action` list slot with copy on the standard locale seat. The node half is an empty apply so the package appears in the host cordis.yml roster.

## Model Experience

None, as the dashboard renders already-logged projection values in the browser; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Scope is the live session list** â€?totals fold the list mirror the runtime keeps, so sessions outside it (archived or unloaded workspaces) do not count. The trend chart folds per-session totals at their real `updatedAt` positions; the time window filters and re-scales that fold, with no per-day bucketing or within-session series.
- **Model labels for sessions checkpointed before the label existed** â€?the model cell reads the `tokenUsage` projection's newest `request/header`, so a session last checkpointed before the label shipped keeps its model cell blank until the session is opened (tail replay refolds the label) or next checkpointed. Token totals are unaffected.
