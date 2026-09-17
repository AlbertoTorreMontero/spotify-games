/* =========================================================
   BEATPLAY — LANDING
   Paralaje del póster. Escribe variables CSS en vez de
   sobrescribir transform, para no romper el hover.
========================================================= */

(() => {
    const poster = document.querySelector(".poster");

    if (!poster) return;

    const coarsePointer = window.matchMedia("(pointer: coarse)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    if (coarsePointer.matches || reducedMotion.matches) return;

    const AMPLITUDE = 6;
    let frame = null;

    function move(event) {
        if (frame) return;

        frame = requestAnimationFrame(() => {
            frame = null;

            const x = (event.clientX / window.innerWidth - 0.5) * 2;
            const y = (event.clientY / window.innerHeight - 0.5) * 2;

            poster.style.setProperty("--poster-x", `${x * AMPLITUDE}px`);
            poster.style.setProperty("--poster-y", `${y * AMPLITUDE}px`);
        });
    }

    function reset() {
        poster.style.removeProperty("--poster-x");
        poster.style.removeProperty("--poster-y");
    }

    window.addEventListener("mousemove", move, { passive: true });
    document.addEventListener("mouseleave", reset);
})();