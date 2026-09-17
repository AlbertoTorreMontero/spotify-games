/* =========================================================
   BEATPLAY — AUTENTICACIÓN
   Mantiene getSpotifyToken() y checkSpotifyLogin(),
   y añade caché para no pedir el token en cada llamada.
========================================================= */

let cachedToken = null;
let cachedExpiry = 0;


// =====================================================
// TOKEN
// =====================================================

async function getSpotifyToken({ force = false } = {}) {

    if (!force && cachedToken && Date.now() < cachedExpiry) {
        return cachedToken;
    }

    const response = await fetch("/auth/token");

    if (response.status === 401) {
        cachedToken = null;
        cachedExpiry = 0;

        throw new Error("No estás autenticado en Spotify.");
    }

    if (!response.ok) {
        throw new Error("No se pudo comprobar la sesión de Spotify.");
    }

    const data = await response.json();

    if (!data.access_token) {
        throw new Error("Spotify no devolvió un Access Token.");
    }

    cachedToken = data.access_token;

    // Un minuto de margen antes de que caduque.
    cachedExpiry =
        Date.now() + Math.max(0, (data.expires_in || 3600) - 60) * 1000;

    return cachedToken;
}


// =====================================================
// ESTADO DE SESIÓN
// =====================================================

async function checkSpotifyLogin() {

    try {
        await getSpotifyToken();
        return true;

    } catch (error) {
        console.warn("Spotify:", error.message);
        return false;
    }
}


async function logoutSpotify() {

    await fetch("/auth/logout", { method: "POST" });

    cachedToken = null;
    cachedExpiry = 0;

    window.location.href = "/";
}


// =====================================================
// EXPORTS
// =====================================================

window.getSpotifyToken = getSpotifyToken;
window.checkSpotifyLogin = checkSpotifyLogin;
window.logoutSpotify = logoutSpotify;

// Alias que usan script.js y spotify.js
window.getAccessToken = getSpotifyToken;
window.isAuthenticated = checkSpotifyLogin;
window.logout = logoutSpotify;