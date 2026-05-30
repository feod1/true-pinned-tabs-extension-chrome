const RULES_KEY = "titleRules";
const TAB_LOCKS_KEY = "tabLocks";
const WINDOW_LOCKS_KEY = "windowLocks";
const MANUAL_OPEN_MS = 2000;

const manualOpenUntilByWindow = new Map();

function getPageKey(url) {
  try {
    const parsedUrl = new URL(url);
    return `${parsedUrl.origin}${parsedUrl.pathname}`;
  } catch {
    return "";
  }
}

function samePageUrl(firstUrl, secondUrl) {
  const firstKey = getPageKey(firstUrl);
  return Boolean(firstKey && firstKey === getPageKey(secondUrl));
}

async function readLocal(key, fallback) {
  const value = await chrome.storage.local.get(key);
  return value[key] ?? fallback;
}

async function readSession(key, fallback) {
  const storage = chrome.storage.session ?? chrome.storage.local;
  const value = await storage.get(key);
  return value[key] ?? fallback;
}

async function writeSession(key, value) {
  const storage = chrome.storage.session ?? chrome.storage.local;
  await storage.set({ [key]: value });
}

async function getRules() {
  const rules = await readLocal(RULES_KEY, []);
  return Array.isArray(rules) ? rules : [];
}

function findLockedRule(url, rules) {
  if (!url) return null;
  return (
    rules.find((rule) => rule.locked && rule.url === url) ??
    rules.find((rule) => rule.locked && samePageUrl(rule.url, url)) ??
    null
  );
}

async function getTabLocks() {
  return readSession(TAB_LOCKS_KEY, {});
}

async function setTabLocks(tabLocks) {
  await writeSession(TAB_LOCKS_KEY, tabLocks);
}

async function getWindowLocks() {
  return readSession(WINDOW_LOCKS_KEY, {});
}

async function setWindowLocks(windowLocks) {
  await writeSession(WINDOW_LOCKS_KEY, windowLocks);
}

async function rememberLockedTab(tab, rule, currentUrl = tab.url ?? rule.url) {
  const tabLocks = await getTabLocks();
  tabLocks[String(tab.id)] = {
    url: currentUrl,
    ruleUrl: rule.url,
    windowId: tab.windowId
  };
  await setTabLocks(tabLocks);

  if (tab.active) {
    const windowLocks = await getWindowLocks();
    windowLocks[String(tab.windowId)] = tab.id;
    await setWindowLocks(windowLocks);
  }
}

async function forgetLockedTab(tabId) {
  const key = String(tabId);
  const tabLocks = await getTabLocks();
  delete tabLocks[key];
  await setTabLocks(tabLocks);

  const windowLocks = await getWindowLocks();
  for (const [windowId, lockedTabId] of Object.entries(windowLocks)) {
    if (String(lockedTabId) === key) {
      delete windowLocks[windowId];
    }
  }
  await setWindowLocks(windowLocks);
}

async function isStoredLockStillEnabled(lock) {
  const rules = await getRules();
  return Boolean(lock && findLockedRule(lock.ruleUrl ?? lock.url, rules));
}

async function sendLockMessage(tabId, type) {
  try {
    await chrome.tabs.sendMessage(tabId, { type });
  } catch {
    // The tab can be on an extension/browser page where content scripts do not run.
  }
}

async function redirectLockedNavigation(tabId, lock) {
  try {
    await chrome.tabs.update(tabId, { url: lock.url });
    await sendLockMessage(tabId, "LOCK_NAVIGATION_BLOCKED");
  } catch {
    await forgetLockedTab(tabId);
  }
}

async function syncTab(tabId, changeInfo, tab) {
  const rules = await getRules();
  const tabLocks = await getTabLocks();
  const storedLock = tabLocks[String(tabId)];
  const nextUrl = changeInfo.url ?? tab.url;

  if (storedLock && nextUrl) {
    const lockedPageUrl = storedLock.ruleUrl ?? storedLock.url;

    if (!samePageUrl(nextUrl, lockedPageUrl)) {
      if (await isStoredLockStillEnabled(storedLock)) {
        await redirectLockedNavigation(tabId, storedLock);
        return;
      }

      await forgetLockedTab(tabId);
    } else if (nextUrl !== storedLock.url) {
      await rememberLockedTab(tab, { url: lockedPageUrl }, nextUrl);
      return;
    }
  }

  const activeRule = findLockedRule(nextUrl, rules);
  if (activeRule && tab?.id !== undefined) {
    await rememberLockedTab(tab, activeRule, nextUrl);
  }
}

async function rebuildLocks() {
  const rules = await getRules();
  const tabs = await chrome.tabs.query({});
  const tabLocks = {};
  const windowLocks = {};

  for (const tab of tabs) {
    const rule = findLockedRule(tab.url, rules);
    if (!rule || tab.id === undefined) continue;

    tabLocks[String(tab.id)] = {
      url: tab.url,
      ruleUrl: rule.url,
      windowId: tab.windowId
    };

    if (tab.active) {
      windowLocks[String(tab.windowId)] = tab.id;
    }
  }

  await setTabLocks(tabLocks);
  await setWindowLocks(windowLocks);
}

function findOpenTab(url, tabs) {
  return (
    tabs.find((tab) => tab.url === url) ??
    tabs.find((tab) => tab.url && samePageUrl(tab.url, url)) ??
    null
  );
}

async function focusRuleUrl(url, sourceWindowId) {
  const normalizedUrl = new URL(url).href;
  const tabs = await chrome.tabs.query({});
  let targetTab = findOpenTab(normalizedUrl, tabs);

  if (!targetTab) {
    targetTab = await chrome.tabs.create({
      active: false,
      url: normalizedUrl,
      ...(sourceWindowId ? { windowId: sourceWindowId } : {})
    });
  }

  if (targetTab?.id === undefined || targetTab.windowId === undefined) return;

  const windowKey = String(targetTab.windowId);
  manualOpenUntilByWindow.set(windowKey, Date.now() + MANUAL_OPEN_MS);

  await chrome.tabs.update(targetTab.id, { active: true });
  await chrome.windows.update(targetTab.windowId, { focused: true });
}

async function keepWindowOnLockedTab(activeInfo) {
  const windowKey = String(activeInfo.windowId);
  const windowLocks = await getWindowLocks();

  const manualOpenUntil = manualOpenUntilByWindow.get(windowKey) ?? 0;
  if (manualOpenUntil > Date.now()) {
    manualOpenUntilByWindow.delete(windowKey);

    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      const rule = findLockedRule(tab.url, await getRules());
      if (rule) {
        await rememberLockedTab(tab, rule, tab.url);
      } else {
        delete windowLocks[windowKey];
        await setWindowLocks(windowLocks);
      }
    } catch {
      delete windowLocks[windowKey];
      await setWindowLocks(windowLocks);
    }
    return;
  }

  const lockedTabId = windowLocks[windowKey];

  if (lockedTabId && lockedTabId !== activeInfo.tabId) {
    const tabLocks = await getTabLocks();
    const lock = tabLocks[String(lockedTabId)];

    if (await isStoredLockStillEnabled(lock)) {
      try {
        await chrome.tabs.update(lockedTabId, { active: true });
        await sendLockMessage(lockedTabId, "LOCK_SWITCH_BLOCKED");
      } catch {
        delete windowLocks[windowKey];
        await setWindowLocks(windowLocks);
      }
      return;
    }

    delete windowLocks[windowKey];
    await setWindowLocks(windowLocks);
  }

  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    const rule = findLockedRule(tab.url, await getRules());
    if (rule) {
      await rememberLockedTab(tab, rule);
    }
  } catch {
    // The tab disappeared before Chrome returned it.
  }
}

chrome.runtime.onInstalled.addListener(() => {
  rebuildLocks();
});

chrome.runtime.onStartup.addListener(() => {
  rebuildLocks();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[RULES_KEY]) {
    rebuildLocks();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "OPEN_RULE") return false;

  focusRuleUrl(message.url, message.windowId)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    syncTab(tabId, changeInfo, tab);
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  keepWindowOnLockedTab(activeInfo);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  forgetLockedTab(tabId);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  forgetLockedTab(removedTabId);
  chrome.tabs.get(addedTabId).then((tab) => syncTab(addedTabId, { url: tab.url }, tab));
});
