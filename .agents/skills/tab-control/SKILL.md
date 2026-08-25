---
name: tab-control
description: >
  Reads and changes local Firefox or Chromium tabs through tabctl JSON-RPC.
  Use when the user asks to list, inspect, close, or rearrange open browser
  tabs, or to call Tab Control.
---

# Tab Control

The agent owns search, classification, and the plan. The extension holds
browser state and runs primitive changes.

Full message shapes are in [docs/interface.md](../../../docs/interface.md).

## Command

One JSON-RPC 2.0 object on one line. Write the object to `tabctl rpc` on
standard input. Read one JSON-RPC object from standard output.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"get","params":{}}' \
  | dist/tabctl rpc
```

Each process call is one request. Pretty-printed JSON is rejected.

## Methods that work now

| Method | Use |
| --- | --- |
| `get` | Read all windows, tabs, and groups. The result includes `revision`. |
| `apply` | Run an ordered action list. The implemented action is `close`. |

`undo` is in the interface. The extension has no `undo` implementation yet.

## How to compose

1. Call `get`.
2. Decide the change from the inventory. Keep the `revision`.
3. Call `apply` with that `revision`, a `description` that tells the user
   why, and one or more actions.
4. If the response is `-32001`, call `get` again and make a new plan.
5. If the response is `-32004`, wait, then call `apply` again or call `get`.

`get` can run at the same time as another `get`. A `get` that starts during
`apply` waits and then returns a complete inventory.

Session tab IDs and window IDs stay valid until the browser restarts. After
a restart, call `get` again.

## `close`

(Pretty printed for informational purposes only - all payloads must be one-line)

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "apply",
  "params": {
    "revision": 42,
    "description": "Close the debugging tab",
    "actions": [{ "type": "close", "tabIds": [478] }]
  }
}
```

Put only the tab IDs that the user named, or that the plan selected, in
`tabIds`. Other action types get `-32003` until the extension adds them.

## Errors that change the plan

| Code | Next step |
| ---: | --- |
| `-32001` | Call `get`. The supplied revision is old. |
| `-32002` | Call `get`. A tab, window, or group is gone. |
| `-32003` | Use an implemented action. |
| `-32004` | Wait. Then send the change again. |
| `-32000` | The browser or the bridge gave no response. |

## Setup

The browser must run the Tab Control extension. The host must listen. If
`tabctl` reports a socket error, tell the user to load the extension and
run `npm run install-host`.
