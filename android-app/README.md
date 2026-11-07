# BeastBotSniper Android (standalone)

This app embeds Node.js 18 in the APK and runs the existing BeastBotSniper server and engine locally on the phone. It does not connect to a hosted BeastBotSniper server.

## Target device

- Redmi Note 15
- HyperOS 2
- Android 15
- ARM64 plus 32-bit ARM compatibility

## Build

The GitHub Actions workflow downloads the official Node.js Mobile 18.20.4 Android shared library, builds the Vite dashboard and Node server bundle, packages production Node modules into app assets, and builds a debug-signed installable APK.

Run the workflow manually from the Actions tab or push a commit to android-standalone. Download the BeastBotSniper-Android-debug artifact after the workflow succeeds.

## First launch

The first launch extracts the local Node project into app-private storage and can take a few minutes. The dashboard appears after the local health endpoint responds.

The Android app uses a foreground service and a partial wake lock while that service is alive. Trade entry/closure notifications are polled from the local API. Research data is written to the app-private data/research directory and survives app updates.

## HyperOS 2 background setup

After installation:
1. Open App info → Battery saver → select No restrictions.
2. Enable Autostart for BeastBotSniper if HyperOS exposes that option.
3. Allow notifications for service status and trade events.
4. Keep the foreground service notification visible while the engine is expected to run.

Android and HyperOS can still stop an app after a force-stop, reboot, or system intervention. This is not a guarantee of uninterrupted 24/7 operation.

## Safety

This build contains the virtual/paper trading engine from the Android branch base. It does not add live Binance order execution or store Binance API keys. The engine is initially inactive until the user enables it in the dashboard. Start with paper trading and verify the dashboard and notifications before relying on it.
