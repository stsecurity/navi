import io
import json
import tempfile
import unittest
from pathlib import Path

from navihub.server import create_app


BASE_DIR = Path(__file__).resolve().parent.parent


class NaviHubAppTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test.db"
        self.app = create_app({"db_path": self.db_path, "static_dir": BASE_DIR / "static", "enable_favicon_prewarm": False})
        self.cookie = None

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_navigation_and_admin_require_login_while_login_page_is_public(self):
        home = self.request("GET", "/")
        self.assertEqual(home["status"], "302 Found")
        self.assertEqual(home["headers"]["Location"], "/login")

        admin = self.request("GET", "/admin")
        self.assertEqual(admin["status"], "302 Found")
        self.assertEqual(admin["headers"]["Location"], "/login")

        login = self.request("GET", "/login")
        self.assertEqual(login["status"], "200 OK")
        self.assertIn("NaviHub Login", login["text"])
        self.assertIn("Personal navigation page", login["text"])

    def test_admin_page_is_available_after_login(self):
        register = self.request(
            "POST",
            "/api/register",
            {"email": "owner@example.com", "password": "Strongpass1"},
        )
        self.cookie = register["headers"]["Set-Cookie"].split(";", 1)[0]

        admin = self.request("GET", "/admin")
        self.assertEqual(admin["status"], "200 OK")
        self.assertIn("Personal Settings", admin["text"])

    def test_login_page_uses_site_default_theme_before_javascript_loads(self):
        register = self.request(
            "POST",
            "/api/register",
            {"email": "owner@example.com", "password": "Strongpass1"},
        )
        self.cookie = register["headers"]["Set-Cookie"].split(";", 1)[0]

        config = self.request(
            "PUT",
            "/api/site-admin/config",
            {
                "site_title": "NaviHub",
                "registration_open": True,
                "default_user_settings": {
                    "theme": "night",
                    "accent": "pink",
                    "layout": "compact",
                    "background": "midnight",
                    "tab_title": "NaviHub",
                    "admin_heading": "NaviHub",
                    "admin_copy": "Personal navigation page",
                    "nav_heading": "NaviHub Home",
                    "nav_copy": "Personal navigation page",
                },
            },
        )
        self.assertEqual(config["status"], "200 OK")

        self.request("POST", "/api/logout")
        login = self.request("GET", "/login", cookie=None)
        self.assertEqual(login["status"], "200 OK")
        self.assertIn('data-theme="night"', login["text"])
        self.assertIn('data-accent="pink"', login["text"])
        self.assertIn('data-layout="compact"', login["text"])
        self.assertIn('data-background="midnight"', login["text"])

    def test_first_registered_user_becomes_global_admin(self):
        register = self.request(
            "POST",
            "/api/register",
            {"email": "owner@example.com", "password": "Strongpass1"},
        )
        self.assertEqual(register["status"], "201 Created")
        self.cookie = register["headers"]["Set-Cookie"].split(";", 1)[0]
        self.assertTrue(register["json"]["user"]["is_admin"])

        site_admin = self.request("GET", "/site-admin")
        self.assertEqual(site_admin["status"], "200 OK")
        self.assertIn("Site Controls", site_admin["text"])

    def test_registration_enforces_password_rules(self):
        too_simple = self.request(
            "POST",
            "/api/register",
            {"email": "owner@example.com", "password": "lowercaseonly"},
        )
        self.assertEqual(too_simple["status"], "400 Bad Request")
        self.assertIn("at least 3", too_simple["json"]["error"])

        other_language = self.request(
            "POST",
            "/api/register",
            {"email": "owner@example.com", "password": "Strongパス1!"},
        )
        self.assertEqual(other_language["status"], "400 Bad Request")
        self.assertIn("English letters", other_language["json"]["error"])

    def test_user_can_change_password_and_is_logged_out(self):
        register = self.request(
            "POST",
            "/api/register",
            {"email": "owner@example.com", "password": "Strongpass1"},
        )
        self.cookie = register["headers"]["Set-Cookie"].split(";", 1)[0]

        wrong_current = self.request(
            "PUT",
            "/api/account/password",
            {
                "current_password": "Wrongpass1",
                "new_password": "Newstrongpass1",
                "confirm_password": "Newstrongpass1",
            },
        )
        self.assertEqual(wrong_current["status"], "400 Bad Request")
        self.assertEqual(wrong_current["json"]["error"], "Current password is incorrect.")

        mismatch = self.request(
            "PUT",
            "/api/account/password",
            {
                "current_password": "Strongpass1",
                "new_password": "Newstrongpass1",
                "confirm_password": "Differentpass1",
            },
        )
        self.assertEqual(mismatch["status"], "400 Bad Request")
        self.assertEqual(mismatch["json"]["error"], "New passwords do not match.")

        weak = self.request(
            "PUT",
            "/api/account/password",
            {
                "current_password": "Strongpass1",
                "new_password": "short",
                "confirm_password": "short",
            },
        )
        self.assertEqual(weak["status"], "400 Bad Request")
        self.assertEqual(weak["json"]["error"], "New password must be at least 8 characters long.")

        changed = self.request(
            "PUT",
            "/api/account/password",
            {
                "current_password": "Strongpass1",
                "new_password": "Newstrongpass1",
                "confirm_password": "Newstrongpass1",
            },
        )
        self.assertEqual(changed["status"], "200 OK")

        me = self.request("GET", "/api/me")
        self.assertFalse(me["json"]["authenticated"])

        old_login = self.request(
            "POST",
            "/api/login",
            {"email": "owner@example.com", "password": "Strongpass1"},
            cookie=None,
        )
        self.assertEqual(old_login["status"], "401 Unauthorized")

        new_login = self.request(
            "POST",
            "/api/login",
            {"email": "owner@example.com", "password": "Newstrongpass1"},
            cookie=None,
        )
        self.assertEqual(new_login["status"], "200 OK")

    def test_user_can_update_personal_settings_and_links(self):
        register = self.request(
            "POST",
            "/api/register",
            {"email": "owner@example.com", "password": "Strongpass1"},
        )
        self.cookie = register["headers"]["Set-Cookie"].split(";", 1)[0]

        update_settings = self.request(
            "PUT",
            "/api/user-settings",
            {
                "theme": "night",
                "accent": "cyan",
                "layout": "compact",
                "background": "midnight",
                "tab_title": "Night Board",
                "admin_heading": "Control center",
                "admin_copy": "Tune your links and text here.",
                "nav_heading": "Launchpad",
                "nav_copy": "Everything important in one place.",
            },
        )
        self.assertEqual(update_settings["status"], "200 OK")
        self.assertEqual(update_settings["json"]["settings"]["theme"], "night")

        settings = self.request("GET", "/api/user-settings")
        self.assertEqual(settings["json"]["settings"]["tab_title"], "Night Board")

        admin = self.request("GET", "/admin")
        self.assertIn('data-theme="night"', admin["text"])
        self.assertIn('data-accent="cyan"', admin["text"])
        self.assertIn('data-layout="compact"', admin["text"])
        self.assertIn('data-background="midnight"', admin["text"])

        navigation = self.request("GET", "/")
        self.assertIn('data-theme="night"', navigation["text"])
        self.assertIn('data-accent="cyan"', navigation["text"])

        site_admin = self.request("GET", "/site-admin")
        self.assertIn('data-theme="night"', site_admin["text"])
        self.assertIn('data-accent="cyan"', site_admin["text"])

        links = self.request("GET", "/api/links")
        self.assertEqual(len(links["json"]["links"]), 3)

        created = self.request(
            "POST",
            "/api/links",
            {
                "title": "Codex",
                "url": "https://openai.com/codex",
                "description": "Workspace coding agent",
            },
        )
        self.assertEqual(created["status"], "201 Created")

        updated = self.request(
            "PUT",
            f"/api/links/{created['json']['link']['id']}",
            {
                "title": "Codex App",
                "url": "https://openai.com/codex",
                "description": "Updated title",
            },
        )
        self.assertEqual(updated["status"], "200 OK")
        self.assertEqual(updated["json"]["link"]["title"], "Codex App")

    def test_user_can_import_bookmarks_and_duplicates_are_skipped(self):
        register = self.request(
            "POST",
            "/api/register",
            {"email": "owner@example.com", "password": "Strongpass1"},
        )
        self.cookie = register["headers"]["Set-Cookie"].split(";", 1)[0]

        imported = self.request(
            "POST",
            "/api/links/import",
            {
                "links": [
                    {"title": "Python", "url": "https://www.python.org/"},
                    {"title": "Inbox Duplicate", "url": "https://mail.google.com"},
                    {"title": "Bad", "url": "javascript:alert(1)"},
                    {"title": "", "url": "https://example.com/docs"},
                    {"title": "Python Again", "url": "https://www.python.org/"},
                ],
            },
        )
        self.assertEqual(imported["status"], "201 Created")
        self.assertEqual(imported["json"]["imported_count"], 2)
        self.assertEqual(imported["json"]["skipped_duplicate_count"], 2)
        self.assertEqual(imported["json"]["skipped_invalid_count"], 1)
        self.assertEqual(imported["json"]["links"][0]["position"], 4)
        self.assertEqual(imported["json"]["links"][1]["title"], "example.com")

        links = self.request("GET", "/api/links")
        self.assertEqual(len(links["json"]["links"]), 5)

    def test_oauth_identity_can_link_and_login(self):
        register = self.request(
            "POST",
            "/api/register",
            {"email": "owner@example.com", "password": "Strongpass1"},
        )
        self.cookie = register["headers"]["Set-Cookie"].split(";", 1)[0]

        identity = {
            "provider": "google",
            "provider_user_id": "google-subject-1",
            "email": "owner@example.com",
            "display_name": "Owner",
        }
        with self.app.connect() as conn:
            linked = self.app.attach_oauth_identity(conn, "link", 1, identity)
            self.assertEqual(linked["mode"], "link")

            login = self.app.attach_oauth_identity(conn, "login", None, identity)
            self.assertEqual(login["mode"], "login")
            self.assertTrue(login["session_token"])

    def test_background_must_match_theme(self):
        register = self.request(
            "POST",
            "/api/register",
            {"email": "owner@example.com", "password": "Strongpass1"},
        )
        self.cookie = register["headers"]["Set-Cookie"].split(";", 1)[0]

        invalid = self.request(
            "PUT",
            "/api/user-settings",
            {
                "theme": "night",
                "background": "sunrise",
                "accent": "amber",
                "layout": "cozy",
                "tab_title": "Night Board",
                "admin_heading": "Control center",
                "admin_copy": "Tune your links and text here.",
                "nav_heading": "Launchpad",
                "nav_copy": "Everything important in one place.",
            },
        )
        self.assertEqual(invalid["status"], "400 Bad Request")
        self.assertIn("not available", invalid["json"]["error"])

    def test_global_admin_can_close_registration_manage_defaults_and_transfer_admin(self):
        register = self.request(
            "POST",
            "/api/register",
            {"email": "owner@example.com", "password": "Strongpass1"},
        )
        self.cookie = register["headers"]["Set-Cookie"].split(";", 1)[0]

        config = self.request(
            "PUT",
            "/api/site-admin/config",
            {
                "site_title": "My Portal",
                "registration_open": False,
                "default_user_settings": {
                    "theme": "night",
                    "accent": "pink",
                    "layout": "compact",
                    "background": "midnight",
                    "tab_title": "Portal Start",
                    "admin_heading": "Admin",
                    "admin_copy": "Admin intro copy",
                    "nav_heading": "Nav heading",
                    "nav_copy": "Nav copy",
                },
            },
        )
        self.assertEqual(config["status"], "200 OK")
        self.assertFalse(config["json"]["config"]["registration_open"])
        self.assertEqual(config["json"]["config"]["site_title"], "My Portal")

        blocked = self.request(
            "POST",
            "/api/register",
            {"email": "new@example.com", "password": "Strongpass1"},
            cookie=None,
        )
        self.assertEqual(blocked["status"], "403 Forbidden")

        created_account = self.request(
            "POST",
            "/api/site-admin/accounts",
            {"email": "member@example.com", "password": "Strongpass1"},
        )
        self.assertEqual(created_account["status"], "201 Created")
        self.assertFalse(created_account["json"]["account"]["is_admin"])

        links_before = self.request("GET", "/api/site-admin/default-links")
        created_default_link = self.request(
            "POST",
            "/api/site-admin/default-links",
            {
                "title": "News",
                "url": "https://news.ycombinator.com",
                "description": "Daily reading",
            },
        )
        self.assertEqual(created_default_link["status"], "201 Created")

        custom_icon = self.request(
            "PUT",
            f"/api/site-admin/default-links/{created_default_link['json']['link']['id']}",
            {
                "title": "News",
                "url": "https://news.ycombinator.com",
                "description": "Daily reading",
                "icon_mode": "custom",
                "icon_url": "https://cdn.example.com/news.png",
            },
        )
        self.assertEqual(custom_icon["status"], "200 OK")
        self.assertEqual(custom_icon["json"]["link"]["icon_mode"], "custom")
        self.assertEqual(custom_icon["json"]["link"]["icon_url"], "https://cdn.example.com/news.png")

        reset_icon = self.request(
            "PUT",
            f"/api/site-admin/default-links/{created_default_link['json']['link']['id']}",
            {
                "title": "News",
                "url": "https://news.ycombinator.com",
                "description": "Daily reading",
                "icon_mode": "favicon",
                "icon_url": "",
            },
        )
        self.assertEqual(reset_icon["status"], "200 OK")
        self.assertEqual(reset_icon["json"]["link"]["icon_mode"], "favicon")
        self.assertIn("/api/favicon", reset_icon["json"]["link"]["icon_url"])

        links_after = self.request("GET", "/api/site-admin/default-links")
        self.assertEqual(len(links_after["json"]["links"]), len(links_before["json"]["links"]) + 1)

        transfer = self.request(
            "PUT",
            f"/api/site-admin/accounts/{created_account['json']['account']['id']}",
            {"transfer_admin": True},
        )
        self.assertEqual(transfer["status"], "200 OK")
        self.assertTrue(transfer["json"]["account"]["is_admin"])

        member_login = self.request(
            "POST",
            "/api/login",
            {"email": "member@example.com", "password": "Strongpass1"},
            cookie=None,
        )
        member_cookie = member_login["headers"]["Set-Cookie"].split(";", 1)[0]

        accounts = self.request("GET", "/api/site-admin/accounts", cookie=member_cookie)
        admin_accounts = [account for account in accounts["json"]["accounts"] if account["is_admin"]]
        self.assertEqual(len(admin_accounts), 1)
        self.assertEqual(admin_accounts[0]["email"], "member@example.com")

        old_admin_access = self.request("GET", "/site-admin")
        self.assertEqual(old_admin_access["status"], "302 Found")
        self.assertEqual(old_admin_access["headers"]["Location"], "/admin")

    def test_protected_routes_require_authentication(self):
        response = self.request("GET", "/api/links")
        self.assertEqual(response["status"], "400 Bad Request")
        self.assertEqual(response["json"]["error"], "Authentication required.")

        imported = self.request("POST", "/api/links/import", {"links": []})
        self.assertEqual(imported["status"], "400 Bad Request")
        self.assertEqual(imported["json"]["error"], "Authentication required.")

        password = self.request("PUT", "/api/account/password", {})
        self.assertEqual(password["status"], "400 Bad Request")
        self.assertEqual(password["json"]["error"], "Authentication required.")

    def request(self, method, path, payload=None, cookie="USE_STATE"):
        body = b""
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")

        environ = {
            "REQUEST_METHOD": method,
            "PATH_INFO": path,
            "CONTENT_LENGTH": str(len(body)),
            "CONTENT_TYPE": "application/json",
            "wsgi.input": io.BytesIO(body),
            "HTTP_COOKIE": self.cookie if cookie == "USE_STATE" else (cookie or ""),
        }

        captured = {}

        def start_response(status, headers):
            captured["status"] = status
            captured["headers"] = dict(headers)

        response_body = b"".join(self.app(environ, start_response))
        captured["text"] = response_body.decode("utf-8")
        if captured["headers"].get("Content-Type", "").startswith("application/json"):
            captured["json"] = json.loads(captured["text"])
        return captured


if __name__ == "__main__":
    unittest.main()
