// ---------- OpenStreetMap base layer (official OSM tiles) ----------
const OSM_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'
    }
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
};

// ---------- Map (3D globe) ----------
const map = new maplibregl.Map({
  container: 'map',
  style: OSM_STYLE,
  center: [19, 25],
  zoom: 1.3,
  projection: { type: 'globe' },
  interactive: false,                      // no dragging during the intro
  attributionControl: { compact: true }
});

map.on('error', (e) => console.warn('Map error:', e && e.error ? e.error.message : e));

// ---------- Slow globe spin ----------
let spinning = true;
let lng = 19;

function spin() {
  if (!spinning) return;
  lng = (lng + 0.1) % 360;
  const centered = lng > 180 ? lng - 360 : lng;
  map.jumpTo({ center: [centered, 25] });
  requestAnimationFrame(spin);
}

// ---------- UI ----------
const intro = document.getElementById('intro');
const startBtn = document.getElementById('startBtn');

Glim.start(); // Glim appears immediately, even while the map loads

map.on('load', () => {
  startBtn.disabled = false;
  startBtn.textContent = 'Follow the Glim ✨';
  spin();
});

startBtn.addEventListener('click', () => {
  const r = startBtn.getBoundingClientRect();
  Glim.burst(r.left + r.width / 2, r.top + r.height / 2, 90);
  spinning = false;
  intro.classList.add('hidden');
  console.log('Intro dismissed. The dive comes in Step 3!');
});