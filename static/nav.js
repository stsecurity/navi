const state = {
  links: [],
  search: "",
  settings: null,
};

const tileGrid = document.getElementById("tile-grid");
const searchInput = document.getElementById("search");
const navMessage = document.getElementById("nav-message");

document.getElementById("logout-button").addEventListener("click", async () => {
  await api("/api/logout", "POST");
  window.location.href = "/admin";
});

searchInput.addEventListener("input", () => {
  state.search = searchInput.value.trim().toLowerCase();
  renderLinks();
});

async function init() {
  const settings = await api("/api/user-settings", "GET");
  if (!settings.ok) {
    window.location.href = "/admin";
    return;
  }
  state.settings = settings.settings;
  applySettings(settings.settings, settings.site_title);
  await loadLinks();
}

async function loadLinks() {
  const result = await api("/api/links", "GET");
  if (!result.ok) {
    window.location.href = "/admin";
    return;
  }
  state.links = result.links || [];
  renderLinks();
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

  navMessage.textContent = filtered.length
    ? `${filtered.length} link${filtered.length === 1 ? "" : "s"} ready.`
    : "No links match your search yet.";

  if (!filtered.length) {
    tileGrid.innerHTML = `<div class="empty-state">Add or edit links from the backend page, then they will show up here.</div>`;
    return;
  }

  tileGrid.innerHTML = filtered
    .map(
      (link) => `
        <a class="nav-tile" href="${escapeAttribute(link.url)}" target="_blank" rel="noreferrer">
          <div class="nav-tile-head">
            <div class="tile-icon-wrap">
              <img class="tile-icon-image" src="${escapeAttribute(link.icon_url || "")}" alt="" />
              <span class="tile-icon-fallback">${escapeHtml(initials(link.title))}</span>
            </div>
            <div>
              <h2>${escapeHtml(link.title)}</h2>
            </div>
          </div>
          <p>${escapeHtml(link.description || "Open this link.")}</p>
          <span>${escapeHtml(link.url)}</span>
        </a>
      `
    )
    .join("");

  bindIconFallbacks(tileGrid);
}

function applySettings(settings, siteTitle) {
  document.body.dataset.theme = settings.theme;
  document.body.dataset.accent = settings.accent;
  document.body.dataset.layout = settings.layout;
  document.body.dataset.background = settings.background;
  document.body.style.setProperty(
    "--custom-bg-image",
    settings.background === "custom" && settings.custom_background_url ? `url("${String(settings.custom_background_url).replace(/"/g, '\\"')}")` : "none"
  );
  document.title = settings.tab_title || siteTitle;
  document.getElementById("nav-heading").textContent = settings.nav_heading;
  document.getElementById("nav-copy").textContent = settings.nav_copy;
  document.getElementById("nav-eyebrow").textContent = siteTitle;
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

function bindIconFallbacks(root) {
  root.querySelectorAll(".tile-icon-image").forEach((img) => {
    const fallback = img.nextElementSibling;
    const showFallback = () => {
      img.classList.add("hidden");
      fallback.classList.add("visible");
    };
    img.addEventListener("error", showFallback, { once: true });
    img.addEventListener("load", () => {
      img.classList.remove("hidden");
      fallback.classList.remove("visible");
    }, { once: true });
    if (!img.getAttribute("src")) {
      showFallback();
    }
  });
}

function initials(value) {
  return String(value || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "?";
}

init();
