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

```sh
tabctl instances
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"get","params":{"view":"compact"}}' \
  | tabctl rpc --instance 945f84
```

`tabctl instances` writes a JSON array of `{ "id", "name" }`. `name` looks
like `Firefox 945f84`. Copy a **short unique prefix** of `id` into
`--instance` (Docker-style). Do not paste the full UUID. Six characters is
enough when it is unique. If exactly one instance is live, omit `--instance`.

One JSON-RPC 2.0 object on one line to `tabctl rpc` on standard input. One
JSON-RPC object on standard output. Pretty-printed JSON is rejected. Each
process call is one request.

## Read inventory

Use compact `get` by default. It returns `revision`, inventory-coverage
metadata, window IDs, and each tab's `id`, `index`, `title`, and `url`. This is
usually sufficient for discovery, classification, counting, closing, and
summaries.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"get","params":{"view":"compact"}}' \
  | tabctl rpc --instance 945f84
```

Request the full inventory only when the plan needs window state, pinned or
active state, containers, groups, audio state, pending-open state, access time,
or tab relationships:

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"get","params":{}}' \
  | tabctl rpc --instance 945f84
```

Even compact output can be large when tabs have long URLs. Filter it before it
enters the agent context. Keep `revision` with the selected tabs:

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"get","params":{"view":"compact"}}' \
  | tabctl rpc --instance 945f84 \
  | jq -c '{revision:.result.revision,tabs:[.result.windows[].tabs[]
      | select((.url // "") | test("grafana|thanos"; "i"))
      | {id,index,title,url}]}'
```

Use `jq -c` so its result stays on one line. Pretty output is useful only after
a result is small enough for manual inspection.

## Methods that work now

| Method | Use |
| --- | --- |
| `get` | Read compact or full browser state. Both views include `revision`. |
| `apply` | Run an ordered action list. Implemented actions: `close`, `move`, `open`, `newWindow`. |

`undo` is in the interface. The extension has no `undo` implementation yet.

## How to compose

1. Call `tabctl instances`. If more than one instance, pick one and pass a
   short unique `--instance` prefix on every `tabctl rpc`. Do not merge
   inventories. IDs from one instance are invalid on another.
2. Call compact `get` on that instance. Call full `get` instead when the plan
   needs fields that compact omits.
3. Decide the change from the inventory. Keep the `revision`.
4. Call `apply` with that `revision`, a `description` that tells the user
   why, and one or more actions.
5. Check `result.complete`. If it is `false`, earlier actions stay applied,
   the failed action is the last item in `result.actions`, and later actions
   were not attempted. Call `get` and make a new plan.
6. If the response is `-32001`, call `get` again and make a new plan.
7. If the response is `-32004`, wait, then call `apply` again or call `get`.

`get` can run at the same time as another `get` on the same instance. A `get`
that starts during `apply` waits and then returns a complete inventory.

Session tab IDs and window IDs stay valid until that browser profile
restarts. After a restart, call `get` again.

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
`tabIds`. A successful result includes `closedTabIds` in request order and
`closedCount`. A failed result omits both fields because the browser does not
report partial close progress. Unimplemented action types get `-32003`.

## `move`

(Pretty printed for informational purposes only - all payloads must be one-line)

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "apply",
  "params": {
    "revision": 42,
    "description": "Move the docs tab next to the other docs",
    "actions": [{
      "type": "move",
      "tabIds": [17, 24],
      "windowId": 2,
      "index": 3
    }]
  }
}
```

`windowId` is a window id from `get`. `index` `-1` means the end of that
window. After a `newWindow` action, `windowId: null` means the window created
by the nearest preceding `newWindow` in the same action list. The result has
`complete: true` when all actions succeed and `complete: false` when execution
stops on a failed action. The result `actions[].tabs` is what
`tabs.move` actually moved (`id`, `windowId`, `index`). Empty `tabs` with
`ok: true` is a browser no-op, not a failure.

## `newWindow`

```json
{
  "type": "newWindow",
  "tabIds": [17, 24],
  "focused": false
}
```

`newWindow` creates a standard window and asks the browser to move the listed
tabs into it. It does not require their source window IDs. Its result contains
`windowId`. An empty successful browser move is a no-op. Later `move` and
`open` actions in the same list can use `windowId: null` to target the new
window. A second `newWindow` changes that binding to the later window.

## `open`

```json
{
  "type": "open",
  "windowId": 1,
  "index": -1,
  "tabs": [{
    "url": "https://example.com/",
    "title": "Example",
    "pinned": false,
    "containerId": null,
    "openerTabId": null
  }]
}
```

`open` accepts absolute HTTP and HTTPS URLs. It creates inactive tabs without
loading the target websites. Firefox accepts a container ID from `get`;
Chromium requires `containerId: null`. A numeric `index` places the first tab,
and `-1` appends all tabs. `openerTabId` is best effort and is omitted when the
opener is not in the target window. If part of the action fails, its result
lists tabs that were already created. Call `get` before making a new plan.

## Errors that change the plan

| Code | Next step |
| ---: | --- |
| `-32001` | Call `get`. The supplied revision is old. |
| `-32002` | Call `get`. A tab, window, container, or group is gone. |
| `-32003` | Use an implemented action. |
| `-32004` | Wait. Then send the change again. |
| `-32000` | The browser or the bridge gave no response. |

## Setup

The browser must run the Tab Control extension. That profile's host must
listen. If `tabctl` reports a socket error, tell the user to load the
extension and run `npm run install-host`. If `tabctl rpc` fails because more
than one instance is live, call `tabctl instances` and pass `--instance`.
