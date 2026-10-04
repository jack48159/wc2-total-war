# 世界征服者:总体战

TOM-AKA 创作的战争策略游戏重制项目。Windows 浏览器、Android 和 iOS 共用游戏引擎与界面源码，支持单人对局、联机对战、战区指挥部和 MCP Agent 桥接。

## Windows

安装 Node.js 22.13 或更新版本，在项目根目录运行 `node server.js`。浏览器访问 `http://127.0.0.1:8642`。Windows 版本目前采用本地网页运行方式。

## Android

在 `mobile/android` 运行 `npm ci`、`npm run build:web`、`npm run android:sync`，然后在 `mobile/android/android` 运行 `gradlew.bat assembleDebug`。需要 JDK 21、Android SDK 34。

## iOS

在 macOS 的 `mobile/ios` 运行 `npm ci`、`npm run build:web`、`npm run ios:sync`，再用 Xcode 打开 `ios/App/App.xcodeproj`。安装到设备需要自己的签名配置。仓库提供生成未签名 IPA 的 GitHub Actions。

## 数据与联机

本地玩家档案和存档保存在设备浏览器/WebView 的 IndexedDB；联机另行登录服务器账号。仓库不包含真实账号、存档、数据库、证书或密钥。自建联机服务可在 `multiplayer` 安装依赖后运行 `node server.mjs`。

## MCP

桥服务为 `tools/mcp/bridge_server.mjs`，MCP 服务为 `tools/mcp/wc2_mcp_server.mjs`，使用说明见 `skills`。每个 Agent 仅操作绑定国家。

## 授权范围

本项目原创程序代码采用 MIT 许可证。图片、音乐、字体及其他第三方素材不属于该许可证授权范围，其权利和许可证由原权利人保留；发布者应自行确认素材的使用条件。本项目与原游戏发行商无隶属关系。
