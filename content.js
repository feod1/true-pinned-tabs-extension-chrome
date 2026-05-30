const RULES_KEY = "titleRules";
const TITLE_INTERVAL_MS = 5000;

let activeRule = null;
let titleIntervalId = null;
let titleObserver = null;
let toastTimerId = null;
let lockEnabled = false;

function sameUrl(url) {
  return url === window.location.href;
}

function getPageKey(url) {
  try {
    const parsedUrl = new URL(url, window.location.href);
    return `${parsedUrl.origin}${parsedUrl.pathname}`;
  } catch {
    return "";
  }
}

function samePageUrl(firstUrl, secondUrl = window.location.href) {
  const firstKey = getPageKey(firstUrl);
  return Boolean(firstKey && firstKey === getPageKey(secondUrl));
}

function showLockToast(message = "This tab is locked.") {
  const existing = document.getElementById("static-title-tabs-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "static-title-tabs-toast";
  toast.textContent = message;
  toast.style.position = "fixed";
  toast.style.left = "50%";
  toast.style.top = "18px";
  toast.style.transform = "translateX(-50%)";
  toast.style.zIndex = "2147483647";
  toast.style.maxWidth = "min(420px, calc(100vw - 32px))";
  toast.style.padding = "10px 14px";
  toast.style.borderRadius = "8px";
  toast.style.background = "#111827";
  toast.style.color = "#ffffff";
  toast.style.font = "14px/1.35 system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  toast.style.boxShadow = "0 12px 30px rgba(0, 0, 0, 0.25)";
  toast.style.textAlign = "center";

  const mount = document.body || document.documentElement;
  mount.appendChild(toast);

  clearTimeout(toastTimerId);
  toastTimerId = window.setTimeout(() => toast.remove(), 2600);
}

function setSavedTitle() {
  if (!activeRule?.title) return;
  if (document.title !== activeRule.title) {
    document.title = activeRule.title;
  }
}

function startTitleWatcher() {
  stopTitleWatcher();
  if (!activeRule?.title) return;

  setSavedTitle();
  titleIntervalId = window.setInterval(setSavedTitle, TITLE_INTERVAL_MS);

  const titleNode = document.querySelector("title");
  if (titleNode) {
    titleObserver = new MutationObserver(setSavedTitle);
    titleObserver.observe(titleNode, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }
}

function stopTitleWatcher() {
  if (titleIntervalId) {
    window.clearInterval(titleIntervalId);
    titleIntervalId = null;
  }

  if (titleObserver) {
    titleObserver.disconnect();
    titleObserver = null;
  }
}

function blockNavigation(event, targetUrl) {
  if (!lockEnabled || !activeRule || samePageUrl(targetUrl)) return false;

  event.preventDefault();
  event.stopPropagation();
  showLockToast();
  return true;
}

function opensOutsideCurrentTab(event, link) {
  return (
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    event.button === 1 ||
    (link.target && link.target.toLowerCase() !== "_self")
  );
}

function handleDocumentClick(event) {
  const link = event.target?.closest?.("a[href]");
  if (!link) return;
  if (opensOutsideCurrentTab(event, link)) return;

  const targetUrl = new URL(link.getAttribute("href"), window.location.href).href;
  blockNavigation(event, targetUrl);
}

function handleFormSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;

  const action = form.getAttribute("action") || window.location.href;
  const targetUrl = new URL(action, window.location.href).href;
  blockNavigation(event, targetUrl);
}

function enableLock() {
  if (lockEnabled) return;

  lockEnabled = true;
  document.addEventListener("click", handleDocumentClick, true);
  document.addEventListener("submit", handleFormSubmit, true);
}

function disableLock() {
  if (!lockEnabled) return;

  lockEnabled = false;
  document.removeEventListener("click", handleDocumentClick, true);
  document.removeEventListener("submit", handleFormSubmit, true);
}

async function loadRules() {
  const value = await chrome.storage.local.get(RULES_KEY);
  return Array.isArray(value[RULES_KEY]) ? value[RULES_KEY] : [];
}

async function refreshRule() {
  const rules = await loadRules();
  activeRule =
    rules.find((rule) => sameUrl(rule.url)) ??
    rules.find((rule) => rule.locked && samePageUrl(rule.url)) ??
    null;

  if (activeRule) {
    startTitleWatcher();
  } else {
    stopTitleWatcher();
  }

  if (activeRule?.locked) {
    enableLock();
  } else {
    disableLock();
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[RULES_KEY]) {
    refreshRule();
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "RULES_UPDATED") {
    refreshRule();
  }

  if (message?.type === "LOCK_SWITCH_BLOCKED") {
    showLockToast("This tab is locked.");
  }

  if (message?.type === "LOCK_NAVIGATION_BLOCKED") {
    showLockToast();
  }
});

refreshRule();
