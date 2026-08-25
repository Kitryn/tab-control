# Tab Control

Tab Control is a shared vanilla JavaScript WebExtension for current Firefox and Chromium-based browsers.

## Development

Use Node.js 18 or newer and Rust 1.85 or newer.

```sh
npm run check
npm test
npm run build
npm run install-host
```

The browser-ready extensions are written to `dist/firefox` and `dist/chromium`.
The CLI binary is `dist/tabctl`. The native host and CLI live in the
`native` Cargo crate.

Load `dist/firefox` as a temporary add-on in Firefox. Load `dist/chromium` as an unpacked extension in a Chromium-based browser.

The source is shared. The build uses one browser-specific Manifest V3 file for each target.

The JSON-RPC handler is `handleRequest` in `src/background.js` and accepts
`get` and `apply` (`close` only) from the Native Messaging transport.

The CLI is a JSON-RPC transport shim:

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"get","params":{}}' \
  | dist/tabctl rpc
```

It uses `$TAB_CONTROL_SOCKET` when set. Otherwise it uses
`/run/user/<uid>/tab-control.sock` when that directory exists and is owned by
the current user, or `/tmp/tab-control-<uid>.sock`.
Firefox and Chromium start `dist/native-host` through Native Messaging. The
checked-in host manifests are templates. `npm run install-host` writes them
into the user Native Messaging directories and fills the absolute host path.

After loading the unpacked Chromium extension, pass its ID:

```sh
npm run install-host -- --chromium-extension-id=<id>
```

Then reload the extension.
