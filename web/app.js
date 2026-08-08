const elements = {
  coordinates: document.querySelector("#coordinates"),
  updatedAt: document.querySelector("#updated-at"),
  mapEmpty: document.querySelector("#map-empty"),
  emptyMessage: document.querySelector("#empty-message"),
  mapKey: document.querySelector("#map-key"),
  history: document.querySelector("#history-list"),
  pointCount: document.querySelector("#point-count"),
};

let map;
let currentMarker;
let historyLayer;
let trackLine;
let lastFingerprint = "";
let lastMapRenderKey = "";
let trackingHash = "";

function requestedTracker() {
  const query = new URLSearchParams(window.location.search).get("phone");
  if (query) {
    // URLSearchParams decodes an unescaped leading "+" as a space.
    return query.startsWith(" ") ? `+${query.trim()}` : query.trim();
  }

  const baseParts = window.HIKE_TRACKER_BASE_PATH.split("/").filter(Boolean);
  const pathParts = window.location.pathname.split("/").filter(Boolean);
  return pathParts.slice(baseParts.length).join("").trim();
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function resolveTrackerHash(value) {
  if (/^[a-f0-9]{64}$/i.test(value)) return value.toLowerCase();
  if (!value.startsWith("+")) return "";
  const digits = value.replace(/\D/g, "");
  const canonical = digits.length === 10 ? `+1${digits}` : `+${digits}`;
  if (!/^\+\d{11,15}$/.test(canonical)) return "";
  return sha256(canonical);
}

function relativeTime(timestamp) {
  const milliseconds = Date.now() - new Date(timestamp).getTime();
  if (!Number.isFinite(milliseconds)) return "at an unknown time";
  const future = milliseconds < 0;
  const minutes = Math.max(0, Math.round(Math.abs(milliseconds) / 60_000));
  if (minutes < 1) return future ? "in a moment" : "just now";
  if (minutes < 60) return future ? `in ${minutes} minutes` : `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return future ? `in ${hours} hours` : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return future ? `in ${days} days` : `${days} days ago`;
}

function formatCoordinates(point) {
  return `${Number(point.latitude).toFixed(5)}, ${Number(point.longitude).toFixed(5)}`;
}

function ensureMap() {
  if (map) return;
  map = L.map("map", {
    zoomControl: true,
    preferCanvas: true,
    scrollWheelZoom: true,
    wheelDebounceTime: 20,
    wheelPxPerZoomLevel: 50,
    zoomSnap: 0.25,
    zoomDelta: 1,
    zoomAnimation: true,
    fadeAnimation: true,
    markerZoomAnimation: true,
    inertia: true,
    inertiaDeceleration: 2600,
    inertiaMaxSpeed: 1800,
    easeLinearity: 0.2,
  }).setView([49.2827, -123.1207], 10);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  historyLayer = L.layerGroup().addTo(map);

  // The stylesheet is loaded from a computed GitHub Pages base path. If it
  // arrives after Leaflet initializes, recompute the viewport once dimensions
  // settle and whenever the responsive container changes size.
  requestAnimationFrame(() => map.invalidateSize({ pan: false }));
  if ("ResizeObserver" in window) {
    let resizeFrame;
    new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => map.invalidateSize({ pan: false }));
    }).observe(document.querySelector("#map"));
  }
}

function renderMap(history, fingerprint) {
  ensureMap();
  const renderKey = `${history.length}:${fingerprint}`;
  if (renderKey === lastMapRenderKey) return;

  historyLayer.clearLayers();
  if (trackLine) trackLine.remove();
  if (currentMarker) currentMarker.remove();

  const points = history.map((point) => [point.latitude, point.longitude]);
  trackLine = L.polyline(points, { color: "#1e4d35", weight: 4, opacity: 0.78 }).addTo(map);

  history.slice(0, -1).forEach((point) => {
    L.circleMarker([point.latitude, point.longitude], {
      radius: 4,
      color: "#fffef8",
      weight: 2,
      fillColor: "#4f7f55",
      fillOpacity: 1,
    }).bindTooltip(formatCoordinates(point)).addTo(historyLayer);
  });

  const latest = history.at(-1);
  currentMarker = L.marker([latest.latitude, latest.longitude], {
    icon: L.divIcon({ className: "", html: '<div class="current-marker"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
    zIndexOffset: 1000,
  }).bindPopup(`<strong>Current location</strong><br>${formatCoordinates(latest)}`).addTo(map);

  if (!lastFingerprint) {
    if (points.length === 1) {
      map.setView(points[0], 13, { animate: false });
    } else {
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15, animate: false });
    }
  } else if (lastFingerprint !== fingerprint && !map.getBounds().pad(-0.15).contains(currentMarker.getLatLng())) {
    map.panTo(currentMarker.getLatLng(), { animate: true, duration: 0.45 });
  }
  lastFingerprint = fingerprint;
  lastMapRenderKey = renderKey;
}

function renderHistory(history) {
  const fragment = document.createDocumentFragment();
  [...history].reverse().forEach((point) => {
    const item = document.createElement("li");
    item.className = "history-item";

    const time = document.createElement("time");
    time.dateTime = point.timestamp;
    time.textContent = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(point.timestamp));
    const coordinates = document.createElement("strong");
    coordinates.textContent = formatCoordinates(point);
    const source = document.createElement("small");
    source.textContent = (point.sourceFormat || "location").replaceAll("_", " ");

    item.append(time, coordinates, source);
    fragment.append(item);
  });
  elements.history.replaceChildren(fragment);
  elements.pointCount.textContent = `${history.length} ${history.length === 1 ? "point" : "points"}`;
}

function showEmpty(message) {
  elements.coordinates.textContent = message;
  elements.updatedAt.textContent = "";
  elements.emptyMessage.textContent = message;
  elements.mapEmpty.hidden = false;
  elements.mapKey.hidden = true;
  elements.history.replaceChildren();
  elements.pointCount.textContent = "0 points";
  ensureMap();
}

function renderTracker(entry) {
  const history = Array.isArray(entry?.history) ? entry.history : [];
  if (!history.length || !entry.lastLocation) {
    showEmpty("No location received yet.");
    return;
  }

  const latest = entry.lastLocation;
  elements.coordinates.textContent = formatCoordinates(latest);
  elements.updatedAt.textContent = `Updated ${relativeTime(latest.timestamp)}`;
  elements.updatedAt.title = new Date(latest.timestamp).toLocaleString();
  elements.mapEmpty.hidden = true;
  elements.mapKey.hidden = false;
  renderMap(history, latest.fingerprint || `${latest.timestamp}|${latest.latitude}|${latest.longitude}`);
  renderHistory(history);
}

async function refresh() {
  try {
    const dataUrl = new URL(`${window.HIKE_TRACKER_BASE_PATH}data/locations.json`, window.location.origin);
    dataUrl.searchParams.set("v", Date.now().toString());
    const response = await fetch(dataUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Location data request failed (${response.status})`);
    const data = await response.json();
    const entry = data[trackingHash];
    if (!entry) {
      showEmpty("No tracking data found.");
      return;
    }
    renderTracker(entry);
  } catch (error) {
    console.error(error);
    elements.updatedAt.textContent = "Could not refresh location data. Retrying in one minute.";
  }
}

trackingHash = await resolveTrackerHash(requestedTracker());
if (!trackingHash) {
  showEmpty("No tracking data found.");
} else {
  await refresh();
  window.setInterval(refresh, 60_000);
  window.setInterval(() => {
    const timestamp = document.querySelector(".history-item time")?.dateTime;
    if (timestamp) elements.updatedAt.textContent = `Updated ${relativeTime(timestamp)}`;
  }, 30_000);
}
