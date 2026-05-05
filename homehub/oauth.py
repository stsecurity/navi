import copy
import json
from urllib.parse import urlencode
from urllib.request import Request, urlopen


DEFAULT_OAUTH_SETTINGS = {
    "external_base_url": "",
    "google": {
        "enabled": False,
        "client_id": "",
        "client_secret": "",
    },
    "github": {
        "enabled": False,
        "client_id": "",
        "client_secret": "",
    },
    "nextcloud": {
        "enabled": False,
        "base_url": "",
        "client_id": "",
        "client_secret": "",
    },
}

PROVIDER_LABELS = {
    "google": "Google",
    "github": "GitHub",
    "nextcloud": "Nextcloud",
}

PROVIDER_ORDER = ["google", "github", "nextcloud"]


def validate_oauth_settings(payload):
    settings = copy.deepcopy(DEFAULT_OAUTH_SETTINGS)
    payload = payload or {}
    settings["external_base_url"] = str(payload.get("external_base_url", "") or "").strip().rstrip("/")

    for provider in PROVIDER_ORDER:
        current = settings[provider]
        incoming = payload.get(provider, {}) or {}
        current["enabled"] = bool(incoming.get("enabled", current["enabled"]))
        for key in current.keys():
            if key == "enabled":
                continue
            current[key] = str(incoming.get(key, current[key]) or "").strip()

        if current["enabled"]:
            if provider in {"google", "github"}:
                if not current["client_id"] or not current["client_secret"]:
                    raise ValueError(f"{PROVIDER_LABELS[provider]} OAuth needs client ID and client secret.")
            elif provider == "nextcloud":
                if not current["base_url"] or not current["client_id"] or not current["client_secret"]:
                    raise ValueError("Nextcloud OAuth needs base URL, client ID, and client secret.")
                current["base_url"] = current["base_url"].rstrip("/")

    return settings


def configured_providers(settings):
    providers = []
    for provider in PROVIDER_ORDER:
        config = settings.get(provider, {})
        if not config.get("enabled"):
            continue
        if provider in {"google", "github"} and config.get("client_id") and config.get("client_secret"):
            providers.append(provider)
        if provider == "nextcloud" and config.get("base_url") and config.get("client_id") and config.get("client_secret"):
            providers.append(provider)
    return providers


def provider_label(provider):
    return PROVIDER_LABELS.get(provider, provider.title())


def provider_redirect_uri(provider, base_url):
    return f"{base_url.rstrip('/')}/oauth/{provider}/callback"


def provider_authorize_url(provider, settings, base_url, state_token):
    redirect_uri = provider_redirect_uri(provider, base_url)
    if provider == "google":
        query = urlencode(
            {
                "client_id": settings["google"]["client_id"],
                "redirect_uri": redirect_uri,
                "response_type": "code",
                "scope": "openid email profile",
                "state": state_token,
                "prompt": "select_account",
            }
        )
        return f"https://accounts.google.com/o/oauth2/v2/auth?{query}"
    if provider == "github":
        query = urlencode(
            {
                "client_id": settings["github"]["client_id"],
                "redirect_uri": redirect_uri,
                "scope": "read:user user:email",
                "state": state_token,
            }
        )
        return f"https://github.com/login/oauth/authorize?{query}"
    if provider == "nextcloud":
        query = urlencode(
            {
                "client_id": settings["nextcloud"]["client_id"],
                "redirect_uri": redirect_uri,
                "response_type": "code",
                "state": state_token,
            }
        )
        return f"{settings['nextcloud']['base_url']}/index.php/apps/oauth2/authorize?{query}"
    raise ValueError("Unsupported provider.")


def exchange_code_for_identity(provider, settings, base_url, code):
    redirect_uri = provider_redirect_uri(provider, base_url)
    if provider == "google":
        token = post_form_json(
            "https://oauth2.googleapis.com/token",
            {
                "client_id": settings["google"]["client_id"],
                "client_secret": settings["google"]["client_secret"],
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": redirect_uri,
            },
        )
        profile = get_json(
            "https://openidconnect.googleapis.com/v1/userinfo",
            headers={"Authorization": f"Bearer {token['access_token']}"},
        )
        return {
            "provider": "google",
            "provider_user_id": str(profile["sub"]),
            "email": profile.get("email", "").strip().lower(),
            "display_name": profile.get("name") or profile.get("email") or "Google user",
        }
    if provider == "github":
        token = post_form_json(
            "https://github.com/login/oauth/access_token",
            {
                "client_id": settings["github"]["client_id"],
                "client_secret": settings["github"]["client_secret"],
                "code": code,
                "redirect_uri": redirect_uri,
            },
            extra_headers={"Accept": "application/json"},
        )
        access_token = token["access_token"]
        user = get_json(
            "https://api.github.com/user",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/vnd.github+json",
                "User-Agent": "HomeHub/1.0",
            },
        )
        email = (user.get("email") or "").strip().lower()
        if not email:
            emails = get_json(
                "https://api.github.com/user/emails",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/vnd.github+json",
                    "User-Agent": "HomeHub/1.0",
                },
            )
            primary = next((item for item in emails if item.get("primary") and item.get("verified")), None)
            fallback = next((item for item in emails if item.get("verified")), None)
            chosen = primary or fallback or (emails[0] if emails else {})
            email = str(chosen.get("email", "")).strip().lower()
        return {
            "provider": "github",
            "provider_user_id": str(user["id"]),
            "email": email,
            "display_name": user.get("name") or user.get("login") or email or "GitHub user",
        }
    if provider == "nextcloud":
        token = post_form_json(
            f"{settings['nextcloud']['base_url']}/index.php/apps/oauth2/api/v1/token",
            {
                "client_id": settings["nextcloud"]["client_id"],
                "client_secret": settings["nextcloud"]["client_secret"],
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": redirect_uri,
            },
        )
        access_token = token["access_token"]
        profile = get_json(
            f"{settings['nextcloud']['base_url']}/ocs/v2.php/cloud/user?format=json",
            headers={
                "Authorization": f"Bearer {access_token}",
                "OCS-APIRequest": "true",
                "Accept": "application/json",
                "User-Agent": "HomeHub/1.0",
            },
        )
        user = profile.get("ocs", {}).get("data", {})
        return {
            "provider": "nextcloud",
            "provider_user_id": str(user.get("id") or user.get("email") or ""),
            "email": str(user.get("email", "")).strip().lower(),
            "display_name": user.get("display-name") or user.get("id") or user.get("email") or "Nextcloud user",
        }
    raise ValueError("Unsupported provider.")


def post_form_json(url, data, extra_headers=None):
    body = urlencode(data).encode("utf-8")
    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "User-Agent": "HomeHub/1.0",
    }
    if extra_headers:
        headers.update(extra_headers)
    request = Request(url, data=body, headers=headers, method="POST")
    with urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def get_json(url, headers=None):
    request = Request(
        url,
        headers=headers or {
            "Accept": "application/json",
            "User-Agent": "HomeHub/1.0",
        },
    )
    with urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))
