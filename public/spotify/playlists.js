/* =========================================================
   BEATPLAY — PLAYLISTS DEL USUARIO
   Mismos nombres de funciones que antes.
   Cada tarjeta lleva las dos convenciones de clase
   (.playlist y .playlist-card) para que el CSS aplique
   venga de donde venga.
========================================================= */

let playlists = [];
let selectedPlaylist = null;


// =====================================================
// UTILIDADES
// =====================================================

const $playlist = id => document.getElementById(id);

function setPlaylistStatus(text) {
    const status = $playlist("playlistStatus");
    if (status) status.textContent = text;
}

async function playlistApi(url) {

    const response = await fetch(url);

    let data = null;

    try {
        data = await response.json();
    } catch {
        data = null;
    }

    if (!response.ok) {
        throw new Error(
            data?.error || "No se pudo contactar con el servidor."
        );
    }

    return data;
}


// =====================================================
// CARGA
// =====================================================

async function loadPlaylists() {

    const container = $playlist("playlistList");

    if (!container) return [];

    setPlaylistStatus("Cargando playlists…");

    try {
        const data = await playlistApi("/api/playlists");

        if (!Array.isArray(data)) {
            throw new Error("La respuesta de playlists no es válida.");
        }

        playlists = data;

        renderPlaylists();

        window.updateStartButton?.();

        return playlists;

    } catch (error) {

        console.error("Playlists:", error);

        container.textContent = "";
        container.appendChild(
            createMessage("No se pudieron cargar tus playlists.")
        );

        setPlaylistStatus("Error");

        throw error;
    }
}


function createMessage(text) {

    const message = document.createElement("p");

    message.className = "playlistEmpty playlist-empty";
    message.textContent = text;

    return message;
}


// =====================================================
// RENDER
// =====================================================

function renderPlaylists() {

    const container = $playlist("playlistList");

    if (!container) return;

    container.textContent = "";

    if (!playlists.length) {

        container.appendChild(
            createMessage("No tienes playlists con canciones.")
        );

        setPlaylistStatus("0 playlists");
        return;
    }

    const fragment = document.createDocumentFragment();

    for (const playlist of playlists) {

        const card = document.createElement("button");

        card.type = "button";
        card.className = "playlist playlist-card";
        card.dataset.id = playlist.id;

        card.classList.toggle(
            "selected",
            selectedPlaylist?.id === playlist.id
        );

        if (playlist.image) {

            const image = document.createElement("img");

            image.src = playlist.image;
            image.alt = "";
            image.loading = "lazy";

            card.appendChild(image);
        }

        const info = document.createElement("span");
        info.className = "playlist-card-info";

        const name = document.createElement("span");
        name.className = "playlistName playlist-card-name";
        name.textContent = playlist.name || "Sin nombre";

        const tracks = document.createElement("span");
        tracks.className = "playlistTracks playlist-card-tracks";
        tracks.textContent = `${playlist.tracks || 0} canciones`;

        info.append(name, tracks);
        card.appendChild(info);

        card.addEventListener("click", () => selectPlaylist(playlist));

        fragment.appendChild(card);
    }

    container.appendChild(fragment);

    setPlaylistStatus(
        `${playlists.length} playlist${playlists.length === 1 ? "" : "s"}`
    );
}


// =====================================================
// SELECCIÓN
// =====================================================

function selectPlaylist(playlist) {

    selectedPlaylist = playlist;

    document
        .querySelectorAll(".playlist, .playlist-card")
        .forEach(card =>
            card.classList.toggle(
                "selected",
                card.dataset.id === playlist.id
            )
        );

    if (typeof window.updateStartButton === "function") {
        window.updateStartButton();
        return;
    }

    const selectedText = $playlist("selectedText");

    if (selectedText) {
        selectedText.textContent = playlist.name;
    }
}


function getSelectedPlaylist() {
    return selectedPlaylist;
}


// =====================================================
// CANCIONES
// =====================================================

function normalizeTrack(track) {

    const year = Number(track.year);

    return {
        id: track.id,
        uri: track.uri,
        name: track.name,
        artist: track.artist || "",
        album: track.album || "",
        year: Number.isInteger(year) ? year : null,
        cover: track.cover || null
    };
}


function normalizeTracks(data) {

    if (!Array.isArray(data)) {
        throw new Error("La respuesta de canciones no es válida.");
    }

    return data
        .filter(track => track?.uri && track?.name)
        .map(normalizeTrack);
}


async function getPlaylistTracks(playlistId) {

    if (!playlistId) {
        throw new Error("Falta el ID de la playlist.");
    }

    return normalizeTracks(
        await playlistApi(
            `/api/playlists/${encodeURIComponent(playlistId)}/tracks`
        )
    );
}


async function getPlaylistCatalog(playlistId) {

    if (!playlistId) {
        throw new Error("Falta el ID de la playlist.");
    }

    return normalizeTracks(
        await playlistApi(
            `/api/playlists/${encodeURIComponent(playlistId)}/catalog`
        )
    );
}


async function getHipsterTracks(playlistId) {

    const url = playlistId
        ? `/api/playlists/${encodeURIComponent(playlistId)}/hipster`
        : "/api/hipster/tracks";

    return normalizeTracks(await playlistApi(url));
}


async function getSelectedPlaylistTracks() {

    if (!selectedPlaylist) {
        throw new Error("No hay ninguna playlist seleccionada.");
    }

    return getPlaylistTracks(selectedPlaylist.id);
}


// =====================================================
// EXPORTS
// =====================================================

window.loadPlaylists = loadPlaylists;
window.renderPlaylists = renderPlaylists;
window.selectPlaylist = selectPlaylist;
window.getSelectedPlaylist = getSelectedPlaylist;
window.getPlaylistTracks = getPlaylistTracks;
window.getPlaylistCatalog = getPlaylistCatalog;
window.getHipsterTracks = getHipsterTracks;
window.getSelectedPlaylistTracks = getSelectedPlaylistTracks;