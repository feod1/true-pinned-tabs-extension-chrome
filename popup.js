const RULES_KEY = "titleRules";
const FOLDERS_KEY = "tabFolders";
const SETTINGS_KEY = "popupSettings";

const form = document.getElementById("rule-form");
const urlInput = document.getElementById("url-input");
const titleInput = document.getElementById("title-input");
const lockInput = document.getElementById("lock-input");
const saveButton = document.getElementById("save-button");
const useCurrentButton = document.getElementById("use-current-button");
const backButton = document.getElementById("back-button");
const pathLabel = document.getElementById("path-label");
const addFolderButton = document.getElementById("add-folder-button");
const folderForm = document.getElementById("folder-form");
const folderNameInput = document.getElementById("folder-name-input");
const cancelFolderButton = document.getElementById("cancel-folder-button");
const rulesList = document.getElementById("rules-list");
const lockDefaultInput = document.getElementById("lock-default-input");

let currentTab = null;
let currentFolderId = null;
let editingRuleId = null;
let rules = [];
let folders = [];
let settings = {
  lockByDefault: false
};
const dropTargets = new WeakSet();

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  return tab ?? null;
}

async function loadData() {
  const value = await chrome.storage.local.get([RULES_KEY, FOLDERS_KEY, SETTINGS_KEY]);
  rules = Array.isArray(value[RULES_KEY]) ? value[RULES_KEY] : [];
  folders = Array.isArray(value[FOLDERS_KEY]) ? value[FOLDERS_KEY] : [];
  settings = {
    ...settings,
    ...(value[SETTINGS_KEY] && typeof value[SETTINGS_KEY] === "object" ? value[SETTINGS_KEY] : {})
  };
}

async function saveRules(nextRules) {
  rules = nextRules;
  await chrome.storage.local.set({ [RULES_KEY]: rules });
  renderExplorer();
  notifyActiveTab();
}

async function saveFolders(nextFolders) {
  folders = nextFolders;
  await chrome.storage.local.set({ [FOLDERS_KEY]: folders });
  renderExplorer();
}

async function saveSettings(nextSettings) {
  settings = {
    ...settings,
    ...nextSettings
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

function normalizeFolderId(folderId) {
  return folderId || null;
}

function normalizeUrl(rawUrl) {
  return new URL(rawUrl).href;
}

function getFolder(folderId) {
  return folders.find((folder) => folder.id === folderId) ?? null;
}

function getFolderPath(folderId) {
  const path = [];
  let cursor = getFolder(folderId);

  while (cursor) {
    path.unshift(cursor);
    cursor = getFolder(normalizeFolderId(cursor.parentId));
  }

  return path;
}

function getFolderItemCount(folderId) {
  const normalizedFolderId = normalizeFolderId(folderId);
  const folderCount = folders.filter((folder) => normalizeFolderId(folder.parentId) === normalizedFolderId).length;
  const ruleCount = rules.filter((rule) => normalizeFolderId(rule.folderId) === normalizedFolderId).length;
  return folderCount + ruleCount;
}

function getCurrentItems() {
  const childFolders = folders.filter((folder) => normalizeFolderId(folder.parentId) === currentFolderId);

  const childRules = rules.filter((rule) => normalizeFolderId(rule.folderId) === currentFolderId);
  return { childFolders, childRules };
}

function isFolderInside(folderId, ancestorId) {
  let cursor = getFolder(folderId);

  while (cursor) {
    if (normalizeFolderId(cursor.parentId) === ancestorId) return true;
    cursor = getFolder(normalizeFolderId(cursor.parentId));
  }

  return false;
}

function canMoveFolder(folderId, targetFolderId) {
  const normalizedTargetId = normalizeFolderId(targetFolderId);
  return folderId !== normalizedTargetId && !isFolderInside(normalizedTargetId, folderId);
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
  editingRuleId = rule.id;
  urlInput.value = rule.url;
  titleInput.value = rule.title;
  lockInput.checked = Boolean(rule.locked);
  saveButton.textContent = "Save";
  urlInput.focus();
}

function resetFormMode() {
  editingRuleId = null;
  saveButton.textContent = "Add";
  lockInput.checked = settings.lockByDefault;
}

function fillCurrentUrl() {
  if (currentTab?.url) {
    urlInput.value = currentTab.url;
  }
}

function setCurrentFolder(folderId) {
  currentFolderId = normalizeFolderId(folderId);
  resetFolderForm();
  renderExplorer();
}

function setFolderFormVisible(isVisible) {
  folderForm.hidden = !isVisible;
  if (isVisible) {
    folderNameInput.value = "";
    folderNameInput.focus();
  }
}

function resetFolderForm() {
  folderForm.hidden = true;
  folderNameInput.value = "";
}

function readDragData(event) {
  const rawData = event.dataTransfer.getData("application/json") || event.dataTransfer.getData("text/plain");
  if (!rawData) return null;

  try {
    return JSON.parse(rawData);
  } catch {
    return null;
  }
}

function makeDraggable(element, payload) {
  element.draggable = true;
  element.addEventListener("dragstart", (event) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/json", JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", JSON.stringify(payload));
    element.classList.add("dragging");
  });

  element.addEventListener("dragend", () => {
    element.classList.remove("dragging");
  });
}

function makeDropTarget(element, targetFolderId) {
  element.dataset.targetFolderId = targetFolderId ?? "";
  if (dropTargets.has(element)) return;

  dropTargets.add(element);

  element.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    element.classList.add("drop-target");
  });

  element.addEventListener("dragleave", () => {
    element.classList.remove("drop-target");
  });

  element.addEventListener("drop", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    element.classList.remove("drop-target");

    const payload = readDragData(event);
    if (payload) {
      await moveDraggedItem(payload, normalizeFolderId(element.dataset.targetFolderId));
    }
  });
}

async function moveDraggedItem(payload, targetFolderId) {
  const normalizedTargetId = normalizeFolderId(targetFolderId);

  if (payload.type === "rule") {
    await saveRules(
      rules.map((rule) => (rule.id === payload.id ? { ...rule, folderId: normalizedTargetId } : rule))
    );
    return;
  }

  if (payload.type === "folder" && canMoveFolder(payload.id, normalizedTargetId)) {
    await saveFolders(
      folders.map((folder) => (
        folder.id === payload.id ? { ...folder, parentId: normalizedTargetId } : folder
      ))
    );
  }
}

function createMeta(text) {
  const meta = document.createElement("div");
  meta.className = "item-meta";
  meta.textContent = text;
  return meta;
}

function createFolderElement(folder) {
  const item = document.createElement("article");
  item.className = "item folder-item";

  makeDraggable(item, { type: "folder", id: folder.id });
  makeDropTarget(item, folder.id);

  const main = document.createElement("button");
  main.type = "button";
  main.className = "item-main folder-main";
  main.addEventListener("click", () => setCurrentFolder(folder.id));

  const mark = document.createElement("span");
  mark.className = "folder-mark";
  mark.setAttribute("aria-hidden", "true");

  const copy = document.createElement("span");
  copy.className = "item-copy";

  const title = document.createElement("span");
  title.className = "item-title";
  title.textContent = folder.name;

  copy.append(title, createMeta(`${getFolderItemCount(folder.id)} items`));
  main.append(mark, copy);

  const actions = document.createElement("div");
  actions.className = "item-actions compact-actions";

  const renameButton = document.createElement("button");
  renameButton.type = "button";
  renameButton.textContent = "Rename";
  renameButton.addEventListener("click", () => renameFolder(folder));

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "delete";
  deleteButton.textContent = "Delete";
  deleteButton.addEventListener("click", () => deleteFolder(folder));

  actions.append(renameButton, deleteButton);
  item.append(main, actions);
  return item;
}

function createRuleElement(rule) {
  const item = document.createElement("article");
  item.className = "item rule-item";

  makeDraggable(item, { type: "rule", id: rule.id });

  const main = document.createElement("div");
  main.className = "item-main";

  const copy = document.createElement("div");
  copy.className = "item-copy";

  const titleRow = document.createElement("div");
  titleRow.className = "title-row";

  const title = document.createElement("div");
  title.className = "item-title";
  title.textContent = rule.title;
  titleRow.appendChild(title);

  if (rule.locked) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "locked";
    titleRow.appendChild(badge);
  }

  copy.append(titleRow, createMeta(rule.url));
  main.appendChild(copy);

  const actions = document.createElement("div");
  actions.className = "item-actions";

  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "open";
  openButton.textContent = "Open";
  openButton.addEventListener("click", () => openRule(rule));

  const editButton = document.createElement("button");
  editButton.type = "button";
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

function renderPath() {
  const path = getFolderPath(currentFolderId);
  pathLabel.textContent = path.length ? `Saved tabs / ${path.map((folder) => folder.name).join(" / ")}` : "Saved tabs";
  backButton.disabled = !currentFolderId;
}

function renderExplorer() {
  renderPath();
  rulesList.replaceChildren();
  makeDropTarget(rulesList, currentFolderId);

  const { childFolders, childRules } = getCurrentItems();

  if (!childFolders.length && !childRules.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = currentFolderId ? "This folder is empty" : "No saved tabs yet";
    rulesList.appendChild(empty);
    return;
  }

  for (const rule of childRules) {
    rulesList.appendChild(createRuleElement(rule));
  }

  for (const folder of childFolders) {
    rulesList.appendChild(createFolderElement(folder));
  }
}

function renameFolder(folder) {
  const nextName = prompt("Folder name", folder.name)?.trim();
  if (!nextName) return;

  saveFolders(folders.map((item) => (item.id === folder.id ? { ...item, name: nextName } : item)));
}

function deleteFolder(folder) {
  if (!confirm(`Delete "${folder.name}"? Its contents will move up one level.`)) return;

  const parentId = normalizeFolderId(folder.parentId);
  folders = folders
    .filter((item) => item.id !== folder.id)
    .map((item) => (normalizeFolderId(item.parentId) === folder.id ? { ...item, parentId } : item));

  rules = rules.map((rule) => (normalizeFolderId(rule.folderId) === folder.id ? { ...rule, folderId: parentId } : rule));

  chrome.storage.local.set({ [FOLDERS_KEY]: folders, [RULES_KEY]: rules }).then(() => {
    if (currentFolderId === folder.id) {
      currentFolderId = parentId;
    }
    renderExplorer();
    notifyActiveTab();
  });
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

  const existingRule = rules.find((rule) => rule.id === editingRuleId) ?? rules.find((rule) => rule.url === url);
  const nextRule = {
    id: existingRule?.id ?? crypto.randomUUID(),
    url,
    title,
    locked: lockInput.checked,
    folderId: normalizeFolderId(existingRule?.folderId ?? currentFolderId)
  };

  const nextRules = existingRule
    ? rules.map((rule) => (rule.id === existingRule.id ? nextRule : rule))
    : [nextRule, ...rules];

  await saveRules(nextRules);
  resetFormMode();
});

folderForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = folderNameInput.value.trim();
  if (!name) return;

  await saveFolders([
    {
      id: crypto.randomUUID(),
      name,
      parentId: currentFolderId
    },
    ...folders
  ]);

  resetFolderForm();
});

useCurrentButton.addEventListener("click", fillCurrentUrl);
addFolderButton.addEventListener("click", () => setFolderFormVisible(true));
cancelFolderButton.addEventListener("click", resetFolderForm);
lockDefaultInput.addEventListener("change", async () => {
  await saveSettings({ lockByDefault: lockDefaultInput.checked });

  if (!editingRuleId) {
    lockInput.checked = settings.lockByDefault;
  }
});
backButton.addEventListener("click", () => {
  const currentFolder = getFolder(currentFolderId);
  setCurrentFolder(normalizeFolderId(currentFolder?.parentId));
});

document.addEventListener("DOMContentLoaded", async () => {
  currentTab = await getActiveTab();
  fillCurrentUrl();
  await loadData();
  lockDefaultInput.checked = settings.lockByDefault;
  lockInput.checked = settings.lockByDefault;

  const currentRule = rules.find((rule) => currentTab?.url && rule.url === currentTab.url);
  if (currentRule) {
    currentFolderId = normalizeFolderId(currentRule.folderId);
    fillFromRule(currentRule);
  }

  renderExplorer();
});
