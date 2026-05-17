const state = {
  mode: "login",
  user: null,
  links: [],
  search: "",
  settings: null,
  oauthProviders: [],
  siteTitle: "NaviHub",
  registrationOpen: true,
  uploadEnabled: false,
  previewCustomBackgroundUrl: "",
  importedBookmarks: [],
  bookmarkTree: [],
};

const authPanel = document.getElementById("auth-panel");
const dashboard = document.getElementById("dashboard");
const authForm = document.getElementById("auth-form");
const authMessage = document.getElementById("auth-message");
const authPasswordInput = document.getElementById("password");
const authPasswordRule = document.getElementById("auth-password-rule");
const dashboardMessage = document.getElementById("dashboard-message");
const settingsMessage = document.getElementById("settings-message");
const authSubmit = document.getElementById("auth-submit");
const welcomeTitle = document.getElementById("welcome-title");
const linkForm = document.getElementById("link-form");
const linkCancel = document.getElementById("link-cancel");
const linkList = document.getElementById("link-list");
const searchInput = document.getElementById("search");
const settingsForm = document.getElementById("settings-form");
const passwordForm = document.getElementById("password-form");
const passwordMessage = document.getElementById("password-message");
const newPasswordInput = document.getElementById("new-password");
const newPasswordRule = document.getElementById("new-password-rule");
const registrationPill = document.getElementById("registration-pill");
const registerTab = document.getElementById("register-tab");
const siteAdminLink = document.getElementById("site-admin-link");
const oauthLoginList = document.getElementById("oauth-login-list");
const oauthLinkList = document.getElementById("oauth-link-list");
const oauthLinkMessage = document.getElementById("oauth-link-message");
const bookmarkFile = document.getElementById("bookmark-file");
const bookmarkPreview = document.getElementById("bookmark-preview");
const bookmarkImportMessage = document.getElementById("bookmark-import-message");
const bookmarkSelectAll = document.getElementById("bookmark-select-all");
const bookmarkClearAll = document.getElementById("bookmark-clear-all");
const bookmarkImportSelected = document.getElementById("bookmark-import-selected");
const bookmarkActions = document.getElementById("bookmark-actions");
const previewFields = ["theme", "accent", "layout", "background"];
const backgroundChoices = {
  day: [
    { value: "sunrise", label: "Sunrise" },
    { value: "paper", label: "Paper" },
    { value: "aurora", label: "Aurora" },
    { value: "custom", label: "Custom image" },
  ],
  night: [
    { value: "midnight", label: "Midnight" },
    { value: "custom", label: "Custom image" },
  ],
};

document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});

document.querySelectorAll("[data-link-tab]").forEach((button) => {
  button.addEventListener("click", () => setLinkTab(button.dataset.linkTab));
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.getElementById("email").value.trim();
  const password = authPasswordInput.value;
  if (state.mode === "register" && !updatePasswordRule(authPasswordRule, password, { showWhenEmpty: true })) {
    authMessage.textContent = "Password does not meet the requirements.";
    return;
  }
  const endpoint = state.mode === "login" ? "/api/login" : "/api/register";
  const result = await api(endpoint, "POST", { email, password });

  if (!result.ok) {
    authMessage.textContent = result.error;
    return;
  }

  authForm.reset();
  authMessage.textContent = state.mode === "login" ? "Logged in." : "Account created.";
  await refreshSession();
});

document.getElementById("logout-button").addEventListener("click", async () => {
  await api("/api/logout", "POST");
  clearSessionState();
});

linkForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const uploadedIcon = await uploadOptionalFile("icon", "link-icon-file", "link-icon-message");
  if (uploadedIcon && !uploadedIcon.ok) {
    return;
  }
  if (uploadedIcon && uploadedIcon.url) {
    document.getElementById("link-icon-url").value = uploadedIcon.url;
    document.getElementById("link-icon-mode").value = "custom";
  }
  const id = document.getElementById("link-id").value;
  const payload = {
    title: document.getElementById("link-title").value.trim(),
    url: document.getElementById("link-url").value.trim(),
    description: document.getElementById("link-description").value.trim(),
    icon_url: document.getElementById("link-icon-url").value.trim(),
    icon_mode: document.getElementById("link-icon-mode").value || "favicon",
  };

  const endpoint = id ? `/api/links/${id}` : "/api/links";
  const method = id ? "PUT" : "POST";
  const result = await api(endpoint, method, payload);
  if (!result.ok) {
    dashboardMessage.textContent = result.error;
    return;
  }

  resetLinkForm();
  dashboardMessage.textContent = id ? "Link updated." : "Link added.";
  await loadLinks();
});

linkCancel.addEventListener("click", () => {
  resetLinkForm();
  dashboardMessage.textContent = "";
  renderLinks();
});

bookmarkFile.addEventListener("change", async () => {
  const file = bookmarkFile.files[0];
  if (!file) {
    state.importedBookmarks = [];
    state.bookmarkTree = [];
    renderBookmarkPreview();
    bookmarkImportMessage.textContent = "";
    return;
  }
  try {
    const text = await file.text();
    const parsed = file.name.toLowerCase().endsWith(".json")
      ? parseFirefoxJsonBookmarks(text)
      : parseBookmarkHtml(text);
    state.importedBookmarks = markBookmarkDuplicates(parsed.bookmarks);
    state.bookmarkTree = parsed.tree;
    renderBookmarkPreview();
    updateBookmarkImportMessage();
  } catch (error) {
    state.importedBookmarks = [];
    state.bookmarkTree = [];
    renderBookmarkPreview();
    bookmarkImportMessage.textContent = "Could not read that bookmark file.";
  }
});

bookmarkSelectAll.addEventListener("click", () => {
  state.importedBookmarks = state.importedBookmarks.map((bookmark) => ({
    ...bookmark,
    selected: true,
  }));
  renderBookmarkPreview();
  updateBookmarkImportMessage();
});

bookmarkClearAll.addEventListener("click", () => {
  state.importedBookmarks = state.importedBookmarks.map((bookmark) => ({ ...bookmark, selected: false }));
  renderBookmarkPreview();
  updateBookmarkImportMessage();
});

bookmarkImportSelected.addEventListener("click", async () => {
  const selectedBookmarks = state.importedBookmarks.filter((bookmark) => bookmark.selected);
  const importable = selectedBookmarks.filter((bookmark) => !bookmark.duplicate);
  if (!importable.length) {
    bookmarkImportMessage.textContent = "Choose at least one bookmark to import.";
    return;
  }
  if (selectedBookmarks.length > 1000) {
    bookmarkImportMessage.textContent = `${selectedBookmarks.length} bookmarks selected. Select 1000 or fewer to import at once.`;
    return;
  }
  const result = await api("/api/links/import", "POST", {
    links: importable.map((bookmark) => ({ title: bookmark.title, url: bookmark.url })),
  });
  if (!result.ok) {
    bookmarkImportMessage.textContent = result.error;
    return;
  }
  bookmarkImportMessage.textContent = `${result.imported_count} imported. ${result.skipped_duplicate_count} duplicate${result.skipped_duplicate_count === 1 ? "" : "s"} skipped. ${result.skipped_invalid_count} invalid skipped.`;
  state.importedBookmarks = [];
  state.bookmarkTree = [];
  bookmarkFile.value = "";
  renderBookmarkPreview();
  await loadLinks();
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  let customBackgroundUrl = state.settings?.custom_background_url || "";
  if (document.getElementById("background").value === "custom") {
    const uploadedBackground = await uploadOptionalFile("background", "background-file", "background-upload-message");
    if (uploadedBackground && !uploadedBackground.ok) {
      return;
    }
    if (uploadedBackground && uploadedBackground.url) {
      customBackgroundUrl = uploadedBackground.url;
      state.previewCustomBackgroundUrl = uploadedBackground.url;
    }
  }
  const payload = {
    theme: document.getElementById("theme").value,
    accent: document.getElementById("accent").value,
    layout: document.getElementById("layout").value,
    background: document.getElementById("background").value,
    custom_background_url: customBackgroundUrl,
    tab_title: document.getElementById("tab-title").value.trim(),
    admin_heading: document.getElementById("settings-admin-heading").value.trim(),
    admin_copy: document.getElementById("settings-admin-copy").value.trim(),
    nav_heading: document.getElementById("settings-nav-heading").value.trim(),
    nav_copy: document.getElementById("settings-nav-copy").value.trim(),
  };
  const result = await api("/api/user-settings", "PUT", payload);
  if (!result.ok) {
    settingsMessage.textContent = result.error;
    return;
  }
  state.settings = result.settings;
  applySettings(state.settings);
  fillSettingsForm(state.settings);
  settingsMessage.textContent = "Settings saved.";
  document.getElementById("background-file").value = "";
});

passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  passwordMessage.textContent = "";
  const currentPassword = document.getElementById("current-password").value;
  const newPassword = newPasswordInput.value;
  const confirmPassword = document.getElementById("confirm-password").value;

  if (!updatePasswordRule(newPasswordRule, newPassword, { showWhenEmpty: true })) {
    passwordMessage.textContent = "New password does not meet the requirements.";
    return;
  }
  if (newPassword !== confirmPassword) {
    passwordMessage.textContent = "New passwords do not match.";
    return;
  }

  const result = await api("/api/account/password", "PUT", {
    current_password: currentPassword,
    new_password: newPassword,
    confirm_password: confirmPassword,
  });
  if (!result.ok) {
    passwordMessage.textContent = result.error;
    return;
  }

  passwordForm.reset();
  clearSessionState();
  setMode("login");
  authMessage.textContent = "Password changed. Please log in with your new password.";
});

searchInput.addEventListener("input", () => {
  state.search = searchInput.value.trim().toLowerCase();
  renderLinks();
});

authPasswordInput.addEventListener("input", () => {
  updateAuthPasswordRule();
});

newPasswordInput.addEventListener("input", () => {
  updatePasswordRule(newPasswordRule, newPasswordInput.value);
});

async function refreshSession() {
  const me = await api("/api/me", "GET");
  state.user = me.user || null;
  if (!state.user) {
    render();
    return;
  }
  await loadUserSettings();
  await loadLinks();
  await loadOAuthProviders();
}

async function loadLinks() {
  const result = await api("/api/links", "GET");
  state.links = result.links || [];
  render();
}

async function loadUserSettings() {
  const result = await api("/api/user-settings", "GET");
  if (!result.ok) {
    return;
  }
  state.settings = result.settings;
  state.siteTitle = result.site_title;
  state.uploadEnabled = result.upload_enabled;
  applySettings(state.settings);
  fillSettingsForm(state.settings);
  bindPreviewListeners();
}

async function loadSiteConfig() {
  const result = await api("/api/public-config", "GET");
  state.registrationOpen = result.ok ? result.registration_open : true;
  state.siteTitle = result.ok ? result.site_title : "NaviHub";
  updateRegistrationState();
}

async function loadOAuthProviders() {
  const result = await api("/api/oauth/providers", "GET");
  state.oauthProviders = result.ok ? result.providers || [] : [];
  renderOAuthProviders();
}

function setMode(mode) {
  if (mode === "register" && !state.registrationOpen) {
    authMessage.textContent = "Registration is closed right now.";
    return;
  }
  state.mode = mode;
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  authSubmit.textContent = mode === "login" ? "Login" : "Create account";
  authMessage.textContent = "";
  updateAuthPasswordRule();
}

function setLinkTab(tabName) {
  document.querySelectorAll("[data-link-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.linkTab === tabName);
  });
  document.querySelectorAll("[data-link-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.linkPanel === tabName);
  });
}

function updateRegistrationState() {
  registerTab.classList.toggle("hidden", !state.registrationOpen);
  registrationPill.classList.toggle("hidden", state.registrationOpen);
  if (!state.registrationOpen) {
    registrationPill.classList.add("closed");
    if (state.mode === "register") {
      setMode("login");
    }
  }
}

function render() {
  const signedIn = Boolean(state.user);
  authPanel.classList.toggle("hidden", signedIn);
  dashboard.classList.toggle("hidden", !signedIn);

  if (signedIn) {
    welcomeTitle.textContent = `Welcome, ${state.user.email}`;
    siteAdminLink.classList.toggle("hidden", !state.user.is_admin);
    renderOAuthProviders();
    renderLinks();
  } else {
    siteAdminLink.classList.add("hidden");
    dashboardMessage.textContent = "";
    settingsMessage.textContent = "";
    passwordMessage.textContent = "";
    oauthLinkMessage.textContent = "Link a provider so you can sign in without a password next time.";
    linkList.innerHTML = "";
    renderOAuthProviders();
  }
}

function clearSessionState() {
  state.user = null;
  state.links = [];
  state.importedBookmarks = [];
  state.bookmarkTree = [];
  state.search = "";
  searchInput.value = "";
  renderBookmarkPreview();
  render();
}

function updateAuthPasswordRule() {
  if (state.mode !== "register") {
    authPasswordRule.classList.add("hidden");
    authPasswordRule.textContent = "";
    return true;
  }
  authPasswordRule.classList.remove("hidden");
  return updatePasswordRule(authPasswordRule, authPasswordInput.value);
}

function updatePasswordRule(element, password, options = {}) {
  const showWhenEmpty = options.showWhenEmpty === true;
  if (!password && !showWhenEmpty) {
    element.textContent = "";
    element.classList.remove("valid", "invalid");
    return false;
  }
  const result = passwordStrength(password);
  element.textContent = `${result.valid ? "✓" : "X"} ${result.message}`;
  element.classList.toggle("valid", result.valid);
  element.classList.toggle("invalid", !result.valid);
  return result.valid;
}

function passwordStrength(password) {
  const ruleText = "Use at least 8 English letters, numbers, or special characters, with at least 3 types.";
  if (password.length < 8) {
    return { valid: false, message: ruleText };
  }
  if (!/^[!-~]+$/.test(password)) {
    return { valid: false, message: "Only English letters, numbers, and special characters are allowed." };
  }
  const categories = [
    /[0-9]/.test(password),
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;
  if (categories < 3) {
    return {
      valid: false,
      message: "Include at least 3 of these: numbers, lowercase letters, uppercase letters, special characters.",
    };
  }
  return { valid: true, message: "Password meets the requirements." };
}

function renderOAuthProviders() {
  if (!state.oauthProviders.length) {
    oauthLoginList.innerHTML = `<p class="meta">No third-party login providers are configured yet.</p>`;
    oauthLinkList.innerHTML = `<p class="meta">No third-party login providers are configured yet.</p>`;
    return;
  }

  oauthLoginList.innerHTML = state.oauthProviders
    .map(
      (provider) => `<a class="secondary-link" href="${escapeAttribute(provider.login_url)}">Continue with ${escapeHtml(provider.label)}</a>`
    )
    .join("");

  oauthLinkList.innerHTML = state.oauthProviders
    .map((provider) => {
      if (provider.linked) {
        const details = provider.linked_identity?.email || provider.linked_identity?.display_name || provider.label;
        return `<span class="pill admin">${escapeHtml(provider.label)} linked${details ? `: ${escapeHtml(details)}` : ""}</span>`;
      }
      return `<a class="secondary-link" href="${escapeAttribute(provider.link_url)}">Link ${escapeHtml(provider.label)}</a>`;
    })
    .join("");
}

function renderLinks() {
  const query = state.search;
  const filtered = state.links.filter((link) => {
    if (!query) {
      return true;
    }
    const haystack = `${link.title} ${link.url} ${link.description}`.toLowerCase();
    return haystack.includes(query);
  });

  if (!filtered.length) {
    linkList.innerHTML = `<div class="empty-state">No links match your search yet.</div>`;
    return;
  }

  linkList.innerHTML = filtered
    .map(
      (link) => `
        <article class="link-card ${document.getElementById("link-id").value === String(link.id) ? "editing" : ""}">
          <div class="card-title-row">
            <div class="tile-icon-wrap small">
              <img class="tile-icon-image" src="${escapeAttribute(link.icon_url || "")}" alt="" data-fallback="${escapeAttribute(initials(link.title))}" />
              <span class="tile-icon-fallback">${escapeHtml(initials(link.title))}</span>
            </div>
            <div>
              <h3>${escapeHtml(link.title)}</h3>
              <p>${escapeHtml(link.description || "No description yet.")}</p>
            </div>
          </div>
          <a class="link-card-url" href="${escapeAttribute(link.url)}" target="_blank" rel="noreferrer">${escapeHtml(link.url)}</a>
          <div class="card-actions link-card-actions">
            <button class="secondary-button" type="button" data-action="edit" data-id="${link.id}">Edit</button>
            <button class="secondary-button" type="button" data-action="reset-icon" data-id="${link.id}">Reset icon</button>
            <button class="ghost-button" type="button" data-action="delete" data-id="${link.id}">Delete</button>
          </div>
        </article>
      `
    )
    .join("");

  bindIconFallbacks(linkList);

  linkList.querySelectorAll("button[data-action='edit']").forEach((button) => {
    button.addEventListener("click", () => startEdit(Number(button.dataset.id)));
  });

  linkList.querySelectorAll("button[data-action='delete']").forEach((button) => {
    button.addEventListener("click", async () => {
      const result = await api(`/api/links/${button.dataset.id}`, "DELETE");
      if (!result.ok) {
        dashboardMessage.textContent = result.error;
        return;
      }
      dashboardMessage.textContent = "Link deleted.";
      await loadLinks();
    });
  });

  linkList.querySelectorAll("button[data-action='reset-icon']").forEach((button) => {
    button.addEventListener("click", async () => {
      const link = state.links.find((item) => item.id === Number(button.dataset.id));
      if (!link) {
        return;
      }
      const result = await api(`/api/links/${button.dataset.id}`, "PUT", {
        title: link.title,
        url: link.url,
        description: link.description,
        icon_mode: "favicon",
        icon_url: "",
      });
      if (!result.ok) {
        dashboardMessage.textContent = result.error;
        return;
      }
      if (document.getElementById("link-id").value === String(link.id)) {
        document.getElementById("link-icon-url").value = "";
        document.getElementById("link-icon-mode").value = "favicon";
        document.getElementById("link-icon-file").value = "";
      }
      dashboardMessage.textContent = "Link icon reset to favicon.";
      await loadLinks();
    });
  });
}

function startEdit(id) {
  const link = state.links.find((item) => item.id === id);
  if (!link) {
    return;
  }
  setLinkTab("add");
  document.getElementById("link-id").value = link.id;
  document.getElementById("link-title").value = link.title;
  document.getElementById("link-url").value = link.url;
  document.getElementById("link-description").value = link.description;
  document.getElementById("link-icon-url").value = link.icon_url || "";
  document.getElementById("link-icon-mode").value = link.icon_mode || "favicon";
  document.getElementById("link-icon-file").value = "";
  document.getElementById("link-submit").textContent = "Save changes";
  linkCancel.classList.remove("hidden");
  linkForm.classList.add("editing");
  document.getElementById("link-icon-message").textContent =
    link.icon_mode === "custom"
      ? "This link is using a custom icon. Upload a new one to replace it, or leave the field empty to keep it."
      : "This link is using the site favicon. Upload an image only if you want to override it.";
  dashboardMessage.textContent = "Editing link.";
  renderLinks();
  linkForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetLinkForm() {
  linkForm.reset();
  document.getElementById("link-id").value = "";
  document.getElementById("link-icon-url").value = "";
  document.getElementById("link-icon-mode").value = "favicon";
  document.getElementById("link-submit").textContent = "Add link";
  linkCancel.classList.add("hidden");
  linkForm.classList.remove("editing");
  document.getElementById("link-icon-message").textContent = "If you do not upload an image, the site favicon will be used automatically.";
}

function parseBookmarkHtml(text) {
  const document = new DOMParser().parseFromString(text, "text/html");
  const root = document.querySelector("dl");
  if (!root) {
    return { bookmarks: [], tree: [] };
  }
  const bookmarks = [];
  const tree = [];
  let nextFolderId = 0;

  function parseFolder(dl, path, target) {
    const children = Array.from(dl.children);
    for (let index = 0; index < children.length; index += 1) {
      const item = children[index];
      const tag = item.tagName?.toLowerCase();
      if (tag === "dt") {
        const itemChildren = Array.from(item.children);
        const link = itemChildren.find((child) => child.tagName?.toLowerCase() === "a");
        if (link) {
          const bookmark = addParsedBookmark(bookmarks, link.textContent, link.getAttribute("href"), path);
          if (bookmark) {
            target.push({ type: "bookmark", bookmarkId: bookmark.id });
          }
          continue;
        }

        const folder = itemChildren.find((child) => child.tagName?.toLowerCase() === "h3");
        const nested = itemChildren.find((child) => child.tagName?.toLowerCase() === "dl")
          || (item.nextElementSibling?.tagName?.toLowerCase() === "dl" ? item.nextElementSibling : null);
        if (folder && nested) {
          const node = { type: "folder", id: nextFolderId, title: cleanText(folder.textContent) || "Untitled folder", children: [] };
          nextFolderId += 1;
          target.push(node);
          parseFolder(nested, [...path, node.title], node.children);
          if (nested === children[index + 1]) {
            index += 1;
          }
        }
        continue;
      }
      if (tag === "dl" || item.children.length) {
        parseFolder(item, path, target);
      }
    }
  }

  parseFolder(root, [], tree);
  return { bookmarks, tree };
}

function parseFirefoxJsonBookmarks(text) {
  const data = JSON.parse(text);
  const bookmarks = [];
  const tree = [];
  let nextFolderId = 0;

  function walk(node, path, target) {
    if (!node || typeof node !== "object") {
      return;
    }
    const url = node.uri || node.url;
    if (url) {
      const bookmark = addParsedBookmark(bookmarks, node.title, url, path);
      if (bookmark) {
        target.push({ type: "bookmark", bookmarkId: bookmark.id });
      }
      return;
    }
    const title = cleanText(node.title);
    const children = node.children || [];
    if (title) {
      const folder = { type: "folder", id: nextFolderId, title, children: [] };
      nextFolderId += 1;
      target.push(folder);
      children.forEach((child) => walk(child, [...path, title], folder.children));
      return;
    }
    children.forEach((child) => walk(child, path, target));
  }

  walk(data, [], tree);
  return { bookmarks, tree };
}

function addParsedBookmark(bookmarks, rawTitle, rawUrl, path) {
  const url = String(rawUrl || "").trim();
  const parsed = parseHttpUrl(url);
  if (!parsed) {
    return;
  }
  const bookmark = {
    id: bookmarks.length,
    title: cleanText(rawTitle) || parsed.hostname || url,
    url,
    folder: path.filter(Boolean).join(" / "),
    selected: true,
    duplicate: false,
  };
  bookmarks.push(bookmark);
  return bookmark;
}

function markBookmarkDuplicates(bookmarks) {
  const existing = new Set(state.links.map((link) => link.url));
  const seen = new Set();
  return bookmarks.map((bookmark) => {
    const duplicate = existing.has(bookmark.url) || seen.has(bookmark.url);
    seen.add(bookmark.url);
    return { ...bookmark, duplicate, selected: false };
  });
}

function renderBookmarkPreview() {
  if (!state.importedBookmarks.length) {
    bookmarkPreview.innerHTML = bookmarkFile.files[0]
      ? `<div class="empty-state">No importable bookmarks were found in this file.</div>`
      : "";
    bookmarkActions.classList.add("hidden");
    return;
  }

  bookmarkActions.classList.remove("hidden");
  bookmarkPreview.innerHTML = renderBookmarkTree(state.bookmarkTree, 1);

  bookmarkPreview.querySelectorAll("input[data-bookmark-index]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const index = Number(checkbox.dataset.bookmarkIndex);
      state.importedBookmarks[index].selected = checkbox.checked;
      updateFolderCheckboxes();
      updateBookmarkImportMessage();
    });
  });
  bookmarkPreview.querySelectorAll("input[data-bookmark-folder]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const folder = findBookmarkFolder(Number(checkbox.dataset.bookmarkFolder), state.bookmarkTree);
      if (!folder) {
        return;
      }
      const ids = collectFolderBookmarkIds(folder);
      ids.forEach((id) => {
        const bookmark = state.importedBookmarks[id];
        if (!bookmark) {
          return;
        }
        bookmark.selected = checkbox.checked;
        const bookmarkCheckbox = bookmarkPreview.querySelector(`input[data-bookmark-index="${id}"]`);
        if (bookmarkCheckbox) {
          bookmarkCheckbox.checked = checkbox.checked;
        }
      });
      updateFolderCheckboxes();
      updateBookmarkImportMessage();
    });
  });
  bookmarkPreview.querySelectorAll("button[data-action='toggle-bookmark-folder']").forEach((button) => {
      button.addEventListener("click", () => {
        const folder = button.closest(".bookmark-folder");
        const collapsed = folder.classList.toggle("collapsed");
        button.setAttribute("aria-expanded", String(!collapsed));
      });
  });
  updateFolderCheckboxes();
}

function updateBookmarkImportMessage() {
  if (!state.importedBookmarks.length) {
    bookmarkImportMessage.textContent = "";
    return;
  }
  const selected = state.importedBookmarks.filter((bookmark) => bookmark.selected);
  const selectedDuplicates = selected.filter((bookmark) => bookmark.duplicate).length;
  bookmarkImportMessage.textContent =
    `${state.importedBookmarks.length} bookmark${state.importedBookmarks.length === 1 ? "" : "s"} total. ` +
    `${selected.length} selected.` +
    (selectedDuplicates ? ` ${selectedDuplicates} already exist and will be skipped.` : "");
}

function renderBookmarkTree(nodes, level) {
  return nodes
    .map((node) => {
      if (node.type === "folder") {
        const selection = folderSelectionState(node);
        return `
          <section class="bookmark-folder collapsed" data-folder-id="${node.id}" style="--bookmark-level: ${level}">
            <div class="bookmark-folder-heading">
              <input type="checkbox" data-bookmark-folder="${node.id}" ${selection.checked ? "checked" : ""} ${selection.disabled ? "disabled" : ""} />
              <button class="bookmark-folder-title" type="button" data-action="toggle-bookmark-folder" aria-expanded="false">
              <span class="folder-caret" aria-hidden="true"></span>
              ${escapeHtml(node.title)}
              </button>
            </div>
            <div class="bookmark-folder-children">${renderBookmarkTree(node.children, level + 1)}</div>
          </section>
        `;
      }
      const bookmark = state.importedBookmarks[node.bookmarkId];
      if (!bookmark) {
        return "";
      }
      return `
        <label class="bookmark-row ${bookmark.duplicate ? "duplicate" : ""}" style="--bookmark-level: ${level}">
          <input type="checkbox" data-bookmark-index="${bookmark.id}" ${bookmark.selected ? "checked" : ""} ${bookmark.duplicate ? "disabled" : ""} />
          <span>
            <strong>${escapeHtml(bookmark.title)}</strong>
            <a href="${escapeAttribute(bookmark.url)}" target="_blank" rel="noreferrer">${escapeHtml(bookmark.url)}</a>
          </span>
          ${bookmark.duplicate ? `<em>Already saved</em>` : ""}
        </label>
      `;
    })
    .join("");
}

function findBookmarkFolder(id, nodes) {
  for (const node of nodes) {
    if (node.type !== "folder") {
      continue;
    }
    if (node.id === id) {
      return node;
    }
    const found = findBookmarkFolder(id, node.children);
    if (found) {
      return found;
    }
  }
  return null;
}

function collectFolderBookmarkIds(folder) {
  const ids = [];
  folder.children.forEach((node) => {
    if (node.type === "bookmark") {
      ids.push(node.bookmarkId);
      return;
    }
    ids.push(...collectFolderBookmarkIds(node));
  });
  return ids;
}

function folderSelectionState(folder) {
  const selectable = collectFolderBookmarkIds(folder)
    .map((id) => state.importedBookmarks[id])
    .filter(Boolean);
  if (!selectable.length) {
    return { checked: false, indeterminate: false, disabled: true };
  }
  const selectedCount = selectable.filter((bookmark) => bookmark.selected).length;
  return {
    checked: selectedCount === selectable.length,
    indeterminate: selectedCount > 0 && selectedCount < selectable.length,
    disabled: false,
  };
}

function updateFolderCheckboxes() {
  bookmarkPreview.querySelectorAll("input[data-bookmark-folder]").forEach((checkbox) => {
    const folder = findBookmarkFolder(Number(checkbox.dataset.bookmarkFolder), state.bookmarkTree);
    if (!folder) {
      return;
    }
    const selection = folderSelectionState(folder);
    checkbox.checked = selection.checked;
    checkbox.indeterminate = selection.indeterminate;
    checkbox.disabled = selection.disabled;
  });
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseHttpUrl(url) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) {
      return null;
    }
    return parsed;
  } catch (error) {
    return null;
  }
}

function fillSettingsForm(settings) {
  document.getElementById("theme").value = settings.theme;
  document.getElementById("accent").value = settings.accent;
  document.getElementById("layout").value = settings.layout;
  syncBackgroundOptions("theme", "background", settings.background);
  document.getElementById("tab-title").value = settings.tab_title;
  document.getElementById("settings-admin-heading").value = settings.admin_heading;
  document.getElementById("settings-admin-copy").value = settings.admin_copy;
  document.getElementById("settings-nav-heading").value = settings.nav_heading;
  document.getElementById("settings-nav-copy").value = settings.nav_copy;
  document.getElementById("background-upload-message").textContent = state.uploadEnabled
    ? (settings.custom_background_url ? "A custom background image is already saved. Pick a new one to replace it." : "Pick an image to preview it instantly, then save settings to upload it.")
    : "S3 uploads are not configured yet, so custom background uploads are unavailable.";
}

function bindPreviewListeners() {
  previewFields.forEach((id) => {
    const element = document.getElementById(id);
    if (element.dataset.previewBound === "true") {
      return;
    }
    if (id === "theme") {
      element.addEventListener("change", () => {
        syncBackgroundOptions("theme", "background");
        previewAppearance();
      });
    }
    element.addEventListener("input", previewAppearance);
    element.addEventListener("change", previewAppearance);
    element.dataset.previewBound = "true";
  });
  const backgroundFile = document.getElementById("background-file");
  if (backgroundFile.dataset.previewBound === "true") {
    return;
  }
  backgroundFile.addEventListener("change", previewBackgroundFile);
  backgroundFile.dataset.previewBound = "true";
}

function previewAppearance() {
  syncBackgroundOptions("theme", "background");
  const previewSettings = {
    ...state.settings,
    theme: document.getElementById("theme").value,
    accent: document.getElementById("accent").value,
    layout: document.getElementById("layout").value,
    background: document.getElementById("background").value,
    custom_background_url: state.previewCustomBackgroundUrl || state.settings?.custom_background_url || "",
  };
  applySettings(previewSettings, { preserveText: true, preserveTitle: true });
  settingsMessage.textContent = "Previewing appearance changes. Click Save settings to keep them.";
}

function previewBackgroundFile() {
  const file = document.getElementById("background-file").files[0];
  if (!file) {
    state.previewCustomBackgroundUrl = "";
    previewAppearance();
    return;
  }
  if (!file.type.startsWith("image/")) {
    document.getElementById("background-upload-message").textContent = "Choose an image file for the custom background.";
    return;
  }
  state.previewCustomBackgroundUrl = URL.createObjectURL(file);
  document.getElementById("background").value = "custom";
  previewAppearance();
  document.getElementById("background-upload-message").textContent = "Previewing your custom background locally. Save settings to upload it.";
}

function syncBackgroundOptions(themeSelectId, backgroundSelectId, preferredValue) {
  const theme = document.getElementById(themeSelectId).value;
  const select = document.getElementById(backgroundSelectId);
  const choices = backgroundChoices[theme] || [];
  const currentValue = preferredValue || select.value;

  select.innerHTML = choices
    .map((choice) => `<option value="${choice.value}">${choice.label}</option>`)
    .join("");

  const allowed = choices.some((choice) => choice.value === currentValue);
  select.value = allowed ? currentValue : choices[0]?.value || "";
}

function applySettings(settings, options = {}) {
  const preserveText = options.preserveText === true;
  const preserveTitle = options.preserveTitle === true;
  document.body.dataset.theme = settings.theme;
  document.body.dataset.accent = settings.accent;
  document.body.dataset.layout = settings.layout;
  document.body.dataset.background = settings.background;
  const customBackgroundUrl = settings.custom_background_url || "";
  document.body.style.setProperty(
    "--custom-bg-image",
    settings.background === "custom" && customBackgroundUrl ? `url("${customBackgroundUrl.replace(/"/g, '\\"')}")` : "none"
  );
  if (!preserveTitle) {
    document.title = settings.tab_title;
  }
  if (!preserveText) {
    document.getElementById("admin-heading").textContent = settings.admin_heading;
    document.getElementById("admin-copy").textContent = settings.admin_copy;
  }
}

async function uploadOptionalFile(kind, inputId, messageId) {
  const input = document.getElementById(inputId);
  const file = input.files[0];
  if (!file) {
    return null;
  }
  if (!state.uploadEnabled) {
    document.getElementById(messageId).textContent = "S3 uploads are not configured yet.";
    return { ok: false };
  }
  const form = new FormData();
  form.append("kind", kind);
  form.append("file", file);
  const result = await api("/api/uploads", "POST", form, true);
  if (!result.ok) {
    document.getElementById(messageId).textContent = result.error;
    return { ok: false };
  }
  document.getElementById(messageId).textContent = kind === "icon" ? "Icon uploaded. It will be saved with this link." : "Background uploaded. Save settings to keep it.";
  return { ok: true, url: result.upload.url };
}

function bindIconFallbacks(root) {
  root.querySelectorAll(".tile-icon-image").forEach((img) => {
    const fallback = img.nextElementSibling;
    if (img.dataset.bound === "true") {
      return;
    }
    const showFallback = () => {
      img.classList.add("hidden");
      fallback.classList.add("visible");
    };
    img.addEventListener("error", showFallback);
    img.addEventListener("load", () => {
      img.classList.remove("hidden");
      fallback.classList.remove("visible");
    });
    if (!img.getAttribute("src")) {
      showFallback();
    }
    img.dataset.bound = "true";
  });
}

function consumeOAuthStatus() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get("oauth_status");
  const error = params.get("oauth_error");
  const provider = params.get("provider");
  if (!status && !error) {
    return;
  }

  if (error) {
    const readable = String(error).replaceAll("_", " ");
    if (state.user) {
      oauthLinkMessage.textContent = `OAuth error: ${readable}.`;
    } else {
      authMessage.textContent = `OAuth error: ${readable}.`;
    }
  } else if (status === "linked") {
    oauthLinkMessage.textContent = `${provider || "Provider"} linked successfully.`;
  } else if (status === "logged_in") {
    dashboardMessage.textContent = `${provider || "Provider"} login successful.`;
  }

  window.history.replaceState({}, document.title, window.location.pathname);
}

function initials(value) {
  return String(value || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "?";
}

async function api(url, method, body, isForm = false) {
  try {
    const response = await fetch(url, {
      method,
      headers: body ? (isForm ? {} : { "Content-Type": "application/json" }) : {},
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
      credentials: "same-origin",
    });
    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json") ? await response.json() : {};
    return { ok: response.ok, status: response.status, ...data };
  } catch (error) {
    return { ok: false, error: "The request failed. Please try again." };
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

async function init() {
  setMode("login");
  setLinkTab("add");
  renderBookmarkPreview();
  await loadSiteConfig();
  await refreshSession();
  if (!state.user) {
    await loadOAuthProviders();
  }
  consumeOAuthStatus();
}

init();
