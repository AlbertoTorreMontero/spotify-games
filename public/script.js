/* =========================================================
   BEATPLAY — CONTROLADOR DE LA APP
========================================================= */

const $ = id => document.getElementById(id);

const state = {
    game: "snake",
    busy: false
};

const htmlCache = new Map();


// =====================================================
// UTILIDADES DE INTERFAZ
// =====================================================

function showScreen(id) {

    document
        .querySelectorAll(".screen")
        .forEach(screen => screen.classList.toggle("hidden", screen.id !== id));

    window.scrollTo({ top: 0 });
}

function toast(message) {

    let element = document.querySelector(".toast");

    if (!element) {
        element = document.createElement("div");
        element.className = "toast";
        element.setAttribute("role", "status");
        document.body.appendChild(element);
    }

    element.textContent = message;
    element.classList.add("show");

    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove("show"), 4500);
}

// Los juegos cargados dinámicamente también avisan por aquí.
window.beatplayToast = toast;

function setStatus(text, online = false) {

    const status = $("appStatus");

    if (!status) return;

    status.textContent = text;
    status.classList.toggle("online", online);
}

async function loadGameHTML(url, containerId) {

    const container = $(containerId);

    if (!container) {
        throw new Error(`Falta el contenedor #${containerId} en index.html.`);
    }

    if (!htmlCache.has(url)) {

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`No se pudo cargar ${url}.`);
        }

        htmlCache.set(url, await response.text());
    }

    container.innerHTML = htmlCache.get(url);
}

function requireFunction(name) {

    if (typeof window[name] !== "function") {
        throw new Error(`${name} no está definido.`);
    }

    return window[name];
}


// =====================================================
// PLAYLISTS
// =====================================================

function currentPlaylist() {
    return typeof getSelectedPlaylist === "function"
        ? getSelectedPlaylist()
        : null;
}

async function fetchTracks(playlistId, minimum, label) {

    const tracks = await requireFunction("getPlaylistTracks")(playlistId);

    if (tracks.length < minimum) {
        throw new Error(
            `${label} necesita al menos ${minimum} canciones reproducibles. ` +
            `Esta playlist tiene ${tracks.length}.`
        );
    }

    return tracks;
}


// =====================================================
// JUEGOS DISPONIBLES
// =====================================================

const GAMES = {

    snake: {
        label: "EMPEZAR SNAKE",
        loading: "CARGANDO SNAKE…",
        screen: "gameScreen",
        container: "snakeContainer",
        html: "/snake/snake.html",
        needsPlaylist: true,
        prepare: playlist => fetchTracks(playlist.id, 1, "Snake"),
        run: (playlist, tracks) =>
            requireFunction("startSnake")(tracks, playlist.name)
    },

    bingo: {
        label: "CREAR BINGO",
        loading: "CARGANDO BINGO…",
        screen: "bingoScreen",
        container: "bingoContainer",
        html: "/bingo/bingo.html",
        needsPlaylist: true,
        prepare: playlist => fetchTracks(playlist.id, 15, "El bingo"),
        run: (playlist, tracks) =>
            requireFunction("startBingo")(tracks, playlist.name)
    },

    "hipster-user": {
        label: "EMPEZAR HIPSTER",
        loading: "CARGANDO HIPSTER…",
        screen: "hipsterScreen",
        container: "hipsterContainer",
        html: "/hipster/hipster.html",
        needsPlaylist: true,
        run: playlist =>
            requireFunction("startHipster")({ mode: "user", playlist })
    },

    "hipster-global": {
        label: "EMPEZAR HIPSTER GLOBAL",
        loading: "CARGANDO HIPSTER GLOBAL…",
        screen: "hipsterScreen",
        container: "hipsterContainer",
        html: "/hipster/hipster.html",
        needsPlaylist: false,
        run: () =>
            requireFunction("startHipster")({ mode: "global", playlist: null })
    },

    // Multijugador: cada jugador elige su playlist dentro de la sala,
    // así que aquí no hace falta ninguna selección previa.
    roulette: {
        label: "ENTRAR EN MUSIC ROULETTE",
        loading: "CONECTANDO…",
        screen: "rouletteScreen",
        container: "rouletteContainer",
        html: "/roulette/roulette.html",
        needsPlaylist: false,
        selectedText: "Sala privada con tus amigos",
        run: () => requireFunction("startRoulette")()
    }
};


// =====================================================
// BOTÓN PRINCIPAL
// =====================================================

function updateStartButton() {

    const button = $("startButton");
    const label = $("startLabel");
    const selected = $("selectedText");
    const section = $("playlistSection");

    const game = GAMES[state.game];
    const playlist = currentPlaylist();

    if (section) {
        section.classList.toggle("hidden", !game.needsPlaylist);
    }

    if (label) {
        label.textContent = state.busy ? game.loading : game.label;
    }

    if (button) {
        button.disabled = state.busy || (game.needsPlaylist && !playlist);
    }

    if (selected) {
        if (!game.needsPlaylist) {
            selected.textContent =
                game.selectedText || "Playlist oficial de Hipster";
        } else if (playlist) {
            selected.textContent =
                `${playlist.name} — ${playlist.tracks} canciones`;
        } else {
            selected.textContent = "Elige una playlist";
        }
    }
}

window.updateStartButton = updateStartButton;


// =====================================================
// SELECTOR DE JUEGO
// =====================================================

function initGameSelector() {

    const cards = document.querySelectorAll(".game-card[data-game]");

    cards.forEach(card => {

        card.addEventListener("click", () => {

            if (state.busy) return;

            state.game = card.dataset.game;

            cards.forEach(item =>
                item.classList.toggle("selected", item === card)
            );

            updateStartButton();
        });
    });
}


// =====================================================
// ARRANQUE DE PARTIDA
// =====================================================

async function startGame() {

    if (state.busy) return;

    const game = GAMES[state.game];
    const playlist = currentPlaylist();

    if (game.needsPlaylist && !playlist) {
        toast("Elige una playlist antes de empezar.");
        return;
    }

    state.busy = true;
    updateStartButton();

    try {
        const data = game.prepare ? await game.prepare(playlist) : null;

        await loadGameHTML(game.html, game.container);

        showScreen(game.screen);

        await game.run(playlist, data);

    } catch (error) {
        console.error(`[${state.game}]`, error);
        toast(error.message || "No se pudo iniciar el juego.");
        showScreen("menuScreen");

    } finally {
        state.busy = false;
        updateStartButton();
    }
}


// =====================================================
// SALIR DE UN JUEGO
// =====================================================

const EXIT_BUTTONS = {
    exitGameButton: ["stopSnake"],
    exitBingoButton: ["stopBingo"],
    exitHipsterButton: ["stopHipster"],
    exitRouletteButton: ["stopRoulette"]
};

document.addEventListener("click", async event => {

    const button = event.target.closest(
        Object.keys(EXIT_BUTTONS).map(id => `#${id}`).join(", ")
    );

    if (!button) return;

    for (const name of EXIT_BUTTONS[button.id]) {
        if (typeof window[name] === "function") window[name]();
    }

    if (typeof pauseSpotify === "function") {
        await pauseSpotify().catch(() => {});
    }

    showScreen("menuScreen");
    updateStartButton();
});


// =====================================================
// SESIÓN
// =====================================================

async function enterBeatplay() {

    initGameSelector();
    updateStartButton();

    const authenticated =
        typeof isAuthenticated === "function" ? await isAuthenticated() : false;

    if (!authenticated) {
        showScreen("loginScreen");
        return;
    }

    showScreen("menuScreen");

    try {
        await requireFunction("loadPlaylists")();
    } catch (error) {
        console.error("Playlists:", error);
        toast(error.message || "No se pudieron cargar tus playlists.");
        setStatus("SPOTIFY RECHAZÓ LA PETICIÓN");
    }

    updateStartButton();

    if (typeof initSpotify === "function") {
        initSpotify()
            .then(info => setStatus(info.label, info.ready))
            .catch(error => {
                console.error("Spotify:", error);
                setStatus("REPRODUCTOR NO DISPONIBLE");
            });
    }
}

$("startButton")?.addEventListener("click", startGame);

enterBeatplay();