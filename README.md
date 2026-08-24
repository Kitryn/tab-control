# Tab Control

Tab Control is a shared vanilla JavaScript WebExtension for current Firefox and Chromium-based browsers.

## Development

Use Node.js 18 or newer.

```sh
npm run check
npm test
npm run build
```

The browser-ready extensions are written to `dist/firefox` and `dist/chromium`.

Load `dist/firefox` as a temporary add-on in Firefox. Load `dist/chromium` as an unpacked extension in a Chromium-based browser.

The source is shared. The build uses one browser-specific Manifest V3 file for each target. The native bridge and control protocol are not part of this setup.

Version 0 implements only the JSON-RPC `get` request handler. The handler is
available as `globalThis.TabControl.handleRequest(request)` for a later Native
Messaging transport. It does not accept mutations.
