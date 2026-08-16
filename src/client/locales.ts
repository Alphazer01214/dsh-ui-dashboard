/** `dashboard` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'dashboard'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger': '用量仪表盘',
  'title': '用量仪表盘',
  'close': '关闭',
  'sessions': '{count} 个会话',
  'stat.turns': '总轮次',
  'stat.steps': '总步数',
  'stat.llmTime': 'LLM 时间',
  'stat.toolTime': '工具时间',
  'stat.throughput': '平均吞吐',
  'token.input': '输入 token',
  'token.output': '输出 token',
  'token.cacheRead': '缓存读取',
  'token.cacheWrite': '缓存写入',
  'token.cacheHit': '缓存命中',
  'token.total': '总 token',
  'perSecond': '{value} tok/s',
  'cacheHit.value': '{percent}%',
  'trend.title': '用量趋势',
  'table.title': '按会话',
  'table.session': '会话',
  'table.model': '模型',
  'table.turns': '轮次 / 步数',
  'table.input': '输入',
  'table.output': '输出',
  'table.total': '总计',
  'duration.hours': '{hours} 时 {minutes} 分',
  'duration.minutes': '{minutes} 分 {seconds} 秒',
  'duration.seconds': '{seconds} 秒',
  'empty': '还没有可统计的用量',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<DashboardKey, string> = {
  'trigger': 'Usage dashboard',
  'title': 'Usage dashboard',
  'close': 'Close',
  'sessions': '{count} sessions',
  'stat.turns': 'Total turns',
  'stat.steps': 'Total steps',
  'stat.llmTime': 'LLM time',
  'stat.toolTime': 'Tool time',
  'stat.throughput': 'Avg throughput',
  'token.input': 'Input tokens',
  'token.output': 'Output tokens',
  'token.cacheRead': 'Cache reads',
  'token.cacheWrite': 'Cache writes',
  'token.cacheHit': 'Cache hit',
  'token.total': 'Total tokens',
  'perSecond': '{value} tok/s',
  'cacheHit.value': '{percent}%',
  'trend.title': 'Usage trend',
  'table.title': 'By session',
  'table.session': 'Session',
  'table.model': 'Model',
  'table.turns': 'Turns / steps',
  'table.input': 'Input',
  'table.output': 'Output',
  'table.total': 'Total',
  'duration.hours': '{hours}h {minutes}m',
  'duration.minutes': '{minutes}m {seconds}s',
  'duration.seconds': '{seconds}s',
  'empty': 'No usage recorded yet',
}

/** Key domain of the `dashboard` namespace (zh is the source of truth). */
export type DashboardKey = keyof typeof zh
