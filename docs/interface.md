# Tab Control Interface

## 1. Scope

Tab Control gives a local agent access to open browser windows and tabs. The
agent reads browser state and sends primitive browser changes. The agent owns
search, classification, duplicate detection, sorting decisions, grouping
decisions, and summaries.

The extension does not contain an orchestration engine.

This interface targets current Firefox and Chromium-based browsers on Linux
and macOS.

## 2. Client command

The client has one command:

```sh
node tabctl.js rpc
```

The command reads one JSON-RPC 2.0 request from standard input. It writes one
JSON-RPC 2.0 response to standard output. It writes diagnostic messages to
standard error.

The command connects to the local native bridge through a Unix domain socket.
The socket protocol and socket location are internal details. They are not
part of this interface.

Version 1 does not support JSON-RPC notifications or batch requests.

## 3. Methods

Version 1 has three methods:

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

`privateWindowsIncluded` is false when the browser does not give the extension
access to private or incognito windows. In that case, the inventory is complete
only for non-private windows.

Browser tab, window, and group IDs are valid only in the current browser
session. An agent must call `get` again after the browser restarts.

The extension returns `null` for an unsupported or unavailable field. For
example, Chromium returns `null` for `container` and `successorTabId`.

A container is a Firefox contextual identity. It gives a tab a separate cookie
store, such as Personal, Work, or Banking. Chromium does not support Firefox
containers.

`lastAccessed` is the last time that the tab became active in its window.
Current Firefox and Chromium versions expose this value.

`openerTabId` identifies the tab that opened this tab. It is available only
while the opener still exists. In Firefox, the opener must also be in the same
window. `successorTabId` identifies the tab that Firefox selects after this tab
closes. Chromium does not expose a successor tab ID.

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

## 6. `apply`

`apply` checks the supplied revision and validates the complete action list. It
validates each action against the state that earlier actions will produce. If
validation succeeds, it saves a recovery snapshot and runs the actions in array
order. It applies the change immediately.

The recovery snapshot stores the window and tab inventory and the metadata that
the extension supports. It does not store page form data, page process state,
or other content state.

The extension creates a change record only when execution can start. A failed
revision check or validation does not create a change record.

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

If an action fails, the extension stops and does not run later actions. It then
uses the saved snapshot to roll back all supported changes. Rollback is best
effort because a browser cannot restore all closed-tab state.

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
          "message": "Tab 24 does not exist"
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
of the destination window. Pinned tabs must stay before unpinned tabs. The
extension rejects an index outside the permitted pinned or unpinned region.

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
come before all unpinned tabs.

### 7.3 `relativeOrder`

Replace the order between two stable anchors without sending the complete
window order:

```json
{
  "type": "relativeOrder",
  "windowId": 1,
  "beforeTabId": 17,
  "tabIds": [9, 24, 12],
  "afterTabId": 31
}
```

The tabs before `beforeTabId` and after `afterTabId` stay in place. The two
anchor tabs also stay in place. `tabIds` must contain each tab that is currently
between the anchors exactly once. The action changes only the order of that
middle range.

Use `null` for `beforeTabId` to anchor the range at the start of the window. Use
`null` for `afterTabId` to anchor it at the end. The pinned-tab ordering rule
still applies.

### 7.4 `update`

Update tab properties:

```json
{
  "type": "update",
  "tabIds": [17, 24],
  "pinned": true
}
```

Version 1 supports only `pinned`.

### 7.5 `group`

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

A request must contain either `groupId` or the new group properties. It must not
contain both forms.

All tabs must be in one window. For an existing group, all tabs must be in the
same window as the group.

The method returns an unsupported-operation error if the browser does not
support tab groups.

### 7.6 `ungroup`

Remove tabs from their groups:

```json
{
  "type": "ungroup",
  "tabIds": [17, 24]
}
```

### 7.7 `open`

Open inactive tabs without loading the target websites:

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

All new tabs start inactive and discarded. The target websites do not load
until the user activates their tabs.

Firefox supports direct creation of discarded tabs. Chromium does not. On
Chromium, the extension creates and discards a small local placeholder tab. It
stores the target URL and navigates to it when the user first activates the
tab. `get` returns the target URL and title for such a pending tab and sets
`pendingOpen` to `true`. Other tabs return `pendingOpen: false`.

`containerId` is available only in Firefox. All tabs must have fully qualified
HTTP or HTTPS URLs in version 1.

### 7.8 `close`

Close tabs:

```json
{
  "type": "close",
  "tabIds": [17, 24]
}
```

The recovery snapshot is the version 1 archive record.

### 7.9 `newWindow`

Create a normal window and move tabs into it:

```json
{
  "type": "newWindow",
  "tabIds": [17, 24],
  "focused": false
}
```

The action result contains the new window ID. Later actions in the same request
cannot refer to this ID.

Version 1 rejects private or incognito tabs in this action.

### 7.10 `closeWindow`

Close a window and all its tabs:

```json
{
  "type": "closeWindow",
  "windowId": 2
}
```

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

Undo is best effort. Closed tabs and windows can require tab recreation. This
can lose navigation history, form data, and other browser-session state. A
warning explains each state that the extension could not restore exactly. For
example:

```json
{
  "warnings": [
    {
      "code": "TAB_RECREATED",
      "message": "Tab 24 was recreated without its navigation history"
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
RPC interface does not expose a separate changelog method.

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
| `-32000` | The browser is unavailable. |
| `-32001` | The browser state changed. |
| `-32002` | A tab, window, group, or change does not exist. |
| `-32003` | The browser does not support the operation. |
| `-32004` | Another change is in progress. |
| `-32005` | The change cannot be undone. |

An action failure uses a short string code such as `TAB_NOT_FOUND`,
`WINDOW_NOT_FOUND`, `GROUP_NOT_FOUND`, or `UNSUPPORTED_OPERATION`.

## 11. Firefox and Chromium differences

The extension must hide browser API differences from the RPC client where it
can. The future agent skill must still describe the semantic differences in
this section. An agent must not assume that a `null` value means that the
underlying browser state is false.

| Area | Firefox | Chromium | RPC rule |
| --- | --- | --- | --- |
| Background process | Manifest V3 uses a background script or event page. | Manifest V3 uses a service worker. | This is an implementation detail. |
| Containers | Supports contextual identities and separate cookie stores. | Does not support Firefox containers. | `container` and `containerId` are `null` or unsupported on Chromium. |
| Last access | Exposes `Tab.lastAccessed`. | Exposes `Tab.lastAccessed` in current versions. | Return Unix time in milliseconds or `null`. |
| Opener | Exposes `Tab.openerTabId` while the opener exists and is in the same window. | Exposes `Tab.openerTabId` while the opener exists. | Return the ID or `null`. Do not treat this as a durable relationship. |
| Successor | Exposes `Tab.successorTabId`. | Does not expose a successor tab ID. | Return `null` on Chromium. |
| Direct discarded creation | `tabs.create({discarded: true})` creates a tab without loading its target. | Current `tabs.create` has no `discarded` property. `tabs.discard` works only after tab creation. | Use direct creation on Firefox. Use a discarded local placeholder on Chromium and load the target on first activation. |
| Tab groups | Supports current WebExtension tab group APIs. | Supports tab group APIs. | Return unsupported-operation when the installed browser lacks the required API. |
| Collapsed active group | Keeps the active tab active and collapses the other tabs. | Moves activation outside the collapsed group. | Do not promise identical active-tab behavior after group collapse. |
| Private windows | Access depends on the user giving the extension private-window permission. | Access depends on the user giving the extension incognito permission. | Return `privateWindowsIncluded` with every `get` result. |
| Tab, window, and group IDs | IDs are scoped to a browser session. | IDs are scoped to a browser session. | Require a fresh `get` after restart and use revisions before changes. |
| Native host allowlist | Uses `allowed_extensions`. | Uses `allowed_origins`. | Install a browser-specific native host manifest. |
| Native host location | Uses Firefox-specific manifest directories. | Uses Chromium-specific manifest directories. | The installer must write both manifests on Linux and macOS. |

The Chromium lazy-open fallback must not load the target website before the
user activates the tab. `get` must return the intended target URL and title,
not the internal placeholder URL, and must set `pendingOpen` to `true`.

The current Chromium API documentation and source schema list `discarded` on a
Tab and support `tabs.discard()`. They do not list `discarded` in
`tabs.create()` properties:

- [Chromium Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Chromium `tabs.json` source schema](https://chromium.googlesource.com/chromium/src/+/master/chrome/common/extensions/api/tabs.json)

Firefox documents `discarded` as a `tabs.create()` property:

- [Firefox `tabs.create()`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/create)

The metadata and group behavior rules come from these references:

- [Firefox `tabs.Tab`](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/tabs/Tab)
- [Firefox `tabGroups.update()`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabGroups/update)
- [Cross-browser background scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background)
- [Native Messaging differences](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Chrome_incompatibilities#native_messaging)
