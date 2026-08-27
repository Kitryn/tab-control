# Tab Control Interface

## 1. Scope

Tab Control gives a local agent access to open browser windows and tabs. The
agent reads browser state and sends primitive browser changes. The agent owns
search, classification, duplicate detection, sorting decisions, grouping
decisions, and summaries.

The agent owns orchestration. The extension supplies browser state and executes
primitive browser changes.

This interface targets current Firefox and Chromium-based browsers on Linux
and macOS.

## 2. Client command

The client has two commands:

```sh
tabctl instances
tabctl rpc [--instance <instanceId> | --name <profileName>]
```

`tabctl rpc` reads one JSON-RPC 2.0 request from standard input. It writes one
JSON-RPC 2.0 response to standard output. It writes diagnostic messages to
standard error. The request and the socket frame are JSON Lines: one JSON
object, one line. Pretty-printed JSON is rejected.

Each `tabctl rpc` invocation accepts one JSON-RPC request and returns one
JSON-RPC response. Each invocation is independent. The client does not hold a
session or a browser lock across invocations. Occupancy is one in-flight
change (`apply` or `undo`) **per instance**, not ownership of the browser.

Multiple clients may call the same instance at the same time.

The public interface starts at JSON-RPC input and ends at JSON-RPC output. The
bridge owns the socket protocol and socket location.

### Instances

One browser profile is one instance. Firefox and Chromium, or two profiles of
the same product, are separate instances. Tab, window, and group IDs and the
revision counter are scoped to that instance. `get` returns one instance. The
client does not merge inventories.

The extension creates an instance id with `crypto.randomUUID()` and stores it
in `storage.local`. The user can select the extension toolbar icon to set an
optional profile name. The extension sends `{ "instanceId", "browser", "name" }`
to the native host before the host listens. Reinstall or a storage wipe creates
a new id. A profile-name change restarts the native connection with the same id.

The host binds one Unix socket per instance:

- `/run/user/<uid>/tab-control/<instanceId>.sock` when `/run/user/<uid>`
  exists and is owned by the current user
- otherwise `/tmp/tab-control-<uid>/<instanceId>.sock`

The host creates the directory with mode `0700`. It binds only after it has
the identity. It does not replace another instance's socket. If the path
exists, it probes: a live peer means this instance is already up and this
host exits; a dead socket is unlinked, then this host binds.

The extension holds `runtime.connectNative()` for the browser session. That
open native Port is what keeps the Firefox event page and the Chromium
service worker from unloading while the browser is idle. On
`Port.onDisconnect`, the extension connects again with the same instance id.
The host process and the socket last only as long as that Port. They do not
outlive the browser process.

### `tabctl instances`

The command lists live instances. It reads the socket directory, probes each
socket with `describe`, unlinks a dead socket, and writes one JSON array to
standard output.

```json
[
  {
    "id": "945f84ab-1234-4000-8000-000000000001",
    "name": "work"
  },
  {
    "id": "a1b2c3de-5678-4000-8000-000000000002",
    "name": "Chrome a1b2c3"
  }
]
```

`id` is the full instance UUID. That is also the socket file name. `name` is
the set profile name. If the profile has no set name, it is the `browser`
string from `describe`, a space, then the first six characters of `id`.

`--instance` accepts the full `id` or a unique prefix of it, like a Docker
container id. `--name` accepts an exact set profile name. The two selectors
are mutually exclusive. Zero matches or two or more matches make the command
fail. Two live browser profiles can have the same name because each profile
has separate extension storage.

### `tabctl rpc`

- `--instance <id>` connects to that instance's socket (full id or unique
  prefix). If it is not live, the command fails.
- `--name <name>` connects to the instance with that exact set profile name.
  If zero or multiple live instances match, the command fails.
- no selector and zero live instances: the command fails
- no selector and one live instance: the command uses that instance
- no selector and two or more live instances: the command fails, writes the
  same array as `tabctl instances` to standard error, and does not guess

### `describe`

`tabctl instances` calls this method. Agents do not need to send it.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "describe",
  "params": {}
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "instanceId": "945f84ab-1234-4000-8000-000000000001",
    "browser": "Firefox",
    "name": "work"
  }
}
```

`params` must be empty. `instanceId` and `browser` are required. `browser` is
the product name (`Firefox`, `Chrome`, `Brave`, `Edge`). `name` is the set
profile name, or `null` when the profile has no set name.

`get` never fails because another `get` is in progress.

If `apply` or `undo` is in progress, `get` waits until that change
finishes, then returns a consistent inventory. It does not return
mid-change state.

If `apply` or `undo` is already in progress, a second `apply` or `undo`
fails immediately with `-32004`. The second change is not queued.

If a change completes and a later `apply` or `undo` sends a stale
revision, the method fails with `-32001`. The agent must call `get` and
decide what to do.

If the browser or bridge does not respond, the client fails and the
bridge abandons that request so later clients are not blocked. A JSON-RPC
error uses `-32000`.

## 3. Methods

The interface has four methods:

| Method | Purpose |
| --- | --- |
| `describe` | Identify this instance. Used by `tabctl instances`. |
| `get` | Get the complete current browser state of this instance. |
| `apply` | Validate and apply an ordered action list. Fail-stop; no rollback. |
| `undo` | Restore a recovery snapshot. Deferred with changelog work. |

## 4. Common messages

A request has this form:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "get",
  "params": {}
}
```

An ID must be a string or integer. The response contains the same ID.

A successful response has this form:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {}
}
```

An error response has this form:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32001,
    "message": "The browser state changed",
    "data": {
      "expectedRevision": 42,
      "actualRevision": 44
    }
  }
}
```

## 5. `get`

`get` returns one inventory of all browser windows that this instance's
extension can access.

### Request

An empty `params` object returns the full inventory. `view: "full"` is
equivalent.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "get",
  "params": {}
}
```

Use `view: "compact"` for discovery, classification, counting, and close
plans that need only tab identity and position:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "get",
  "params": { "view": "compact" }
}
```

No other `view` or parameter is valid.

### Full result

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "revision": 42,
    "capturedAt": 1787550000000,
    "privateWindowsIncluded": true,
    "windows": [
      {
        "id": 1,
        "focused": true,
        "incognito": false,
        "type": "normal",
        "state": "maximized",
        "tabs": [
          {
            "id": 17,
            "index": 0,
            "url": "https://example.com/",
            "pendingUrl": null,
            "title": "Example",
            "active": true,
            "pinned": false,
            "discarded": false,
            "pendingOpen": false,
            "hidden": false,
            "audible": false,
            "muted": false,
            "lastAccessed": 1787549950000,
            "container": {
              "id": "firefox-container-1",
              "name": "Personal"
            },
            "groupId": null,
            "openerTabId": null,
            "successorTabId": null
          }
        ]
      }
    ],
    "containers": [
      {
        "id": "firefox-container-1",
        "name": "Personal"
      }
    ],
    "groups": []
  }
}
```

### Compact result

The compact result keeps the revision and inventory-coverage metadata. Each
window contains only its ID and tabs. Each tab contains `id`, `index`, `title`,
and `url`:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "revision": 42,
    "capturedAt": 1787550000000,
    "privateWindowsIncluded": true,
    "windows": [
      {
        "id": 1,
        "tabs": [
          {
            "id": 17,
            "index": 0,
            "title": "Example",
            "url": "https://example.com/"
          }
        ]
      }
    ]
  }
}
```

Compact `url` and `title` use the same pending-open normalization as the full
result. Compact `get` does not query containers or groups. Use the full result
before a plan depends on window state, pinned or active state, containers,
groups, audio state, pending-open state, access time, or tab relationships.
Both views use the same revision counter.

`capturedAt` and `lastAccessed` are Unix times in milliseconds.

`privateWindowsIncluded: true` means that the inventory covers standard and
private windows. `privateWindowsIncluded: false` means that the inventory covers
standard windows.

Browser tab, window, and group IDs belong to the current instance session. An
agent calls `get` again after that browser profile restarts.

The extension returns `null` when the browser omits a field. For example,
Chromium returns `null` for `container` and `successorTabId`.

A container is a Firefox contextual identity. It gives a tab a separate cookie
store, such as Personal, Work, or Banking. Top-level `containers` lists all
containers that an `open` action can use, including containers with no open
tabs. A tab's `container` is the matching object or `null`. Chromium returns
`containers: []` and `container: null`.

`lastAccessed` is the last time that the tab became active in its window.
Current Firefox and Chromium versions expose this value.

`openerTabId` identifies the tab that opened this tab. Firefox keeps the
opener in the same window. A browser can clear the relationship before the
opener closes, so the extension always reports the current native value.
`successorTabId` identifies the tab that Firefox selects after this tab closes.
Chromium returns `null` for this Firefox-specific field.

A group has this form:

```json
{
  "id": 8,
  "windowId": 1,
  "title": "Documentation",
  "color": "blue",
  "collapsed": false
}
```

The revision counter tracks changes that can make tab IDs, window IDs, tab
URLs, or tab positions stale. The extension increments it for tab and window
creation, removal, replacement, or movement; tab-group movement; and tab URL,
pinned-state, or group changes. Title, loading, audio, discard, activation,
highlighting, focus, and tab-group metadata events are outside revision
tracking.

Concurrent `get` requests succeed independently. A `get` that arrives
while `apply` or `undo` is running waits for that change to finish.

## 6. `apply`

`apply` runs this pipeline. Occupancy is one in-flight change. A second
`apply` or `undo` fails immediately with `-32004`.

1. Compare `params.revision` to the in-memory revision counter. If they differ,
   fail with `-32001`. This check does not make `apply` atomic.
2. Fetch a fresh inventory (`windows.getAll({ populate: true })`, groups,
   containers, private-window access). Use that snapshot to validate.
3. Validate action fields and inventory references against that snapshot. For
   `windowId: null`, also verify that a `newWindow` action comes first in the
   list.
4. If validation succeeds, execute the actions in array order. The first
   failed native call ends forward execution. Earlier actions stay applied.
   There is no rollback.

Validation uses only the starting snapshot. The browser controls the state
changes between actions. Thus, an earlier action can remove a tab or group that
a later action references. The later action then fails with the browser error.
Split dependent work into separate `apply` calls, and call `get` between them.

The result `revision` is the revision counter after execution.
Recovery snapshots, automatic rollback, and change records are deferred
until undo work.

### Request

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "apply",
  "params": {
    "revision": 42,
    "description": "Group the open documentation tabs",
    "actions": [
      {
        "type": "move",
        "tabIds": [17, 24],
        "windowId": 1,
        "index": 4
      },
      {
        "type": "group",
        "tabIds": [17, 24],
        "windowId": 1,
        "title": "Documentation",
        "color": "blue",
        "collapsed": false
      }
    ]
  }
}
```

`description` is required. It must tell the user why the agent made the change.

`actions` must contain at least one action.

The result has `complete: true` when all actions succeed. It has
`complete: false` when a native action fails. Each attempted action result
includes `index` and `ok`. Actions after the first failed action are not
attempted and are not included.

A successful `move` result contains `intendedCount`, `movedCount`, `windowId`,
`firstIndex`, and `lastIndex`. These fields summarize the browser response. A
successful `close` result contains `closedTabIds` in request order and
`closedCount`. If `tabs.move` returns an empty array, `movedCount` is `0`, and
`firstIndex` and `lastIndex` are null. This result identifies a browser move
no-op. The current browser controls pinned regions, split views, and other
`tabs.move` behavior. The agent skill gives references to the MDN and Chrome
documentation for these cases.

### Successful result

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "changeId": "174",
    "revision": 43,
    "complete": true,
    "actions": [
      {
        "index": 0,
        "ok": true
      },
      {
        "index": 1,
        "ok": true,
        "groupId": 8
      }
    ]
  }
}
```

### Failed action

The first failed action ends forward execution and sets `complete` to `false`.
Earlier actions in the list stay applied. The result has no `rollback` field.

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "changeId": "174",
    "revision": 44,
    "complete": false,
    "actions": [
      {
        "index": 0,
        "ok": true
      },
      {
        "index": 1,
        "ok": false,
        "error": {
          "code": "BROWSER_REJECTED",
          "message": "No tab with id: 24"
        }
      }
    ]
  }
}
```

The agent must call `get` after a failed action and decide what to do. The
browser may be mid-change.

## 7. Actions

`move`, `open`, and the create form of `group` take `windowId`. A number is a
window from the inventory (including windows earlier actions in this list
already used). `null` means the window created by the nearest preceding
`newWindow` in this `actions` list. `null` is not the focused window.

If `windowId` is `null` and no `newWindow` precedes this action, validation
fails. After a second `newWindow`, `null` binds to that later window. An
earlier new window in the same list has no id the agent can name; a later
`apply` after `get` can use the numeric id from `get`.

`closeWindow` requires a numeric `windowId`. `null` is invalid.

`groupId` has no such bind. It is a number from `get`, or omitted on the
create form. `groupId: null` is invalid.

### 7.1 `move`

Move tabs to a window and index:

```json
{
  "type": "move",
  "tabIds": [17, 24],
  "windowId": 2,
  "index": 3
}
```

The extension passes `tabIds`, `windowId`, and `index` unchanged to
`tabs.move`. The browser uses a numeric `index` as its insertion index during
the move. The final index of the first moved tab can differ from that number.
For example, a same-window move of `[B, C]` to index `4` in
`[A, B, C, D, E, F]` can produce `[A, D, E, B, C, F]`; the moved block then
starts at index `3`. This can occur when several tabs move forward in the same
window because each tab moves in turn.

An index of `-1` means the end of the destination window. It avoids this index
shift for a valid move to the end. Tabs omitted from `tabIds` stay where they
are. The browser controls pinned regions, split views, and other placement
rules.

The result contains `intendedCount`,
`movedCount`, `windowId`, `firstIndex`, and `lastIndex`. `intendedCount` is the
number of tab IDs in the request. `movedCount` is the number of tabs in the
browser response. `windowId` identifies the destination window. `firstIndex`
and `lastIndex` identify the range of moved tabs. If the browser returns an
empty array, the call succeeds with `movedCount: 0`, and both indexes are null.
For example, the browser can return an empty array for a request to move an
unpinned tab into the pinned region.

Use `movedCount`, `firstIndex`, and `lastIndex` as the final browser result.
If the result differs from the requested arrangement, call `get` and make a
new plan.

For a full-strip reorder, send one `move` with every tab ID in the required
order and `index: 0`. This uses the existing `move` action.

### 7.2 `update`

Update tab properties:

```json
{
  "type": "update",
  "tabIds": [17, 24],
  "pinned": true
}
```

The `update` action supports the `pinned` property. It calls
`tabs.update` for each tab.

### 7.3 `group`

Create a group:

```json
{
  "type": "group",
  "tabIds": [17, 24],
  "windowId": 1,
  "title": "Documentation",
  "color": "blue",
  "collapsed": false
}
```

Move tabs into an existing group:

```json
{
  "type": "group",
  "tabIds": [17, 24],
  "groupId": 8
}
```

Use one group form in each action: numeric `groupId` from `get`, or the new
group properties. There is no `groupId: null` meaning “last created group.”
The create form requires a string `title`, a Boolean `collapsed`, and one of
these `color` values: `grey`, `blue`, `red`, `yellow`, `green`, `pink`,
`purple`, `cyan`, or `orange`.

The create form accepts an optional numeric or `null` `windowId`. A number
maps to `createProperties.windowId`. `null` binds to the nearest preceding
`newWindow` in the action list. If `windowId` is omitted, the browser uses its
current window. The existing-group form does not accept `windowId`; the
existing group selects the target window.

Tabs can come from different windows. The browser moves them to the target
window, unpins them when necessary, makes them adjacent, and groups them.
Snapshot validation checks the starting tab, window, and group IDs. The browser
controls group membership and placement during execution. If a later action
depends on the new state, call `get` first and use a separate `apply` request.
Private-window boundaries and browser-specific placement behavior follow the
current browser.

Create uses `tabs.group({ tabIds, createProperties: { windowId } })` when
`windowId` is present, or `tabs.group({ tabIds })` when it is omitted. It then
uses `tabGroups.update` for title, color, and collapsed. Join-existing uses
`tabs.group({ tabIds, groupId })`. A successful create or join result contains
`groupId`. If create succeeds but the metadata update fails, the failed result
also contains that new `groupId` because the group stays created.

Create requires `tabGroups.query`. If that method is missing, create fails
with `-32003` even if `tabs.group` exists. Otherwise `get` would return
`groups: []` after a successful create. `tabs.ungroup` may still run when
present.

If `tabs.group` is missing, both group forms fail with `-32003`.

A preceding `move` is not required. Grouping itself can move tabs between
windows. Join-existing needs a `groupId` from `get`.

### 7.4 `ungroup`

Remove tabs from their groups:

```json
{
  "type": "ungroup",
  "tabIds": [17, 24]
}
```

The action calls `tabs.ungroup`. If that method is missing, the action fails
with `-32003`.

### 7.5 `open`

Open inactive tabs and keep their target websites unloaded:

```json
{
  "type": "open",
  "windowId": 1,
  "index": -1,
  "tabs": [
    {
      "url": "https://example.com/one",
      "title": "Example one",
      "pinned": false,
      "containerId": null,
      "openerTabId": null
    },
    {
      "url": "https://example.com/two",
      "title": "Example two",
      "pinned": false,
      "containerId": null,
      "openerTabId": null
    }
  ]
}
```

All new tabs start inactive. The target website loads when the user activates
the tab.

Firefox uses `tabs.create({ discarded: true, url, title, active: false })`.
The tab already holds the target URL. When `pinned` is true, the extension
creates the discarded tab first and then pins it with `tabs.update`. Firefox
119 is the minimum because Firefox 113 through 118 can fail when pinning a
discarded tab ([bug 1852391](https://bugzilla.mozilla.org/show_bug.cgi?id=1852391)).

Chromium has no discarded-create. It opens a `data:text/html` document that
stores the target URL in the page and calls `location.replace` when
`document.visibilityState` becomes `visible`. There is no tab-id-to-URL map.
`get` parses that `data:` URL (and the document title when present) and
returns the target `url` and `title` with `pendingOpen: true`. After the
replace, `pendingOpen` is `false`. Other tabs return `pendingOpen: false`.
The Chromium tab is a small live document until activation (`discarded` is
`false` in the browser; the RPC still reports the target as unloaded via
`pendingOpen`). Chromium can clear `openerTabId` when the pending page
navigates because it resets opener relationships for some non-link
navigations. Preserving it requires overriding native behavior, so the
extension does not restore it.

Firefox accepts `containerId`. Chromium accepts `null`. The `open` action
accepts fully qualified HTTP or HTTPS URLs. Agents never send `data:` or
`about:blank` as `open` targets.

`openerTabId` is best effort. The tab must exist when the action is validated.
Immediately before creation, the extension uses it only when the opener is
still in the target window. Otherwise it omits `openerTabId`; the new tab is
still created.

The extension creates tabs in input order. A numeric `index` is the position
of the first tab; later tabs follow it. `-1` appends them. The result contains
each created tab's `id`, `windowId`, and final `index`.

Creation is not atomic. If a native call fails after earlier tabs were
created, the failed action result includes those tabs, `complete` is false,
and later actions do not run. If the final tab lookup fails, the action also
fails and reports unknown `windowId` and `index` values as `null`. The agent
then calls `get`.

### 7.6 `close`

Close tabs:

```json
{
  "type": "close",
  "tabIds": [17, 24]
}
```

Closed tabs are gone. There is no automatic restore. The action calls
`tabs.remove`. After that call succeeds, the result contains `closedTabIds` in
request order and `closedCount`:

```json
{
  "index": 0,
  "ok": true,
  "closedTabIds": [17, 24],
  "closedCount": 2
}
```

If `tabs.remove` rejects, the failed result does not contain either close-detail
field because the browser does not report partial progress. The agent must call
`get` to inspect the current state.

### 7.7 `newWindow`

Create a normal window and move tabs into it:

```json
{
  "type": "newWindow",
  "tabIds": [17, 24],
  "focused": false
}
```

The action calls `windows.create` and moves the listed tabs into that window
with `tabs.move`. The action result contains the new window ID. If creation
succeeds but the move fails, the failed result still contains that ID. Later
`move`, `open`, and create-`group` actions in this list target that window with
`windowId: null`. They cannot name the new numeric id until a later `get`.

The action does not require the source window IDs of its tabs. Browser rules
for private-window boundaries and tab placement apply. As with `move`, an
empty successful `tabs.move` result is a browser no-op and does not fail the
action. The browser may also create its usual extra New Tab in that window.
The extension does not close it. The next `get` shows the actual state.

### 7.8 `closeWindow`

Close a window and all its tabs:

```json
{
  "type": "closeWindow",
  "windowId": 2
}
```

`windowId` must be a number from the inventory. It must not be `null`. The
action calls `windows.remove`.

## 8. `undo`

`undo` and the planned changelog page are deferred. The shapes below are the
target, not current behavior.

`undo` restores the supported state from the snapshot for one change. It
applies immediately. It first checks that the browser still has the revision
that the change produced. This check prevents undo from overwriting later user
or agent changes.

### Request

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "undo",
  "params": {
    "changeId": "174",
    "revision": 43
  }
}
```

### Result

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "changeId": "174",
    "revision": 44,
    "warnings": []
  }
}
```

If the current revision differs from `revision`, the method fails with
`-32001`. The agent must call `get` and decide what to do.

If another `apply` or `undo` is already in progress, this method fails
immediately with `-32004`. It does not wait for the other change.

Undo restores supported browser state. Closed tabs and windows can require tab
recreation. Recreated tabs start with fresh navigation and content state. A
warning explains each partial restoration. For example:

```json
{
  "warnings": [
    {
      "code": "TAB_RECREATED",
      "message": "Tab 24 was recreated with fresh navigation history"
    }
  ]
}
```

## 9. Planned changelog page

The extension stores one changelog record with each recovery snapshot:

```json
{
  "id": "174",
  "timestamp": 1787550000000,
  "description": "Group the open documentation tabs",
  "actions": [],
  "revisionBefore": 42,
  "revisionAfter": 43,
  "result": {},
  "snapshot": {}
}
```

The extension settings page currently controls the profile name. A later
changelog page will read these records from extension storage. The public RPC
interface remains `describe`, `get`, `apply`, and `undo`.

## 10. Errors

Use the standard JSON-RPC error codes when they apply:

| Code | Meaning |
| ---: | --- |
| `-32700` | Parse error |
| `-32600` | Invalid request |
| `-32601` | Unknown method |
| `-32602` | Invalid parameters |
| `-32603` | Internal error |

Use these application error codes:

| Code | Meaning |
| ---: | --- |
| `-32000` | The browser is unavailable, or the browser or bridge did not respond. |
| `-32001` | The browser state changed. The supplied revision is stale. |
| `-32002` | A starting browser reference or requested change is missing. |
| `-32003` | The browser does not support the operation. |
| `-32004` | Another `apply` or `undo` is in progress. This code is not used for concurrent `get` requests. |
| `-32005` | The change cannot be undone. |

A native action failure uses `BROWSER_REJECTED` and preserves the browser's
message. This includes a reference that an earlier action removed after
snapshot validation. An internal unsupported plan step uses
`UNSUPPORTED_OPERATION`.

## 11. Firefox and Chromium differences

The extension reports browser results. It does not invent a second shuffle
model. `null` means the browser omitted a field; `false` is a Boolean state.
The current browser controls split views, pinned-region no-ops, and other
`tabs.move` behavior. The action result gives the intended count and a summary
of the browser response.

| Area | Firefox | Chromium | RPC rule |
| --- | --- | --- | --- |
| Background process | Manifest V3 event page. An open native messaging Port keeps it loaded. | Manifest V3 service worker. `connectNative()` keeps it loaded (Chrome 105+). | Hold that Port. Reconnect on disconnect with the same instance id. |
| Instance identity | `storage.local` UUID and optional name, per profile. | `storage.local` UUID and optional name, per profile. | Socket path and `--instance` use the id; `--name` uses an exact set name. |
| Containers | Supports contextual identities and separate cookie stores. | Uses the standard browser cookie store. | `container` and `containerId` are `null` on Chromium. |
| Last access | Exposes `Tab.lastAccessed`. | Exposes `Tab.lastAccessed` in current versions. | Return Unix time in milliseconds or `null`. |
| Opener | Keeps the opener in the same window. | Can clear the opener during non-link navigation. | Return the current `Tab.openerTabId` or `null`; do not restore cleared relationships. |
| Successor | Exposes `Tab.successorTabId`. | RPC normalization supplies `null`. | Return the Firefox ID or Chromium `null`. |
| Direct discarded creation | `tabs.create({discarded: true})` creates an unloaded target tab. | No discarded-create. `open` uses a `data:text/html` document that replaces itself on first visible. | `get` returns the target URL and title. Chromium pending tabs set `pendingOpen: true`. |
| Tab groups | `tabs.group` / `ungroup` from Firefox 138; `tabGroups.query` from 139. Manifest min is 119. | Tab group APIs on current Chrome. | `get` → `groups: []` without `tabGroups.query`. Create-`group` → `-32003` until `tabGroups.query` exists. |
| Collapsed active group | Keeps the active tab active and collapses the other tabs. | Moves activation outside the collapsed group. | Report the resulting active tab from a fresh `get`. |
| Private windows | Access depends on the user giving the extension private-window permission. | Access depends on the user giving the extension incognito permission. | Return `privateWindowsIncluded` with every `get` result. |
| Tab, window, and group IDs | IDs are scoped to a browser session. | IDs are scoped to a browser session. | Require a fresh `get` after restart and use revisions before changes. |
| Native host allowlist | Uses `allowed_extensions`. | Uses `allowed_origins`. | Install a browser-specific native host manifest. |
| Native host location | Uses Firefox-specific manifest directories. | Uses Chromium-specific manifest directories. | The installer must write both manifests on Linux and macOS. |

The Chromium `open` fallback does not fetch the target site until the tab is
visible. `get` parses the `data:` document and returns the intended URL and
title with `pendingOpen: true`. There is no sidecar map from tab id to URL.

The current Chromium API documentation and source schema list `discarded` on a
Tab and support `tabs.discard()`. The `tabs.create()` properties comprise the
standard creation fields such as URL, index, active state, pin state, opener,
and window:

- [Chromium Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Chromium `tabs.json` source schema](https://chromium.googlesource.com/chromium/src/+/master/chrome/common/extensions/api/tabs.json)

Firefox documents `discarded` as a `tabs.create()` property:

- [Firefox `tabs.create()`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/create)

The metadata and group behavior rules come from these references:

- [Firefox `tabs.Tab`](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/tabs/Tab)
- [Firefox `tabGroups.update()`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabGroups/update)
- [Cross-browser background scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background)
- [Native Messaging differences](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Chrome_incompatibilities#native_messaging)
- [Chrome native messaging and service worker lifetime](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
