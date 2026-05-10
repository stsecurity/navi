const state = {
  config: null,
  personalSettings: null,
  accounts: [],
  defaultLinks: [],
};
const backgroundChoices = {
  day: [
    { value: "sunrise", label: "Sunrise" },
    { value: "paper", label: "Paper" },
    { value: "aurora", label: "Aurora" },
  ],
  night: [
    { value: "midnight", label: "Midnight" },
  ],
};

const siteConfigForm = document.getElementById("site-config-form");
const accountForm = document.getElementById("account-form");
const defaultLinkForm = document.getElementById("default-link-form");

document.getElementById("default-theme").addEventListener("change", () => {
  syncBackgroundOptions("default-theme", "default-background");
});

document.querySelectorAll("[data-site-tab]").forEach((button) => {
  button.addEventListener("click", () => setSiteTab(button.dataset.siteTab));
});

siteConfigForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    site_title: document.getElementById("site-title").value.trim(),
    external_base_url: document.getElementById("external-base-url").value.trim(),
    registration_open: document.getElementById("registration-open").value === "true",
    s3_settings: {
      endpoint_url: document.getElementById("s3-endpoint-url").value.trim(),
      region: document.getElementById("s3-region").value.trim(),
      bucket: document.getElementById("s3-bucket").value.trim(),
      access_key_id: document.getElementById("s3-access-key-id").value.trim(),
      secret_access_key: document.getElementById("s3-secret-access-key").value,
      public_base_url: document.getElementById("s3-public-base-url").value.trim(),
      key_prefix: document.getElementById("s3-key-prefix").value.trim(),
    },
    oauth_settings: {
      external_base_url: document.getElementById("external-base-url").value.trim(),
      google: {
        enabled: document.getElementById("oauth-google-enabled").value === "true",
        client_id: document.getElementById("oauth-google-client-id").value.trim(),
        client_secret: document.getElementById("oauth-google-client-secret").value,
      },
      github: {
        enabled: document.getElementById("oauth-github-enabled").value === "true",
        client_id: document.getElementById("oauth-github-client-id").value.trim(),
        client_secret: document.getElementById("oauth-github-client-secret").value,
      },
      nextcloud: {
        enabled: document.getElementById("oauth-nextcloud-enabled").value === "true",
        base_url: document.getElementById("oauth-nextcloud-base-url").value.trim(),
        client_id: document.getElementById("oauth-nextcloud-client-id").value.trim(),
        client_secret: document.getElementById("oauth-nextcloud-client-secret").value,
      },
    },
    default_user_settings: {
      theme: document.getElementById("default-theme").value,
      accent: document.getElementById("default-accent").value,
      layout: document.getElementById("default-layout").value,
      background: document.getElementById("default-background").value,
      tab_title: document.getElementById("default-tab-title").value.trim(),
      admin_heading: document.getElementById("default-admin-heading").value.trim(),
      admin_copy: document.getElementById("default-admin-copy").value.trim(),
      nav_heading: document.getElementById("default-nav-heading").value.trim(),
      nav_copy: document.getElementById("default-nav-copy").value.trim(),
    },
  };
  const result = await api("/api/site-admin/config", "PUT", payload);
  if (!result.ok) {
    message("site-config-message", result.error);
    return;
  }
  state.config = result.config;
  applyConfig(result.config);
  message("site-config-message", "Site settings saved.");
});

accountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    email: document.getElementById("account-email").value.trim(),
    password: document.getElementById("account-password").value,
  };
  const result = await api("/api/site-admin/accounts", "POST", payload);
  if (!result.ok) {
    message("account-message", result.error);
    return;
  }
  accountForm.reset();
  message("account-message", "Account created.");
  await loadAccounts();
});

defaultLinkForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    title: document.getElementById("default-link-title").value.trim(),
    url: document.getElementById("default-link-url").value.trim(),
    description: document.getElementById("default-link-description").value.trim(),
  };
  const result = await api("/api/site-admin/default-links", "POST", payload);
  if (!result.ok) {
    message("default-link-message", result.error);
    return;
  }
  defaultLinkForm.reset();
  message("default-link-message", "Default link added.");
  await loadDefaultLinks();
});

function setSiteTab(tabName) {
  document.querySelectorAll("[data-site-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.siteTab === tabName);
  });
  document.querySelectorAll("[data-site-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.sitePanel === tabName);
  });
}

async function init() {
  const [config, personal] = await Promise.all([
    api("/api/site-admin/config", "GET"),
    api("/api/user-settings", "GET"),
  ]);
  if (!config.ok || !personal.ok) {
    window.location.href = "/admin";
    return;
  }
  state.config = config.config;
  state.personalSettings = personal.settings;
  applyPersonalSettings(personal.settings, config.config.site_title);
  applyConfig(config.config);
  await Promise.all([loadAccounts(), loadDefaultLinks()]);
}

async function loadAccounts() {
  const result = await api("/api/site-admin/accounts", "GET");
  if (!result.ok) {
    message("account-message", result.error);
    return;
  }
  state.accounts = result.accounts || [];
  renderAccounts();
}

async function loadDefaultLinks() {
  const result = await api("/api/site-admin/default-links", "GET");
  if (!result.ok) {
    message("default-link-message", result.error);
    return;
  }
  state.defaultLinks = result.links || [];
  renderDefaultLinks();
}

function applyConfig(config) {
  document.title = `${config.site_title} Site Admin`;
  document.getElementById("site-admin-title").textContent = `${config.site_title} site controls`;
  document.getElementById("site-title").value = config.site_title;
  document.getElementById("external-base-url").value = config.oauth_settings.external_base_url || "";
  document.getElementById("registration-open").value = String(config.registration_open);
  document.getElementById("default-theme").value = config.default_user_settings.theme;
  document.getElementById("default-accent").value = config.default_user_settings.accent;
  document.getElementById("default-layout").value = config.default_user_settings.layout;
  syncBackgroundOptions("default-theme", "default-background", config.default_user_settings.background);
  document.getElementById("s3-endpoint-url").value = config.s3_settings.endpoint_url;
  document.getElementById("s3-region").value = config.s3_settings.region;
  document.getElementById("s3-bucket").value = config.s3_settings.bucket;
  document.getElementById("s3-access-key-id").value = config.s3_settings.access_key_id;
  document.getElementById("s3-secret-access-key").value = config.s3_settings.secret_access_key;
  document.getElementById("s3-public-base-url").value = config.s3_settings.public_base_url;
  document.getElementById("s3-key-prefix").value = config.s3_settings.key_prefix;
  document.getElementById("oauth-google-enabled").value = String(config.oauth_settings.google.enabled);
  document.getElementById("oauth-google-client-id").value = config.oauth_settings.google.client_id;
  document.getElementById("oauth-google-client-secret").value = config.oauth_settings.google.client_secret;
  document.getElementById("oauth-github-enabled").value = String(config.oauth_settings.github.enabled);
  document.getElementById("oauth-github-client-id").value = config.oauth_settings.github.client_id;
  document.getElementById("oauth-github-client-secret").value = config.oauth_settings.github.client_secret;
  document.getElementById("oauth-nextcloud-enabled").value = String(config.oauth_settings.nextcloud.enabled);
  document.getElementById("oauth-nextcloud-base-url").value = config.oauth_settings.nextcloud.base_url;
  document.getElementById("oauth-nextcloud-client-id").value = config.oauth_settings.nextcloud.client_id;
  document.getElementById("oauth-nextcloud-client-secret").value = config.oauth_settings.nextcloud.client_secret;
  document.getElementById("default-tab-title").value = config.default_user_settings.tab_title;
  document.getElementById("default-admin-heading").value = config.default_user_settings.admin_heading;
  document.getElementById("default-admin-copy").value = config.default_user_settings.admin_copy;
  document.getElementById("default-nav-heading").value = config.default_user_settings.nav_heading;
  document.getElementById("default-nav-copy").value = config.default_user_settings.nav_copy;

  const pill = document.getElementById("registration-status-pill");
  pill.textContent = config.registration_open ? "Registration open" : "Registration closed";
  pill.classList.toggle("closed", !config.registration_open);
}

function applyPersonalSettings(settings, siteTitle) {
  document.body.dataset.theme = settings.theme;
  document.body.dataset.accent = settings.accent;
  document.body.dataset.layout = settings.layout;
  document.body.dataset.background = settings.background;
  document.title = `${siteTitle} Site Admin`;
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

function renderAccounts() {
  const list = document.getElementById("account-list");
  if (!state.accounts.length) {
    list.innerHTML = `<div class="empty-state">No accounts yet.</div>`;
    return;
  }

  list.innerHTML = state.accounts
    .map(
      (account) => `
        <article class="account-card">
          <div class="account-card-head">
            <div>
              <h3>${escapeHtml(account.email)}</h3>
              <p>${escapeHtml(account.created_at)}</p>
            </div>
            <div class="card-actions">
              <span class="pill ${account.is_admin ? "admin" : ""}">${account.is_admin ? "Global admin" : "User"}</span>
              ${account.is_admin ? "" : `<button class="secondary-button" type="button" data-action="transfer-admin" data-id="${account.id}">Transfer admin</button>`}
              <button class="ghost-button" type="button" data-action="delete-account" data-id="${account.id}">Delete</button>
            </div>
          </div>
        </article>
      `
    )
    .join("");

  list.querySelectorAll("button[data-action='transfer-admin']").forEach((button) => {
    button.addEventListener("click", async () => {
      const result = await api(`/api/site-admin/accounts/${button.dataset.id}`, "PUT", {
        transfer_admin: true,
      });
      if (!result.ok) {
        message("account-message", result.error);
        return;
      }
      message("account-message", "Site admin transferred.");
      await loadAccounts();
      setTimeout(() => {
        window.location.href = "/admin";
      }, 700);
    });
  });

  list.querySelectorAll("button[data-action='delete-account']").forEach((button) => {
    button.addEventListener("click", async () => {
      const result = await api(`/api/site-admin/accounts/${button.dataset.id}`, "DELETE");
      if (!result.ok) {
        message("account-message", result.error);
        return;
      }
      message("account-message", "Account removed.");
      await loadAccounts();
    });
  });
}

function renderDefaultLinks() {
  const list = document.getElementById("default-link-list");
  if (!state.defaultLinks.length) {
    list.innerHTML = `<div class="empty-state">No default links set yet.</div>`;
    return;
  }

  list.innerHTML = state.defaultLinks
    .map(
      (link) => `
        <article class="default-link-card">
          <div class="default-link-head">
            <div>
              <h3>${escapeHtml(link.title)}</h3>
              <p>${escapeHtml(link.description || "No description yet.")}</p>
            </div>
            <div class="card-actions">
              <button class="ghost-button" type="button" data-action="delete-default-link" data-id="${link.id}">Delete</button>
            </div>
          </div>
          <a href="${escapeAttribute(link.url)}" target="_blank" rel="noreferrer">${escapeHtml(link.url)}</a>
        </article>
      `
    )
    .join("");

  list.querySelectorAll("button[data-action='delete-default-link']").forEach((button) => {
    button.addEventListener("click", async () => {
      const result = await api(`/api/site-admin/default-links/${button.dataset.id}`, "DELETE");
      if (!result.ok) {
        message("default-link-message", result.error);
        return;
      }
      message("default-link-message", "Default link removed.");
      await loadDefaultLinks();
    });
  });
}

async function api(url, method, body) {
  try {
    const response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json") ? await response.json() : {};
    return { ok: response.ok, status: response.status, ...data };
  } catch (error) {
    return { ok: false, error: "The request failed. Please try again." };
  }
}

function message(id, text) {
  document.getElementById(id).textContent = text;
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

init();
