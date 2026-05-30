const RULES_KEY = "titleRules";

const form = document.getElementById("rule-form");
const urlInput = document.getElementById("url-input");
const titleInput = document.getElementById("title-input");
const lockInput = document.getElementById("lock-input");
const saveButton = document.getElementById("save-button");
const useCurrentButton = document.getElementById("use-current-button");
const rulesList = document.getElementById("rules-list");

let currentTab = null;
let rules = [];

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  return tab ?? null;
}

async function loadRules() {
  const value = await chrome.storage.local.get(RULES_KEY);
  rules = Array.isArray(value[RULES_KEY]) ? value[RULES_KEY] : [];
}

async function saveRules(nextRules) {
  rules = nextRules;
  await chrome.storage.local.set({ [RULES_KEY]: rules });
  renderRules();
  notifyActiveTab();
}

function normalizeUrl(rawUrl) {
  return new URL(rawUrl).href;
}

async function openRule(rule) {
  await chrome.runtime.sendMessage({
    type: "OPEN_RULE",
    url: rule.url,
    windowId: currentTab?.windowId
  });
  window.close();
}

function fillFromRule(rule) {
  urlInput.value = rule.url;
  titleInput.value = rule.title;
  lockInput.checked = Boolean(rule.locked);
  saveButton.textContent = "Save";
}

function fillCurrentUrl() {
  if (currentTab?.url) {
    urlInput.value = currentTab.url;
  }
}

function createRuleElement(rule) {
  const item = document.createElement("article");
  item.className = "rule";

  const main = document.createElement("div");
  main.className = "rule-main";

  const title = document.createElement("div");
  title.className = "rule-title";
  title.textContent = rule.title;

  const url = document.createElement("div");
  url.className = "rule-url";
  url.textContent = rule.url;

  main.append(title, url);

  if (rule.locked) {
    const badge = document.createElement("div");
    badge.className = "badge";
    badge.textContent = "lock";
    main.appendChild(badge);
  }

  const actions = document.createElement("div");
  actions.className = "rule-actions";

  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "open";
  openButton.textContent = "Open";
  openButton.addEventListener("click", () => openRule(rule));

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "edit";
  editButton.textContent = "Edit";
  editButton.addEventListener("click", () => fillFromRule(rule));

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "delete";
  deleteButton.textContent = "Delete";
  deleteButton.addEventListener("click", () => {
    saveRules(rules.filter((itemRule) => itemRule.id !== rule.id));
  });

  actions.append(openButton, editButton, deleteButton);
  item.append(main, actions);
  return item;
}

function renderRules() {
  rulesList.replaceChildren();

  if (!rules.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No saved tabs yet";
    rulesList.appendChild(empty);
    return;
  }

  for (const rule of rules) {
    rulesList.appendChild(createRuleElement(rule));
  }
}

async function notifyActiveTab() {
  if (!currentTab?.id) return;

  try {
    await chrome.tabs.sendMessage(currentTab.id, { type: "RULES_UPDATED" });
  } catch {
    // Chrome pages do not accept content-script messages.
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  let url = "";
  try {
    url = normalizeUrl(urlInput.value.trim());
  } catch (error) {
    urlInput.setCustomValidity(error.message);
    urlInput.reportValidity();
    return;
  }

  urlInput.setCustomValidity("");
  const title = titleInput.value.trim();
  if (!url || !title) return;

  const existingRule = rules.find((rule) => rule.url === url);
  const nextRule = {
    id: existingRule?.id ?? crypto.randomUUID(),
    url,
    title,
    locked: lockInput.checked
  };

  const nextRules = existingRule
    ? rules.map((rule) => (rule.url === url ? nextRule : rule))
    : [nextRule, ...rules];

  await saveRules(nextRules);
  saveButton.textContent = "Save";
});

useCurrentButton.addEventListener("click", fillCurrentUrl);

document.addEventListener("DOMContentLoaded", async () => {
  currentTab = await getActiveTab();
  fillCurrentUrl();
  await loadRules();

  const currentRule = rules.find((rule) => currentTab?.url && rule.url === currentTab.url);
  if (currentRule) {
    fillFromRule(currentRule);
  }

  renderRules();
});
