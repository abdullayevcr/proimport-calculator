# Proİmport

Proİmport estimates the complete cost of importing a vehicle to Baku. The desktop app includes the BidCars archived-auction search, offline Azad Logistics tariffs, customs calculation, invoice and expense breakdown, settings, and local calculation history.

## macOS build

The app targets macOS 13 and newer and builds a universal DMG for Intel and Apple Silicon Macs. The DMG bundles Electron and does not require a separate runtime.

Every push to `main` starts the macOS build workflow. It installs the locked dependencies, runs the calculator checks, builds the unsigned DMG, and uploads it as a seven-day GitHub Actions artifact. Open the completed workflow run and download `proimport-macos-unsigned-test-dmg`.

To build locally on macOS:

```sh
npm ci
npm run build:mac
```

The current build is unsigned because this project has no Apple Developer ID certificate. macOS may show Gatekeeper warnings when the DMG is installed. See [macOS build notes](macos/README.md).

## Privacy

The desktop app stores its BidCars session and calculation history in that Mac user's local application data. The app does not use the Proİmport website's local connector.
