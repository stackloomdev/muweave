# 浏览器架构

```text
UI / 原生 WebMCP
        ↓
client / storage → schema + core 校验与事务
        ↓                    ↓
IndexedDB                Konva renderer
工程·素材·历史·任务        预览·缩略图·PNG·固定时间视频帧
        ↓                    ↓
Blob URL / 下载          ffmpeg.wasm worker → MP4
```

`apps/studio/src/storage.ts` 是唯一持久提交者。一次 IndexedDB readwrite 事务同时保存新工程、历史、素材与回执。独立标签页也受同一数据库事务串行约束；`expectedRevision` 阻止覆盖，`requestId` 与规范化参数哈希负责持久去重。事务中只等待 IndexedDB 请求，哈希与媒体处理在事务外完成。[IndexedDB 事务说明](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)。

`client.ts` 提供编辑器和 Agent 共用的应用操作，以及按素材哈希 / 导出任务分组的 Blob URL。素材存储为不可变内容寻址 Blob；撤销不会删除仍被历史或快照引用的素材。工程与素材只保存于当前站点来源下的浏览器，不会上传。

`media.ts` 用 Canvas 栅格化图片，Web Audio 解码及 48 kHz 重采样，以实际帧数计算时长和波形。静音分析只提供首尾裁剪建议，保留句中停顿；不自动修改工程。字体仍使用自托管 Google Fonts Roboto / Noto Sans SC，可选导入其他字体。

`exports.ts` 创建含冻结工程的持久任务，浏览器执行并在同一事务保存成品 Blob 与成功状态。关闭页面不能继续导出。Web Locks 标识存活的持有页面，新标签不会中断其他页面的任务；打开时发现持有者已离开则标记中断。无 Web Locks 时采用保守超时恢复。[Web Locks 文档](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)。

`browser-export.ts` 用与预览相同的整数时间求值和 Canvas 渲染器逐帧绘制，按最多 60 帧或约 24 MiB PNG 批次编码并释放帧文件，再统一混音、完整解码、校验元数据。该阈值不是总内存上限：压缩片段、音频、最终输出和 WASM 内存仍占空间。

`bundles.ts` 在浏览器打包 / 解压 ZIP，限制路径、解压大小和素材哈希；整包处理完成后才事务性添加工程。兼容旧 schemaVersion=1 工程包，导入为新工程和新撤销历史。

`packages/webmcp` 只注册浏览器原生工具，不需要 MCP 服务器。文件交接为 prepare → 选择文件 → status → import；普通浏览器无原生 WebMCP 时仍能用完整 UI。生图、配音模型不包含在网页内。

开发由 Vite 提供静态资源和热更新；`pnpm start` 预览生产构建。独立网页只需静态 HTTPS 站点；ChatGPT 模式额外提供可选的无状态 MCP 函数，不引入工程数据库或媒体服务。测试里的 Node、Sharp、FFprobe/FFmpeg 是独立验收工具，不属于应用执行链路。

## 远程 MCP 适配层

`packages/mcp/src/drafts.ts` 复用 schema/core，将完整快照转换为新的快照；不依赖浏览器存储。`apps/mcp` 通过官方 SDK 提供 Streamable HTTP，每次请求新建并关闭 server/transport。`api/mcp.ts` 引用构建后的适配器供 Vercel 部署；唯一模块级内容是公共组件 HTML 和配置。

`apps/chatgpt` 通过 MCP Apps bridge 接收工具结果，实例内保存预览状态，复用 Konva renderer。工程包用浏览器 ZIP 生成，经宿主下载；主站 `bundles.ts` 导入 ZIP 或受限的无素材 JSON，产生新的本地工程。工具结果、项目数据不进入公共组件 HTML 或 URL。能力限制、重试语义、无登录边界见 [ChatGPT 接入](CHATGPT.md)。
