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
`get` and `apply` (`close` and `move`) from the Native Messaging transport.

The CLI is a JSON-RPC transport shim:

```sh
tabctl instances
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"get","params":{}}' \
  | dist/tabctl rpc --name work
```

The host binds `/run/user/<uid>/tab-control/<instanceId>.sock` when that
runtime directory exists and is owned by the current user, or
`/tmp/tab-control-<uid>/<instanceId>.sock`. Select the extension toolbar icon
to set a profile name. `tabctl instances` lists live instances. `tabctl rpc`
uses the only live instance, or accepts `--instance <id>` or `--name <name>`
to select one. See [docs/interface.md](docs/interface.md) section 2.

Firefox and Chromium start `dist/native-host` through Native Messaging. The
checked-in host manifests are templates. `npm run install-host` writes them
into the user Native Messaging directories (Firefox, Chromium, Chrome, Brave,
Edge, Helium) and fills the absolute host path. The Chromium extension id is
pinned by the `key` in `manifests/chromium.json`, so unpacked loads keep the
same id. Reload the extension after install-host.
