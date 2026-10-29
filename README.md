# Arcsider Enhanced

**An Arc-inspired sidebar for Chromium: hover to reveal your saved links, keep open tabs organized, and move your collection with validated JSON backups.**

This enhanced edition builds on [jparrill/arcsider](https://github.com/jparrill/arcsider) with a left-edge hover drawer, a resizable Open Tabs section, live indicators on saved links, light and dark appearance, and import recovery. It retains the original nested folders, drag and drop, pinned shortcuts, and native browser side panel.

**Current version: 1.1.1** · Manifest V3 · No runtime dependencies · MIT licensed

[中文安装、使用与迁移说明](USAGE.zh-CN.md)

## What's new in 1.1.1

- Restore the pinned drawer at document start instead of waiting for page parsing to finish.
- Skip slide-in animations for pinned drawers and resolve their initial state before revealing the edge trigger.
- Recheck pinned state when a page is restored from the back/forward cache, and prevent a stale initial storage read from overwriting a newer pin change.

The drawer belongs to each web page. Full navigation still replaces its document and iframe; these changes reduce restoration delay and animation flicker, but do not make the drawer a persistent browser-level surface. Browser new-tab pages remain outside the injection scope.

## Features introduced in 1.1.0

- **Left-edge hover drawer.** Move the pointer to the left edge of a regular web page to slide the sidebar into view. Move away to hide it, or pin the drawer to keep it open. The drawer overlays the page without resizing its layout.
- **Working folder renaming.** Right-click a folder and choose **Rename**. Enter or blur saves the change; Escape cancels it. Editing a name no longer toggles the folder or submits the edit twice.
- **Resizable Open Tabs.** Drag the divider above Open Tabs to give either list more room. The divider also supports arrow keys and Home/End, and its position survives reloads.
- **Saved links replace duplicate tab rows.** Once a tab is saved anywhere in the collection, it disappears from Open Tabs. Its saved entry and pinned shortcut show whether it is open, with a separate highlight for the active tab in the current window.
- **Accurate URL matching.** Query strings and hash routes are preserved when matching saved links to tabs. Different dashboards or application routes are not collapsed into one entry merely because they share a path.
- **Light and dark appearance.** The interface follows the browser-reported color scheme and uses system colors instead of the original fixed purple background.
- **Validated imports with a recovery point.** Imports are checked before replacement, show a folder/link count preview, and preserve the previous collection for recovery. Invalid files, canceled imports, and rejected storage writes leave the existing collection unchanged.
- **Original backup compatibility.** Both the original `{ tree, pinnedIds }` export and older tree-only arrays are supported. Exports keep the original object format.
- **Synchronized views.** Collection changes propagate between open drawers and the native side panel through local storage events.
- **Simple local builds.** `npm run build` produces a ready-to-load extension folder using an explicit runtime file list.

## Core features

- Organize links in nested folders, reorder them, and move them with drag and drop.
- Pin frequently used links in a favicon shortcut grid.
- Drag an open tab into a folder to save it.
- Activate a matching open tab when clicking a saved link instead of opening another copy.
- Add pages and links from browser context menus.
- Open the native side panel from the extension icon or the default `Alt+S` shortcut.
- Import spaces, folders, and pinned items from Arc Browser's `StorableSidebar.json` using the existing converter.
- Export and restore collections as local JSON files.

## Install

1. Clone or download this repository.
2. Generate the extension folder with Node.js; no `npm install` is needed:

   ```sh
   npm run build
   ```

3. Open `chrome://extensions` in Chrome, `edge://extensions` in Edge, or `brave://extensions` in Brave.
4. Enable **Developer mode** and choose **Load unpacked**.
5. Select **`dist/arcsider`**, the folder containing the generated `manifest.json`.
6. Refresh web pages that were already open so the hover drawer can be injected.

The extension targets Chromium browsers with the Side Panel API. Automated interaction checks were run in Playwright Chromium; other browser versions have not been individually verified.

When updating an existing unpacked installation, keep its folder path unchanged, click **Reload** on the extensions page, and refresh the web pages where you use the drawer.

## Two ways to open the sidebar

### Left-edge drawer

On a regular HTTP or HTTPS page, move the pointer to the leftmost approximately **5 pixels of the page content**. The drawer opens after a brief hover and closes about 300 ms after the pointer leaves it.

Use **◇ / ◆** in the drawer toolbar to toggle its persistent pinned state. An unpinned drawer can also be closed with Escape. The edge trigger can receive keyboard focus and opens with Enter or Space.

### Native browser side panel

Click the extension icon or use `Alt+S` to open the original native side panel. This remains available for browser pages where an injected drawer cannot run.

**Clicking the extension icon opens the native panel, not the hover drawer.** Its position is controlled by the browser's sidebar settings. To place it on the left in Chrome, use **Settings → Appearance → Side panel → Left** where that option is available. The browser's pin icon and the drawer's pin button are independent controls.

## Open Tabs and saved links

Open Tabs lists pages in the current window that have not already been saved in the collection. Saving a page does **not** close its browser tab; it moves its representation from the unsaved tab list to the saved collection.

Open saved links receive a colored indicator, and the active saved page receives a background highlight. Pinned shortcuts show the same open/active states. Switching or closing tabs updates the indicators.

Drag the separator above Open Tabs to adjust its height. With the separator focused, use **Arrow Up / Arrow Down** to resize it or **Home / End** to select the minimum/maximum size. The saved range is 10%–75% of the viewport; both lists scroll independently and shrink as needed in small windows.

URL matching retains query parameters and fragments. For example, `/dashboard?id=1` and `/dashboard?id=2`, or `/#/devices` and `/#/rules`, remain distinct pages. URLs with different query parameter ordering are also treated as distinct.

## Migrate from the original extension

1. Export your collection from the original extension and keep the JSON file outside the extension directory.
2. Disable the original extension. **Do not uninstall it until migration has been checked.**
3. Load this edition and open its native side panel from the extension icon.
4. Choose **Import Arcsider JSON**, select the original backup, and review the folder, link, and pinned-item counts.
5. Confirm the replacement, inspect your important folders and URLs, and open a few saved links.
6. Export a new backup and retain the original file as a separate copy.

A separately loaded extension may have a different extension ID and therefore separate storage. An empty collection in the new installation does not mean the original extension's data has been deleted. Browser storage is not transferred automatically.

## Backup compatibility and recovery

The export format remains compatible with the original implementation:

```json
{
  "tree": [],
  "pinnedIds": []
}
```

Older backups containing only a tree array are accepted too; those files do not contain pinned shortcut information. Node IDs, names, URLs, nested order, expansion states, and additional node fields are preserved. Backups contain saved links, not unsaved open tabs, drawer settings, or recovery history.

Before an import is applied, the entire tree is checked for malformed nodes, missing or duplicate IDs, invalid fields, and unsupported structure. Stale or duplicate pinned references are reported in the preview and omitted without deleting saved links. An empty collection is a valid backup: confirming it replaces the current collection with an empty one.

On confirmation, the previous collection is saved as a local recovery point alongside the replacement data in a single storage request. Use **↶** in the toolbar to preview and restore the collection from before the most recent import. A restoration also saves the collection it replaces.

**The recovery point is not an external backup.** Only the most recent replacement is retained, and recovery data is not included in exports. Uninstalling the extension or clearing its storage can remove it. Keep your original JSON file until you have verified your own collection.

## Browser limits and appearance

- The hover drawer runs inside ordinary HTTP/HTTPS pages, not the browser toolbar, address bar, or tab strip.
- Browser settings, new-tab pages, extension pages, the Chrome Web Store, built-in PDF viewers, and local files may prohibit injection. Use the native side panel there. Website policies and fullscreen content can also affect drawer availability.
- Appearance follows the browser-reported light/dark preference. Chrome does not expose the exact colors or wallpaper of a custom browser theme through the APIs used here; exact theme matching is not claimed.
- The drawer overlays page content, including when pinned. The native side panel remains the option for a browser-managed, docked layout.

See the [Side Panel API documentation](https://developer.chrome.com/docs/extensions/reference/api/sidePanel) and [Chrome's sidebar settings](https://support.google.com/chrome/answer/13156494) for browser behavior.

## Development and validation

```sh
npm test             # Node.js tests; no third-party test dependencies
npm run build        # Generate dist/arcsider
```

On systems with Make and `zip`, `make zip` builds the extension and packages it as `dist/arcsider.zip`.

The repository also includes an optional interaction check:

```sh
node scripts/verify-browser.cjs
```

This requires Playwright and its matching Chromium to be installed and resolvable separately. It launches an isolated temporary browser profile and local test pages; it does not connect to an everyday browser profile. Playwright is not a runtime dependency and is not included in the extension package.

Validation for this edition covers folder renaming, resize persistence, saved-tab indicators, browser drag/drop event handling, an actual JSON download/import/recovery cycle, invalid and canceled imports, simulated storage rejection, light/dark appearance, and drawer hover/pinning. The Node test run passed all 33 tests: 5 new backup/URL tests and 28 existing utility tests.

Compatibility was checked against the original export implementation and equivalent synthetic backups. **A user's real legacy backup and a real Arc Browser export have not been independently migration-tested.** See [the detailed validation record](VERIFICATION.md) and [implementation scope](DESIGN.md) for evidence and remaining boundaries; both documents are currently in Chinese.

## Privacy and permissions

Collections and preferences are stored locally using `chrome.storage.local`. This edition adds no collection backend, analytics, or telemetry service.

- **Website access:** the content script runs on HTTP/HTTPS pages to provide the left-edge drawer.
- **Tabs:** tab information is used to list open pages, detect saved matches, and activate an existing tab.
- **Storage:** saved links, folder structure, pinned shortcuts, layout preferences, and the import recovery point remain in the browser profile.
- **Side panel and context menus:** provide the native panel and browser-level add actions.
- **Favicons:** the existing implementation requests favicons from Google's public favicon service, which receives the requested site's domain. Favicon loading therefore makes external network requests.

## Credits and license

Based on [Arcsider by Juan Manuel Parrilla Madrid](https://github.com/jparrill/arcsider). This edition extends the original project while retaining its attribution and [MIT license](LICENSE).
