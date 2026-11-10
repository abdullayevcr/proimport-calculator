# Proİmport for macOS

The DMG bundles Electron, so users do not need to install Node.js or another runtime. It targets macOS 13 and newer and contains a universal app for Intel and Apple silicon Macs.

This is an **unsigned test build**. macOS Gatekeeper may block the first launch because the app has no Developer ID signature or Apple notarization. If the Mac owner trusts the file, Apple documents approving it under System Settings → Privacy & Security → Open Anyway after trying to launch it. Do not use this build for public distribution or sensitive environments.

## Build locally on a Mac

Install Node.js 22 and Xcode Command Line Tools, then run from the project folder:

```sh
npm ci
npm run build:mac
```

It emits the DMG under `installer-output-macos/`.

## Build on an Amazon EC2 Mac

Use a macOS EC2 instance backed by a Dedicated Host. Copy this build archive to the instance, unpack it, install Node.js 22 and Xcode Command Line Tools, and run the commands above. The host allocation has a 24-hour minimum. Release the Dedicated Host after the build to stop further host charges. This unsigned DMG is intended for testing; distributing a Gatekeeper-trusted build requires Apple Developer ID signing and notarization.

## GitHub Actions

The workflow `.github/workflows/build-macos.yml` builds the unsigned test DMG on a hosted macOS runner and uploads it as a workflow artifact. It needs no Apple credentials. The project must be pushed to a GitHub repository before the workflow can run.

For a properly identified, notarized release later, switch signing back on and configure a Developer ID Application certificate and App Store Connect API key as protected CI secrets. See [Apple's notarization guide](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).
