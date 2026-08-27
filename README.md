# Tab Control

<p align="center">
  <img src="icons/tab-control.png" alt="Tab Control logo" width="180">
</p>

Tab Control lets a local agent inspect and organize tabs in Firefox and
Chromium-based browsers. It provides a small JSON-RPC interface via Native
Messaging and a local Unix socket for tab inventory, movement, grouping, 
creation, and closure. 

The API is deliberately small and composable - agents are smart enough to 
perform orchestration and other smarter behaviours by themselves. Ask your
favourite agent to read the SKILL.md.

## Features

- Read browser state.
- Select browser instances by name or instance ID.
- Move, open, close, group, and ungroup tabs, and create windows.
- Open tabs with deferred page loading.
- Support Firefox containers in open actions.

## Requirements

- Node.js 18 or newer
- Rust 1.85 or newer
- Linux or macOS
- Current Firefox or a Chromium-based browser

## Build and install

```sh
npm run build
npm run install-host
```

The build creates:

- `dist/firefox` — Firefox extension
- `dist/chromium` — Chromium extension
- `dist/native-host` — Native Messaging host
- `dist/tabctl` — command-line client

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Select **Load Temporary Add-on**.
3. Select `dist/firefox/manifest.json`.

### Chromium

1. Open the browser extension page.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Select `dist/chromium`.

Reload an existing extension after `npm run install-host`.

Select the Tab Control toolbar icon to set a profile name such as `work` or
`personal`.

## Development

```sh
npm run check
npm test
npm run build
```

Source files are shared across both browser builds. Browser manifests live in
`manifests/`, extension code lives in `src/`, and the Rust host and CLI live in
`native/`.

See [docs/interface.md](docs/interface.md) for the complete JSON-RPC contract.
Agent usage guidance is in
[`.agents/skills/tab-control/SKILL.md`](.agents/skills/tab-control/SKILL.md).

## Future work

- Packaging
- Building and installing to `$PATH`
- Change history, undo
- Dashboard
