# Personal Music Streaming Platform

A full-stack personal music streaming app powered by `FastAPI`, `ytmusicapi`, and `yt-dlp`.

## Features

- Song search through YouTube Music
- Audio stream URL extraction with 4-hour in-memory caching
- Artist and playlist views
- Liked songs support through authenticated YouTube Music access
- Single-page frontend with queue, playlists, likes, history, toasts, and responsive player controls

## Setup

1. Create and activate a virtual environment.
2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Configure YouTube Music authentication for personal library access.

## ytmusicapi Auth Setup

`/search`, `/playlist/{playlistId}`, and `/artist/{artistId}` can work without authentication. `/liked` requires an authenticated `ytmusicapi` session.

1. Install the browser extension recommended by `ytmusicapi` for exporting request headers.
2. Open `https://music.youtube.com`.
3. Export headers and save the file as `headers_auth.json` in the project root beside `main.py`.

If you use cookies with `yt-dlp` for restricted tracks, set:

```bash
set YT_DLP_COOKIEFILE=C:\path\to\cookies.txt
```

## Run

```bash
uvicorn main:app --reload
```

Open `http://127.0.0.1:8000/`.

## API Endpoints

- `GET /search?q={query}`
- `GET /stream/{videoId}`
- `GET /playlist/{playlistId}`
- `GET /liked`
- `GET /artist/{artistId}`
- `GET /health`

## Notes

- Stream URLs are cached in memory for 4 hours.
- Local playlists, likes, queue, and recently played data are stored in browser `localStorage`.
- CORS is enabled for local frontend access.
