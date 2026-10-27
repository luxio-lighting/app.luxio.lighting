# Luxio Web App

Browser version of the SwiftUI app in `next/luxio-ios`. This folder is self-contained: it does not import from neighboring checkouts.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. Select a discovered light, connect by IP address under **Add Luxio**, or choose **Add a virtual device** to try the simulator.

```sh
npm run check
npm test
npm run build
```

The static production output is `dist/`. No application backend, API key, or environment variables are needed. `public/CNAME` is reserved for a future GitHub Pages deployment at `app.luxio.lighting`; that custom domain is not configured by the Sites deployment.

## Hosted preview

The private Sites deployment is at https://luxio-app.emilenijssen.chatgpt.site. Sign in with the owner's ChatGPT account on each device. The site's identity and static build directory are tracked in `.openai/hosting.json`. Local edits are not deployed automatically; publish a new version to update the hosted app.

## Layout and controls

- The app uses Studio and Setup’s neutral dark surfaces, typography, borders, cyan/green primary actions, and a persistent 56px app header. Mobile keeps the iOS color-backed device controls, brightness slider, mode picker, wheel, three-column preset grids, and bottom sheets.
- Desktop keeps a persistent device sidebar and places the editor beside the preset library. The editor remains visible while scrolling through presets. Intermediate widths use a stacked layout.
- All 24 colors, 24 gradients, and 10 animation presets come from the iOS app. Animation source comes from its Swift definitions, with a runtime-selected compatibility branch for firmware without bulk Lua rendering APIs.
- Color/white controls reflect the strip type. Gradients support 2–8 stops and require more than one LED. The wheel supports touch, mouse, and arrow keys.
- Save, apply, search, rename, and delete independent color, gradient, and animation libraries. Live edits and built-in presets do not create library files.
- Animation settings apply without restarting and are remembered per light and animation in this browser.
- Settings support device configuration, relay settings, Wi-Fi scanning/setup, Matter pairing codes and QR codes, and manual firmware updates. Installation requires an explicit click; success is reported only after the device reconnects on the expected build.

## Connectivity and browser differences

Discovery immediately lists every device returned by `https://api.luxio.lighting/devices`, even when its HTTP endpoint cannot be reached. Supported browsers then fetch local state. Safari shows Chrome guidance when a directory device is selected. Manual addresses are supported. Local device state refreshes every four seconds while the tab is visible. Requests for each device are serialized; failed mutations are never automatically retried. Library pagination follows the existing firmware protocol.

Use current desktop or Android Chrome and allow local network access to control HTTP devices from an HTTPS deployment. Safari, Firefox, and other browsers may block that connection. The sidebar offers **Find via BLE** (Web Bluetooth on desktop/Android Chrome) and **Find via USB** (Web Serial on desktop Chrome). Device pickers require a click; connections stay in memory, and disconnected devices must be selected again. Chrome on iOS uses WebKit and does not provide these capabilities. Native mDNS discovery remains in the iOS app. Configure a light's initial Wi-Fi using the native app or [Luxio Setup](https://setup.luxio.lighting/).

The simulator works without a physical light. Its configuration, active scene, animation parameters, and saved libraries persist in local storage. Data stays in this browser and is not synced to iOS or Studio. Private browsing, clearing site data, or unavailable storage affects persistence. Wi-Fi passwords are never persisted.

Animated device backgrounds run the same vendored Lua runtime used by Luxio's other web tools, in isolated Web Workers. They pause when offscreen, backgrounded, powered off, or Reduce Motion is enabled. Runtime errors or a stalled worker fall back to the preset palette. Previews are illustrative and are not frame-synchronized with hardware.

## Verification

`npm test` exercises simulator controls and persistence, independent saved libraries, strip capability checks, animation parameter updates, all ten Lua presets across all four strip types, HTTP device discovery, paginated libraries, and failed-mutation replay protection. HTTP tests use mocked Protobuf responses and do not access physical lights.

The UI has also been checked in the browser at desktop and phone widths. All ten presets were also verified on Luxio S3 mini running firmware 35, restoring its original color, brightness, and power afterward. BLE/USB framing, fragmentation, pagination, and disconnect behavior are tested with mocked browser transports; physical BLE/USB connections have not been verified. firmware installation, Wi-Fi changes, relay wiring, and Matter commissioning have not been exercised against physical devices.

## Shared snapshots

`shared/protocol/` and `shared/device/src/` are copied from `next/luxio-ios/shared/`. `src/presets.json` was initially generated by compiling `Luxio/Presets.swift` with `tools/export-ios-presets.swift` from the iOS checkout. `src/colors.json` mirrors its `scenes` array. Preserve the compatible Lua branches (from the previous iOS/Studio presets) when updating these snapshots. `tools/build-browser.mjs` bundles the Lua engine for browser use before dev/build.
