#!/bin/sh
set -eu
PLIST="$(dirname "$0")/ios/App/App/Info.plist"
if [ ! -f "$PLIST" ]; then echo "Run npx cap add ios first" >&2; exit 1; fi
PB=/usr/libexec/PlistBuddy
# WKWebView only: the existing multiplayer/auth origin is plain HTTP and WebSocket.
$PB -c 'Add :NSAppTransportSecurity dict' "$PLIST" 2>/dev/null || true
$PB -c 'Set :NSAppTransportSecurity:NSAllowsArbitraryLoadsInWebContent true' "$PLIST" 2>/dev/null || $PB -c 'Add :NSAppTransportSecurity:NSAllowsArbitraryLoadsInWebContent bool true' "$PLIST"
$PB -c 'Add :NSAppTransportSecurity:NSExceptionDomains dict' "$PLIST" 2>/dev/null || true
$PB -c 'Add :NSAppTransportSecurity:NSExceptionDomains:208.87.207.49 dict' "$PLIST" 2>/dev/null || true
$PB -c 'Set :NSAppTransportSecurity:NSExceptionDomains:208.87.207.49:NSExceptionAllowsInsecureHTTPLoads true' "$PLIST" 2>/dev/null || $PB -c 'Add :NSAppTransportSecurity:NSExceptionDomains:208.87.207.49:NSExceptionAllowsInsecureHTTPLoads bool true' "$PLIST"
# iOS 14+ 访问局域网设备(电脑上的对战桥)需要本地网络用途说明
$PB -c 'Set :NSLocalNetworkUsageDescription 用于连接电脑上的对战桥，让 LLM 对手接管对局。' "$PLIST" 2>/dev/null || $PB -c 'Add :NSLocalNetworkUsageDescription string 用于连接电脑上的对战桥，让 LLM 对手接管对局。' "$PLIST"
$PB -c 'Set :UIStatusBarHidden true' "$PLIST" 2>/dev/null || $PB -c 'Add :UIStatusBarHidden bool true' "$PLIST"
$PB -c 'Set :UIViewControllerBasedStatusBarAppearance false' "$PLIST" 2>/dev/null || $PB -c 'Add :UIViewControllerBasedStatusBarAppearance bool false' "$PLIST"
for KEY in UISupportedInterfaceOrientations UISupportedInterfaceOrientations~ipad; do
  $PB -c "Delete :$KEY" "$PLIST" 2>/dev/null || true
  $PB -c "Add :$KEY array" "$PLIST"
  $PB -c "Add :$KEY:0 string UIInterfaceOrientationLandscapeLeft" "$PLIST"
  $PB -c "Add :$KEY:1 string UIInterfaceOrientationLandscapeRight" "$PLIST"
done
echo "Configured ATS web content, landscape and hidden status bar in $PLIST"
