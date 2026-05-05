const state = {
  mode: "login",
  user: null,
  links: [],
  search: "",
  settings: null,
  oauthProviders: [],
  siteTitle: "HomeHub",
  registrationOpen: true,
  uploadEnabled: false,
  previewCustomBackgroundUrl: "",
};

const authPanel = document.getElementById("auth-panel");
const dashboard = document.getElementById("dashboard");
const authForm = document.getElementById("auth-form");
const authMessage = document.getElementById("auth-message");
const dashboardMessage = document.getElementById("dashboard-message");
const settingsMessage = document.getElementById("settings-message");
const authSubmit = document.getElementById("auth-submit");
const welcomeTitle = document.getElementById("welcome-title");
const linkForm = document.getElementById("link-form");
const linkList = document.getElementById("link-list");
const searchInput = document.getElementById("search");
const settingsForm = document.getElementById("settings-form");
const registrationPill = document.getElementById("registration-pill");
const registerTab = document.getElementById("register-tab");
const siteAdminLink = document.getElementById("site-admin-link");
const oauthLoginList = document.getElementById("oauth-login-list");
const oauthLinkList = document.getElementById("oauth-link-list");
const oauthLinkMessage = document.getElementById("oauth-link-message");
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

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
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
  state.user = null;
  state.links = [];
  render();
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

searchInput.addEventListener("input", () => {
  state.search = searchInput.value.trim().toLowerCase();
  renderLinks();
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
  state.siteTitle = result.ok ? result.site_title : "HomeHub";
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
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  authSubmit.textContent = mode === "login" ? "Login" : "Create account";
  authMessage.textContent = "";
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
    oauthLinkMessage.textContent = "Link a provider so you can sign in without a password next time.";
    linkList.innerHTML = "";
    renderOAuthProviders();
  }
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
        <article class="link-card">
          <div class="link-card-head">
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
            <div class="card-actions">
              <button class="secondary-button" type="button" data-action="edit" data-id="${link.id}">Edit</button>
              <button class="secondary-button" type="button" data-action="reset-icon" data-id="${link.id}">Reset icon</button>
              <button class="ghost-button" type="button" data-action="delete" data-id="${link.id}">Delete</button>
            </div>
          </div>
          <a href="${escapeAttribute(link.url)}" target="_blank" rel="noreferrer">${escapeHtml(link.url)}</a>
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
  document.getElementById("link-id").value = link.id;
  document.getElementById("link-title").value = link.title;
  document.getElementById("link-url").value = link.url;
  document.getElementById("link-description").value = link.description;
  document.getElementById("link-icon-url").value = link.icon_url || "";
  document.getElementById("link-icon-mode").value = link.icon_mode || "favicon";
  document.getElementById("link-icon-file").value = "";
  document.getElementById("link-submit").textContent = "Save changes";
  document.getElementById("link-icon-message").textContent =
    link.icon_mode === "custom"
      ? "This link is using a custom icon. Upload a new one to replace it, or leave the field empty to keep it."
      : "This link is using the site favicon. Upload an image only if you want to override it.";
  dashboardMessage.textContent = "Editing link.";
}

function resetLinkForm() {
  linkForm.reset();
  document.getElementById("link-id").value = "";
  document.getElementById("link-icon-url").value = "";
  document.getElementById("link-icon-mode").value = "favicon";
  document.getElementById("link-submit").textContent = "Add link";
  document.getElementById("link-icon-message").textContent = "If you do not upload an image, the site favicon will be used automatically.";
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
  await loadSiteConfig();
  await refreshSession();
  if (!state.user) {
    await loadOAuthProviders();
  }
  consumeOAuthStatus();
}

init();
