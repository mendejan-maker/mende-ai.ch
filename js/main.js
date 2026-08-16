// mende-ai — gemeinsames Layout-Pattern (Header/Footer) und leichte Interaktion.

const SIGNET_SVG = `
<svg viewBox="0 0 40 24" role="img" aria-hidden="true">
  <line x1="2" y1="12" x2="16" y2="12" stroke="#9AA3C7" stroke-width="0.9" stroke-linecap="round" stroke-opacity="0.72"></line>
  <circle cx="20" cy="12" r="4.25" fill="none" stroke="#9AA3C7" stroke-width="0.55" stroke-opacity="0.2"></circle>
  <circle cx="20" cy="12" r="2.35" fill="#AEB6D6"></circle>
  <line x1="24" y1="12" x2="38" y2="12" stroke="#9AA3C7" stroke-width="0.9" stroke-linecap="round" stroke-opacity="0.72"></line>
</svg>
`;

const NAV_LINKS = [
  { href: "index.html", label: "Start" },
  { href: "leistungen.html", label: "Leistungen" },
  { href: "ueber-uns.html", label: "Über uns" },
  { href: "kontakt.html", label: "Kontakt" },
];

function currentFile() {
  const path = window.location.pathname.split("/").pop();
  return path === "" ? "index.html" : path;
}

function renderHeader() {
  const mount = document.getElementById("site-header");
  if (!mount) return;

  const here = currentFile();
  const links = NAV_LINKS.map((link) => {
    const isCurrent = link.href === here;
    return `<li><a href="${link.href}"${isCurrent ? ' aria-current="page"' : ""}>${link.label}</a></li>`;
  }).join("");

  mount.innerHTML = `
    <div class="wrap">
      <a href="index.html" class="wordmark" aria-label="mende-ai Startseite">
        <span class="signet">${SIGNET_SVG}</span>
        mende-ai
      </a>
      <nav class="site-nav" aria-label="Hauptnavigation">
        <ul>${links}</ul>
      </nav>
    </div>
  `;
  mount.classList.add("site-header");
}

function renderFooter() {
  const mount = document.getElementById("site-footer");
  if (!mount) return;

  const year = new Date().getFullYear();

  mount.innerHTML = `
    <div class="wrap">
      <div class="footer-mark">
        <span class="signet signet-small">${SIGNET_SVG}</span>
        mende-ai &mdash; ${year}
      </div>
      <div class="footer-meta">
        <span>Zug, Schweiz</span>
        <a href="mailto:kontakt@mende-ai.ch">kontakt@mende-ai.ch</a>
      </div>
    </div>
  `;
  mount.classList.add("site-footer");
}

function initFadeIn() {
  const items = document.querySelectorAll(".fade-in");
  if (!items.length) return;

  if (!("IntersectionObserver" in window)) {
    items.forEach((el) => el.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );

  items.forEach((el) => observer.observe(el));
}

document.addEventListener("DOMContentLoaded", () => {
  renderHeader();
  renderFooter();
  initFadeIn();
});
