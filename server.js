require("dotenv").config();

const path = require("path");
const http = require("http");
const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// =====================================================
// CONFIGURACIÓN
// =====================================================

const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

const REDIRECT_URI =
    process.env.SPOTIFY_REDIRECT_URI ||
    `http://127.0.0.1:${PORT}/callback`;

const HIPSTER_PLAYLIST_ID =
    process.env.HIPSTER_PLAYLIST_ID || "323RDMtCMPS3Jb8cvv0QeE";

const SPOTIFY_API = "https://api.spotify.com/v1";
const SPOTIFY_ACCOUNTS = "https://accounts.spotify.com";

const PUBLIC_DIR = path.join(__dirname, "public");
const PAGE_SIZE = 50;
const GAME_TRACKS = 50;

const SCOPES = [
    "streaming",
    "user-read-private",
    "user-modify-playback-state",
    "user-read-playback-state",
    "playlist-read-private",
    "playlist-read-collaborative"
].join(" ");

if (!CLIENT_ID || !CLIENT_SECRET) {
    console.warn("Falta SPOTIFY_CLIENT_ID o SPOTIFY_CLIENT_SECRET en .env");
}


// =====================================================
// SESIÓN
// =====================================================

const session = {
    accessToken: null,
    refreshToken: null,
    expiresAt: 0
};

class SpotifyError extends Error {
    constructor(message, status = 500) {
        super(message);
        this.status = status;
    }
}

function saveSession(data) {
    session.accessToken = data.access_token;
    session.expiresAt = Date.now() + (data.expires_in - 60) * 1000;

    if (data.refresh_token) session.refreshToken = data.refresh_token;
}

function clearSession() {
    session.accessToken = null;
    session.refreshToken = null;
    session.expiresAt = 0;
}

async function requestToken(body) {

    const credentials = Buffer.from(
        `${CLIENT_ID}:${CLIENT_SECRET}`
    ).toString("base64");

    const response = await fetch(`${SPOTIFY_ACCOUNTS}/api/token`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${credentials}`
        },
        body: new URLSearchParams(body)
    });

    const data = await response.json();

    if (!response.ok) {
        throw new SpotifyError(
            data.error_description || "No se pudo autenticar con Spotify.",
            response.status
        );
    }

    return data;
}

async function getAccessToken() {

    if (!session.accessToken) return null;
    if (Date.now() < session.expiresAt) return session.accessToken;

    if (!session.refreshToken) {
        clearSession();
        return null;
    }

    try {
        saveSession(
            await requestToken({
                grant_type: "refresh_token",
                refresh_token: session.refreshToken
            })
        );

        return session.accessToken;

    } catch (error) {
        console.error("No se pudo renovar el token:", error.message);
        clearSession();
        return null;
    }
}


// =====================================================
// CLIENTE DE LA API
// =====================================================

async function spotifyFetch(endpoint, options = {}) {

    const token = await getAccessToken();

    if (!token) {
        throw new SpotifyError("No hay ninguna sesión de Spotify activa.", 401);
    }

    const response = await fetch(`${SPOTIFY_API}${endpoint}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(options.headers || {})
        }
    });

    const text = await response.text();

    let data = null;

    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = { error: { message: text } };
        }
    }

    if (!response.ok) {

        // 403 en Development Mode suele ser la cuenta fuera de la allowlist
        // o una playlist que no es tuya.
        if (response.status === 403) {
            throw new SpotifyError(
                "Spotify ha denegado la petición (403). En Development Mode " +
                "solo puedes usar cuentas añadidas en el Dashboard y leer " +
                "playlists tuyas o colaborativas.",
                403
            );
        }

        throw new SpotifyError(
            data?.error?.message || "Error en la API de Spotify.",
            response.status
        );
    }

    return data;
}

const route = handler => async (req, res) => {
    try {
        await handler(req, res);
    } catch (error) {
        const status = error.status || 500;
        if (status >= 500) console.error(error);
        res.status(status).json({ error: error.message || "Error inesperado." });
    }
};


// =====================================================
// CANCIONES
// Spotify renombró en febrero de 2026, para apps en
// Development Mode:
//   /playlists/{id}/tracks  ->  /playlists/{id}/items
//   playlist.tracks.total   ->  playlist.items.total
//   item.track              ->  item.item
// =====================================================

const ITEM_FIELDS =
    "total,items(item(id,uri,name,type,is_local," +
    "artists(name),album(name,release_date,images)))";

function isPlayable(track) {
    return Boolean(
        track &&
        track.type === "track" &&
        track.uri &&
        track.id &&
        !track.is_local
    );
}

function getYear(track) {
    const year = parseInt(track.album?.release_date?.slice(0, 4), 10);
    return Number.isInteger(year) ? year : null;
}

function formatTrack(track) {

    const images = track.album?.images || [];

    return {
        id: track.id,
        uri: track.uri,
        name: track.name,
        artist: (track.artists || []).map(artist => artist.name).join(", "),
        album: track.album?.name || "",
        year: getYear(track),
        cover: images[0]?.url || images[1]?.url || images[2]?.url || null
    };
}

function uniqueTracks(tracks) {
    const seen = new Set();

    return tracks.filter(track => {
        if (seen.has(track.id)) return false;
        seen.add(track.id);
        return true;
    });
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function hasYear(track) {
    return Number.isInteger(track.year) && track.year > 0;
}

async function getPlaylistInfo(playlistId) {

    const data = await spotifyFetch(
        `/playlists/${encodeURIComponent(playlistId)}` +
        `?fields=${encodeURIComponent("name,items(total),tracks(total)")}`
    );

    const total = data?.items?.total ?? data?.tracks?.total ?? null;

    // Si el campo no viene, la playlist no es tuya ni colaborativa.
    if (total === null) {
        throw new SpotifyError(
            "Spotify solo deja leer el contenido de playlists tuyas o " +
            "colaborativas. Guarda una copia en tu cuenta y vuelve a probar.",
            403
        );
    }

    return { name: data?.name || "", total };
}

async function getPlaylistPage(playlistId, offset = 0, limit = PAGE_SIZE) {
    return spotifyFetch(
        `/playlists/${encodeURIComponent(playlistId)}/items` +
        `?limit=${limit}&offset=${offset}` +
        `&fields=${encodeURIComponent(ITEM_FIELDS)}`
    );
}

function extractTracks(page) {
    return (page?.items || [])
        .map(entry => entry.item ?? entry.track)
        .filter(isPlayable)
        .map(formatTrack);
}

async function getAllPlaylistTracks(playlistId) {

    const { total } = await getPlaylistInfo(playlistId);

    const pages = [];

    for (let offset = 0; offset < total; offset += PAGE_SIZE) {
        pages.push(extractTracks(await getPlaylistPage(playlistId, offset)));
    }

    return uniqueTracks(pages.flat());
}

async function getRandomPlaylistTracks(playlistId, amount = GAME_TRACKS) {

    const { name, total } = await getPlaylistInfo(playlistId);

    if (!total) return { name, tracks: [] };

    const offsets = [];

    for (let offset = 0; offset < total; offset += PAGE_SIZE) {
        offsets.push(offset);
    }

    shuffle(offsets);

    let tracks = [];

    for (const offset of offsets) {

        tracks = uniqueTracks(
            tracks.concat(
                extractTracks(await getPlaylistPage(playlistId, offset))
            )
        );

        if (tracks.length >= amount) break;
    }

    return { name, tracks: shuffle(tracks).slice(0, amount) };
}


// =====================================================
// PÁGINAS
// =====================================================

app.use(express.json({ limit: "1mb" }));
app.use(express.static(PUBLIC_DIR, { index: false }));

app.get("/", (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "landing", "landing.html"));
});

app.get("/app", (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});


// =====================================================
// AUTENTICACIÓN
// =====================================================

app.get("/login", (req, res) => {

    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: "code",
        redirect_uri: REDIRECT_URI,
        scope: SCOPES
    });

    res.redirect(`${SPOTIFY_ACCOUNTS}/authorize?${params}`);
});

app.get("/callback", route(async (req, res) => {

    const { code, error } = req.query;

    if (error) return res.redirect("/?auth=denied");
    if (!code) return res.redirect("/?auth=error");

    saveSession(
        await requestToken({
            grant_type: "authorization_code",
            code,
            redirect_uri: REDIRECT_URI
        })
    );

    console.log("Sesión de Spotify iniciada.");
    res.redirect("/app");
}));

app.get("/auth/token", route(async (req, res) => {

    const token = await getAccessToken();

    if (!token) {
        throw new SpotifyError("No hay ninguna sesión de Spotify activa.", 401);
    }

    res.json({
        access_token: token,
        expires_in: Math.max(
            0,
            Math.floor((session.expiresAt - Date.now()) / 1000)
        )
    });
}));

app.post("/auth/logout", (req, res) => {
    clearSession();
    res.sendStatus(204);
});

app.get("/api/me", route(async (req, res) => {

    const me = await spotifyFetch("/me");

    // "product" y "email" ya no se devuelven en Development Mode.
    res.json({
        id: me.id,
        name: me.display_name || me.id
    });
}));


// =====================================================
// PLAYLISTS
// =====================================================

app.get("/api/playlists", route(async (req, res) => {

    const playlists = [];
    let url = "/me/playlists?limit=50";

    while (url) {

        const data = await spotifyFetch(url);

        for (const playlist of data.items || []) {

            if (!playlist) continue;

            playlists.push({
                id: playlist.id,
                name: playlist.name,
                owner: playlist.owner?.display_name || "",
                image: playlist.images?.[0]?.url || null,
                tracks: playlist.items?.total ?? playlist.tracks?.total ?? 0,
                uri: playlist.uri
            });
        }

        url = data.next ? data.next.replace(SPOTIFY_API, "") : null;
    }

    res.json(playlists.filter(playlist => playlist.tracks > 0));
}));

app.get("/api/playlists/:playlistId/tracks", route(async (req, res) => {

    const { name, tracks } = await getRandomPlaylistTracks(
        req.params.playlistId
    );

    console.log(`${name}: ${tracks.length} canciones`);
    res.json(tracks);
}));

app.get("/api/playlists/:playlistId/catalog", route(async (req, res) => {
    res.json(shuffle(await getAllPlaylistTracks(req.params.playlistId)));
}));

app.get("/api/playlists/:playlistId/hipster", route(async (req, res) => {

    const tracks = (
        await getAllPlaylistTracks(req.params.playlistId)
    ).filter(hasYear);

    console.log(`Hipster personal: ${tracks.length} canciones`);
    res.json(shuffle(tracks));
}));

app.get("/api/hipster/tracks", route(async (req, res) => {

    const tracks = (
        await getAllPlaylistTracks(HIPSTER_PLAYLIST_ID)
    ).filter(hasYear);

    console.log(`Hipster global: ${tracks.length} canciones`);
    res.json(shuffle(tracks));
}));


// =====================================================
// REPRODUCCIÓN
// =====================================================

app.put("/api/transfer", route(async (req, res) => {

    const { deviceId } = req.body;

    if (!deviceId) {
        throw new SpotifyError("Falta el identificador del dispositivo.", 400);
    }

    await spotifyFetch("/me/player", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_ids: [deviceId], play: false })
    });

    res.sendStatus(204);
}));

app.put("/api/play", route(async (req, res) => {

    const { deviceId, trackUri, positionMs } = req.body;

    if (!deviceId) {
        throw new SpotifyError("Falta el identificador del dispositivo.", 400);
    }

    await spotifyFetch(
        `/me/player/play?device_id=${encodeURIComponent(deviceId)}`,
        {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
                trackUri
                    ? { uris: [trackUri], position_ms: positionMs || 0 }
                    : {}
            )
        }
    );

    res.sendStatus(204);
}));

app.put("/api/pause", route(async (req, res) => {
    await spotifyFetch("/me/player/pause", { method: "PUT" });
    res.sendStatus(204);
}));


// =====================================================
// MUSICROULETTE — SALAS EN MEMORIA
//
// El servidor nunca toca las cuentas de Spotify de los
// demás. Cada jugador lee sus propias playlists con su
// sesión y manda solo portada, título y artista.
// =====================================================

const ROUNDS = 5;
const COVERS_PER_ROUND = 5;
const ROUND_MS = 15000;
const BREAK_MS = 5000;
const MAX_PLAYERS = 10;
const MIN_TRACKS = COVERS_PER_ROUND;

const rooms = new Map();

function send(ws, type, data = {}) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, ...data }));
    }
}

function broadcast(room, type, data = {}) {
    room.players.forEach(player => send(player.ws, type, data));
}

function createCode() {
    let code;

    do {
        code = Math.random().toString(36).slice(2, 7).toUpperCase();
    } while (rooms.has(code));

    return code;
}

function roomState(room) {
    return {
        code: room.code,
        hostId: room.hostId,
        status: room.status,
        players: room.players.map(player => ({
            id: player.id,
            name: player.name,
            ready: Boolean(player.playlist && player.tracks.length >= MIN_TRACKS),
            playlist: player.playlist?.name || null,
            score: player.score
        }))
    };
}

function broadcastState(room) {
    broadcast(room, "room_state", roomState(room));
}

function buildRounds(room) {

    const eligible = room.players.filter(
        player => player.tracks.length >= MIN_TRACKS
    );

    const owners = [];
    let pool = [];

    for (let i = 0; i < ROUNDS; i++) {

        if (!pool.length) pool = shuffle([...eligible]);

        owners.push(pool.pop());
    }

    return owners.map(owner => ({
        ownerId: owner.id,
        tracks: shuffle([...owner.tracks]).slice(0, COVERS_PER_ROUND)
    }));
}

function startGame(room) {

    if (room.status !== "lobby") return;

    if (room.players.length < 2) {
        return broadcast(room, "error_message", {
            message: "Hacen falta al menos dos jugadores."
        });
    }

    const notReady = room.players.filter(
        player => !player.playlist || player.tracks.length < MIN_TRACKS
    );

    if (notReady.length) {
        return broadcast(room, "error_message", {
            message: "Todos tienen que elegir una playlist antes de empezar."
        });
    }

    room.status = "playing";
    room.currentRound = 0;

    room.players.forEach(player => {
        player.score = 0;
        player.answer = null;
    });

    room.rounds = buildRounds(room);

    startRound(room);
}

function startRound(room) {

    const round = room.rounds[room.currentRound];

    if (!round) return finishGame(room);

    room.startedAt = Date.now();

    room.players.forEach(player => {
        player.answer = null;
    });

    const answers = shuffle(
        room.players.map(player => ({ id: player.id, name: player.name }))
    );

    room.players.forEach(player => {
        send(player.ws, "round_start", {
            round: room.currentRound + 1,
            totalRounds: ROUNDS,
            duration: ROUND_MS,
            tracks: round.tracks,
            answers,
            isOwner: player.id === round.ownerId
        });
    });

    clearTimeout(room.timer);
    room.timer = setTimeout(() => finishRound(room), ROUND_MS);
}

function handleVote(room, player, ownerId) {

    if (room.status !== "playing") return;
    if (player.answer) return;

    const round = room.rounds[room.currentRound];

    // El dueño de la ronda no juega: ya sabe la respuesta.
    if (player.id === round.ownerId) return;

    const elapsed = Date.now() - room.startedAt;

    if (elapsed > ROUND_MS) return;

    player.answer = ownerId;

    const correct = ownerId === round.ownerId;

    if (correct) {
        const remaining = Math.max(0, ROUND_MS - elapsed);
        player.score += 500 + Math.round(500 * (remaining / ROUND_MS));
    }

    send(player.ws, "vote_registered", { correct, score: player.score });

    const pending = room.players.filter(
        other => other.id !== round.ownerId && !other.answer
    );

    if (!pending.length) finishRound(room);
}

function finishRound(room) {

    if (room.status !== "playing") return;

    clearTimeout(room.timer);

    const round = room.rounds[room.currentRound];
    const owner = room.players.find(player => player.id === round.ownerId);

    broadcast(room, "round_results", {
        ownerId: round.ownerId,
        ownerName: owner?.name || "Alguien que se fue",
        results: room.players
            .map(player => ({
                id: player.id,
                name: player.name,
                correct: player.answer === round.ownerId,
                answered: Boolean(player.answer),
                isOwner: player.id === round.ownerId,
                score: player.score
            }))
            .sort((a, b) => b.score - a.score)
    });

    room.currentRound++;

    clearTimeout(room.timer);

    room.timer = setTimeout(() => {
        if (room.currentRound >= ROUNDS) finishGame(room);
        else startRound(room);
    }, BREAK_MS);
}

function finishGame(room) {

    room.status = "finished";
    clearTimeout(room.timer);

    broadcast(room, "game_over", {
        scoreboard: room.players
            .map(player => ({
                id: player.id,
                name: player.name,
                score: player.score
            }))
            .sort((a, b) => b.score - a.score)
    });
}

function resetRoom(room) {

    clearTimeout(room.timer);

    room.status = "lobby";
    room.currentRound = 0;
    room.rounds = [];

    room.players.forEach(player => {
        player.score = 0;
        player.answer = null;
    });

    broadcastState(room);
}

function leaveRoom(player) {

    const room = rooms.get(player.room);

    player.room = null;

    if (!room) return;

    room.players = room.players.filter(other => other.id !== player.id);

    if (!room.players.length) {
        clearTimeout(room.timer);
        rooms.delete(room.code);
        return;
    }

    if (room.hostId === player.id) {
        room.hostId = room.players[0].id;
    }

    // Si se queda gente insuficiente a mitad de partida, se vuelve al lobby.
    if (room.status === "playing" && room.players.length < 2) {
        broadcast(room, "error_message", {
            message: "No quedan jugadores suficientes. Vuelta a la sala."
        });
        return resetRoom(room);
    }

    broadcastState(room);
}

function sanitizeName(value) {
    return String(value || "").trim().slice(0, 20) || "Jugador";
}

function sanitizeTracks(value) {

    if (!Array.isArray(value)) return [];

    return value
        .filter(track => track?.id && track?.cover)
        .slice(0, 100)
        .map(track => ({
            id: String(track.id).slice(0, 40),
            name: String(track.name || "").slice(0, 120),
            artist: String(track.artist || "").slice(0, 120),
            cover: String(track.cover).slice(0, 300)
        }));
}

wss.on("connection", ws => {

    const player = {
        ws,
        id: Math.random().toString(36).slice(2, 10),
        name: "Jugador",
        room: null,
        playlist: null,
        tracks: [],
        score: 0,
        answer: null
    };

    ws.on("message", raw => {

        let message;

        try {
            message = JSON.parse(raw);
        } catch {
            return;
        }

        const room = player.room ? rooms.get(player.room) : null;

        switch (message.type) {

            case "create_room": {

                if (player.room) leaveRoom(player);

                player.name = sanitizeName(message.name);

                const code = createCode();

                const newRoom = {
                    code,
                    hostId: player.id,
                    players: [player],
                    status: "lobby",
                    rounds: [],
                    currentRound: 0,
                    timer: null,
                    startedAt: 0
                };

                rooms.set(code, newRoom);
                player.room = code;

                send(ws, "joined", { code, playerId: player.id });
                broadcastState(newRoom);
                break;
            }

            case "join_room": {

                const code = String(message.code || "").trim().toUpperCase();
                const target = rooms.get(code);

                if (!target) {
                    return send(ws, "error_message", {
                        message: "No existe ninguna sala con ese código."
                    });
                }

                if (target.status !== "lobby") {
                    return send(ws, "error_message", {
                        message: "Esa partida ya ha empezado."
                    });
                }

                if (target.players.length >= MAX_PLAYERS) {
                    return send(ws, "error_message", {
                        message: "La sala está completa."
                    });
                }

                if (player.room) leaveRoom(player);

                player.name = sanitizeName(message.name);
                player.room = code;
                target.players.push(player);

                send(ws, "joined", { code, playerId: player.id });
                broadcastState(target);
                break;
            }

            case "set_playlist": {

                if (!room || room.status !== "lobby") return;

                const tracks = sanitizeTracks(message.tracks);

                if (tracks.length < MIN_TRACKS) {
                    return send(ws, "error_message", {
                        message:
                            `Esa playlist solo tiene ${tracks.length} canciones ` +
                            `con portada. Hacen falta ${MIN_TRACKS}.`
                    });
                }

                player.playlist = {
                    id: String(message.playlist?.id || ""),
                    name: String(message.playlist?.name || "").slice(0, 80)
                };

                player.tracks = tracks;

                broadcastState(room);
                break;
            }

            case "start_game":
                if (room && room.hostId === player.id) startGame(room);
                break;

            case "vote":
                if (room) handleVote(room, player, message.ownerId);
                break;

            case "play_again":
                if (room && room.hostId === player.id) resetRoom(room);
                break;

            case "leave_room":
                leaveRoom(player);
                break;
        }
    });

    ws.on("close", () => leaveRoom(player));
    ws.on("error", () => leaveRoom(player));
});


// =====================================================
// 404
// =====================================================

app.use((req, res) => {
    if (req.path.startsWith("/api/")) {
        return res.status(404).json({ error: "Ruta no encontrada." });
    }
    res.redirect("/");
});

server.listen(PORT, () => {
    console.log(`BeatPlay en http://127.0.0.1:${PORT}`);
});