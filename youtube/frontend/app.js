const API_BASE = "";
const STORAGE_KEYS = {
  liked: "pulse-liked-songs",
  playlists: "pulse-local-playlists",
  recent: "pulse-recently-played",
  queue: "pulse-queue",
  volume: "pulse-volume",
};

const state = {
  route: "home",
  currentViewId: null,
  searchQuery: "",
  searchResults: [],
  loading: false,
  nowPlaying: null,
  queue: loadStorage(STORAGE_KEYS.queue, []),
  liked: loadStorage(STORAGE_KEYS.liked, []),
  recent: loadStorage(STORAGE_KEYS.recent, []),
  playlists: loadStorage(STORAGE_KEYS.playlists, [
    { id: crypto.randomUUID(), name: "Late Night Rotation", tracks: [] },
  ]),
  shuffle: false,
  repeat: false,
};

const elements = {
  content: document.getElementById("content"),
  globalSearch: document.getElementById("global-search"),
  navLinks: [...document.querySelectorAll(".nav-link")],
  libraryList: document.getElementById("library-list"),
  queueList: document.getElementById("queue-list"),
  queueDrawer: document.getElementById("queue-drawer"),
  queueCount: document.getElementById("queue-count"),
  toastRoot: document.getElementById("toast-root"),
  audio: document.getElementById("audio-player"),
  playerThumb: document.getElementById("player-thumb"),
  playerTitle: document.getElementById("player-title"),
  playerArtist: document.getElementById("player-artist"),
  playBtn: document.getElementById("play-btn"),
  prevBtn: document.getElementById("prev-btn"),
  nextBtn: document.getElementById("next-btn"),
  shuffleBtn: document.getElementById("shuffle-btn"),
  repeatBtn: document.getElementById("repeat-btn"),
  progressBar: document.getElementById("progress-bar"),
  currentTime: document.getElementById("current-time"),
  durationTime: document.getElementById("duration-time"),
  volumeBar: document.getElementById("volume-bar"),
  likeCurrentBtn: document.getElementById("like-current-btn"),
  likedSyncBtn: document.getElementById("liked-sync-btn"),
};

function loadStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function persistState() {
  saveStorage(STORAGE_KEYS.queue, state.queue);
  saveStorage(STORAGE_KEYS.liked, state.liked);
  saveStorage(STORAGE_KEYS.recent, state.recent);
  saveStorage(STORAGE_KEYS.playlists, state.playlists);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

function escapeHtml(value = "") {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function showToast(message, kind = "info") {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  if (kind === "error") toast.style.borderColor = "rgba(239, 68, 68, 0.45)";
  elements.toastRoot.appendChild(toast);
  window.setTimeout(() => toast.remove(), 2600);
}

async function apiGet(path) {
  const response = await fetch(`${API_BASE}${path}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || "Something went wrong.");
  return data;
}

function isLiked(track) {
  return state.liked.some((item) => item.videoId === track.videoId);
}

function toggleLike(track) {
  if (!track?.videoId) return;
  const exists = isLiked(track);
  state.liked = exists
    ? state.liked.filter((item) => item.videoId !== track.videoId)
    : [track, ...state.liked].slice(0, 500);
  persistState();
  renderLibrarySidebar();
  updatePlayerUI();
  renderCurrentRoute();
  showToast(exists ? "Removed from liked songs" : "Added to liked songs");
}

function addToRecent(track) {
  state.recent = [track, ...state.recent.filter((item) => item.videoId !== track.videoId)].slice(0, 40);
  persistState();
}

function enqueue(track, notify = true) {
  state.queue.push(track);
  persistState();
  renderQueue();
  if (notify) showToast(`Queued ${track.title}`);
}

function removeFromQueue(videoId) {
  state.queue = state.queue.filter((item) => item.videoId !== videoId);
  persistState();
  renderQueue();
}

async function playTrack(track) {
  if (!track?.videoId) return;
  state.nowPlaying = track;
  updatePlayerUI();
  addToRecent(track);
  renderCurrentRoute();
  elements.playBtn.textContent = "...";

  try {
    const data = await apiGet(`/stream/${encodeURIComponent(track.videoId)}`);
    elements.audio.src = data.url;
    await elements.audio.play();
    elements.playBtn.textContent = "❚❚";
    showToast(`Now playing ${track.title}`);
  } catch (error) {
    elements.playBtn.textContent = "▶";
    showToast(error.message || "Unable to play this track right now.", "error");
  }
}

function playNextTrack() {
  if (!state.queue.length && !state.repeat) {
    elements.audio.pause();
    elements.playBtn.textContent = "▶";
    return;
  }
  if (state.repeat && state.nowPlaying) {
    playTrack(state.nowPlaying);
    return;
  }
  const nextIndex = state.shuffle ? Math.floor(Math.random() * state.queue.length) : 0;
  const [nextTrack] = state.queue.splice(nextIndex, 1);
  persistState();
  renderQueue();
  if (nextTrack) playTrack(nextTrack);
}

function playPreviousTrack() {
  const previous = state.recent[1];
  if (previous) playTrack(previous);
}

function updatePlayerUI() {
  const track = state.nowPlaying;
  elements.playerThumb.src = track?.thumbnail || "";
  elements.playerTitle.textContent = track?.title || "Nothing playing";
  elements.playerArtist.textContent = track?.artist || "Choose a song to start";
  elements.likeCurrentBtn.textContent = track && isLiked(track) ? "♥" : "♡";
  elements.shuffleBtn.style.opacity = state.shuffle ? "1" : "0.6";
  elements.repeatBtn.style.opacity = state.repeat ? "1" : "0.6";
}

function openQueueDrawer(open) {
  elements.queueDrawer.classList.toggle("hidden", !open);
}

function renderQueue() {
  elements.queueCount.textContent = `${state.queue.length} song${state.queue.length === 1 ? "" : "s"} waiting`;
  if (!state.queue.length) {
    elements.queueList.innerHTML = `<div class="empty-state">Your queue is empty.</div>`;
    return;
  }

  elements.queueList.innerHTML = state.queue.map((track) => `
    <article class="song-row">
      <img src="${escapeHtml(track.thumbnail || "")}" alt="">
      <div class="song-meta">
        <h3>${escapeHtml(track.title)}</h3>
        <p>${escapeHtml(track.artist)} • ${escapeHtml(track.album || "Single")}</p>
      </div>
      <div class="song-actions">
        <button class="ghost-btn" data-action="play-track" data-id="${escapeHtml(track.videoId)}">Play</button>
        <button class="ghost-btn" data-action="remove-queue" data-id="${escapeHtml(track.videoId)}">Remove</button>
      </div>
    </article>
  `).join("");
}

function renderLibrarySidebar() {
  const staticItems = [
    { label: "Liked Songs", route: "library", view: "liked" },
    { label: "Recently Played", route: "library", view: "recent" },
  ];
  const staticMarkup = staticItems.map((item) => `
    <button class="nav-link ${state.route === item.route && state.currentViewId === item.view ? "active" : ""}" data-route="${item.route}" data-view="${item.view}">
      ${item.label}
    </button>
  `).join("");

  const playlistsMarkup = state.playlists.map((playlist) => `
    <button class="nav-link ${state.route === "playlist" && state.currentViewId === playlist.id ? "active" : ""}" data-route="playlist" data-view="${playlist.id}">
      ${escapeHtml(playlist.name)}
    </button>
  `).join("");

  elements.libraryList.innerHTML = staticMarkup + playlistsMarkup;
}

function renderSkeleton(rows = 6) {
  return `
    <div class="card glass-panel">
      <div class="song-list">
        ${Array.from({ length: rows }, () => `<div class="song-row skeleton" style="height: 86px;"></div>`).join("")}
      </div>
    </div>
  `;
}

function renderHero() {
  return `
    <section class="hero-card glass-panel">
      <div class="hero-copy">
        <p class="eyebrow">Sharper than a tab jungle</p>
        <h2>Your personal streaming cockpit.</h2>
        <p>Fast song search, persistent local collections, and a queue-first player without the clutter.</p>
        <div class="prompt-row">
          <button class="primary-btn" data-route-jump="search">Search Music</button>
          <button class="ghost-btn" data-route-jump="library">Open Library</button>
        </div>
      </div>
      <div class="hero-stats">
        <div class="stat"><p class="eyebrow">Liked songs</p><h2>${state.liked.length}</h2></div>
        <div class="stat"><p class="eyebrow">Playlists</p><h2>${state.playlists.length}</h2></div>
        <div class="stat"><p class="eyebrow">Recent plays</p><h2>${state.recent.length}</h2></div>
        <div class="stat"><p class="eyebrow">Queue size</p><h2>${state.queue.length}</h2></div>
      </div>
    </section>
  `;
}

function trackRow(track, options = {}) {
  const liked = isLiked(track);
  const playlistOptions = state.playlists.map((playlist) => `
    <button class="ghost-btn" data-action="add-to-playlist" data-id="${escapeHtml(track.videoId)}" data-playlist="${playlist.id}">
      ${escapeHtml(playlist.name)}
    </button>
  `).join("");

  return `
    <article class="song-row">
      <img src="${escapeHtml(track.thumbnail || "")}" alt="${escapeHtml(track.title)}">
      <div class="song-meta">
        <h3>${escapeHtml(track.title)}</h3>
        <p>${escapeHtml(track.artist)} • ${escapeHtml(track.album || "Single")} ${track.duration ? `• ${escapeHtml(track.duration.toString())}` : ""}</p>
      </div>
      <div class="song-actions">
        <button class="play-btn" data-action="play-track" data-id="${escapeHtml(track.videoId)}">▶</button>
        ${track.artistId ? `<button class="ghost-btn" data-action="open-artist" data-artist="${escapeHtml(track.artistId)}">Artist</button>` : ""}
        <button class="ghost-btn" data-action="queue-track" data-id="${escapeHtml(track.videoId)}">Queue</button>
        <button class="ghost-btn" data-action="like-track" data-id="${escapeHtml(track.videoId)}">${liked ? "♥" : "♡"}</button>
        ${options.hidePlaylistActions ? "" : `<div class="chip">${playlistOptions || "Create a playlist to save songs"}</div>`}
      </div>
    </article>
  `;
}

function getTrackLookup() {
  const index = new Map();
  [
    ...state.searchResults,
    ...state.queue,
    ...state.liked,
    ...state.recent,
    ...state.playlists.flatMap((playlist) => playlist.tracks),
    ...(state.nowPlaying ? [state.nowPlaying] : []),
  ].forEach((track) => {
    if (track?.videoId) index.set(track.videoId, track);
  });
  return index;
}

async function renderHome() {
  const recentRows = state.recent.length
    ? state.recent.slice(0, 8).map((track) => trackRow(track, { hidePlaylistActions: true })).join("")
    : `<div class="empty-state">Start playing music and your recent history will show up here.</div>`;

  const playlistCards = state.playlists.length
    ? state.playlists.map((playlist) => `
      <article class="playlist-card glass-panel">
        <div class="page-head">
          <div>
            <h3>${escapeHtml(playlist.name)}</h3>
            <p>${playlist.tracks.length} tracks saved locally</p>
          </div>
          <button class="ghost-btn" data-route-jump="playlist" data-view="${playlist.id}">Open</button>
        </div>
      </article>
    `).join("")
    : `<div class="empty-state">Create a playlist to start curating your own library.</div>`;

  elements.content.innerHTML = `
    ${renderHero()}
    <section class="card glass-panel">
      <div class="page-head">
        <h2>Recently Played</h2>
        <p class="muted">Resume from where you left off.</p>
      </div>
      <div class="song-list">${recentRows}</div>
    </section>
    <section class="card glass-panel">
      <div class="page-head">
        <h2>Your Playlists</h2>
        <button class="ghost-btn" id="inline-playlist-btn">Create Playlist</button>
      </div>
      <div class="grid">${playlistCards}</div>
    </section>
  `;
}

async function renderSearch() {
  const heading = state.searchQuery ? `Results for "${escapeHtml(state.searchQuery)}"` : "Search for tracks";
  const body = state.loading
    ? renderSkeleton()
    : state.searchResults.length
      ? `<div class="card glass-panel"><div class="song-list">${state.searchResults.map((track) => trackRow(track)).join("")}</div></div>`
      : `<div class="card glass-panel"><div class="empty-state">Type in the search bar to find songs, artists, and albums.</div></div>`;

  elements.content.innerHTML = `
    <section class="page-head">
      <div>
        <h2>${heading}</h2>
        <p class="muted">Real-time search backed by YouTube Music.</p>
      </div>
    </section>
    ${body}
  `;
}

async function renderLibrary() {
  const view = state.currentViewId || "liked";
  let title = "Liked Songs";
  let tracks = state.liked;

  if (view === "recent") {
    title = "Recently Played";
    tracks = state.recent;
  }

  elements.content.innerHTML = `
    <section class="card glass-panel">
      <div class="page-head">
        <div>
          <h2>${title}</h2>
          <p class="muted">Stored locally in your browser.</p>
        </div>
      </div>
      <div class="song-list">
        ${tracks.length ? tracks.map((track) => trackRow(track, { hidePlaylistActions: true })).join("") : `<div class="empty-state">Nothing here yet.</div>`}
      </div>
    </section>
  `;
}

async function renderPlaylistView() {
  const playlist = state.playlists.find((item) => item.id === state.currentViewId);
  if (!playlist) {
    elements.content.innerHTML = `<section class="card glass-panel"><div class="error-state">Playlist not found.</div></section>`;
    return;
  }

  elements.content.innerHTML = `
    <section class="card glass-panel">
      <div class="page-head">
        <div>
          <h2>${escapeHtml(playlist.name)}</h2>
          <p class="muted">${playlist.tracks.length} tracks</p>
        </div>
        <button class="ghost-btn" data-action="delete-playlist" data-playlist="${playlist.id}">Delete</button>
      </div>
      <div class="song-list">
        ${playlist.tracks.length ? playlist.tracks.map((track) => trackRow(track, { hidePlaylistActions: true })).join("") : `<div class="empty-state">Add songs from search results or your library.</div>`}
      </div>
    </section>
  `;
}

async function renderArtistView(artistId) {
  elements.content.innerHTML = renderSkeleton(5);
  try {
    const artist = await apiGet(`/artist/${encodeURIComponent(artistId)}`);
    const songs = artist.topSongs || [];
    elements.content.innerHTML = `
      <section class="hero-card glass-panel">
        <div class="hero-copy">
          <p class="eyebrow">Artist</p>
          <h2>${escapeHtml(artist.name)}</h2>
          <p>${escapeHtml(artist.description || "Top tracks and artist profile.")}</p>
          <p class="muted">${escapeHtml(artist.subscribers || "")}</p>
        </div>
        <div class="hero-stats">
          <div class="stat"><p class="eyebrow">Top songs</p><h2>${songs.length}</h2></div>
        </div>
      </section>
      <section class="card glass-panel">
        <div class="song-list">
          ${songs.length ? songs.map((track) => trackRow(track)).join("") : `<div class="empty-state">No top songs found.</div>`}
        </div>
      </section>
    `;
  } catch (error) {
    elements.content.innerHTML = `<section class="card glass-panel"><div class="error-state">${escapeHtml(error.message)}</div></section>`;
  }
}

async function renderCurrentRoute() {
  elements.navLinks.forEach((button) => {
    button.classList.toggle("active", button.dataset.route === state.route);
  });

  renderLibrarySidebar();

  if (state.route === "home") return renderHome();
  if (state.route === "search") return renderSearch();
  if (state.route === "library") return renderLibrary();
  if (state.route === "playlist") return renderPlaylistView();
  if (state.route === "artist") return renderArtistView(state.currentViewId);
}

async function performSearch(query) {
  state.route = "search";
  state.searchQuery = query;
  state.loading = true;
  renderCurrentRoute();

  if (!query.trim()) {
    state.searchResults = [];
    state.loading = false;
    renderCurrentRoute();
    return;
  }

  try {
    const data = await apiGet(`/search?q=${encodeURIComponent(query.trim())}`);
    state.searchResults = data.results || [];
  } catch (error) {
    state.searchResults = [];
    showToast(error.message || "Search failed.", "error");
  } finally {
    state.loading = false;
    renderCurrentRoute();
  }
}

function createPlaylistPrompt() {
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `
    <div class="modal-card glass-panel">
      <h2>Create Playlist</h2>
      <p class="muted">Store a custom playlist in local browser storage.</p>
      <input id="playlist-name-input" placeholder="Weekend drive">
      <div class="prompt-row">
        <button class="primary-btn" id="save-playlist-btn">Save</button>
        <button class="ghost-btn" id="cancel-playlist-btn">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.querySelector("#playlist-name-input").focus();
  modal.querySelector("#cancel-playlist-btn").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.remove();
  });
  modal.querySelector("#save-playlist-btn").addEventListener("click", () => {
    const input = modal.querySelector("#playlist-name-input");
    const name = input.value.trim();
    if (!name) {
      showToast("Enter a playlist name.", "error");
      return;
    }
    state.playlists.unshift({ id: crypto.randomUUID(), name, tracks: [] });
    persistState();
    renderCurrentRoute();
    showToast(`Created ${name}`);
    modal.remove();
  });
}

function addTrackToPlaylist(track, playlistId) {
  const playlist = state.playlists.find((item) => item.id === playlistId);
  if (!playlist) return;
  if (playlist.tracks.some((item) => item.videoId === track.videoId)) {
    showToast("Song is already in that playlist.");
    return;
  }
  playlist.tracks.unshift(track);
  persistState();
  renderCurrentRoute();
  showToast(`Added to ${playlist.name}`);
}

function deletePlaylist(playlistId) {
  const playlist = state.playlists.find((item) => item.id === playlistId);
  state.playlists = state.playlists.filter((item) => item.id !== playlistId);
  persistState();
  state.route = "library";
  state.currentViewId = "liked";
  renderCurrentRoute();
  showToast(`Deleted ${playlist?.name || "playlist"}`);
}

async function syncLikedSongs() {
  elements.likedSyncBtn.disabled = true;
  elements.likedSyncBtn.textContent = "Syncing...";
  try {
    const data = await apiGet("/liked");
    state.liked = data.tracks || [];
    persistState();
    renderCurrentRoute();
    renderLibrarySidebar();
    showToast("Liked songs synced from YouTube Music");
  } catch (error) {
    showToast(error.message || "Unable to sync liked songs.", "error");
  } finally {
    elements.likedSyncBtn.disabled = false;
    elements.likedSyncBtn.textContent = "Sync Liked";
  }
}

function bindEvents() {
  document.body.addEventListener("click", async (event) => {
    const target = event.target.closest("button");
    if (!target) return;

    const route = target.dataset.route;
    const routeJump = target.dataset.routeJump;
    const action = target.dataset.action;
    const view = target.dataset.view;
    const lookup = getTrackLookup();
    const trackId = target.dataset.id;
    const track = trackId ? lookup.get(trackId) : null;

    if (route || routeJump) {
      state.route = route || routeJump;
      state.currentViewId = view || (state.route === "library" ? "liked" : null);
      renderCurrentRoute();
      return;
    }

    if (target.id === "new-playlist-btn" || target.id === "inline-playlist-btn") return createPlaylistPrompt();
    if (target.id === "queue-toggle" || target.id === "show-queue-btn") return openQueueDrawer(true);
    if (target.id === "close-queue") return openQueueDrawer(false);
    if (target.id === "liked-sync-btn") return syncLikedSongs();
    if (action === "open-artist" && target.dataset.artist) {
      state.route = "artist";
      state.currentViewId = target.dataset.artist;
      return renderCurrentRoute();
    }
    if (action === "play-track" && track) return playTrack(track);
    if (action === "queue-track" && track) return enqueue(track);
    if (action === "remove-queue" && trackId) return removeFromQueue(trackId);
    if (action === "like-track" && track) return toggleLike(track);
    if (action === "delete-playlist") return deletePlaylist(target.dataset.playlist);
    if (action === "add-to-playlist" && track) return addTrackToPlaylist(track, target.dataset.playlist);
  });

  elements.globalSearch.addEventListener("input", debounce((event) => {
    performSearch(event.target.value);
  }, 280));

  elements.playBtn.addEventListener("click", async () => {
    if (!state.nowPlaying) {
      const fallback = state.queue[0] || state.recent[0] || state.liked[0];
      if (fallback) playTrack(fallback);
      return;
    }
    if (elements.audio.paused) {
      await elements.audio.play();
      elements.playBtn.textContent = "❚❚";
    } else {
      elements.audio.pause();
      elements.playBtn.textContent = "▶";
    }
  });

  elements.prevBtn.addEventListener("click", playPreviousTrack);
  elements.nextBtn.addEventListener("click", playNextTrack);
  elements.shuffleBtn.addEventListener("click", () => {
    state.shuffle = !state.shuffle;
    updatePlayerUI();
  });
  elements.repeatBtn.addEventListener("click", () => {
    state.repeat = !state.repeat;
    updatePlayerUI();
  });
  elements.likeCurrentBtn.addEventListener("click", () => toggleLike(state.nowPlaying));

  elements.audio.addEventListener("timeupdate", () => {
    const { currentTime, duration } = elements.audio;
    elements.currentTime.textContent = formatTime(currentTime);
    elements.durationTime.textContent = formatTime(duration);
    elements.progressBar.value = duration ? (currentTime / duration) * 100 : 0;
  });
  elements.audio.addEventListener("ended", playNextTrack);
  elements.audio.addEventListener("play", () => { elements.playBtn.textContent = "❚❚"; });
  elements.audio.addEventListener("pause", () => {
    if (elements.audio.currentTime < elements.audio.duration) elements.playBtn.textContent = "▶";
  });
  elements.audio.addEventListener("error", () => {
    showToast("Playback failed for this stream.", "error");
    elements.playBtn.textContent = "▶";
  });

  elements.progressBar.addEventListener("input", () => {
    const duration = elements.audio.duration || 0;
    elements.audio.currentTime = (Number(elements.progressBar.value) / 100) * duration;
  });

  const savedVolume = Number(localStorage.getItem(STORAGE_KEYS.volume) || "1");
  elements.audio.volume = savedVolume;
  elements.volumeBar.value = savedVolume;
  elements.volumeBar.addEventListener("input", () => {
    const volume = Number(elements.volumeBar.value);
    elements.audio.volume = volume;
    localStorage.setItem(STORAGE_KEYS.volume, String(volume));
  });
}

function debounce(fn, wait) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => fn(...args), wait);
  };
}

function init() {
  bindEvents();
  renderQueue();
  updatePlayerUI();
  renderCurrentRoute();
}

init();
