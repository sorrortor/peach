# AdGuard 通用网页过滤数据

规则来源为 AdGuard Base（含 EasyList）与 Popups 两份 Safari 优化订阅，地址与内容 SHA-256 见 `manifest.json`。`sources.txt.gz` 保留完整订阅输入；`rules.json.gz` 为原生 WebKit 规则，校验值也在 manifest 中。

转换复用 [SafariConverterLib 4.3.1](https://github.com/AdguardTeam/SafariConverterLib/tree/v4.3.1)，GPL-3.0，见 `LICENSE`。官方 ConverterTool 为 arm64，SHA-256 固定于实现及 manifest。其 Swift PSL 资源使用上游 Package.resolved 的 `7ccee9d576d4ca45219440e346f61117f44c816f`；MIT 许可证见 `LICENSE.swift-psl`。官方发布的单独工具需要同目录的 `swift-psl_PublicSuffixList.bundle`，Peach 从固定 revision 取得三份原始二进制数据并分别校验，不从文本源码缓存提取二进制资源。

维护者在 Apple Silicon Mac 的项目环境运行 `python -m peach.web_watch_filters --bundle-dir web/vendor/adguard-filters` 生成快照、完整输入、许可证和校验信息。转换目标为 Safari 15，关闭 advanced blocking；只采用原生网络、CSS 隐藏及例外规则，不执行订阅中的 JavaScript、scriptlet、HTML 过滤或重定向。

运行时直接使用随包快照。Apple Silicon Mac 打开观看窗口后，每 24 小时最多尝试一次后台更新；工具约 2.2 MB，PSL 资源约 0.5 MB，只在缺失或校验不符时下载。完整转换成功才原子发布规则缓存，下次打开窗口生效；工具固定版本，不自动更新可执行文件版本。Intel Mac 使用随包快照。所有订阅请求使用固定公开地址，不携带正在观看的网页、账号或浏览历史。
