import asyncio
import os
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from yt_dlp import YoutubeDL
from ytmusicapi import YTMusic


BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"
STREAM_CACHE_TTL = 4 * 60 * 60


class APIError(Exception):
    def __init__(self, status_code: int, message: str) -> None:
        self.status_code = status_code
        self.message = message
        super().__init__(message)


class StreamResponse(BaseModel):
    url: str
    expiresIn: int


class StreamCache:
    def __init__(self, ttl_seconds: int) -> None:
        self.ttl_seconds = ttl_seconds
        self._data: dict[str, tuple[float, dict[str, Any]]] = {}
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> dict[str, Any] | None:
        async with self._lock:
            cached = self._data.get(key)
            if not cached:
                return None
            expires_at, payload = cached
            if time.time() >= expires_at:
                self._data.pop(key, None)
                return None
            return payload

    async def set(self, key: str, payload: dict[str, Any]) -> None:
        async with self._lock:
            self._data[key] = (time.time() + self.ttl_seconds, payload)


app = FastAPI(
    title="Personal Music Streaming Platform",
    description="FastAPI backend for YouTube Music search and audio streaming.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

stream_cache = StreamCache(ttl_seconds=STREAM_CACHE_TTL)


def _auth_file() -> Path | None:
    for name in ("headers_auth.json", "browser_auth.json", "oauth.json"):
        candidate = BASE_DIR / name
        if candidate.exists():
            return candidate
    return None


def get_ytmusic_public_client() -> YTMusic:
    return YTMusic()


def get_ytmusic_client() -> YTMusic:
    auth_path = _auth_file()
    if auth_path:
        return YTMusic(str(auth_path))
    return YTMusic()


def get_ytmusic_client_required() -> YTMusic:
    auth_path = _auth_file()
    if not auth_path:
        raise APIError(
            503,
            "YouTube Music authentication is not configured. Follow the README to add headers_auth.json.",
        )
    return YTMusic(str(auth_path))


def pick_thumbnail(item: dict[str, Any]) -> str:
    thumbnails = item.get("thumbnails") or []
    if not thumbnails:
        return ""
    return thumbnails[-1].get("url", "")


def normalize_song(item: dict[str, Any]) -> dict[str, Any]:
    artists = item.get("artists") or []
    album = item.get("album") or {}
    return {
        "videoId": item.get("videoId"),
        "title": item.get("title") or "Unknown title",
        "artist": ", ".join(artist.get("name", "") for artist in artists if artist.get("name")) or "Unknown artist",
        "artistId": artists[0].get("id") if artists else None,
        "album": album.get("name") or "",
        "albumId": album.get("id"),
        "thumbnail": pick_thumbnail(item),
        "duration": item.get("duration") or item.get("duration_seconds") or "",
    }


def normalize_playlist_track(item: dict[str, Any]) -> dict[str, Any]:
    artists = item.get("artists") or []
    album = item.get("album") or {}
    thumbnails = item.get("thumbnails") or []
    return {
        "videoId": item.get("videoId"),
        "title": item.get("title") or "Unknown title",
        "artist": ", ".join(artist.get("name", "") for artist in artists if artist.get("name")) or "Unknown artist",
        "artistId": artists[0].get("id") if artists else None,
        "album": album.get("name") or "",
        "albumId": album.get("id"),
        "thumbnail": thumbnails[-1].get("url", "") if thumbnails else "",
        "duration": item.get("duration") or "",
    }


async def run_blocking(func, *args, **kwargs):
    return await asyncio.to_thread(func, *args, **kwargs)


async def api_call(func, *args, **kwargs):
    try:
        return await run_blocking(func, *args, **kwargs)
    except APIError:
        raise
    except Exception as exc:
        raise APIError(502, "The music service is temporarily unavailable. Please try again.") from exc


async def liked_api_call(func, *args, **kwargs):
    try:
        return await run_blocking(func, *args, **kwargs)
    except KeyError as exc:
        raise APIError(
            401,
            "YouTube Music did not accept the current auth headers. Export fresh browser headers and replace headers_auth.json.",
        ) from exc
    except APIError:
        raise
    except Exception as exc:
        raise APIError(502, "The music service is temporarily unavailable. Please try again.") from exc


@app.exception_handler(APIError)
async def api_error_handler(_, exc: APIError):
    return JSONResponse(content={"detail": exc.message}, status_code=exc.status_code)


@app.get("/search")
async def search(q: str = Query(..., min_length=1, max_length=120)):
    query = q.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Enter a search term to find songs.")

    client = get_ytmusic_public_client()
    results = await api_call(client.search, query, filter="songs", limit=25)
    songs = [normalize_song(item) for item in results if item.get("videoId")]
    return {"query": query, "results": songs}


def _extract_stream(video_id: str) -> dict[str, Any]:
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "format": "bestaudio/best",
        "extract_flat": False,
        "cookiefile": os.getenv("YT_DLP_COOKIEFILE"),
        "noplaylist": True,
    }
    with YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(f"https://music.youtube.com/watch?v={video_id}", download=False)
        url = info.get("url")
        if not url:
            raise APIError(404, "Unable to extract an audio stream for this track.")
        return {"url": url, "expiresIn": STREAM_CACHE_TTL}


@app.get("/stream/{video_id}", response_model=StreamResponse)
async def stream(video_id: str):
    cached = await stream_cache.get(video_id)
    if cached:
        return cached

    payload = await api_call(_extract_stream, video_id)
    await stream_cache.set(video_id, payload)
    return payload


@app.get("/playlist/{playlist_id}")
async def playlist(playlist_id: str):
    client = get_ytmusic_public_client()
    data = await api_call(client.get_playlist, playlist_id, limit=100)
    tracks = [normalize_playlist_track(item) for item in data.get("tracks", []) if item.get("videoId")]
    return {
        "id": playlist_id,
        "title": data.get("title") or "Playlist",
        "description": data.get("description") or "",
        "thumbnail": pick_thumbnail(data),
        "tracks": tracks,
    }


@app.get("/liked")
async def liked():
    client = get_ytmusic_client_required()
    songs = await liked_api_call(client.get_liked_songs, 100)
    tracks = [normalize_playlist_track(item) for item in songs.get("tracks", []) if item.get("videoId")]
    return {"title": "Liked Songs", "tracks": tracks}


@app.get("/artist/{artist_id}")
async def artist(artist_id: str):
    client = get_ytmusic_public_client()
    data = await api_call(client.get_artist, artist_id)
    top_tracks = [
        normalize_playlist_track(item)
        for item in (data.get("songs", {}).get("results") or [])
        if item.get("videoId")
    ]
    return {
        "id": artist_id,
        "name": data.get("name") or "Artist",
        "description": data.get("description") or "",
        "subscribers": data.get("subscribers") or "",
        "thumbnail": pick_thumbnail(data),
        "topSongs": top_tracks,
    }


@app.get("/health")
async def health():
    return {"status": "ok"}


if FRONTEND_DIR.exists():
    app.mount("/frontend", StaticFiles(directory=FRONTEND_DIR), name="frontend")


@app.get("/")
async def root():
    index_path = FRONTEND_DIR / "index.html"
    if not index_path.exists():
        raise HTTPException(status_code=404, detail="Frontend is missing.")
    return FileResponse(index_path)
