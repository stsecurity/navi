# HomeHub

HomeHub is a personal browser start page with a small backend, user authentication, per-user visual settings, and a private collection of links you can manage after signing in.

## Why this project exists

This project is meant to be a clean base for a custom homepage:

- one place for your daily links
- private account-based access
- no external Python dependencies
- easy to extend with categories, widgets, or bookmarks

## Stack

- Frontend: vanilla HTML, CSS, and JavaScript
- Backend: Python WSGI server from the standard library
- Database: SQLite
- Auth: email/password with hashed passwords and cookie sessions
- OAuth: Google, GitHub, and self-hosted Nextcloud

## Project structure

- `app.py` starts the local server
- `homehub/server.py` contains routing, auth, and link APIs
- `homehub/oauth.py` contains third-party login helpers
- `static/` contains the homepage UI
- `tests/test_homehub.py` covers auth and protected link flows
- `deploy/nginx/homehub.conf.template` is the reverse-proxy template

## Pages

- `/` is the actual navigation homepage you can use as your browser start page
- `/admin` is the personal backend page for login, registration, link management, and per-user settings
- `/site-admin` is the global admin page for registration control, accounts, site title, default settings, and default starter links

## Commands

- Install: no install step required for the current version
- Dev: `python app.py`
- Build: no build step required
- Test: `python -m unittest discover -s tests`
- Lint: not configured yet
- Docker: `docker compose up --build`

## Features in this version

- register and log in
- persistent SQLite-backed users and sessions
- private per-user link storage
- add, edit, delete, and search links
- import selected bookmarks from Chrome, Edge, and Firefox exports
- automatic favicon icons for links, with optional custom icon uploads
- third-party sign-in and account linking for Google, GitHub, and self-hosted Nextcloud
- user settings for themes, colors, layout density, backgrounds, page text, and browser tab title
- custom background image uploads for each user
- global admin controls for account creation/removal, registration open or closed, site title, default user settings, and default starter links
- S3 object storage settings for uploaded assets such as icons and custom backgrounds
- the first existing account becomes the global admin automatically
- responsive homepage UI for desktop and mobile

## Next ideas

- categories and drag-to-reorder
- export bookmarks
- background images or themes
- search shortcuts
- browser extension sync

## Deployment notes

- Docker runs the app on port `8000` by default
- `docker-compose.yml` mounts `./data` so the SQLite database survives restarts
- set your public URL and OAuth credentials from `/site-admin`
- use `deploy/nginx/homehub.conf.template` as the reverse-proxy starting point on Debian
