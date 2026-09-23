# 字体来源与授权

项目内置字体来自 Google Fonts 官方 CSS API 提供的 WOFF2 可变字体分片，文件随项目本地分发。浏览器通过 `unicode-range` 只加载当前文字需要的分片；界面、画布、字幕与导出无需访问 Google Fonts 在线服务。

| 字体         | 用途                                       | 官方来源                                                                                                                    | 授权原文                                                             |
| ------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Roboto       | 界面英文、数字；可选文字图层               | [Google Fonts / Roboto](https://github.com/google/fonts/tree/e44c4b011a820c2cbe2fd2cfa8052037d7edb571/ofl/roboto)           | [OFL-Roboto.txt](../apps/studio/public/fonts/OFL-Roboto.txt)         |
| Noto Sans SC | 界面中文、默认文字图层、字幕；中文回退字体 | [Google Fonts / Noto Sans SC](https://github.com/google/fonts/tree/e44c4b011a820c2cbe2fd2cfa8052037d7edb571/ofl/notosanssc) | [OFL-NotoSansSC.txt](../apps/studio/public/fonts/OFL-NotoSansSC.txt) |

两款字体均采用 SIL Open Font License 1.1，允许商用、嵌入及随软件分发。分发字体时须保留原始版权和授权声明，不能单独出售字体文件；完整条件以随附的授权原文为准。这些声明属于字体作者，Muweave 的原创代码和示例采用独立的 [MIT 许可证](../LICENSE)。

WOFF2 文件按官方响应原样保存，未重新切割或修改字体。每片的官方版本化地址、字形范围、字节数和 SHA-256，以及 CSS 请求与授权原文来源，均记录在 [SOURCES.json](../apps/studio/public/fonts/SOURCES.json)。文件名含内容哈希，Vercel 可长期缓存；更新内容时必须生成新文件名，并同步样式、来源和许可证。普通构建使用已提交的分片，不需要联网下载字体。
