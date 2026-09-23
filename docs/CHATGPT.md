# ChatGPT / MCP Apps 接入

这是一条可选的远程入口；独立幕织网页仍可纯静态运行，编辑、素材处理和视频导出均在浏览器中。远程 MCP 只对明确传入的文字/形状工程快照执行纯转换。

## 本地启动

```sh
pnpm install
pnpm dev                   # 网页：localhost:4175
pnpm dev:mcp               # 另一终端：127.0.0.1:4176/api/mcp
```

`dev:mcp` 先构建聊天画布及适配器再监听 loopback；开发进程只处理 MCP，不读取浏览器数据。改变代码后重新运行即可。`pnpm build` 构建网站、聊天组件与 MCP 适配器；仅需静态网站时运行 `pnpm build:studio`。

Vercel 入口为 `api/mcp.ts`，通过仓库中的构建命令和函数 includeFiles 配置打包聊天画布。不需要数据库、Redis、对象存储、OpenAI API key 或原生视频服务。`MUWEAVE_PUBLIC_ORIGIN` 可改为自己的 HTTPS 站点，构建和运行时必须一致；默认是 `https://muweave.vercel.app`。字体是公共静态资源，单独允许跨域加载，MCP 的用户结果禁止缓存。

## 在 ChatGPT 试用

1. 将代码部署到自己的公开 HTTPS 站点，MCP 地址为 `https://你的域名/api/mcp`。本地开发也可以用自己选择的安全隧道转发 4176 端口。
2. 在账户/工作区允许的情况下启用 ChatGPT Developer mode，添加远程 MCP 连接。这个首版只提供无状态转换，选择无认证。
3. 刷新工具列表，确认发现下面的 5 个工具。试用“创建两页分镜 → 修改第二页 → 预览 → 下载工程包”。
4. 在幕织网页点击工程列表 → 打开工程包。导入生成新的浏览器工程，再添加图片、配音并导出视频。宿主不支持组件下载时，可将工具返回的 `structuredContent.project` 保存为 `project.json`，同一入口也能导入。

插件源码在 `integrations/plugins/muweave`，包含便携 `plugin.json` / `mcp.json`、兼容 `.codex-plugin/plugin.json` / `.mcp.json` 和工作流 skill。接入自己的域名时同时修改两个 MCP 配置。插件包没有自动安装或提交目录审核；真实 ChatGPT 账户内的授权策略、组件下载和上架状态需要在目标账户验收，不能由本地协议测试推断。

官方文档：[构建 MCP](https://developers.openai.com/plugins/build/mcp-server)、[聊天内 UI](https://developers.openai.com/plugins/build/chatgpt-ui)、[插件打包](https://developers.openai.com/plugins/build/plugins)。

## 工具和数据契约

| 工具                     | 输入与行为                                              |
| ------------------------ | ------------------------------------------------------- |
| `muweave_capabilities`   | 查询限制与命令，不读取工程                              |
| `muweave_create_draft`   | 稳定 projectId、createdAt、标题和完整场景 → 工程快照    |
| `muweave_apply_commands` | projectId、完整 snapshot、batch、editedAt → 新快照      |
| `muweave_preview`        | projectId 与完整 snapshot → 画布、时间轴与校验结果      |
| `muweave_validate`       | projectId 与完整 snapshot → 结构/时间检查，不做事实核查 |

相同输入重试产生相同输出。create 的 ID、时间和场景必须重用；apply 的快照、batch、editedAt 必须重用。所有命令先通过现有 schema/core 校验，整批成功才返回结果。时间为整数微秒，默认不加场景间停顿。

首版每个工程最多 30 页、600 图层、600 条字幕、128 KiB；HTTP 请求最多 512 KiB。只接收文字/形状、字幕、配音文案与制作备注；不接收素材文件、音频绑定、图片节点、媒体 URL 或本机路径。完整快照会增加模型上下文开销，因此这不是大工程的云端编辑替代品。

## 用户隔离边界

- 每个 HTTP 请求创建独立 MCP server/transport，返回后关闭；没有服务器“当前工程”、用户工程表、会话表、任务表或结果缓存。
- 浏览器的原生 WebMCP 仍只操作所在页面的 IndexedDB；远程 MCP 没有读取它的接口。
- 工程 ID、requestId、MCP session、模型提供的 userId 都不能用于私人数据查找。公开资源只有不含用户数据的组件 HTML；没有 project.list、assets.get、jobs.get 或按 ID 读取工程接口。
- 全部 MCP 响应，包括错误，都设置 no-store。应用不记录请求参数、项目正文、凭证或工具输出；部署平台的访问日志与 ChatGPT 自己的数据政策另计。不落库不等于数据不经过服务器或宿主。
- 工程包在组件浏览器内生成，经宿主下载 API 交给用户；不生成包含工程内容的共享 URL。JSON/ZIP 导入生成新 ID，不按原 ID 覆盖已有工程。
- 组件实例不使用 localStorage / IndexedDB / BroadcastChannel 保存分镜；它只展示宿主传给这个实例的结果。主站浏览器库仍按站点来源隔离，同一浏览器配置里的 ChatGPT 账号切换不会分库。

这是**请求隔离**，不是带账号的云端多租户授权系统。如果调用方已经持有一份完整快照，服务就可以转换它；服务无法判断这份输入原本属于谁。projectId/expectedRevision 仅检查当前提交快照的一致性，不代表服务知道另一个对话中的最新版本，也没有跨请求持久回执。

以后增加私人保存/读取、云端素材或任务时，必须先加入 OAuth：从服务端验证过的凭证确定身份，每次操作校验工程/素材/任务所有权，缓存与幂等记录也按身份隔离。不得仅凭模型参数或工程 ID 授权。

## 验证

```sh
pnpm test:mcp
pnpm exec playwright test tests/e2e/mcp.spec.ts
pnpm check
pnpm test:e2e
```

HTTP 测试使用官方 MCP Client 连接真实 loopback 服务。UI 测试使用真实 Chromium 和符合 MCP Apps 消息格式的测试宿主，验证接收结果、两个画布隔离、拒绝其他 iframe 消息、宿主下载、ZIP/JSON 导入和 PNG 导出。这种测试不能代替 ChatGPT 自身的沙箱与文件下载验收。
