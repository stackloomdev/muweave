# Muweave · 幕织

**把内容，编织成故事。**

Muweave 是运行在浏览器里的图文视频工作台。Agent 通过原生 WebMCP 读取场景、修改文字、导入图片、调整配音和字幕、发起导出；你可以随时在画布上接手。两种操作共用工程状态、版本检查和撤销历史。

当前为 early preview。代码与原创示例采用 MIT。

## 使用和开发

部署后的站点直接打开即可使用。编辑、保存、素材处理与导出都在浏览器执行，不需要安装 FFmpeg、Chromium 或本地业务服务。

源码开发需要 Node.js 22.12+ 和 pnpm 10：

```sh
pnpm install
pnpm dev
```

浏览器访问 `http://localhost:4175/`。生产构建预览：

```sh
pnpm build
pnpm start
```

`pnpm start` 只提供静态文件。Vercel 可使用仓库中的 `vercel.json`：构建命令 `pnpm build`，发布目录 `apps/studio/dist`。其他静态 HTTPS 托管也可使用该目录，无需 Serverless Functions。当前尚未实测公网部署。

## 功能

- 可编辑场景、文字、图片、形状、图层、编组和独立 4:3 封面。
- IndexedDB 自动保存、整批撤销 / 重做、乐观版本检查、持久请求去重。
- 文件选择或拖入图片、音频和字体；浏览器解码、规范化、测量配音时长和波形。
- 整数微秒时间轴、试听、首尾静音裁剪建议、字幕同步和 SRT 导入 / 导出。
- 浏览器 ffmpeg.wasm 输出 1080p / 30 FPS H.264 + AAC MP4；Canvas 输出 PNG；浏览器打包可编辑工程 ZIP。
- 导出冻结版本，期间可继续编辑；支持取消、成片预览、下载和刷新后读取完成记录。
- 原生 WebMCP 的 16 个工具。没有 WebMCP 的浏览器也可使用编辑器，接入说明见 [Codex 指南](integrations/codex/README.md)。

## 数据与限制

工程和素材保存在**当前浏览器、当前站点来源**的 IndexedDB 中。换域名、端口、浏览器或设备不会自动同步。清除站点数据会删除其中的工程；请通过工程包备份和迁移。素材不上传服务器。生成图片和配音的模型仍在宿主侧，生成结果通过浏览器文件选择器导入。

单素材最多 100 MiB，处理后的文件也受同样限制；音频规范化为 PCM WAV，因此长音频可能先达到该限制。工程包解压内容最多 250 MiB。撤销保留最近 40 次操作，素材暂不自动垃圾回收，避免误删历史 / 导出快照引用。

视频首次使用加载约 31 MiB 原始 WASM 资源。导出期间需保持页面打开，关闭或刷新不会在后台续跑。长工程、大量高分辨率图片、移动端内存和浏览器差异仍需进一步验证；短片实测见 [验证记录](docs/VALIDATION.md)。

## 从旧本地版本迁移

旧工程文件不会被自动删除。已导出的 `.muweave.zip` 可从工程列表直接导入。旧版目录还没有工程包时，可以用一次性辅助脚本：

```sh
pnpm migrate:legacy ~/.muweave/projects ./legacy-bundles
```

脚本只读旧目录，将每个工程的当前版本与素材导出为 ZIP；随后在浏览器中选择工程包。导入会创建新工程和新撤销历史；原目录的历史和旧成片保留。这个脚本不是应用运行所需的服务。

## 开发验证

```sh
pnpm check
pnpm exec playwright install chromium
pnpm test:e2e
pnpm format:check
```

单元测试覆盖事务、并发、回执、历史、快照和时间轴。真实浏览器测试覆盖导入、画布交互、导出、取消及重开；测试中的原生 FFprobe / FFmpeg 仅用于独立复核成片，需要开发者另行安装，不被网页调用。

## 目录与授权

`apps/studio` 包含浏览器 UI、存储、素材处理和导出；`packages/schema`、`core`、`renderer`、`webmcp` 提供共用数据模型、编辑逻辑、Canvas 和 Agent 接口。架构见 [ARCHITECTURE](docs/ARCHITECTURE.md)。

内置字体为 Google Fonts 官方 **Roboto** 和 **Noto Sans SC**，采用 OFL 1.1，允许商用和随软件分发；字体本地加载。字体许可与来源见 [字体说明](licenses/README.md)，其他依赖及 ffmpeg.wasm 分发事项见 [第三方声明](THIRD_PARTY_NOTICES.md)。用户素材不纳入源码分发。
