/* =========================================================
   BEATPLAY — REPRODUCTOR (Web Playback SDK)
   Mismos nombres que antes. Ahora la inicialización espera
   de verdad a que el SDK cargue y a que llegue "ready".
   Requiere Spotify Premium.
========================================================= */

let spotifyPlayer = null;
let spotifyDeviceId = null;
let spotifyReady = null;

let resolveDevice = null;

// El SDK invoca esta función cuando termina de cargarse.
const sdkLoaded = new Promise(resolve => {

    if (window.Spotify?.Player) {
        resolve();
        return;
    }

    window.onSpotifyWebPlaybackSDKReady = () => {
        console.log("Spotify Web Playback SDK cargado");
        resolve();
    };
});


// =====================================================
// INICIALIZAR
// =====================================================

function initSpotify() {

    if (!spotifyReady) {

        spotifyReady = initializeSpotify();

        // Si falla, permitimos reintentar más tarde.
        spotifyReady.catch(() => {
            spotifyReady = null;
        });
    }

    return spotifyReady;
}


async function initializeSpotify() {

    const token = await getSpotifyToken();

    await sdkLoaded;

    if (typeof window.Spotify?.Player !== "function") {
        throw new Error("Spotify Web Playback SDK no está disponible.");
    }

    const devicePromise = new Promise((resolve, reject) => {

        resolveDevice = resolve;

        setTimeout(
            () => reject(new Error("El reproductor de Spotify tardó demasiado.")),
            15000
        );
    });

    const player = new window.Spotify.Player({
        name: "BeatPlay",
        volume: 0.5,

        // Se vuelve a pedir el token cada vez que el SDK lo necesita,
        // así una sesión larga no se queda sin autorización.
        getOAuthToken: callback => {
            getSpotifyToken({ force: true })
                .then(callback)
                .catch(error => console.error("Spotify token:", error));
        }
    });

    spotifyPlayer = player;


    // Dispositivo listo

    player.addListener("ready", async ({ device_id }) => {

        spotifyDeviceId = device_id;

        try {
            await transferPlayback(device_id);
        } catch (error) {
            console.error("Transferencia:", error.message);
        }

        resolveDevice?.(device_id);
    });


    player.addListener("not_ready", ({ device_id }) => {
        if (spotifyDeviceId === device_id) {
            spotifyDeviceId = null;
        }
    });


    // Estado de reproducción

    player.addListener("player_state_changed", state => {
        window.onSpotifyGameStateChanged?.(state);
    });


    // Errores

    const logError = (type, message) =>
        console.error(`Spotify ${type}:`, message);

    player.addListener("initialization_error", ({ message }) =>
        logError("initialization", message)
    );

    player.addListener("authentication_error", ({ message }) =>
        logError("authentication", message)
    );

    player.addListener("account_error", () =>
        logError("account", "El reproductor necesita Spotify Premium.")
    );

    player.addListener("playback_error", ({ message }) =>
        logError("playback", message)
    );


    const connected = await player.connect();

    if (!connected) {
        throw new Error("No se pudo conectar con Spotify.");
    }

    const deviceId = await devicePromise;

    return {
        player,
        deviceId,
        ready: true,
        label: "REPRODUCTOR LISTO"
    };
}


// =====================================================
// LLAMADAS AL SERVIDOR
// =====================================================

async function playbackRequest(url, body) {

    const response = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {})
    });

    if (response.ok || response.status === 204) return;

    let message = "Error de reproducción.";

    try {
        message = (await response.json()).error || message;
    } catch {
        /* respuesta sin cuerpo */
    }

    throw new Error(message);
}


function transferPlayback(deviceId) {
    return playbackRequest("/api/transfer", { deviceId });
}


// =====================================================
// PLAYER DISPONIBLE
// =====================================================

async function waitForSpotify() {

    await initSpotify();

    if (!spotifyDeviceId) {
        throw new Error("El reproductor de Spotify no está listo.");
    }

    return spotifyDeviceId;
}


// =====================================================
// REPRODUCCIÓN
// =====================================================

async function playSpotifyTrack(trackUri, positionMs = 0) {

    if (!trackUri) {
        throw new Error("Falta la URI de la canción.");
    }

    const deviceId = await waitForSpotify();

    await playbackRequest("/api/play", { deviceId, trackUri, positionMs });
}


async function pauseSpotify() {

    if (!spotifyDeviceId) return;

    try {
        await playbackRequest("/api/pause");
    } catch (error) {
        console.warn("Pausa:", error.message);
    }
}


// =====================================================
// CONTROLES DEL SDK
// =====================================================

async function spotifyResume() {
    await initSpotify();
    return spotifyPlayer.resume();
}


async function spotifyPause() {
    await initSpotify();
    return spotifyPlayer.pause();
}


async function spotifyTogglePlay() {
    await initSpotify();
    return spotifyPlayer.togglePlay();
}


async function spotifySeek(positionMs) {
    await initSpotify();
    return spotifyPlayer.seek(Math.round(positionMs));
}


async function spotifyGetState() {
    return spotifyPlayer ? spotifyPlayer.getCurrentState() : null;
}


function getDeviceId() {
    return spotifyDeviceId;
}


// =====================================================
// EXPORTS
// =====================================================

window.initSpotify = initSpotify;
window.waitForSpotify = waitForSpotify;
window.playSpotifyTrack = playSpotifyTrack;
window.pauseSpotify = pauseSpotify;
window.spotifyResume = spotifyResume;
window.spotifyPause = spotifyPause;
window.spotifyTogglePlay = spotifyTogglePlay;
window.spotifySeek = spotifySeek;
window.spotifyGetState = spotifyGetState;
window.getDeviceId = getDeviceId;

// Alias corto
window.playTrack = playSpotifyTrack;