import base64
import cgi
import datetime as dt
import hashlib
import html
import hmac
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import threading
from socketserver import ThreadingMixIn
from http import HTTPStatus
from pathlib import Path
from urllib.parse import parse_qs, quote, urljoin, urlparse
from urllib.request import Request, urlopen
from wsgiref.simple_server import WSGIServer, make_server

from navihub.oauth import (
    DEFAULT_OAUTH_SETTINGS,
    configured_providers,
    exchange_code_for_identity,
    provider_authorize_url,
    provider_label,
    validate_oauth_settings,
)


BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = BASE_DIR / "data" / "navihub.db"
DEFAULT_STATIC_DIR = BASE_DIR / "static"

DEFAULT_SITE_TITLE = "NaviHub"
DEFAULT_USER_SETTINGS = {
    "theme": "day",
    "accent": "amber",
    "layout": "cozy",
    "background": "sunrise",
    "custom_background_url": "",
    "tab_title": "My NaviHub",
    "admin_heading": "NaviHub",
    "admin_copy": "Personal navigation page",
    "nav_heading": "Open what matters, right from your start page.",
    "nav_copy": "This is your personal navigation page. Keep it fast, visual, and focused on the sites you use every day.",
}
DEFAULT_LINKS = [
    {"title": "Inbox", "url": "https://mail.google.com", "description": "Check messages", "position": 1},
    {"title": "Calendar", "url": "https://calendar.google.com", "description": "Plan the day", "position": 2},
    {"title": "Docs", "url": "https://docs.google.com", "description": "Notes and documents", "position": 3},
]
ALLOWED_THEMES = {"day", "night"}
ALLOWED_ACCENTS = {"amber", "cyan", "pink"}
ALLOWED_LAYOUTS = {"cozy", "compact"}
ALLOWED_BACKGROUNDS = {"sunrise", "paper", "aurora", "midnight", "custom"}
THEME_BACKGROUNDS = {
    "day": {"sunrise", "paper", "aurora", "custom"},
    "night": {"midnight", "custom"},
}
HOST_ICON_FALLBACKS = {
    "calendar.google.com": [
        "https://calendar.google.com/googlecalendar/images/favicons_2020q4/calendar_31_256.ico",
    ],
}
EMPTY_S3_SETTINGS = {
    "endpoint_url": "",
    "region": "",
    "bucket": "",
    "access_key_id": "",
    "secret_access_key": "",
    "public_base_url": "",
    "key_prefix": "navihub",
}


def json_response(status, payload, extra_headers=None):
    body = json.dumps(payload).encode("utf-8")
    headers = [
        ("Content-Type", "application/json; charset=utf-8"),
        ("Content-Length", str(len(body))),
    ]
    if extra_headers:
        headers.extend(extra_headers)
    return f"{status.value} {status.phrase}", headers, [body]


def binary_response(status, body, content_type="application/octet-stream", extra_headers=None):
    headers = [("Content-Type", content_type), ("Content-Length", str(len(body)))]
    if extra_headers:
        headers.extend(extra_headers)
    return f"{status.value} {status.phrase}", headers, [body]


def text_response(status, body, content_type="text/plain; charset=utf-8", extra_headers=None):
    return binary_response(status, body.encode("utf-8"), content_type, extra_headers)


def redirect_response(location):
    return f"{HTTPStatus.FOUND.value} {HTTPStatus.FOUND.phrase}", [("Location", location)], [b""]


def file_response(path):
    data = path.read_bytes()
    content_type, _ = mimetypes.guess_type(path.name)
    return binary_response(HTTPStatus.OK, data, content_type or "application/octet-stream")


def html_response(body):
    return binary_response(HTTPStatus.OK, body.encode("utf-8"), "text/html; charset=utf-8")


def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        120000,
    ).hex()
    return f"{salt}${digest}"


def verify_password(password, stored_hash):
    salt, digest = stored_hash.split("$", 1)
    candidate = hash_password(password, salt).split("$", 1)[1]
    return hmac.compare_digest(candidate, digest)


def validate_password_strength(password, label="Password"):
    if len(password) < 8:
        raise ValueError(f"{label} must be at least 8 characters long.")
    if not all(33 <= ord(char) <= 126 for char in password):
        raise ValueError(f"{label} can only use English letters, numbers, and special characters.")

    categories = [
        any(char.isdigit() for char in password),
        any("a" <= char <= "z" for char in password),
        any("A" <= char <= "Z" for char in password),
        any(not char.isalnum() for char in password),
    ]
    if sum(categories) < 3:
        raise ValueError(
            f"{label} must include at least 3 of these: numbers, lowercase letters, uppercase letters, special characters."
        )


def parse_cookies(environ):
    cookies = {}
    raw = environ.get("HTTP_COOKIE", "") or ""
    for part in raw.split(";"):
        if "=" not in part:
            continue
        key, value = part.strip().split("=", 1)
        cookies[key] = value
    return cookies


def parse_json_body(environ):
    try:
        length = int(environ.get("CONTENT_LENGTH", "0") or "0")
    except ValueError:
        length = 0
    raw = environ["wsgi.input"].read(length) if length else b""
    if not raw:
        return {}
    return json.loads(raw.decode("utf-8"))


def parse_multipart_form(environ):
    form = cgi.FieldStorage(
        fp=environ["wsgi.input"],
        environ=environ,
        keep_blank_values=True,
    )
    data = {}
    files = {}
    for key in form.keys():
        item = form[key]
        if isinstance(item, list):
            item = item[0]
        if getattr(item, "filename", None):
            files[key] = item
        else:
            data[key] = item.value
    return data, files


def ensure_parent(path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)


def favicon_url(url):
    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        return ""
    return f"{parsed.scheme}://{parsed.netloc}/favicon.ico"


def homepage_url(url):
    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        return ""
    return f"{parsed.scheme}://{parsed.netloc}/"


def fetch_url_bytes(url, accept="image/*,*/*;q=0.8"):
    request = Request(
        url,
        headers={
            "User-Agent": "NaviHub/1.0",
            "Accept": accept,
        },
    )
    with urlopen(request, timeout=10) as response:
        payload = response.read()
        content_type = response.headers.get_content_type() or "application/octet-stream"
    return payload, content_type


def discover_icon_from_html(page_url):
    payload, content_type = fetch_url_bytes(page_url, accept="text/html,application/xhtml+xml;q=0.9,*/*;q=0.5")
    if "html" not in content_type:
        return None
    text = payload.decode("utf-8", errors="ignore")
    pattern = re.compile(
        r"<link\b[^>]*rel=[\"'][^\"']*(?:icon|shortcut icon|apple-touch-icon)[^\"']*[\"'][^>]*href=[\"']([^\"']+)[\"'][^>]*>",
        re.IGNORECASE,
    )
    match = pattern.search(text)
    if not match:
        match = re.search(r"<link\b[^>]*href=[\"']([^\"']+)[\"'][^>]*rel=[\"'][^\"']*(?:icon|shortcut icon|apple-touch-icon)[^\"']*[\"'][^>]*>", text, re.IGNORECASE)
    if not match:
        return None
    href = html.unescape(match.group(1).strip())
    if href.startswith("data:"):
        return None
    return urljoin(page_url, href)


def host_specific_icon_candidates(url):
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    return HOST_ICON_FALLBACKS.get(host, [])


def favicon_cache_key(url):
    return hashlib.sha256(url.encode("utf-8")).hexdigest()


def file_extension(filename, content_type):
    name = (filename or "").lower()
    ext = Path(name).suffix
    if ext in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico"}:
        return ext
    guessed = mimetypes.guess_extension(content_type or "")
    return guessed or ".bin"


def build_public_object_url(settings, key):
    base = (settings.get("public_base_url") or "").strip().rstrip("/")
    if base:
        return f"{base}/{quote(key, safe='/')}"
    endpoint = settings["endpoint_url"].rstrip("/")
    return f"{endpoint}/{quote(settings['bucket'])}/{quote(key, safe='/')}"


def s3_enabled(settings):
    return all((settings.get(field) or "").strip() for field in ("endpoint_url", "bucket", "access_key_id", "secret_access_key"))


def validate_s3_settings(payload):
    settings = {**EMPTY_S3_SETTINGS, **(payload or {})}
    cleaned = {key: str(value or "").strip() for key, value in settings.items()}
    cleaned["key_prefix"] = cleaned["key_prefix"] or "navihub"
    required = ("endpoint_url", "bucket", "access_key_id", "secret_access_key")
    filled = [bool(cleaned[field]) for field in required]
    if any(filled) and not all(filled):
        raise ValueError("Complete all required S3 settings or leave them all blank.")
    return cleaned


def sign_s3_request(method, endpoint_url, region, access_key_id, secret_access_key, bucket, key, payload, content_type):
    parsed = urlparse(endpoint_url.rstrip("/"))
    if not parsed.scheme or not parsed.netloc:
        raise ValueError("S3 endpoint URL is invalid.")
    region = region or "auto"

    canonical_uri = f"/{quote(bucket)}/{quote(key, safe='/')}"
    host = parsed.netloc
    now = dt.datetime.now(dt.timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(payload).hexdigest()
    canonical_headers = (
        f"content-type:{content_type}\n"
        f"host:{host}\n"
        f"x-amz-content-sha256:{payload_hash}\n"
        f"x-amz-date:{amz_date}\n"
    )
    signed_headers = "content-type;host;x-amz-content-sha256;x-amz-date"
    canonical_request = "\n".join(
        [
            method,
            canonical_uri,
            "",
            canonical_headers,
            signed_headers,
            payload_hash,
        ]
    )
    algorithm = "AWS4-HMAC-SHA256"
    credential_scope = f"{date_stamp}/{region}/s3/aws4_request"
    string_to_sign = "\n".join(
        [
            algorithm,
            amz_date,
            credential_scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ]
    )

    def sign(key_bytes, message):
        return hmac.new(key_bytes, message.encode("utf-8"), hashlib.sha256).digest()

    signing_key = sign(sign(sign(sign(("AWS4" + secret_access_key).encode("utf-8"), date_stamp), region), "s3"), "aws4_request")
    signature = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    authorization = (
        f"{algorithm} Credential={access_key_id}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    return {
        "url": f"{parsed.scheme}://{host}{canonical_uri}",
        "headers": {
            "Content-Type": content_type,
            "Host": host,
            "x-amz-content-sha256": payload_hash,
            "x-amz-date": amz_date,
            "Authorization": authorization,
        },
    }


def upload_to_s3(settings, key, payload, content_type):
    signed = sign_s3_request(
        "PUT",
        settings["endpoint_url"],
        settings["region"],
        settings["access_key_id"],
        settings["secret_access_key"],
        settings["bucket"],
        key,
        payload,
        content_type,
    )
    request = Request(signed["url"], data=payload, method="PUT", headers=signed["headers"])
    with urlopen(request, timeout=30) as response:
        if response.status >= 300:
            raise ValueError("Upload failed.")


class ThreadingWSGIServer(ThreadingMixIn, WSGIServer):
    daemon_threads = True


def init_db(db_path):
    ensure_parent(db_path)
    with sqlite3.connect(db_path) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                is_admin INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT NOT NULL UNIQUE,
                user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                url TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                icon_url TEXT NOT NULL DEFAULT '',
                icon_mode TEXT NOT NULL DEFAULT 'favicon',
                position INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS user_settings (
                user_id INTEGER PRIMARY KEY,
                settings_json TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS global_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS default_links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                url TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                icon_url TEXT NOT NULL DEFAULT '',
                icon_mode TEXT NOT NULL DEFAULT 'favicon',
                position INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS favicon_cache (
                cache_key TEXT PRIMARY KEY,
                source_url TEXT NOT NULL,
                icon_url TEXT NOT NULL,
                content_type TEXT NOT NULL,
                body BLOB NOT NULL,
                etag TEXT NOT NULL,
                fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS oauth_identities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                provider TEXT NOT NULL,
                provider_user_id TEXT NOT NULL,
                email TEXT NOT NULL DEFAULT '',
                display_name TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(provider, provider_user_id),
                UNIQUE(user_id, provider),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS oauth_states (
                state TEXT PRIMARY KEY,
                provider TEXT NOT NULL,
                mode TEXT NOT NULL,
                user_id INTEGER,
                redirect_path TEXT NOT NULL DEFAULT '/admin',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            """
        )
        user_columns = {row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
        if "is_admin" not in user_columns:
            conn.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
        link_columns = {row[1] for row in conn.execute("PRAGMA table_info(links)").fetchall()}
        if "icon_url" not in link_columns:
            conn.execute("ALTER TABLE links ADD COLUMN icon_url TEXT NOT NULL DEFAULT ''")
        if "icon_mode" not in link_columns:
            conn.execute("ALTER TABLE links ADD COLUMN icon_mode TEXT NOT NULL DEFAULT 'favicon'")
        default_link_columns = {row[1] for row in conn.execute("PRAGMA table_info(default_links)").fetchall()}
        if "icon_url" not in default_link_columns:
            conn.execute("ALTER TABLE default_links ADD COLUMN icon_url TEXT NOT NULL DEFAULT ''")
        if "icon_mode" not in default_link_columns:
            conn.execute("ALTER TABLE default_links ADD COLUMN icon_mode TEXT NOT NULL DEFAULT 'favicon'")

        if conn.execute("SELECT COUNT(*) FROM default_links").fetchone()[0] == 0:
            conn.executemany(
                """
                INSERT INTO default_links (title, url, description, icon_url, icon_mode, position)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        item["title"],
                        item["url"],
                        item["description"],
                        favicon_url(item["url"]),
                        "favicon",
                        item["position"],
                    )
                    for item in DEFAULT_LINKS
                ],
            )

        defaults = {
            "site_title": DEFAULT_SITE_TITLE,
            "registration_open": "true",
            "default_user_settings": json.dumps(DEFAULT_USER_SETTINGS),
            "s3_settings": json.dumps(EMPTY_S3_SETTINGS),
            "oauth_settings": json.dumps(DEFAULT_OAUTH_SETTINGS),
        }
        for key, value in defaults.items():
            conn.execute(
                "INSERT OR IGNORE INTO global_settings (key, value) VALUES (?, ?)",
                (key, value),
            )

        admin_rows = conn.execute("SELECT id FROM users WHERE is_admin = 1 ORDER BY id ASC").fetchall()
        admin_count = len(admin_rows)
        if admin_count == 0:
            first_user = conn.execute("SELECT id FROM users ORDER BY id ASC LIMIT 1").fetchone()
            if first_user:
                conn.execute("UPDATE users SET is_admin = 1 WHERE id = ?", (first_user[0],))
        elif admin_count > 1:
            keep_admin_id = admin_rows[0][0]
            conn.execute("UPDATE users SET is_admin = 0 WHERE id != ?", (keep_admin_id,))

        conn.execute(
            """
            UPDATE links
            SET icon_url = CASE
                WHEN icon_url = '' OR icon_url IS NULL THEN
                    substr(url, 1, instr(substr(url, 9), '/') + 7) || '/favicon.ico'
                ELSE icon_url
            END
            WHERE url LIKE 'http%' AND (icon_url = '' OR icon_url IS NULL)
            """
        )
        conn.execute(
            """
            UPDATE default_links
            SET icon_url = CASE
                WHEN icon_url = '' OR icon_url IS NULL THEN
                    substr(url, 1, instr(substr(url, 9), '/') + 7) || '/favicon.ico'
                ELSE icon_url
            END
            WHERE url LIKE 'http%' AND (icon_url = '' OR icon_url IS NULL)
            """
        )


class NaviHubApp:
    def __init__(self, db_path=DEFAULT_DB_PATH, static_dir=DEFAULT_STATIC_DIR, enable_favicon_prewarm=True):
        self.db_path = str(db_path)
        self.static_dir = Path(static_dir)
        self.enable_favicon_prewarm = enable_favicon_prewarm
        init_db(self.db_path)

    def connect(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def warm_favicon_async(self, icon_url):
        if not self.enable_favicon_prewarm:
            return
        if not icon_url.startswith(("http://", "https://")):
            return
        thread = threading.Thread(target=self.prewarm_favicon_cache, args=(icon_url,), daemon=True)
        thread.start()

    def prewarm_favicon_cache(self, icon_url):
        cache_key = favicon_cache_key(icon_url)
        with self.connect() as conn:
            cached = conn.execute(
                "SELECT fetched_at FROM favicon_cache WHERE cache_key = ?",
                (cache_key,),
            ).fetchone()
        if cached and not self.cache_stale(cached["fetched_at"]):
            return

        candidates = [icon_url]
        for candidate in host_specific_icon_candidates(icon_url):
            if candidate not in candidates:
                candidates.append(candidate)
        home = homepage_url(icon_url)
        if home:
            try:
                discovered = discover_icon_from_html(home)
                if discovered and discovered not in candidates:
                    candidates.append(discovered)
            except Exception:
                pass

        for candidate in candidates:
            try:
                payload, content_type = fetch_url_bytes(candidate)
                if content_type.startswith("image/") or candidate.endswith(".ico"):
                    etag = hashlib.sha256(payload).hexdigest()
                    with self.connect() as conn:
                        conn.execute(
                            """
                            INSERT INTO favicon_cache (cache_key, source_url, icon_url, content_type, body, etag, fetched_at)
                            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                            ON CONFLICT(cache_key) DO UPDATE SET
                                source_url = excluded.source_url,
                                icon_url = excluded.icon_url,
                                content_type = excluded.content_type,
                                body = excluded.body,
                                etag = excluded.etag,
                                fetched_at = CURRENT_TIMESTAMP
                            """,
                            (cache_key, icon_url, candidate, content_type, payload, etag),
                        )
                    return
            except Exception:
                continue

    def __call__(self, environ, start_response):
        method = environ["REQUEST_METHOD"].upper()
        path = environ.get("PATH_INFO", "/")

        try:
            if path == "/":
                result = self.serve_navigation(environ)
            elif path == "/login":
                result = self.serve_login(environ)
            elif path == "/admin":
                result = self.serve_admin(environ)
            elif path == "/site-admin":
                result = self.serve_site_admin(environ)
            elif path.startswith("/static/"):
                result = self.serve_static(path.removeprefix("/static/"))
            elif path == "/api/register" and method == "POST":
                result = self.register(environ)
            elif path == "/api/login" and method == "POST":
                result = self.login(environ)
            elif path == "/api/logout" and method == "POST":
                result = self.logout(environ)
            elif path == "/api/account/password" and method == "PUT":
                result = self.change_password(environ)
            elif path == "/api/me" and method == "GET":
                result = self.me(environ)
            elif path == "/api/public-config" and method == "GET":
                result = self.get_public_config(environ)
            elif path == "/api/links" and method == "GET":
                result = self.list_links(environ)
            elif path == "/api/favicon" and method == "GET":
                result = self.proxy_favicon(environ)
            elif path == "/api/oauth/providers" and method == "GET":
                result = self.list_oauth_providers(environ)
            elif path == "/api/links/import" and method == "POST":
                result = self.import_links(environ)
            elif path == "/api/links" and method == "POST":
                result = self.create_link(environ)
            elif path.startswith("/api/links/") and method == "PUT":
                result = self.update_link(environ, path)
            elif path.startswith("/api/links/") and method == "DELETE":
                result = self.delete_link(environ, path)
            elif path == "/api/user-settings" and method == "GET":
                result = self.get_user_settings(environ)
            elif path == "/api/user-settings" and method == "PUT":
                result = self.update_user_settings(environ)
            elif path == "/api/uploads" and method == "POST":
                result = self.upload_asset(environ)
            elif path == "/api/site-admin/config" and method == "GET":
                result = self.get_site_admin_config(environ)
            elif path == "/api/site-admin/config" and method == "PUT":
                result = self.update_site_admin_config(environ)
            elif path == "/api/site-admin/accounts" and method == "GET":
                result = self.list_accounts(environ)
            elif path == "/api/site-admin/accounts" and method == "POST":
                result = self.create_account(environ)
            elif path.startswith("/api/site-admin/accounts/") and method == "PUT":
                result = self.update_account(environ, path)
            elif path.startswith("/api/site-admin/accounts/") and method == "DELETE":
                result = self.delete_account(environ, path)
            elif path == "/api/site-admin/default-links" and method == "GET":
                result = self.list_default_links(environ)
            elif path == "/api/site-admin/default-links" and method == "POST":
                result = self.create_default_link(environ)
            elif path.startswith("/api/site-admin/default-links/") and method == "PUT":
                result = self.update_default_link(environ, path)
            elif path.startswith("/api/site-admin/default-links/") and method == "DELETE":
                result = self.delete_default_link(environ, path)
            elif path.startswith("/oauth/") and path.endswith("/start") and method == "GET":
                result = self.start_oauth(environ, path)
            elif path.startswith("/oauth/") and path.endswith("/callback") and method == "GET":
                result = self.complete_oauth(environ, path)
            else:
                result = json_response(HTTPStatus.NOT_FOUND, {"error": "Not found"})
        except ValueError as exc:
            result = json_response(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except PermissionError as exc:
            result = json_response(HTTPStatus.FORBIDDEN, {"error": str(exc)})
        except Exception:
            result = json_response(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": "The server hit an unexpected error."},
            )

        status, headers, body = result
        start_response(status, headers)
        return body

    def serve_navigation(self, environ):
        user = self.current_user(environ)
        if not user:
            return redirect_response("/login")
        return self.serve_themed_page("index.html", user)

    def serve_login(self, environ):
        return self.serve_default_themed_page("login.html")

    def serve_admin(self, environ):
        user = self.current_user(environ)
        if not user:
            return redirect_response("/login")
        return self.serve_themed_page("admin.html", user)

    def serve_site_admin(self, environ):
        user = self.current_user(environ)
        if not user:
            return redirect_response("/login")
        if not user["is_admin"]:
            return redirect_response("/admin")
        return self.serve_themed_page("site-admin.html", user)

    def serve_themed_page(self, filename, user):
        path = self.static_dir / filename
        with self.connect() as conn:
            settings = self.get_user_settings_record(conn, user["id"])
        return html_response(self.apply_initial_theme(path, settings))

    def serve_default_themed_page(self, filename):
        path = self.static_dir / filename
        with self.connect() as conn:
            settings = self.load_site_config(conn)["default_user_settings"]
        return html_response(self.apply_initial_theme(path, settings))

    def apply_initial_theme(self, path, settings):
        body = path.read_text(encoding="utf-8")
        replacements = {
            "data-theme": settings["theme"],
            "data-accent": settings["accent"],
            "data-layout": settings["layout"],
            "data-background": settings["background"],
        }
        for attr, value in replacements.items():
            body = re.sub(rf'{attr}="[^"]*"', f'{attr}="{html.escape(value, quote=True)}"', body, count=1)

        if settings["background"] == "custom" and settings.get("custom_background_url"):
            custom_url = settings["custom_background_url"].replace("\\", "\\\\").replace('"', '\\"')
            style_value = f'--custom-bg-image: url("{custom_url}")'
            escaped_style = html.escape(style_value, quote=True)
            if re.search(r"<body\b[^>]*\bstyle=", body):
                body = re.sub(
                    r'(<body\b[^>]*\bstyle=")([^"]*)"',
                    lambda match: f'{match.group(1)}{match.group(2)}; {escaped_style}"',
                    body,
                    count=1,
                )
            else:
                body = re.sub(
                    r"(<body\b[^>]*)(>)",
                    lambda match: f'{match.group(1)} style="{escaped_style}"{match.group(2)}',
                    body,
                    count=1,
                )
        return body

    def serve_static(self, relative_path):
        path = (self.static_dir / relative_path).resolve()
        static_root = self.static_dir.resolve()
        if static_root not in path.parents and path != static_root:
            return json_response(HTTPStatus.FORBIDDEN, {"error": "Forbidden"})
        if not path.exists() or not path.is_file():
            return json_response(HTTPStatus.NOT_FOUND, {"error": "Not found"})
        return file_response(path)

    def current_user(self, environ):
        cookies = parse_cookies(environ)
        token = cookies.get("session_id")
        if not token:
            return None
        with self.connect() as conn:
            row = conn.execute(
                """
                SELECT users.id, users.email, users.is_admin
                FROM sessions
                JOIN users ON users.id = sessions.user_id
                WHERE sessions.token = ?
                """,
                (token,),
            ).fetchone()
        return dict(row) if row else None

    def require_user(self, environ):
        user = self.current_user(environ)
        if not user:
            raise ValueError("Authentication required.")
        return user

    def require_admin(self, environ):
        user = self.require_user(environ)
        if not user["is_admin"]:
            raise PermissionError("Admin access required.")
        return user

    def resolve_external_base_url(self, environ, oauth_settings):
        configured = str(oauth_settings.get("external_base_url", "") or "").strip().rstrip("/")
        if configured:
            return configured
        scheme = (environ.get("HTTP_X_FORWARDED_PROTO") or environ.get("wsgi.url_scheme") or "http").split(",")[0].strip()
        host = (environ.get("HTTP_X_FORWARDED_HOST") or environ.get("HTTP_HOST") or "").split(",")[0].strip()
        if not host:
            server_name = environ.get("SERVER_NAME", "127.0.0.1")
            server_port = environ.get("SERVER_PORT", "8000")
            host = f"{server_name}:{server_port}"
        return f"{scheme}://{host}".rstrip("/")

    def list_oauth_providers(self, environ):
        user = self.current_user(environ)
        with self.connect() as conn:
            config = self.load_site_config(conn)
            settings = config["oauth_settings"]
            available = configured_providers(settings)
            linked = {}
            if user:
                rows = conn.execute(
                    "SELECT provider, email, display_name FROM oauth_identities WHERE user_id = ?",
                    (user["id"],),
                ).fetchall()
                linked = {row["provider"]: {"email": row["email"], "display_name": row["display_name"]} for row in rows}
        providers = []
        for provider in available:
            providers.append(
                {
                    "id": provider,
                    "label": provider_label(provider),
                    "login_url": f"/oauth/{provider}/start?mode=login",
                    "link_url": f"/oauth/{provider}/start?mode=link",
                    "linked": provider in linked,
                    "linked_identity": linked.get(provider),
                }
            )
        return json_response(HTTPStatus.OK, {"providers": providers})

    def start_oauth(self, environ, path):
        provider = path.strip("/").split("/")[1]
        query = parse_qs(environ.get("QUERY_STRING", ""))
        mode = (query.get("mode") or ["login"])[0].strip().lower()
        if mode not in {"login", "link"}:
            raise ValueError("Invalid OAuth mode.")

        user = self.current_user(environ)
        if mode == "link" and not user:
            return redirect_response("/login?oauth_error=login_required")

        with self.connect() as conn:
            config = self.load_site_config(conn)
            oauth_settings = config["oauth_settings"]
            if provider not in configured_providers(oauth_settings):
                raise ValueError("That provider is not configured.")
            state_token = secrets.token_urlsafe(24)
            redirect_path = "/admin" if mode == "link" else "/login"
            conn.execute(
                """
                INSERT INTO oauth_states (state, provider, mode, user_id, redirect_path)
                VALUES (?, ?, ?, ?, ?)
                """,
                (state_token, provider, mode, user["id"] if user else None, redirect_path),
            )
        base_url = self.resolve_external_base_url(environ, oauth_settings)
        return redirect_response(provider_authorize_url(provider, oauth_settings, base_url, state_token))

    def complete_oauth(self, environ, path):
        provider = path.strip("/").split("/")[1]
        query = parse_qs(environ.get("QUERY_STRING", ""))
        state_token = (query.get("state") or [""])[0].strip()
        code = (query.get("code") or [""])[0].strip()
        provider_error = (query.get("error") or [""])[0].strip()
        if not state_token:
            return redirect_response("/login?oauth_error=missing_state")
        if provider_error:
            return redirect_response(f"/login?oauth_error={quote(provider_error, safe='')}")
        if not code:
            return redirect_response("/login?oauth_error=missing_code")

        with self.connect() as conn:
            state_row = conn.execute(
                "SELECT state, provider, mode, user_id, redirect_path FROM oauth_states WHERE state = ?",
                (state_token,),
            ).fetchone()
            if not state_row:
                return redirect_response("/login?oauth_error=invalid_state")
            conn.execute("DELETE FROM oauth_states WHERE state = ?", (state_token,))
            config = self.load_site_config(conn)
            oauth_settings = config["oauth_settings"]
        if state_row["provider"] != provider:
            return redirect_response(f"{state_row['redirect_path']}?oauth_error=provider_mismatch")

        base_url = self.resolve_external_base_url(environ, oauth_settings)
        try:
            identity = exchange_code_for_identity(provider, oauth_settings, base_url, code)
            if not identity.get("provider_user_id"):
                return redirect_response(f"{state_row['redirect_path']}?oauth_error=identity_missing")
        except Exception as exc:
            return redirect_response(f"{state_row['redirect_path']}?oauth_error={quote(str(exc)[:120], safe='')}")

        with self.connect() as conn:
            result = self.attach_oauth_identity(conn, state_row["mode"], state_row["user_id"], identity)

        if result["mode"] == "login":
            headers = [("Set-Cookie", self.session_cookie(result["session_token"])), ("Location", f"/admin?oauth_status=logged_in&provider={provider}")]
            return f"{HTTPStatus.FOUND.value} {HTTPStatus.FOUND.phrase}", headers, [b""]
        return redirect_response(f"/admin?oauth_status=linked&provider={provider}")

    def attach_oauth_identity(self, conn, mode, acting_user_id, identity):
        existing_identity = conn.execute(
            """
            SELECT user_id FROM oauth_identities
            WHERE provider = ? AND provider_user_id = ?
            """,
            (identity["provider"], identity["provider_user_id"]),
        ).fetchone()

        if mode == "link":
            if not acting_user_id:
                raise ValueError("You must be logged in to link a provider.")
            current_link = conn.execute(
                "SELECT 1 FROM oauth_identities WHERE user_id = ? AND provider = ?",
                (acting_user_id, identity["provider"]),
            ).fetchone()
            if current_link:
                raise ValueError("That provider is already linked to your account.")
            if existing_identity and existing_identity["user_id"] != acting_user_id:
                raise ValueError("That provider login is already linked to another account.")
            conn.execute(
                """
                INSERT INTO oauth_identities (user_id, provider, provider_user_id, email, display_name)
                VALUES (?, ?, ?, ?, ?)
                """,
                (acting_user_id, identity["provider"], identity["provider_user_id"], identity["email"], identity["display_name"]),
            )
            return {"mode": "link"}

        if existing_identity:
            session_token = self.create_session(conn, existing_identity["user_id"])
            return {"mode": "login", "session_token": session_token}

        email = identity.get("email", "").strip().lower()
        if not email:
            raise ValueError("The provider did not return an email address.")

        user = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if user:
            raise ValueError("That email already exists. Log in first, then link this provider from your account settings.")

        config = self.load_site_config(conn)
        existing_users = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        if existing_users > 0 and not config["registration_open"]:
            raise PermissionError("New account registration is currently closed.")

        random_password = hash_password(secrets.token_urlsafe(32))
        is_admin = 1 if existing_users == 0 else 0
        cursor = conn.execute(
            "INSERT INTO users (email, password_hash, is_admin) VALUES (?, ?, ?)",
            (email, random_password, is_admin),
        )
        user_id = cursor.lastrowid
        self.save_user_settings_record(conn, user_id, config["default_user_settings"])
        self.seed_links(conn, user_id)
        conn.execute(
            """
            INSERT INTO oauth_identities (user_id, provider, provider_user_id, email, display_name)
            VALUES (?, ?, ?, ?, ?)
            """,
            (user_id, identity["provider"], identity["provider_user_id"], identity["email"], identity["display_name"]),
        )
        session_token = self.create_session(conn, user_id)
        return {"mode": "login", "session_token": session_token}

    def register(self, environ):
        payload = parse_json_body(environ)
        email = (payload.get("email") or "").strip().lower()
        password = payload.get("password") or ""

        if "@" not in email:
            raise ValueError("Enter a valid email address.")
        validate_password_strength(password)

        with self.connect() as conn:
            config = self.load_site_config(conn)
            existing_users = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            if existing_users > 0 and not config["registration_open"]:
                raise PermissionError("New account registration is currently closed.")

            existing = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
            if existing:
                raise ValueError("That email is already registered.")

            is_admin = 1 if existing_users == 0 else 0
            cursor = conn.execute(
                "INSERT INTO users (email, password_hash, is_admin) VALUES (?, ?, ?)",
                (email, hash_password(password), is_admin),
            )
            user_id = cursor.lastrowid
            self.save_user_settings_record(conn, user_id, config["default_user_settings"])
            self.seed_links(conn, user_id)
            token = self.create_session(conn, user_id)

        headers = [("Set-Cookie", self.session_cookie(token))]
        return json_response(
            HTTPStatus.CREATED,
            {"user": {"email": email, "is_admin": bool(is_admin)}},
            headers,
        )

    def login(self, environ):
        payload = parse_json_body(environ)
        email = (payload.get("email") or "").strip().lower()
        password = payload.get("password") or ""

        with self.connect() as conn:
            user = conn.execute(
                "SELECT id, email, password_hash, is_admin FROM users WHERE email = ?",
                (email,),
            ).fetchone()
            if not user or not verify_password(password, user["password_hash"]):
                return json_response(HTTPStatus.UNAUTHORIZED, {"error": "Incorrect email or password."})
            token = self.create_session(conn, user["id"])

        headers = [("Set-Cookie", self.session_cookie(token))]
        return json_response(
            HTTPStatus.OK,
            {"user": {"email": user["email"], "is_admin": bool(user["is_admin"])}},
            headers,
        )

    def change_password(self, environ):
        user = self.require_user(environ)
        payload = parse_json_body(environ)
        current_password = payload.get("current_password") or ""
        new_password = payload.get("new_password") or ""
        confirm_password = payload.get("confirm_password") or ""

        validate_password_strength(new_password, "New password")
        if new_password != confirm_password:
            raise ValueError("New passwords do not match.")

        with self.connect() as conn:
            stored_user = conn.execute(
                "SELECT password_hash FROM users WHERE id = ?",
                (user["id"],),
            ).fetchone()
            if not stored_user or not verify_password(current_password, stored_user["password_hash"]):
                raise ValueError("Current password is incorrect.")
            conn.execute(
                "UPDATE users SET password_hash = ? WHERE id = ?",
                (hash_password(new_password), user["id"]),
            )
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user["id"],))

        headers = [("Set-Cookie", "session_id=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax")]
        return json_response(HTTPStatus.OK, {"ok": True}, headers)

    def logout(self, environ):
        cookies = parse_cookies(environ)
        token = cookies.get("session_id")
        if token:
            with self.connect() as conn:
                conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        headers = [("Set-Cookie", "session_id=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax")]
        return json_response(HTTPStatus.OK, {"ok": True}, headers)

    def me(self, environ):
        user = self.current_user(environ)
        if not user:
            return json_response(HTTPStatus.OK, {"authenticated": False})
        return json_response(
            HTTPStatus.OK,
            {"authenticated": True, "user": user},
        )

    def get_public_config(self, environ):
        with self.connect() as conn:
            config = self.load_site_config(conn)
        return json_response(
            HTTPStatus.OK,
            {
                "site_title": config["site_title"],
                "registration_open": config["registration_open"],
            },
        )

    def list_links(self, environ):
        user = self.require_user(environ)
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT id, title, url, description, icon_url, icon_mode, position
                FROM links
                WHERE user_id = ?
                ORDER BY position ASC, id ASC
                """,
                (user["id"],),
            ).fetchall()
        return json_response(
            HTTPStatus.OK,
            {"links": [self.serialize_link(dict(row)) for row in rows]},
        )

    def proxy_favicon(self, environ):
        self.require_user(environ)
        query = parse_qs(environ.get("QUERY_STRING", ""))
        url = (query.get("url") or [""])[0].strip()
        if not url.startswith(("http://", "https://")):
            return json_response(HTTPStatus.BAD_REQUEST, {"error": "Invalid favicon URL"})

        cache_key = favicon_cache_key(url)
        request_etag = (environ.get("HTTP_IF_NONE_MATCH") or "").strip()
        with self.connect() as conn:
            cached = conn.execute(
                """
                SELECT icon_url, content_type, body, etag, fetched_at
                FROM favicon_cache
                WHERE cache_key = ?
                """,
                (cache_key,),
            ).fetchone()

        if cached and not self.cache_stale(cached["fetched_at"]):
            if request_etag and request_etag == cached["etag"]:
                return f"{HTTPStatus.NOT_MODIFIED.value} {HTTPStatus.NOT_MODIFIED.phrase}", [
                    ("ETag", cached["etag"]),
                    ("Cache-Control", "private, max-age=604800, stale-while-revalidate=86400"),
                ], [b""]
            return binary_response(
                HTTPStatus.OK,
                cached["body"],
                cached["content_type"],
                [
                    ("ETag", cached["etag"]),
                    ("Cache-Control", "private, max-age=604800, stale-while-revalidate=86400"),
                ],
            )

        candidates = [url]
        for candidate in host_specific_icon_candidates(url):
            if candidate not in candidates:
                candidates.append(candidate)
        home = homepage_url(url)
        if home:
            discovered = None
            try:
                discovered = discover_icon_from_html(home)
            except Exception:
                discovered = None
            if discovered and discovered not in candidates:
                candidates.append(discovered)

        for candidate in candidates:
            try:
                payload, content_type = fetch_url_bytes(candidate)
                if content_type.startswith("image/") or candidate.endswith(".ico"):
                    etag = hashlib.sha256(payload).hexdigest()
                    with self.connect() as conn:
                        conn.execute(
                            """
                            INSERT INTO favicon_cache (cache_key, source_url, icon_url, content_type, body, etag, fetched_at)
                            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                            ON CONFLICT(cache_key) DO UPDATE SET
                                source_url = excluded.source_url,
                                icon_url = excluded.icon_url,
                                content_type = excluded.content_type,
                                body = excluded.body,
                                etag = excluded.etag,
                                fetched_at = CURRENT_TIMESTAMP
                            """,
                            (cache_key, url, candidate, content_type, payload, etag),
                        )
                    return binary_response(
                        HTTPStatus.OK,
                        payload,
                        content_type,
                        [
                            ("ETag", etag),
                            ("Cache-Control", "private, max-age=604800, stale-while-revalidate=86400"),
                        ],
                    )
            except Exception:
                continue

        return json_response(HTTPStatus.NOT_FOUND, {"error": "Favicon not available"})

    def create_link(self, environ):
        user = self.require_user(environ)
        payload = parse_json_body(environ)
        title, url, description = self.validate_link_payload(payload)
        icon_url, icon_mode = self.resolve_link_icon(payload, url)

        with self.connect() as conn:
            position = conn.execute(
                "SELECT COALESCE(MAX(position), 0) + 1 FROM links WHERE user_id = ?",
                (user["id"],),
            ).fetchone()[0]
            cursor = conn.execute(
                """
                INSERT INTO links (user_id, title, url, description, icon_url, icon_mode, position)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (user["id"], title, url, description, icon_url, icon_mode, position),
            )
        response = json_response(
            HTTPStatus.CREATED,
            {"link": self.serialize_link({"id": cursor.lastrowid, "title": title, "url": url, "description": description, "icon_url": icon_url, "icon_mode": icon_mode, "position": position})},
        )
        if icon_mode == "favicon":
            self.warm_favicon_async(icon_url)
        return response

    def import_links(self, environ):
        user = self.require_user(environ)
        payload = parse_json_body(environ)
        raw_links = payload.get("links")
        if not isinstance(raw_links, list):
            raise ValueError("Links must be a list.")
        if len(raw_links) > 1000:
            raise ValueError("Import up to 1000 bookmarks at a time.")

        candidates = []
        skipped_invalid = 0
        skipped_request_duplicates = 0
        seen_in_request = set()
        for item in raw_links:
            if not isinstance(item, dict):
                skipped_invalid += 1
                continue
            url = str(item.get("url") or "").strip()
            parsed_url = urlparse(url)
            if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc:
                skipped_invalid += 1
                continue
            if url in seen_in_request:
                skipped_request_duplicates += 1
                continue
            title = str(item.get("title") or "").strip() or parsed_url.netloc or url
            candidates.append((title[:160], url))
            seen_in_request.add(url)

        imported = []
        skipped_duplicates = skipped_request_duplicates
        with self.connect() as conn:
            existing_urls = {
                row["url"]
                for row in conn.execute("SELECT url FROM links WHERE user_id = ?", (user["id"],)).fetchall()
            }
            position = conn.execute(
                "SELECT COALESCE(MAX(position), 0) FROM links WHERE user_id = ?",
                (user["id"],),
            ).fetchone()[0]
            for title, url in candidates:
                if url in existing_urls:
                    skipped_duplicates += 1
                    continue
                position += 1
                icon_url = favicon_url(url)
                cursor = conn.execute(
                    """
                    INSERT INTO links (user_id, title, url, description, icon_url, icon_mode, position)
                    VALUES (?, ?, ?, '', ?, 'favicon', ?)
                    """,
                    (user["id"], title, url, icon_url, position),
                )
                imported.append(
                    {
                        "id": cursor.lastrowid,
                        "title": title,
                        "url": url,
                        "description": "",
                        "icon_url": icon_url,
                        "icon_mode": "favicon",
                        "position": position,
                    }
                )
                existing_urls.add(url)

        for link in imported:
            self.warm_favicon_async(link["icon_url"])
        return json_response(
            HTTPStatus.CREATED,
            {
                "imported_count": len(imported),
                "skipped_duplicate_count": skipped_duplicates,
                "skipped_invalid_count": skipped_invalid,
                "links": [self.serialize_link(link) for link in imported],
            },
        )

    def update_link(self, environ, path):
        user = self.require_user(environ)
        link_id = self.parse_resource_id(path)
        payload = parse_json_body(environ)
        title, url, description = self.validate_link_payload(payload)

        with self.connect() as conn:
            current = conn.execute(
                "SELECT icon_url, icon_mode FROM links WHERE id = ? AND user_id = ?",
                (link_id, user["id"]),
            ).fetchone()
            if not current:
                return json_response(HTTPStatus.NOT_FOUND, {"error": "Link not found"})
            icon_url, icon_mode = self.resolve_link_icon(payload, url, current)
            updated = conn.execute(
                """
                UPDATE links
                SET title = ?, url = ?, description = ?, icon_url = ?, icon_mode = ?
                WHERE id = ? AND user_id = ?
                """,
                (title, url, description, icon_url, icon_mode, link_id, user["id"]),
            )
            if updated.rowcount == 0:
                return json_response(HTTPStatus.NOT_FOUND, {"error": "Link not found"})
        response = json_response(
            HTTPStatus.OK,
            {"link": self.serialize_link({"id": link_id, "title": title, "url": url, "description": description, "icon_url": icon_url, "icon_mode": icon_mode})},
        )
        if icon_mode == "favicon":
            self.warm_favicon_async(icon_url)
        return response

    def delete_link(self, environ, path):
        user = self.require_user(environ)
        link_id = self.parse_resource_id(path)
        with self.connect() as conn:
            deleted = conn.execute("DELETE FROM links WHERE id = ? AND user_id = ?", (link_id, user["id"]))
            if deleted.rowcount == 0:
                return json_response(HTTPStatus.NOT_FOUND, {"error": "Link not found"})
        return json_response(HTTPStatus.OK, {"ok": True})

    def get_user_settings(self, environ):
        user = self.require_user(environ)
        with self.connect() as conn:
            settings = self.get_user_settings_record(conn, user["id"])
            site_config = self.load_site_config(conn)
        return json_response(
            HTTPStatus.OK,
            {
                "settings": settings,
                "site_title": site_config["site_title"],
                "is_admin": bool(user["is_admin"]),
                "upload_enabled": s3_enabled(site_config["s3_settings"]),
            },
        )

    def update_user_settings(self, environ):
        user = self.require_user(environ)
        payload = parse_json_body(environ)
        with self.connect() as conn:
            current = self.get_user_settings_record(conn, user["id"])
            merged = {**current, **payload}
            settings = self.validate_user_settings(merged)
            self.save_user_settings_record(conn, user["id"], settings)
        return json_response(HTTPStatus.OK, {"settings": settings})

    def get_site_admin_config(self, environ):
        self.require_admin(environ)
        with self.connect() as conn:
            config = self.load_site_config(conn)
        return json_response(HTTPStatus.OK, {"config": config})

    def update_site_admin_config(self, environ):
        self.require_admin(environ)
        payload = parse_json_body(environ)
        with self.connect() as conn:
            current = self.load_site_config(conn)
            config = {
                "site_title": str(payload.get("site_title", current["site_title"])).strip() or current["site_title"],
                "registration_open": bool(payload.get("registration_open", current["registration_open"])),
                "default_user_settings": self.validate_user_settings(
                    {**current["default_user_settings"], **payload.get("default_user_settings", {})}
                ),
                "s3_settings": validate_s3_settings(payload.get("s3_settings", current["s3_settings"])),
                "oauth_settings": validate_oauth_settings(payload.get("oauth_settings", current["oauth_settings"])),
            }
            self.save_site_config(conn, config)
        return json_response(HTTPStatus.OK, {"config": config})

    def list_accounts(self, environ):
        self.require_admin(environ)
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT id, email, is_admin, created_at FROM users ORDER BY id ASC"
            ).fetchall()
        return json_response(HTTPStatus.OK, {"accounts": [dict(row) for row in rows]})

    def create_account(self, environ):
        self.require_admin(environ)
        payload = parse_json_body(environ)
        email = (payload.get("email") or "").strip().lower()
        password = payload.get("password") or ""

        if "@" not in email:
            raise ValueError("Enter a valid email address.")
        validate_password_strength(password)

        with self.connect() as conn:
            existing = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
            if existing:
                raise ValueError("That email is already registered.")
            config = self.load_site_config(conn)
            cursor = conn.execute(
                "INSERT INTO users (email, password_hash, is_admin) VALUES (?, ?, ?)",
                (email, hash_password(password), 0),
            )
            user_id = cursor.lastrowid
            self.save_user_settings_record(conn, user_id, config["default_user_settings"])
            self.seed_links(conn, user_id)
        return json_response(HTTPStatus.CREATED, {"account": {"id": user_id, "email": email, "is_admin": False}})

    def update_account(self, environ, path):
        acting_user = self.require_admin(environ)
        account_id = self.parse_resource_id(path)
        payload = parse_json_body(environ)
        transfer_admin = bool(payload.get("transfer_admin", False))
        if not transfer_admin:
            raise ValueError("Only admin transfer is allowed.")

        with self.connect() as conn:
            target = conn.execute("SELECT id, email, is_admin FROM users WHERE id = ?", (account_id,)).fetchone()
            if not target:
                return json_response(HTTPStatus.NOT_FOUND, {"error": "Account not found"})
            if target["id"] == acting_user["id"]:
                raise ValueError("Transfer admin access to another account instead.")
            if target["is_admin"]:
                raise ValueError("That account is already the site admin.")
            conn.execute("UPDATE users SET is_admin = 0 WHERE id = ?", (acting_user["id"],))
            conn.execute("UPDATE users SET is_admin = 1 WHERE id = ?", (account_id,))
        return json_response(
            HTTPStatus.OK,
            {"account": {"id": account_id, "email": target["email"], "is_admin": True}, "transferred": True},
        )

    def delete_account(self, environ, path):
        acting_user = self.require_admin(environ)
        account_id = self.parse_resource_id(path)
        if account_id == acting_user["id"]:
            raise ValueError("You cannot delete the account you are using right now.")

        with self.connect() as conn:
            target = conn.execute("SELECT id, is_admin FROM users WHERE id = ?", (account_id,)).fetchone()
            if not target:
                return json_response(HTTPStatus.NOT_FOUND, {"error": "Account not found"})
            if target["is_admin"]:
                admin_count = conn.execute("SELECT COUNT(*) FROM users WHERE is_admin = 1").fetchone()[0]
                if admin_count <= 1:
                    raise ValueError("The last admin account cannot be deleted.")
            conn.execute("DELETE FROM users WHERE id = ?", (account_id,))
        return json_response(HTTPStatus.OK, {"ok": True})

    def list_default_links(self, environ):
        self.require_admin(environ)
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT id, title, url, description, icon_url, icon_mode, position FROM default_links ORDER BY position ASC, id ASC"
            ).fetchall()
        return json_response(HTTPStatus.OK, {"links": [self.serialize_link(dict(row)) for row in rows]})

    def create_default_link(self, environ):
        self.require_admin(environ)
        payload = parse_json_body(environ)
        title, url, description = self.validate_link_payload(payload)
        icon_url, icon_mode = self.resolve_link_icon(payload, url)
        with self.connect() as conn:
            position = conn.execute("SELECT COALESCE(MAX(position), 0) + 1 FROM default_links").fetchone()[0]
            cursor = conn.execute(
                """
                INSERT INTO default_links (title, url, description, icon_url, icon_mode, position)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (title, url, description, icon_url, icon_mode, position),
            )
            link = {
                "id": cursor.lastrowid,
                "title": title,
                "url": url,
                "description": description,
                "icon_url": icon_url,
                "icon_mode": icon_mode,
                "position": position,
            }
        response = json_response(
            HTTPStatus.CREATED,
            {"link": self.serialize_link(link)},
        )
        if icon_mode == "favicon":
            self.warm_favicon_async(icon_url)
        return response

    def update_default_link(self, environ, path):
        self.require_admin(environ)
        link_id = self.parse_resource_id(path)
        payload = parse_json_body(environ)
        title, url, description = self.validate_link_payload(payload)
        with self.connect() as conn:
            current = conn.execute(
                "SELECT icon_url, icon_mode, position FROM default_links WHERE id = ?",
                (link_id,),
            ).fetchone()
            if not current:
                return json_response(HTTPStatus.NOT_FOUND, {"error": "Default link not found"})
            icon_url, icon_mode = self.resolve_link_icon(payload, url, current)
            conn.execute(
                """
                UPDATE default_links
                SET title = ?, url = ?, description = ?, icon_url = ?, icon_mode = ?
                WHERE id = ?
                """,
                (title, url, description, icon_url, icon_mode, link_id),
            )
            link = {
                "id": link_id,
                "title": title,
                "url": url,
                "description": description,
                "icon_url": icon_url,
                "icon_mode": icon_mode,
                "position": current["position"],
            }
        response = json_response(HTTPStatus.OK, {"link": self.serialize_link(link)})
        if icon_mode == "favicon":
            self.warm_favicon_async(icon_url)
        return response

    def upload_asset(self, environ):
        user = self.require_user(environ)
        data, files = parse_multipart_form(environ)
        kind = (data.get("kind") or "").strip().lower()
        upload = files.get("file")
        if kind not in {"icon", "background"}:
            raise ValueError("Upload kind must be icon or background.")
        if not upload or not getattr(upload, "filename", None):
            raise ValueError("Choose a file to upload.")
        content_type = upload.type or "application/octet-stream"
        if not content_type.startswith("image/"):
            raise ValueError("Only image uploads are allowed.")
        payload = upload.file.read()
        if not payload:
            raise ValueError("The uploaded file was empty.")
        if len(payload) > 5 * 1024 * 1024:
            raise ValueError("Uploads must be 5 MB or smaller.")

        with self.connect() as conn:
            config = self.load_site_config(conn)
        if not s3_enabled(config["s3_settings"]):
            raise ValueError("S3 uploads are not configured yet.")

        ext = file_extension(upload.filename, content_type)
        key = f"{config['s3_settings']['key_prefix'].strip('/')}/users/{user['id']}/{kind}s/{secrets.token_hex(12)}{ext}"
        try:
            upload_to_s3(config["s3_settings"], key, payload, content_type)
        except Exception as exc:
            raise ValueError(f"S3 upload failed: {exc}") from exc

        return json_response(
            HTTPStatus.CREATED,
            {"upload": {"kind": kind, "key": key, "url": build_public_object_url(config["s3_settings"], key)}},
        )

    def delete_default_link(self, environ, path):
        self.require_admin(environ)
        link_id = self.parse_resource_id(path)
        with self.connect() as conn:
            deleted = conn.execute("DELETE FROM default_links WHERE id = ?", (link_id,))
            if deleted.rowcount == 0:
                return json_response(HTTPStatus.NOT_FOUND, {"error": "Default link not found"})
        return json_response(HTTPStatus.OK, {"ok": True})

    def create_session(self, conn, user_id):
        token = secrets.token_urlsafe(32)
        conn.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, user_id))
        return token

    def session_cookie(self, token):
        return f"session_id={token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=1209600"

    def validate_link_payload(self, payload):
        title = (payload.get("title") or "").strip()
        url = (payload.get("url") or "").strip()
        description = (payload.get("description") or "").strip()
        if not title:
            raise ValueError("Title is required.")
        if not url.startswith(("http://", "https://")):
            raise ValueError("URL must start with http:// or https://")
        return title, url, description

    def resolve_link_icon(self, payload, url, current=None):
        requested_mode = str(payload.get("icon_mode") or (current["icon_mode"] if current else "favicon")).strip().lower()
        requested_url = str(payload.get("icon_url") or "").strip()
        if requested_mode == "custom":
            if not requested_url:
                requested_url = (current["icon_url"] if current else "").strip()
            if not requested_url.startswith(("http://", "https://")):
                raise ValueError("Custom icon URL must be a valid http:// or https:// address.")
            return requested_url, "custom"
        return favicon_url(url), "favicon"

    def serialize_link(self, link):
        result = dict(link)
        if result.get("icon_mode") == "favicon":
            result["icon_url"] = f"/api/favicon?url={quote(result['icon_url'], safe='')}"
        return result

    @staticmethod
    def cache_stale(fetched_at):
        try:
            fetched = dt.datetime.strptime(fetched_at, "%Y-%m-%d %H:%M:%S").replace(tzinfo=dt.timezone.utc)
        except ValueError:
            return True
        return (dt.datetime.now(dt.timezone.utc) - fetched) > dt.timedelta(days=7)

    def validate_user_settings(self, payload):
        settings = {**DEFAULT_USER_SETTINGS}
        settings.update(payload)
        theme = settings["theme"]
        accent = settings["accent"]
        layout = settings["layout"]
        background = settings["background"]
        if theme not in ALLOWED_THEMES:
            raise ValueError("Invalid theme.")
        if accent not in ALLOWED_ACCENTS:
            raise ValueError("Invalid accent.")
        if layout not in ALLOWED_LAYOUTS:
            raise ValueError("Invalid layout.")
        if background not in ALLOWED_BACKGROUNDS:
            raise ValueError("Invalid background.")
        if background not in THEME_BACKGROUNDS[theme]:
            raise ValueError("That background is not available for the selected theme.")
        custom_background_url = str(settings.get("custom_background_url", "") or "").strip()
        if background == "custom" and not custom_background_url.startswith(("http://", "https://")):
            raise ValueError("Upload a custom background image before saving the custom background option.")
        settings["custom_background_url"] = custom_background_url

        for key in ("tab_title", "admin_heading", "admin_copy", "nav_heading", "nav_copy"):
            value = str(settings.get(key, "")).strip()
            if not value:
                raise ValueError(f"{key.replace('_', ' ').title()} is required.")
            if len(value) > 160:
                raise ValueError(f"{key.replace('_', ' ').title()} is too long.")
            settings[key] = value

        settings["theme"] = theme
        settings["accent"] = accent
        settings["layout"] = layout
        settings["background"] = background
        return settings

    def load_site_config(self, conn):
        rows = conn.execute("SELECT key, value FROM global_settings").fetchall()
        raw = {row["key"]: row["value"] for row in rows}
        default_settings = DEFAULT_USER_SETTINGS
        if raw.get("default_user_settings"):
            try:
                default_settings = self.validate_user_settings(json.loads(raw["default_user_settings"]))
            except (json.JSONDecodeError, ValueError):
                default_settings = DEFAULT_USER_SETTINGS
        s3_settings = EMPTY_S3_SETTINGS
        if raw.get("s3_settings"):
            try:
                s3_settings = validate_s3_settings(json.loads(raw["s3_settings"]))
            except (json.JSONDecodeError, ValueError):
                s3_settings = EMPTY_S3_SETTINGS
        oauth_settings = DEFAULT_OAUTH_SETTINGS
        if raw.get("oauth_settings"):
            try:
                oauth_settings = validate_oauth_settings(json.loads(raw["oauth_settings"]))
            except (json.JSONDecodeError, ValueError):
                oauth_settings = DEFAULT_OAUTH_SETTINGS
        return {
            "site_title": raw.get("site_title", DEFAULT_SITE_TITLE),
            "registration_open": raw.get("registration_open", "true").lower() == "true",
            "default_user_settings": default_settings,
            "s3_settings": s3_settings,
            "oauth_settings": oauth_settings,
        }

    def save_site_config(self, conn, config):
        pairs = {
            "site_title": config["site_title"],
            "registration_open": "true" if config["registration_open"] else "false",
            "default_user_settings": json.dumps(config["default_user_settings"]),
            "s3_settings": json.dumps(config["s3_settings"]),
            "oauth_settings": json.dumps(config["oauth_settings"]),
        }
        for key, value in pairs.items():
            conn.execute(
                """
                INSERT INTO global_settings (key, value)
                VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                (key, value),
            )

    def get_user_settings_record(self, conn, user_id):
        row = conn.execute("SELECT settings_json FROM user_settings WHERE user_id = ?", (user_id,)).fetchone()
        if row:
            try:
                return self.validate_user_settings(json.loads(row["settings_json"]))
            except (json.JSONDecodeError, ValueError):
                pass
        defaults = self.load_site_config(conn)["default_user_settings"]
        self.save_user_settings_record(conn, user_id, defaults)
        return defaults

    def save_user_settings_record(self, conn, user_id, settings):
        conn.execute(
            """
            INSERT INTO user_settings (user_id, settings_json)
            VALUES (?, ?)
            ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json
            """,
            (user_id, json.dumps(settings)),
        )

    def seed_links(self, conn, user_id):
        defaults = conn.execute(
            "SELECT title, url, description, icon_url, icon_mode, position FROM default_links ORDER BY position ASC, id ASC"
        ).fetchall()
        conn.executemany(
            """
            INSERT INTO links (user_id, title, url, description, icon_url, icon_mode, position)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (user_id, row["title"], row["url"], row["description"], row["icon_url"], row["icon_mode"], row["position"])
                for row in defaults
            ],
        )

    @staticmethod
    def parse_resource_id(path):
        try:
            return int(path.rsplit("/", 1)[-1])
        except ValueError as exc:
            raise ValueError("Invalid id.") from exc


def create_app(config=None):
    config = config or {}
    return NaviHubApp(
        db_path=config.get("db_path", DEFAULT_DB_PATH),
        static_dir=config.get("static_dir", DEFAULT_STATIC_DIR),
        enable_favicon_prewarm=config.get("enable_favicon_prewarm", True),
    )


def run():
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    app = create_app()
    with make_server(host, port, app, server_class=ThreadingWSGIServer) as server:
        print(f"NaviHub running on http://{host}:{port}")
        server.serve_forever()
