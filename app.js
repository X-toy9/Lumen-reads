"use strict";

/*
  Lumen Reads — front-end demonstration
  Real catalog data and covers: Open Library
  Accounts, cart, wishlist, library: browser-only demo
  No payments, email delivery, or e-book downloads.
*/

/* ---------------- Data ---------------- */

const CATEGORY_QUERIES = [
  { category: "Fiction", query: "subject:fiction" },
  { category: "Technology", query: "subject:programming" },
  { category: "Self-development", query: "subject:personal_growth" },
  { category: "Business", query: "subject:business" }
];

const FALLBACK_BOOKS = [
  {
    id: 1001,
    workKey: "/works/OL1168083W",
    title: "The Great Gatsby",
    author: "F. Scott Fitzgerald",
    category: "Fiction",
    firstPublished: 1925,
    coverId: 7222246,
    editionCount: 180,
    description: "A classic novel about ambition, love, and the American Dream."
  },
  {
    id: 1002,
    workKey: "/works/OL1168084W",
    title: "Clean Code",
    author: "Robert C. Martin",
    category: "Technology",
    firstPublished: 2008,
    coverId: 3855644,
    editionCount: 25,
    description: "A practical guide to writing readable, maintainable software."
  },
  {
    id: 1003,
    workKey: "/works/OL2733061W",
    title: "Atomic Habits",
    author: "James Clear",
    category: "Self-development",
    firstPublished: 2018,
    coverId: 9250374,
    editionCount: 40,
    description: "An accessible guide to building better habits through small changes."
  },
  {
    id: 1004,
    workKey: "/works/OL2733062W",
    title: "The Lean Startup",
    author: "Eric Ries",
    category: "Business",
    firstPublished: 2011,
    coverId: 6709717,
    editionCount: 35,
    description: "A method for building products and businesses through rapid learning."
  }
];

const STORAGE_KEY = "lumen-reads-v1";
const CATALOG_KEY = "lumen-catalog-v1";
const WISHLIST_KEY = "lumen-wishlist-v1";
const THEME_KEY = "lumen-theme-v1";
const CACHE_AGE = 24 * 60 * 60 * 1000;

let books = [];
let detailsRequest = 0;

const workCache = new Map();

/* ---------------- Helpers ---------------- */

const $ = (selector) => document.querySelector(selector);

const money = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(value);

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function readJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    toast("Browser storage is unavailable. Changes may not persist.");
  }
}

let toastTimer;

function toast(message) {
  const element = $("#toast");

  element.textContent = message;
  element.classList.add("visible");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    element.classList.remove("visible");
  }, 3200);
}

async function fetchJSON(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- State ---------------- */

function loadState() {
  const saved = readJSON(STORAGE_KEY, {
    users: [],
    currentUserId: null,
    cart: []
  });

  return {
    users: Array.isArray(saved.users) ? saved.users : [],
    currentUserId: saved.currentUserId || null,
    cart: Array.isArray(saved.cart)
      ? saved.cart.filter(Number.isSafeInteger)
      : []
  };
}

let state = loadState();

const savedWishlist = readJSON(WISHLIST_KEY, []);
let wishlist = new Set(
  Array.isArray(savedWishlist)
    ? savedWishlist.filter(Number.isSafeInteger)
    : []
);

function saveState() {
  writeJSON(STORAGE_KEY, state);
}

function currentUser() {
  return state.users.find((user) => user.id === state.currentUserId) || null;
}

/* ---------------- Catalog ---------------- */

function normalizeBook(doc, category) {
  const match = /^\/works\/OL(\d+)W$/.exec(doc.key || "");

  if (!match || !doc.title) return null;

  const id = Number(match[1]);

  if (!Number.isSafeInteger(id)) return null;

  return {
    id,
    workKey: doc.key,
    title: doc.title,
    author: doc.author_name?.join(", ") || "Author not listed",
    category,
    firstPublished: doc.first_publish_year || null,
    coverId: doc.cover_i || null,
    editionCount: doc.edition_count ?? null,

    // Demo interface value; not a real store price.
    price: 9.99 + (id % 4) * 3
  };
}

async function loadCatalog() {
  showLoading();

  const cached = readJSON(CATALOG_KEY, null);

  if (cached?.books?.length && Date.now() - cached.timestamp < CACHE_AGE) {
    books = cached.books;
    finishLoading();
    return;
  }

  const collected = [];

  for (const item of CATEGORY_QUERIES) {
    try {
      const parameters = new URLSearchParams({
        q: item.query,
        limit: "6",
        fields:
          "key,title,author_name,first_publish_year,cover_i,edition_count"
      });

      const result = await fetchJSON(
        `https://openlibrary.org/search.json?${parameters}`
      );

      for (const doc of result.docs || []) {
        const book = normalizeBook(doc, item.category);

        if (book && !collected.some((existing) => existing.id === book.id)) {
          collected.push(book);
        }
      }
    } catch {
      // Continue with successfully loaded categories.
    }
  }

  if (collected.length) {
    books = collected;

    writeJSON(CATALOG_KEY, {
      timestamp: Date.now(),
      books
    });

    finishLoading();
    return;
  }

  if (cached?.books?.length) {
    books = cached.books;
    finishLoading();

    toast("Showing the saved catalog while offline.");
    return;
  }

  books = FALLBACK_BOOKS;
  finishLoading();

  toast("Using the offline starter collection.");
}

function showLoading() {
  ["#trending-books", "#discover-books", "#book-results"].forEach((selector) => {
    const container = $(selector);

    if (!container) return;

    container.setAttribute("aria-busy", "true");
    container.innerHTML = skeletonCards();
  });

  $("#result-count").textContent = "Finding books…";
}

function skeletonCards(count = 4) {
  return Array.from({ length: count }, () => `
    <div class="book-card" aria-hidden="true">
      <div class="cover-area">
        <div class="skeleton skeleton-cover"></div>
      </div>

      <div class="card-body">
        <div class="skeleton skeleton-line short"></div>
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line short"></div>
      </div>
    </div>
  `).join("");
}

function finishLoading() {
  renderHome();
  renderExplore();
  renderLibrary();
  updateStats();

  ["#trending-books", "#discover-books", "#book-results"].forEach((selector) => {
    $(selector)?.removeAttribute("aria-busy");
  });
}

/* ---------------- Covers and cards ---------------- */

function coverMarkup(book) {
  if (!book.coverId) {
    return `
      <div class="cover-fallback" role="img"
        aria-label="Cover unavailable for ${escapeHTML(book.title)}">
        <span>LUMEN READS</span>
        <strong>${escapeHTML(book.title)}</strong>
        <small>${escapeHTML(book.author)}</small>
      </div>
    `;
  }

  return `
    <div class="cover-shell">
      <img
        class="real-cover"
        src="https://covers.openlibrary.org/b/id/${book.coverId}-M.jpg?default=false"
        alt="Cover of ${escapeHTML(book.title)}"
        loading="lazy"
        decoding="async"
      >

      <div class="cover-fallback" hidden>
        <span>LUMEN READS</span>
        <strong>${escapeHTML(book.title)}</strong>
        <small>Cover unavailable</small>
      </div>
    </div>
  `;
}

function bookCard(book, libraryMode = false) {
  const inCart = state.cart.includes(book.id);
  const owned = currentUser()?.library.includes(book.id);
  const saved = wishlist.has(book.id);

  const action = owned || libraryMode
    ? `
      <button class="button button-small ghost"
        data-action="details" data-id="${book.id}">
        View details
      </button>
    `
    : `
      <button class="button button-small"
        data-action="add" data-id="${book.id}"
        ${inCart ? "disabled" : ""}>
        ${inCart ? "In cart" : "Add to cart"}
      </button>
    `;

  return `
    <article class="book-card">
      <div class="cover-area">
        <button
          class="wishlist-button ${saved ? "saved" : ""}"
          type="button"
          data-action="wishlist"
          data-id="${book.id}"
          aria-pressed="${saved}"
          aria-label="${saved ? "Remove from wishlist:" : "Save to wishlist:"} ${escapeHTML(book.title)}"
        >
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none"
            stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
          </svg>
        </button>

        <button
          class="cover-button"
          type="button"
          data-action="details"
          data-id="${book.id}"
          aria-label="Preview ${escapeHTML(book.title)}"
        >
          ${coverMarkup(book)}
          <span class="preview-label">Quick preview</span>
        </button>
      </div>

      <div class="card-body">
        <span class="book-category">${escapeHTML(book.category)}</span>

        <button class="book-title"
          data-action="details" data-id="${book.id}">
          ${escapeHTML(book.title)}
        </button>

        <p class="book-author">By ${escapeHTML(book.author)}</p>

        <div class="card-footer">
          <span class="demo-price">${money(book.price)}</span>
          ${action}
        </div>

        <button class="details-button"
          data-action="details" data-id="${book.id}">
          More about this book
        </button>
      </div>
    </article>
  `;
}

/* ---------------- Rendering ---------------- */

function updateStats() {
  $("#stat-books").textContent = books.length || "—";
}

function renderHome() {
  const trending = books.slice(0, 4);
  const discover = books.slice(4, 8);
  const spotlight = books.find((book) => book.category === "Fiction") || books[0];

  $("#trending-books").innerHTML = trending.length
    ? trending.map((book) => bookCard(book)).join("")
    : `<div class="empty-state"><h2>No books available yet.</h2></div>`;

  $("#discover-books").innerHTML = discover.length
    ? discover.map((book) => bookCard(book)).join("")
    : `<div class="empty-state"><h2>No additional books available yet.</h2></div>`;

  $("#hero-covers").innerHTML = books
    .slice(0, 2)
    .map((book) => coverMarkup(book))
    .join("");

  if (spotlight) {
    $("#spotlight-title").textContent = spotlight.title;
    $("#spotlight-text").textContent = `By ${spotlight.author}. Open the preview to explore its details.`;

    $("#spotlight-meta").innerHTML = `
      <span class="meta-chip">${escapeHTML(spotlight.category)}</span>
      ${
        spotlight.firstPublished
          ? `<span class="meta-chip">First published ${spotlight.firstPublished}</span>`
          : ""
      }
      <span class="meta-chip">${money(spotlight.price)} demo price</span>
    `;

    $("#spotlight-cover").innerHTML = coverMarkup(spotlight);

    const spotlightButton = $("#spotlight-button");

    spotlightButton.dataset.id = spotlight.id;
    spotlightButton.dataset.action = "details";
  }
}

function renderExplore() {
  const search = $("#search-input").value.trim().toLowerCase();
  const category = $("#category-filter").value;
  const sort = $("#sort-select").value;
  const wishlistOnly = $("#wishlist-filter").checked;

  let results = books.filter((book) => {
    const matchesSearch = `${book.title} ${book.author}`
      .toLowerCase()
      .includes(search);

    const matchesCategory = category === "all" || book.category === category;
    const matchesWishlist = !wishlistOnly || wishlist.has(book.id);

    return matchesSearch && matchesCategory && matchesWishlist;
  });

  if (sort === "title") {
    results.sort((a, b) => a.title.localeCompare(b.title));
  }

  if (sort === "year-new") {
    results.sort((a, b) => (b.firstPublished || 0) - (a.firstPublished || 0));
  }

  if (sort === "year-old") {
    results.sort((a, b) => (a.firstPublished || 9999) - (b.firstPublished || 9999));
  }

  $("#result-count").textContent =
    `${results.length} book${results.length === 1 ? "" : "s"} found`;

  $("#book-results").innerHTML = results.length
    ? results.map((book) => bookCard(book)).join("")
    : `
      <div class="empty-state">
        <h2>No books found</h2>
        <p>Try another search, category, or wishlist filter.</p>
      </div>
    `;
}

function renderLibrary() {
  const user = currentUser();
  const content = $("#library-content");

  if (!user) {
    content.innerHTML = `
      <div class="empty-state">
        <h2>Your library is waiting.</h2>
        <p>Log in or create an account to save and view your books.</p>

        <div class="modal-actions" style="justify-content:center">
          <a href="#login" class="button">Log in</a>
          <a href="#signup" class="button ghost">Create account</a>
        </div>
      </div>
    `;

    return;
  }

  const library = books.filter((book) => user.library.includes(book.id));

  content.innerHTML = `
    <div class="library-summary">
      <div class="avatar">${escapeHTML(user.name.charAt(0).toUpperCase())}</div>

      <div>
        <h2>${escapeHTML(user.name)}</h2>
        <p>${escapeHTML(user.email)}</p>
        <p>${library.length} book${library.length === 1 ? "" : "s"} in your demo library</p>
      </div>
    </div>

    <div class="section-head">
      <div>
        <span class="eyebrow">Saved by you</span>
        <h2>My books</h2>
      </div>

      <a href="#explore" class="arrow-link">Discover more</a>
    </div>

    <div class="book-grid">
      ${
        library.length
          ? library.map((book) => bookCard(book, true)).join("")
          : `
            <div class="empty-state">
              <h2>Your library is empty.</h2>
              <p>Add books to your cart, then save them to your demo library.</p>
              <a href="#explore" class="button">Browse books</a>
            </div>
          `
      }
    </div>

    <p class="small-note">
      This demo saves selections only. E-book files and downloads are not included.
    </p>
  `;
}

function updateHeader() {
  const loggedIn = Boolean(currentUser());

  document.querySelectorAll(".guest-only").forEach((element) => {
    element.hidden = loggedIn;
  });

  document.querySelectorAll(".user-only").forEach((element) => {
    element.hidden = !loggedIn;
  });

  $("#cart-count").textContent = state.cart.length;
}

function renderAll() {
  updateHeader();
  renderHome();
  renderExplore();
  renderLibrary();
}

/* ---------------- Book modal ---------------- */

async function openBookModal(id) {
  const book = books.find((item) => item.id === id);

  if (!book) return;

  const requestNumber = ++detailsRequest;
  const modal = $("#book-modal");

  $("#book-modal-body").innerHTML = `
    <div class="book-modal">
      <div class="book-modal-cover">
        ${coverMarkup(book)}
      </div>

      <div class="book-modal-info">
        <span class="book-category">${escapeHTML(book.category)}</span>

        <h3>${escapeHTML(book.title)}</h3>
        <p class="book-modal-author">By ${escapeHTML(book.author)}</p>

        <div class="book-facts">
          <div>
            <span>First published</span>
            <strong>${book.firstPublished || "Not listed"}</strong>
          </div>

          <div>
            <span>Catalog editions</span>
            <strong>${book.editionCount ?? "Not listed"}</strong>
          </div>

          <div>
            <span>Demo price</span>
            <strong>${money(book.price)}</strong>
          </div>
        </div>

        <div
          id="modal-description"
          class="book-description"
          aria-live="polite"
          aria-busy="true"
        >
          <div class="skeleton skeleton-line"></div>
          <div class="skeleton skeleton-line"></div>
          <div class="skeleton skeleton-line short"></div>
        </div>

        <div id="modal-subjects" class="meta-row"></div>

        <div class="modal-actions">
          <button class="button" data-action="add" data-id="${book.id}"
            ${
              state.cart.includes(book.id) ||
              currentUser()?.library.includes(book.id)
                ? "disabled"
                : ""
            }
          >
            ${
              currentUser()?.library.includes(book.id)
                ? "In your library"
                : state.cart.includes(book.id)
                  ? "Already in cart"
                  : `Add to cart · ${money(book.price)}`
            }
          </button>

          <button class="button ghost" data-action="wishlist" data-id="${book.id}"
            aria-pressed="${wishlist.has(book.id)}">
            ${wishlist.has(book.id) ? "Remove from wishlist" : "Save to wishlist"}
          </button>

          <a class="button ghost"
            href="https://openlibrary.org${book.workKey}"
            target="_blank" rel="noopener noreferrer">
            View catalog record
          </a>
        </div>
      </div>
    </div>
  `;

  if (!modal.open) modal.showModal();

  if (book.description) {
    $("#modal-description").textContent = book.description;
    $("#modal-description").setAttribute("aria-busy", "false");
    return;
  }

  try {
    let details = workCache.get(book.workKey);

    if (!details) {
      details = await fetchJSON(`https://openlibrary.org${book.workKey}.json`);
      workCache.set(book.workKey, details);
    }

    if (requestNumber !== detailsRequest || !modal.open) return;

    const description =
      typeof details.description === "string"
        ? details.description
        : details.description?.value;

    const descriptionElement = $("#modal-description");

    descriptionElement.textContent =
      description || "A description is not available for this book.";

    descriptionElement.setAttribute("aria-busy", "false");

    $("#modal-subjects").innerHTML = (details.subjects || [])
      .slice(0, 8)
      .map((subject) => `
        <span class="meta-chip">${escapeHTML(subject)}</span>
      `)
      .join("");
  } catch {
    if (requestNumber !== detailsRequest || !modal.open) return;

    const descriptionElement = $("#modal-description");

    descriptionElement.textContent =
      "The description could not be loaded. You can still view the book's Open Library record.";

    descriptionElement.setAttribute("aria-busy", "false");
  }
}

/* ---------------- Cart ---------------- */

function renderCart() {
  const cartBooks = books.filter((book) => state.cart.includes(book.id));

  if (!cartBooks.length) {
    $("#cart-body").innerHTML = `
      <div class="empty-state">
        <h2>Your cart is empty.</h2>
        <p>Find something you would love to read.</p>

        <div class="modal-actions" style="justify-content:center">
          <button class="button" data-action="browse">Browse books</button>
        </div>
      </div>
    `;

    return;
  }

  const total = cartBooks.reduce((sum, book) => sum + book.price, 0);

  $("#cart-body").innerHTML = `
    ${cartBooks.map((book) => `
      <div class="cart-row">
        <div>
          <h3>${escapeHTML(book.title)}</h3>
          <p>${escapeHTML(book.author)}</p>

          <button class="remove-button"
            data-action="remove" data-id="${book.id}">
            Remove
          </button>
        </div>

        <span class="demo-price">${money(book.price)}</span>
      </div>
    `).join("")}

    <div class="cart-total">
      <span>Demo total</span>
      <strong>${money(total)}</strong>
    </div>

    <button class="button full" data-action="save-library">
      ${currentUser() ? "Save to demo library" : "Log in to save books"}
    </button>

    <p class="small-note">
      No payment will be collected. This action only saves selections.
    </p>
  `;
}

function addToCart(id) {
  const book = books.find((item) => item.id === id);

  if (!book) return;

  if (currentUser()?.library.includes(id)) {
    toast("This book is already in your library.");
    return;
  }

  if (state.cart.includes(id)) {
    toast("This book is already in your cart.");
    return;
  }

  state.cart.push(id);
  saveState();
  renderAll();

  if ($("#book-modal").open) {
    openBookModal(id);
  }

  toast(`${book.title} added to your cart.`);
}

function saveCartToLibrary() {
  const user = currentUser();

  if (!user) {
    $("#cart-modal").close();
    location.hash = "login";
    toast("Log in to save your selected books.");
    return;
  }

  if (!state.cart.length) return;

  user.library = [...new Set([...user.library, ...state.cart])];
  state.cart = [];

  saveState();
  renderAll();

  $("#cart-modal").close();
  location.hash = "library";

  toast("Your selected books were saved to your demo library.");
}

/* ---------------- Wishlist ---------------- */

function toggleWishlist(id, button) {
  const adding = !wishlist.has(id);

  if (adding) wishlist.add(id);
  else wishlist.delete(id);

  writeJSON(WISHLIST_KEY, [...wishlist]);

  renderAll();

  const replacement = document.querySelector(
    `[data-action="wishlist"][data-id="${id}"]`
  );

  replacement?.focus({ preventScroll: true });

  toast(adding ? "Saved to your wishlist." : "Removed from your wishlist.");
}

/* ---------------- Router ---------------- */

const pages = {
  home: "Discover your next book",
  explore: "Explore books",
  library: "My library",
  login: "Log in",
  signup: "Create account",
  about: "About us",
  contact: "Contact us"
};

function route() {
  let pageId = location.hash.replace("#", "") || "home";

  if (!Object.hasOwn(pages, pageId)) {
    pageId = "home";
  }

  document.querySelectorAll(".page").forEach((page) => {
    page.hidden = true;
  });

  const activePage = document.getElementById(pageId);

  if (activePage) {
    activePage.hidden = false;
  }

  document.querySelectorAll("[data-nav]").forEach((link) => {
    const active = link.dataset.nav === pageId;

    link.classList.toggle("active", active);

    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  $("#main-nav").classList.remove("open");
  $("#menu-toggle").setAttribute("aria-expanded", "false");

  document.title = `${pages[pageId]} | Lumen Reads`;

  if (pageId === "library") renderLibrary();
  if (pageId === "explore") renderExplore();

  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", route);

document.addEventListener("click", (event) => {
  const navLink = event.target.closest('a[href^="#"]');

  if (navLink) {
    const target = navLink.getAttribute("href").slice(1);

    if (Object.hasOwn(pages, target)) {
      setTimeout(route, 0);
    }
  }
});

/* ---------------- Global actions ---------------- */

document.addEventListener("click", (event) => {
  const closeButton = event.target.closest("[data-close]");

  if (closeButton) {
    document.getElementById(closeButton.dataset.close).close();
    return;
  }

  const button = event.target.closest("[data-action]");

  if (!button) return;

  const id = Number(button.dataset.id);

  switch (button.dataset.action) {
    case "details":
      openBookModal(id);
      break;

    case "add":
      addToCart(id);
      break;

    case "wishlist":
      toggleWishlist(id, button);
      break;

    case "remove":
      state.cart = state.cart.filter((bookId) => bookId !== id);
      saveState();
      renderAll();
      renderCart();
      break;

    case "save-library":
      saveCartToLibrary();
      break;

    case "browse":
      $("#cart-modal").close();
      location.hash = "explore";
      setTimeout(route, 0);
      break;
  }
});

/* ---------------- Setup ---------------- */

function setupInterface() {
  const savedTheme = readJSON(THEME_KEY, null);

  const initialTheme = savedTheme ||
    (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

  document.documentElement.dataset.theme = initialTheme;

  function syncThemeButton() {
    const dark = document.documentElement.dataset.theme === "dark";

    $("#theme-button").textContent = dark ? "Light mode" : "Dark mode";
  }

  $("#theme-button").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark"
      ? "light"
      : "dark";

    document.documentElement.dataset.theme = next;
    writeJSON(THEME_KEY, next);
    syncThemeButton();
  });

  syncThemeButton();

  $("#menu-toggle").addEventListener("click", () => {
    const open = $("#main-nav").classList.toggle("open");

    $("#menu-toggle").setAttribute("aria-expanded", String(open));
  });

  $("#cart-button").addEventListener("click", () => {
    renderCart();
    $("#cart-modal").showModal();
  });

  $("#search-input").addEventListener("input", renderExplore);
  $("#category-filter").addEventListener("change", renderExplore);
  $("#sort-select").addEventListener("change", renderExplore);
  $("#wishlist-filter").addEventListener("change", renderExplore);

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const listView = button.dataset.view === "list";

      $("#book-results").classList.toggle("list-view", listView);

      document.querySelectorAll("[data-view]").forEach((item) => {
        item.classList.toggle("active", item === button);
        item.setAttribute("aria-pressed", String(item === button));
      });
    });
  });

  document.querySelectorAll(".category-tile").forEach((tile) => {
    tile.addEventListener("click", () => {
      $("#search-input").value = "";
      $("#category-filter").value = tile.dataset.category;
      $("#sort-select").value = "featured";
      $("#wishlist-filter").checked = false;

      renderExplore();

      location.hash = "explore";
      setTimeout(route, 0);
    });
  });

  $("#newsletter-form").addEventListener("submit", (event) => {
    event.preventDefault();

    $("#newsletter-status").textContent =
      "Thanks for trying the signup. This is a demo, so no subscription was created.";

    event.target.reset();
  });

  $("#signup-form").addEventListener("submit", (event) => {
    event.preventDefault();

    const name = $("#signup-name").value.trim();
    const email = $("#signup-email").value.trim().toLowerCase();
    const password = $("#signup-password").value;
    const confirm = $("#signup-confirm").value;
    const error = $("#signup-error");

    error.textContent = "";

    if (name.length < 2) {
      error.textContent = "Please enter at least two characters for your name.";
      return;
    }

    if (password !== confirm) {
      error.textContent = "The passwords do not match.";
      return;
    }

    if (state.users.some((user) => user.email === email)) {
      error.textContent = "An account with this email already exists.";
      return;
    }

    const user = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name,
      email,

      // Demo only. Do not use a real password in browser storage.
      password,

      library: []
    };

    state.users.push(user);
    state.currentUserId = user.id;

    saveState();
    event.target.reset();
    renderAll();

    location.hash = "library";
    setTimeout(route, 0);

    toast("Your demo account is ready.");
  });

  $("#login-form").addEventListener("submit", (event) => {
    event.preventDefault();

    const email = $("#login-email").value.trim().toLowerCase();
    const password = $("#login-password").value;
    const error = $("#login-error");

    error.textContent = "";

    const user = state.users.find(
      (account) => account.email === email && account.password === password
    );

    if (!user) {
      error.textContent = "The email address or password is incorrect.";
      return;
    }

    state.currentUserId = user.id;
    state.cart = state.cart.filter((id) => !user.library.includes(id));

    saveState();
    event.target.reset();
    renderAll();

    location.hash = "library";
    setTimeout(route, 0);

    toast(`Welcome back, ${user.name}.`);
  });

  $("#logout-button").addEventListener("click", () => {
    state.currentUserId = null;
    saveState();
    renderAll();

    location.hash = "home";
    setTimeout(route, 0);

    toast("You have been logged out.");
  });

  $("#contact-form").addEventListener("submit", (event) => {
    event.preventDefault();

    $("#contact-status").textContent =
      "Your demo message passed validation. No message was sent.";

    event.target.reset();
  });

  // Show fallback cover if a real cover image fails.
  document.addEventListener("error", (event) => {
    const image = event.target;

    if (
      !(image instanceof HTMLImageElement) ||
      !image.classList.contains("real-cover")
    ) {
      return;
    }

    image.hidden = true;

    const fallback = image.parentElement.querySelector(".cover-fallback");

    if (fallback) fallback.hidden = false;
  }, true);
}

/* ---------------- Start ---------------- */

$("#year").textContent = new Date().getFullYear();

setupInterface();
updateHeader();
renderAll();
route();
loadCatalog();