# @deepseek-ai/dsh-client-ui-dashboard

English | [中文](README.zh.md)

Usage dashboard for the web sidebar: one footer action beside Settings that folds the session list's retained projection values — the durable `tokenUsage` buckets and the whole-log `sessionStats` counts — into cross-session totals. The trigger renders the sidebar's compact row while the column is wide and the rail circle while collapsed; both open the same modal dialog. The modal shows a session count, a stat-card grid, a per-session usage trend chart (one bar per session in updated order, scaled to the tallest), and a per-session table sorted newest first: session, newest billed model, turns/steps, and the three token columns. Cards cover total, billed input, output, cache-hit share, cache read/write, turns, steps, LLM and tool wall time, and average decode throughput; a card whose figure is zero or unavailable drops out whole, and a list with no projected session shows the empty state instead. Per-session turns/steps stay blank (`—`) while a session serves no `sessionStats` value, and the model cell stays blank while a session serves no `tokenUsage` value. All figures are whole-log durable numbers, so paging and compaction cannot change them. The plugin issues no RPC and holds no state beyond dialog visibility: every read goes through the standard `useSessions` hook over the list mirror the runtime already keeps, and it registers one entry in the `sidebar.footer.action` list slot with copy on the standard locale seat. The node half is an empty apply so the package appears in the host cordis.yml roster.

## Model Experience

None, as the dashboard renders already-logged projection values in the browser; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Scope is the live session list** — totals fold the list mirror the runtime keeps, so sessions outside it (archived or unloaded workspaces) do not count, and the trend chart folds per-session totals in updated order, with no per-day bucketing or within-session series.
- **Model labels for sessions checkpointed before the label existed** — the model cell reads the `tokenUsage` projection's newest `request/header`, so a session last checkpointed before the label shipped keeps its model cell blank until the session is opened (tail replay refolds the label) or next checkpointed. Token totals are unaffected.
