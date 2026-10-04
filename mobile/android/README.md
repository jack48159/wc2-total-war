# Android standalone remake

This app packages the current `public` game, not the legacy native engine.
Package ID: `com.tomaka.wc2remake`.

Build with Java 21, Android SDK 34 and Build Tools 34.0.0:

```powershell
node ../../tools/build_mobile_bundle.mjs
npm install
npx cap sync android
cd android
./gradlew.bat assembleDebug
```

The signed development APK is `android/app/build/outputs/apk/debug/app-debug.apk`.
Normal play uses a local player identity, local profile and local saves in IndexedDB
`wc2-player-local` (`data` store: `account`, `profile`, `saves`).
The automatic save is independent of the 30 manual slots. It updates every minute
at a stable player turn; AI/bridge animations delay the save until that turn is safe.
The central card loads this automatic save. Multiplayer login is separate and still
uses the configured online service. Old server account data is not deleted or migrated.
Uninstalling/clearing app data removes local data. Existing server data remains intact.

iOS uses the same game source; its native build still requires Xcode on macOS.
