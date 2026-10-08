// ================= Config =================
const ROUNDS = 5;
const PANEL_W = 380;          // map padding so the pin area isn't hidden behind the panel
const MAX_POINTS = 5000;
const CLUE_PENALTY = 0.15;
// Colour for 3D buildings. The dark-map CSS filter inverts lightness, so a DARK gold here
// shows up as LIGHT gold on screen. Tweak this hex if it looks off.
const BUILDING_COLOR = '#7a5a10';

// ================= Map =================
const OSM_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'
    }
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
};

const map = new maplibregl.Map({
  container: 'map',
  style: OSM_STYLE,
  center: [19, 25],
  zoom: 1.3,
  minZoom: 1.2,
  maxPitch: 75,
  attributionControl: { compact: true }
});
map.on('error', (e) => console.warn('Map error:', e && e.error ? e.error.message : e));

// ================= Helpers =================
const $ = (id) => document.getElementById(id);
const show = (el) => el.classList.remove('gone');
const hide = (el) => el.classList.add('gone');
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const ZERO_PAD = { left: 0, right: 0, top: 0, bottom: 0 };

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function pinEl(kind) {
  const d = document.createElement('div');
  d.className = 'pin ' + kind;
  return d;
}

function countUp(el, to, ms = 1200, prefix = '+', suffix = ' ✦') {
  const start = performance.now();
  (function tick(now) {
    const f = Math.min((now - start) / ms, 1);
    const eased = 1 - Math.pow(1 - f, 3);
    el.textContent = prefix + Math.round(to * eased).toLocaleString() + suffix;
    if (f < 1) requestAnimationFrame(tick);
  })(start);
}

// ================= Intro spin =================
let spinning = true;
let lng = 19;
function spin() {
  if (!spinning) return;
  lng = (lng + 0.08) % 360;
  map.jumpTo({ center: [lng > 180 ? lng - 360 : lng, 25] });
  requestAnimationFrame(spin);
}

const intro = $('intro');
const startBtn = $('startBtn');
Glim.start();

function enableStart() {
  if (!startBtn.disabled) return;
  startBtn.disabled = false;
  startBtn.textContent = 'Fly over my world ✨';
  $('worldBtn').disabled = false;
}

map.on('load', () => {
  // 3D buildings from OpenFreeMap vector tiles (free, no key). Wrapped so a failure
  // can never break the game; Fairy-Scale just stays flat.
  try {
    map.addSource('openmaptiles', {
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet',
      attribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'
    });
    map.addLayer({
      id: 'buildings-3d',
      type: 'fill-extrusion',
      source: 'openmaptiles',
      'source-layer': 'building',
      minzoom: 14,
      paint: {
        'fill-extrusion-color': BUILDING_COLOR,
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.9
      }
    });
  } catch (err) { console.warn('3D buildings unavailable:', err); }
  enableStart();
  spin();
});
setTimeout(enableStart, 6000); // never leave the player stuck on "Loading"

// ================= Game state =================
const state = { round: 0, total: 0, order: [], place: null, cluesShown: 1, guess: null, phase: 'idle', lastPts: 0 };
let guessMarker = null, truthMarker = null;

function clearMarkers() {
  if (guessMarker) { guessMarker.remove(); guessMarker = null; }
  if (truthMarker) { truthMarker.remove(); truthMarker = null; }
}

function worldView() {
  map.flyTo({
    center: [10, 25], zoom: 1.9, pitch: 0, bearing: 0,
    padding: { left: PANEL_W, right: 0, top: 0, bottom: 0 },
    duration: 2200, essential: true
  });
}

function startGame() {
  state.round = 0;
  state.total = 0;
  state.order = shuffle(PLACES).slice(0, ROUNDS);
  $('scoreLabel').textContent = '0 ✦';
  show($('hud'));
  nextRound();
}

function nextRound() {
  clearMarkers();
  state.place = state.order[state.round];
  state.round += 1;
  state.cluesShown = 1;
  state.guess = null;
  state.phase = 'guessing';

  $('roundLabel').textContent = `Round ${state.round} / ${ROUNDS}`;
  show($('playArea'));
  hide($('result'));
  $('lockBtn').disabled = true;
  $('guessHint').textContent = 'Click the map to drop your pin.';
  renderClues();
  worldView();

  // Glim zips back to the mouse
  Glim.followMouse();
  Glim.burst(innerWidth / 2, innerHeight / 2, 70);
}

function renderClues() {
  const ul = $('clueList');
  ul.innerHTML = '';
  state.place.clues.slice(0, state.cluesShown).forEach((c) => {
    const li = document.createElement('li');
    li.textContent = c;
    ul.appendChild(li);
  });
  const more = $('moreClue');
  if (state.cluesShown >= 3) { more.disabled = true; more.textContent = 'No more clues'; }
  else { more.disabled = false; more.textContent = `Another clue (−${Math.round(CLUE_PENALTY * 100)}% points)`; }
}

$('moreClue').addEventListener('click', () => {
  if (state.phase !== 'guessing' || state.cluesShown >= 3) return;
  state.cluesShown += 1;
  renderClues();
  const r = $('moreClue').getBoundingClientRect();
  Glim.burst(r.left + r.width / 2, r.top, 25);
});

// Drop / move the pin
map.on('click', (e) => {
  if (state.phase !== 'guessing') return;
  const ll = e.lngLat.wrap();
  state.guess = ll;
  if (!guessMarker) guessMarker = new maplibregl.Marker({ element: pinEl('guess') }).setLngLat(ll).addTo(map);
  else guessMarker.setLngLat(ll);
  $('lockBtn').disabled = false;
  $('guessHint').textContent = 'Happy with it? Lock it in.';
  Glim.burst(e.point.x, e.point.y, 20);
});

// Lock in + reveal
$('lockBtn').addEventListener('click', lockIn);

function lockIn() {
  if (state.phase !== 'guessing' || !state.guess) return;
  state.phase = 'revealed';
  const p = state.place, g = state.guess;

  const d = haversine(g.lat, g.lng, p.lat, p.lng);
  const mult = 1 - CLUE_PENALTY * (state.cluesShown - 1);
  const pts = Math.round(MAX_POINTS * Math.exp(-d / 1500) * mult);
  state.total += pts;
  state.lastPts = pts;

  truthMarker = new maplibregl.Marker({ element: pinEl('truth') }).setLngLat([p.lng, p.lat]).addTo(map);

  hide($('playArea'));
  show($('result'));
  $('placeName').textContent = p.name;
  $('placeCountry').textContent = p.country;
  $('resultText').textContent = d < 50 ? 'Spot on! ✨' : `${Math.round(d).toLocaleString()} km away`;
  countUp($('pointsText'), pts);
  $('scoreLabel').textContent = state.total.toLocaleString() + ' ✦';
  $('nextBtn').textContent = state.round >= ROUNDS ? 'See results ✦' : 'Next →';

  map.fitBounds([[g.lng, g.lat], [p.lng, p.lat]], {
    padding: { top: 140, bottom: 140, left: 120, right: 140 },
    maxZoom: 7, duration: 2200, essential: true
  });
  map.once('moveend', () => {
    if (state.phase !== 'revealed') return;
    const a = map.project([g.lng, g.lat]);
    const b = map.project([p.lng, p.lat]);
    Glim.trail(a.x, a.y, b.x, b.y, 45);
    Glim.flyTo(b.x, b.y);
    setTimeout(() => Glim.burst(b.x, b.y, 130), 900);
    setTimeout(() => Glim.followMouse(), 4000);
  });
}

$('nextBtn').addEventListener('click', () => {
  if (state.round >= ROUNDS) showEnd(); else nextRound();
});

// ================= End screen =================
function rankFor(score) {
  if (score >= 20000) return 'Moonlight Navigator';
  if (score >= 14000) return 'Dust Weaver';
  if (score >= 8000) return 'Spark Seeker';
  return 'Fledgling Wisp';
}

function showEnd() {
  state.phase = 'ended';
  clearMarkers();
  hide($('hud'));
  $('rankTitle').textContent = rankFor(state.total);
  countUp($('finalScore'), state.total, 1800, '', '');
  $('geoMsg').textContent = '';
  $('end').classList.remove('hidden');
  map.flyTo({ center: [10, 25], zoom: 1.5, pitch: 0, bearing: 0, padding: ZERO_PAD, duration: 2500, essential: true });
  Glim.followMouse();
  setTimeout(() => Glim.burst(innerWidth / 2, innerHeight / 3, 150), 400);
}

$('againBtn').addEventListener('click', () => {
  $('end').classList.add('hidden');
  startGame();
});

// ================= Fairy-Scale Mode =================
const fairy = { active: false, spin: false, bearing: 0, from: 'hud', raf: 0 };

function enterFairy(lngV, latV, name, from) {
  fairy.from = from;
  fairy.active = true;
  fairy.spin = false;
  fairy.bearing = -30;

  hide($('hud'));
  $('end').classList.add('hidden');
  $('fairyTitle').textContent = `${name}, at fairy scale`;
  show($('fairyBar'));

  map.flyTo({
    center: [lngV, latV], zoom: 16.3, pitch: 65, bearing: fairy.bearing,
    padding: ZERO_PAD, duration: 5000, essential: true
  });
  map.once('moveend', () => {
    if (!fairy.active) return;
    fairy.spin = true;
    Glim.burst(innerWidth / 2, innerHeight / 2, 120);
  });

  (function loop(ts) {
    if (!fairy.active) return;
    if (fairy.spin) { fairy.bearing += 0.07; map.setBearing(fairy.bearing); }
    const a = ts / 1400;
    Glim.flyTo(
      innerWidth / 2 + Math.cos(a) * innerWidth * 0.28,
      innerHeight / 2 + Math.sin(a * 1.3) * innerHeight * 0.2
    );
    fairy.raf = requestAnimationFrame(loop);
  })(performance.now());
}

function exitFairy() {
  if (!fairy.active) return;
  fairy.active = false;
  cancelAnimationFrame(fairy.raf);
  hide($('fairyBar'));
  Glim.followMouse();
  if (fairy.from === 'end') {
    $('end').classList.remove('hidden');
    map.flyTo({ center: [10, 25], zoom: 1.5, pitch: 0, bearing: 0, padding: ZERO_PAD, duration: 2500, essential: true });
  } else {
    show($('hud'));
    worldView();
  }
}

$('fairyBtn').addEventListener('click', () => {
  const p = state.place;
  enterFairy(p.lng, p.lat, p.name, 'hud');
});
$('fairyBack').addEventListener('click', exitFairy);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') exitFairy(); });

// ---- Visit your own place (free OSM geocoding) ----
async function geocode(q) {
  const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' + encodeURIComponent(q));
  if (!r.ok) throw new Error('Geocoder error');
  const j = await r.json();
  if (!j.length) return null;
  return { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon), name: j[0].display_name.split(',')[0] };
}

async function goToOwnPlace() {
  const q = $('placeInput').value.trim();
  const msg = $('geoMsg');
  if (!q) { msg.textContent = 'Type a place first.'; return; }
  msg.textContent = 'Glim is looking…';
  try {
    const res = await geocode(q);
    if (!res) { msg.textContent = "Glim couldn't find that. Try adding the country."; return; }
    msg.textContent = '';
    enterFairy(res.lng, res.lat, res.name, 'end');
  } catch (err) {
    console.warn(err);
    msg.textContent = 'Search failed. Check your connection and try again.';
  }
}
$('goBtn').addEventListener('click', goToOwnPlace);
$('placeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') goToOwnPlace(); });

// ================= Start =================
async function startFlightFromIntro() {
  const typed = $('introPlace').value.trim();
  const msg = $('introMsg');
  msg.textContent = 'Glim is finding you…';
  try {
    let loc;
    if (typed) {
      loc = await geocode(typed);
      if (!loc) throw new Error('notfound');
    } else {
      const p = await Flight.locate();
      loc = { lat: p.lat, lng: p.lng, name: 'your corner of the world' };
    }
    msg.textContent = '';
    const r = startBtn.getBoundingClientRect();
    Glim.burst(r.left + r.width / 2, r.top + r.height / 2, 90);
    Flight.begin(loc.lat, loc.lng, loc.name);
  } catch (err) {
    console.warn(err);
    msg.textContent = typed
      ? "Glim couldn't find that place. Try adding the country."
      : "Couldn't read your location. Allow it in the browser, or type a town above.";
  }
}
startBtn.addEventListener('click', startFlightFromIntro);
$('introPlace').addEventListener('keydown', (e) => { if (e.key === 'Enter') startFlightFromIntro(); });

$('worldBtn').addEventListener('click', () => {
  const r = $('worldBtn').getBoundingClientRect();
  Glim.burst(r.left + r.width / 2, r.top + r.height / 2, 70);
  spinning = false;
  intro.classList.add('hidden');
  startGame();
});