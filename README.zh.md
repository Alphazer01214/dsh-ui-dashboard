# dsh-usage-dashboard

[English](README.md) | 中文

![dashboard](./assets/dashboard.png)

面向 DeepSeek Harness Web 部署的用量仪表盘，以**一等公民组合插件**（一个宿主半边 + 一个受信任的浏览器半边）的形式交付。它用一个持久的、跨会话的用量台账替换侧栏内置的用量对话框，解决内置仪表盘的四个结构性问题：

1. **不依赖手动展开。** 内置仪表盘只折叠浏览器已加载的会话。本插件在激活时直接从会话日志回填所有已持久化会话，之后实时折叠每条已提交事件——无需先打开任何会话。
2. **删除会话不会减少统计。** 台账存放在自己的存储域（harness 存储根目录下的 `usage_dashboard`），与会话日志及其投影缓存完全分离。
3. **备份与迁移。** 对话框把整本台账导出为一个 JSON 文档，也支持重新导入——导入到新部署即可恢复全部历史，重复导入同一备份不会重复计数。
4. **数字精确，不多不少。** 折叠逐字段对齐 harness 自带的 `tokenUsage` / `sessionStats` 投影语义（已在随机事件序列上与 harness 折叠逐一差分验证）：同一步骤的 usage 采样是替换而非累加；fork/子代理的种子前缀被跳过，祖先历史恰好只计一次；每次写入还会与在线 `tokenUsage` 投影交叉核对，不一致时大声报错。

它同时记录**子代理使用的模型**（每个子代理是独立会话，归属其父会话），并把用量趋势改为**按天**绘制——输入/输出堆叠柱加累计曲线，支持近 7 天 / 近 30 天 / 全部窗口。

## 为什么是组合插件（并且不再弹批准框）

早期版本把仪表盘作为**动态 Cordis 包**按会话安装（通过 `autoload/` 装载器）。动态浏览器半边受 harness 客户端代码激活策略约束，因此每次启动 harness 都会在每个会话里弹出 `usage-dashboard` 的 Cordis 批准框。本版本把同一套宿主台账与同一个侧栏对话框挂载为 web profile 补丁中的普通组合行：浏览器半边属于受信任的页面组合，**不再定义动态插件、无需任何批准、也不会再弹窗**。台账数据本身不变，无缝延续。

## 环境要求

挂载了 `storage-domain`、`session-persistence` 与 `webServer` 的 DeepSeek Harness **web-profile** 部署（标准 web bundle 即满足）。插件只读取公开服务——不修改任何 harness 代码。

## 安装（每个部署）

1. 构建可部署包（或直接使用发布版自带的预构建 `lib/`）：

   ```sh
   node scripts/build.mjs   # 生成 lib/index.js（宿主）+ lib/client.js（浏览器 bundle）
   ```

2. 把包复制到 profile 的 packages 目录：

   ```sh
   cp -r . "$DSH_HOME/profiles/<profile>/packages/dsh-usage-dashboard"
   ```

3. 在 `<profile>/package.json` 中加入依赖并链接：

   ```json
   "dependencies": { "dsh-usage-dashboard": "file:./packages/dsh-usage-dashboard" }
   ```

   然后在 profile 目录里执行 `pnpm install`。

4. 在 `<profile>/cordis.patch.yml` 追加：

   ```yaml
   # 用量仪表盘：持久跨会话台账（宿主）+ 受信任侧栏仪表盘（浏览器）。不涉及动态插件批准。
   - insert:
       - id: usage-dashboard
         name: dsh-usage-dashboard
   # 只保留功能最全的仪表盘：禁用内置的仅投影侧栏操作（同一侧栏单元格）。
   - id: ui-dashboard
     disabled: true
   ```

5. 重启 harness。侧栏现在只显示一个由持久台账支撑的「用量」操作，对每个会话生效，且没有任何批准提示。

## 对话框内容

- **统计卡片** — 总 / 输入 / 输出 Token、缓存命中率、缓存读/写、会话数、轮次、步数、LLM 与工具耗时、解码吞吐。
- **用量趋势（按天）** — 输入/输出堆叠柱、累计曲线、图例、虚线网格、稀疏日期刻度与时间窗口选择。
- **模型用量** — 各模型汇总（含子代理计费的模型）与去重会话数。
- **会话明细** — 每会话 Token、最近计费模型、轮次/步数，子代理会话带「子代理」标记。
- **备份与迁移** — 导出（把 JSON 文档复制保存为文件）与导入（粘贴备份并合并）。

## 数据语义

- 每条台账记录以 `sessionId@createdAt` 为键，携带折叠状态（按天/按模型 Token 桶、轮次/步数/耗时、最近计费模型）与 seq 水位。记录只前进：写入按键串行化，低水位快照永远不会回退已存记录。
- 会话自身后缀从头部 `seedLength` 开始：fork 与子代理子会话恰好只计它们实际计费的部分，继承前缀归属祖先——整个 fork 树内合计为真实计费用量，没有任何重复计数。
- 在线会话通过带 `{ global: true }` 的 `session/event` 监听折叠（宿主根上下文本就收得到所有会话的事件；该标志让代码与作用域解耦）。激活时修复所有存量尾部、物化在线单元格，报表还会补扫台账从未见过的会话——插件停用期间新建的会话也会在报表中完整呈现。
- 备份文档格式为 `{ format: 'dsh-usage-dashboard-backup', version: 1, exportedAt, records }`。导入会校验每条记录并按键合并：仅当记录的 seq 高于已存记录时才被采纳，因此重复导入是幂等的。
- 浏览器半边通过同源 webServer 路由 `/usage-dashboard/report`、`/usage-dashboard/export`、`/usage-dashboard/import` 取数（由宿主半边注册）——组合行没有动态运行器的 `harness.handle`/`host.call` 通道。

## 已知限制

- **备份以文本传递。** 导出把 JSON 文档呈现在文本框中（复制保存为文件）；导入把同一份 JSON 粘贴回来。
- **按天分桶使用宿主机本地日历。** 总量从不依赖分桶；只有趋势图的分组依赖。
- **插件安装前日志已被删除的会话**无法重建——已无内容可折叠。存储中现存的一切都会被计入。
- 会话标题在可用时取自在线会话列表；已不在列表中的会话（如已删除）显示短 id。

## 仓库结构

- `src/host.js` — 规范宿主半边模块（台账、heal/backfill、report/export/import webServer 路由）。
- `src/client.js` — 规范浏览器半边模块（侧栏操作与对话框；`React` 由 bundle 包装器提供）。
- `scripts/build.mjs` — 从源码生成 `lib/index.js` 与 `lib/client.js`（浏览器 bundle 是 `window.__ModuleLoader__.load({ id, factory })` 交接格式）。
- `package.json` — 可部署包清单（`dsh.client` 声明 web 浏览器半边；`exports["./client"]` 指向 bundle）。
