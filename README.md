# True Pinned Tabs

Real pinned tabs for Chrome: give important pages stable names and make them hard to leave by accident.

Static Title Tabs is a small Manifest V3 Chrome extension for people who keep long-running browser workspaces open. Save a page, give it your own tab title, and optionally lock it so ordinary navigation or accidental tab switching does not pull you away from it.

## Features

- Rename any saved page with a custom tab title.
- Keep the title stable even when the website tries to change it.
- Save multiple URL/title rules in a simple popup list.
- Open a saved page from the popup, focusing an existing matching tab when one is already open.
- Lock selected pages so normal clicks cannot navigate the current tab away.
- Keep a locked tab active if you accidentally switch to another tab in the same window.
- Allow page reloads, including `Cmd+R` / `Ctrl+R`.
- Allow query and hash changes on the same page, for example `?tab=activity`.
- Allow opening links in new tabs with `Cmd+click`, `Ctrl+click`, middle click, or `target="_blank"`.
- Works on any domain.
- Stores everything locally in Chrome storage.

## How It Works

Each rule is based on a saved URL and a title.

When a matching page is open, the content script immediately sets `document.title` and keeps enforcing it. If lock mode is enabled, the extension blocks normal in-page navigation away from the saved page and uses the Chrome tabs API to bring the locked tab back when you accidentally switch away.

The lock compares the page by `origin + pathname`, so URL parameters can still change. This lets web apps switch internal tabs or filters without breaking the lock.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select this project folder.

## Usage

1. Open the page you want to keep as a static tab.
2. Click the extension icon.
3. The current URL is filled in automatically.
4. Enter the title you want to see in the browser tab.
5. Enable `Lock this tab` if you want lock mode.
6. Click `Add` / `Save`.

You can edit an existing rule from the popup list or delete it at any time.

## Permissions

The extension asks for:

- `storage` to save your URL/title rules locally.
- `tabs` to detect active tabs and return focus to a locked tab.
- `<all_urls>` so the title and lock behavior can work on any website you choose.

The extension does not send data anywhere. There are no network requests, external APIs, analytics, or remote configuration.

## Limits

Chrome extensions cannot fully replace browser-level pinned tabs. Static Title Tabs makes accidental navigation and accidental switching difficult, but it does not add a native Chrome lock button and it does not prevent every browser UI action.

Reloading the current page is intentionally allowed. Opening links in a new tab is also intentionally allowed.

## Project Structure

- `manifest.json` - Chrome extension manifest.
- `popup.html` / `popup.css` / `popup.js` - popup UI and rule management.
- `content.js` - page title enforcement and in-page navigation blocking.
- `background.js` - tab lock tracking and active-tab recovery.
