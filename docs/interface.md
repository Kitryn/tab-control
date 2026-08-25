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

The client has one command:

```sh
tabctl rpc
```

The command reads one JSON-RPC 2.0 request from standard input. It writes one
JSON-RPC 2.0 response to standard output. It writes diagnostic messages to
standard error. The request and the socket frame are JSON Lines: one JSON
object, one line. Pretty-printed JSON is rejected.

The command connects to the local native bridge through a Unix domain socket.
The public interface starts at JSON-RPC input and ends at JSON-RPC output. The
bridge owns the socket protocol and socket location.

Each invocation accepts one JSON-RPC request and returns one JSON-RPC response.
Each invocation is independent. The client does not hold a session or a
browser lock across invocations. Occupancy is one in-flight change
(`apply` or `undo`), not ownership of the browser.

Multiple clients may call the interface at the same time.

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

The interface has three methods:

| Method | Purpose |
| --- | --- |
| `get` | Get the complete current browser state. |
| `apply` | Save a recovery snapshot and apply an ordered action list. |
| `undo` | Restore the recovery snapshot for one change. |

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

`get` returns one inventory of all browser windows that the extension can
access.

### Request

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "get",
  "params": {}
}
```

### Result

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
    "groups": []
  }
}
```

`capturedAt` and `lastAccessed` are Unix times in milliseconds.

`privateWindowsIncluded: true` means that the inventory covers standard and
private windows. `privateWindowsIncluded: false` means that the inventory covers
standard windows.

Browser tab, window, and group IDs belong to the current browser session. An
agent calls `get` again after the browser restarts.

The extension returns `null` when the browser omits a field. For example,
Chromium returns `null` for `container` and `successorTabId`.

A container is a Firefox contextual identity. It gives a tab a separate cookie
store, such as Personal, Work, or Banking. Chromium returns `null` for this
Firefox-specific field.

`lastAccessed` is the last time that the tab became active in its window.
Current Firefox and Chromium versions expose this value.

`openerTabId` identifies the tab that opened this tab. It remains available
while the opener exists. Firefox also keeps the opener in the same window.
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

The revision changes when the inventory changes. An agent uses the revision to
prevent a change from using stale IDs or positions.

Concurrent `get` requests succeed independently. A `get` that arrives
while `apply` or `undo` is running waits for that change to finish.

## 6. `apply`

`apply` checks the supplied revision and validates the complete action list. It
validates each action against the state that earlier actions will produce. If
validation succeeds, it saves a recovery snapshot and runs the actions in array
order. It applies the change immediately.

If another `apply` or `undo` is already in progress, this method fails
immediately with `-32004`. It does not wait for the other change.

The recovery snapshot stores the window and tab inventory plus supported
metadata. Tab recreation restores URLs and supported tab properties.

The extension creates a change record after all validation succeeds and
immediately before execution starts.

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

### Successful result

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "changeId": "174",
    "revision": 43,
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

### Failed action and rollback

The first failed action ends forward execution. The extension then uses the
saved snapshot to roll back all supported changes. Rollback recreates closed
tabs from their URLs and supported metadata.

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "changeId": "174",
    "revision": 44,
    "actions": [
      {
        "index": 0,
        "ok": true
      },
      {
        "index": 1,
        "ok": false,
        "error": {
          "code": "TAB_NOT_FOUND",
          "message": "Tab 24 is missing"
        }
      }
    ],
    "rollback": {
      "attempted": true,
      "complete": true,
      "warnings": []
    }
  }
}
```

The agent must call `get` after a failed action. A rollback can assign new IDs
to recreated tabs or windows.

## 7. Actions

`move`, `order`, and `open` take `windowId`. A number is a window from the
inventory (including windows earlier actions in this list already used).
`null` means the window created by the nearest preceding `newWindow` in this
`actions` list. `null` is not the focused window.

If `windowId` is `null` and no `newWindow` precedes this action, validation
fails. After a second `newWindow`, `null` binds to that later window. An
earlier new window in the same list has no id the agent can name; a later
`apply` after `get` can use the numeric id from `get`.

`closeWindow` requires a numeric `windowId`. `null` is invalid.

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

The extension preserves the order in `tabIds`. An index of `-1` means the end
of the destination window. `index` is the final index of the first moved tab
in the destination window after the move. The agent does not compute
pre-removal index arithmetic. Pinned tabs must stay before unpinned tabs. The
extension rejects an index outside the permitted pinned or unpinned region.

Use `move` when a subset of tabs should land at one place. Use `order` when
one window's strip should become an exact list.

### 7.2 `order`

Set the complete tab order for one window:

```json
{
  "type": "order",
  "windowId": 1,
  "tabIds": [17, 24, 9, 12]
}
```

`tabIds` must contain each tab in the window exactly once. All pinned tabs must
come before all unpinned tabs. If the window's tab set changed since `get`,
validation fails. The agent calls `get` and sends a new `order`.

### 7.3 `update`

Update tab properties:

```json
{
  "type": "update",
  "tabIds": [17, 24],
  "pinned": true
}
```

The `update` action supports the `pinned` property.

### 7.4 `group`

Create a group:

```json
{
  "type": "group",
  "tabIds": [17, 24],
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

Use one group form in each action: `groupId` or the new group properties.

All tabs must be in one window. For an existing group, all tabs must be in the
same window as the group.

A create form returns `groupId` on that action result. Later actions in the
same `apply` list cannot use that id. The agent calls `get`, then a later
`apply` may send `groupId`.

Browsers with tab group APIs execute this action. Other browser versions return
an unsupported-operation error.

### 7.5 `ungroup`

Remove tabs from their groups:

```json
{
  "type": "ungroup",
  "tabIds": [17, 24]
}
```

### 7.6 `open`

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

All new tabs start inactive and discarded. The target website loads when the
user activates its tab.

Firefox creates the target tab directly in a discarded state. Chromium creates
and discards a small local placeholder tab, stores the target URL, and navigates
to it when the user first activates the tab. `get` returns the target URL and
title for such a pending tab and sets `pendingOpen` to `true`. Other tabs return
`pendingOpen: false`.

Firefox accepts `containerId`. Chromium accepts `null`. The `open` action
accepts fully qualified HTTP or HTTPS URLs.

### 7.7 `close`

Close tabs:

```json
{
  "type": "close",
  "tabIds": [17, 24]
}
```

The recovery snapshot is the archive record.

### 7.8 `newWindow`

Create a normal window and move tabs into it:

```json
{
  "type": "newWindow",
  "tabIds": [17, 24],
  "focused": false
}
```

The action result contains the new window ID. Later `move`, `order`, and
`open` actions in this list target that window with `windowId: null`. They
cannot name the new numeric id until a later `get`.

The `newWindow` action accepts tabs from standard windows.

### 7.9 `closeWindow`

Close a window and all its tabs:

```json
{
  "type": "closeWindow",
  "windowId": 2
}
```

`windowId` must be a number from the inventory. It must not be `null`.

## 8. `undo`

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

## 9. Changelog and dashboard

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

The extension dashboard reads these records from extension storage. The public
RPC interface remains `get`, `apply`, and `undo`.

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
| `-32002` | A tab, window, group, or change does not exist. |
| `-32003` | The browser does not support the operation. |
| `-32004` | Another `apply` or `undo` is in progress. This code is not used for concurrent `get` requests. |
| `-32005` | The change cannot be undone. |

An action failure uses a short string code such as `TAB_NOT_FOUND`,
`WINDOW_NOT_FOUND`, `GROUP_NOT_FOUND`, or `UNSUPPORTED_OPERATION`.

## 11. Firefox and Chromium differences

The extension normalizes browser API differences for the RPC client. The future
agent skill describes the semantic differences in this section. A `null` value
means that the browser omitted the data; `false` represents a Boolean state.

| Area | Firefox | Chromium | RPC rule |
| --- | --- | --- | --- |
| Background process | Manifest V3 uses a background script or event page. | Manifest V3 uses a service worker. | This is an implementation detail. |
| Containers | Supports contextual identities and separate cookie stores. | Uses the standard browser cookie store. | `container` and `containerId` are `null` on Chromium. |
| Last access | Exposes `Tab.lastAccessed`. | Exposes `Tab.lastAccessed` in current versions. | Return Unix time in milliseconds or `null`. |
| Opener | Exposes `Tab.openerTabId` while the opener exists and is in the same window. | Exposes `Tab.openerTabId` while the opener exists. | Return the current ID or `null`; refresh it with each `get`. |
| Successor | Exposes `Tab.successorTabId`. | RPC normalization supplies `null`. | Return the Firefox ID or Chromium `null`. |
| Direct discarded creation | `tabs.create({discarded: true})` creates an unloaded target tab. | `tabs.discard()` discards a tab after creation. | Use direct creation on Firefox. Use a discarded local placeholder on Chromium and load the target on first activation. |
| Tab groups | Supports current WebExtension tab group APIs. | Supports tab group APIs. | Execute on browsers that provide the required API; other versions return unsupported-operation. |
| Collapsed active group | Keeps the active tab active and collapses the other tabs. | Moves activation outside the collapsed group. | Report the resulting active tab from a fresh `get`. |
| Private windows | Access depends on the user giving the extension private-window permission. | Access depends on the user giving the extension incognito permission. | Return `privateWindowsIncluded` with every `get` result. |
| Tab, window, and group IDs | IDs are scoped to a browser session. | IDs are scoped to a browser session. | Require a fresh `get` after restart and use revisions before changes. |
| Native host allowlist | Uses `allowed_extensions`. | Uses `allowed_origins`. | Install a browser-specific native host manifest. |
| Native host location | Uses Firefox-specific manifest directories. | Uses Chromium-specific manifest directories. | The installer must write both manifests on Linux and macOS. |

The Chromium lazy-open fallback keeps the target website unloaded until the
user activates the tab. `get` returns the intended target URL and title and
sets `pendingOpen` to `true`.

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
