# iOS 个人侧载工程骨架

此目录是 Capacitor 8 的工程配置。网页代码仍来自 `../../public`，游戏规则、AI、场景和联机协议没有 iOS 副本。`dist/ios_web` 是打包产物，不需要提交。当前 Windows 机器无法编译 iOS 原生工程；需要 macOS、Xcode 和签名身份。

## macOS 构建

需要 Node 22+、Xcode 和 iOS SDK。进入 `mobile/ios` 后执行：

```sh
npm install
npm run build:web            # 可改成 build:web:min；混淆另装 javascript-obfuscator 后用 --obfuscate
npx cap add ios              # 仅在 ios/ 目录不存在时执行；本交付已生成骨架
./configure_native.sh       # 修改生成的 Info.plist
npx cap sync ios
npx cap open ios
```

Capacitor 配置指向 `../../dist/ios_web`，不要把 `server.url` 配成远端地址，否则离线网页资源不会被封入 app。原有登录、存档、联机代码使用 `http://208.87.207.49:8643` 和相应 WebSocket；平台层在原生壳里经 CapacitorHttp 发 HTTP 请求，避开 WebView 的跨域限制，WebSocket 仍沿用现有协议。`configure_native.sh` 为该 IP 配置 ATS 例外。真实设备访问、原生 HTTP 桥接与 WebSocket 握手仍须在 macOS 真机验证。长期应给服务部署 HTTPS/WSS 后移除例外。

Xcode 中选 App target → Signing & Capabilities → 选择自己的 Team，改为唯一的 Bundle Identifier，连接设备后选择设备 Run。Archive → Distribute App → Development/Ad Hoc 导出签名 IPA（可用选项取决于账户和 provisioning profile）。免费 Apple ID 的 Personal Team 签名通常只有约 7 天有效，需重新构建/签名；付费 Apple Developer Program 的开发或 Ad Hoc profile 通常最长 1 年，仍须按实际证书、profile 和设备登记确认。不要在仓库或 Actions 中提交 Apple ID 密码、签名证书及 profile。

在 Windows 侧载时，把已签 IPA 交给 Sideloadly 安装；或让 AltStore/AltServer 在同一 Apple ID 下导入 IPA 并按其刷新流程续签。免费账号的 7 天续签不能省略。未签 IPA 需由侧载工具用你自己的 Apple ID 签名后安装；别人签的 IPA 不能直接当作你的个人签名使用。

可选的 `.github/workflows/ios-unsigned-template.yml` 仅是手动触发模板：macOS runner 生成未签构建，下载后仍需由你在 Xcode 或侧载工具签名。启用前确认 runner 的磁盘容量、编译时间和 GitHub 配额。此阶段不上传任何构建物到外部。

## 产物体积

`npm run build:web` 同时写入 `../../dist/ios_bundle_report.json`。现在按原样拷贝全部 `public` 和桌面服务映射的 `project/app/src/main/assets` 及关卡数据，先不要删素材；报告会标出 `assets`、`leaders`、`backdrops` 等目录。后续可移除无引用的旧版本图、按设备分辨率缩图、转 WebP/AVIF，保留原图备份再比对画质。

当前 `--minify` 产物约 **881 MB（840 MiB）**，其中 `assets` 约 508 MB、`leaders` 约 277 MB。这个体积会增加 IPA 安装和更新成本。压缩代码只减少约 0.9 MB，素材瘦身应优先处理。

参考：[Capacitor iOS 环境要求](https://capacitorjs.com/docs/getting-started/environment-setup)、[Capacitor HTTP](https://capacitorjs.com/docs/apis/http)、[Apple ATS 例外](https://developer.apple.com/documentation/BundleResources/Information-Property-List/NSAppTransportSecurity/NSExceptionDomains)、[Apple 免费账号限制](https://developer.apple.com/support/compare-memberships/)、[AltStore 续签](https://faq.altstore.io/altstore-classic/your-altstore)。

## 对战桥(LLM 接管)在 iPhone 上使用

- 桥进程跑在**电脑**上(电脑端游戏服务启动时会自动拉起，监听 `0.0.0.0:8651`)，手机通过局域网连它；Windows 防火墙需允许 Node.js 入站 8651。
- 手机和电脑要在同一网络。第一次连接时 iOS 会弹“本地网络”权限，需允许(`configure_native.sh` 已写入 `NSLocalNetworkUsageDescription`)。
- 手机上：对局配置 → LLM 接管 开 → 在接管配置页点“桥地址”，填电脑的局域网地址(页面会显示，如 `http://192.168.0.4:8651`)。
- 电脑上的 agent 仍用 `127.0.0.1:8651` 连桥，对局 ID 用手机页面里复制出的指令。
- 新增的 BGM(`public/assets/music/`)和音效(`public/assets/sfx/`)随 `npm run build:web` 一起打进 app。
