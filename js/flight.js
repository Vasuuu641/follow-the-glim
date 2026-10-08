// Glim's Flight: fly over your own surroundings and collect wisps placed on real OSM places.
const Flight = (() => {
  const WISPS_N = 8, COLLECT_R = 90, PITCH = 68, ZOOM = 16.2;
  const FLAVOR = {
    cafe: 'a cosy hearth where warm things brew', ice_cream: 'a frozen treasure trove',
    restaurant: 'a feasting hall for hungry travellers', pub: 'a lantern-lit meeting place',
    library: 'a tower of sleeping stories', place_of_worship: 'a quiet spire of old whispers',
    fountain: 'a wishing well of the town', theatre: 'a hall where dreams are shown',
    cinema: 'a hall where dreams are shown', viewpoint: 'a window onto the whole sky',
    attraction: 'a landmark the pixies love', artwork: 'a secret left by an artist',
    museum: 'a vault of remembered things', gallery: 'a vault of painted things',
    park: 'a green hush', garden: 'a green hush', playground: 'where laughter lingers',
    glade: 'a glade Glim made up just for you'
  };
  const flavorFor = (k) => FLAVOR[k] || 'a place Glim is fond of';

  let active = false, raf = 0, last = 0, startT = 0;
  let pos = { lat: 0, lng: 0 }, bearing = 0, speed = 100, steer = 0;
  let wisps = [], found = [], loc = null;
  const mouse = { x: innerWidth / 2, y: innerHeight / 2 };
  const keys = {};

  window.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
  window.addEventListener('keydown', (e) => {
    keys[e.key.toLowerCase()] = true;
    if (e.key === 'Escape' && active) finish();
  });
  window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

  const rad = Math.PI / 180;
  const distM = (a, b) => haversine(a.lat, a.lng, b.lat, b.lng) * 1000;
  function bearingTo(a, b) {
    const dl = (b.lng - a.lng) * rad;
    const y = Math.sin(dl) * Math.cos(b.lat * rad);
    const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos(dl);
    return Math.atan2(y, x) / rad;
  }
  const fmtTime = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

  function toast(html, ms = 4500) {
    const t = $('toast');
    t.innerHTML = html;
    t.classList.remove('gone');
    clearTimeout(toast._t);
    if (ms) toast._t = setTimeout(() => t.classList.add('gone'), ms);
  }
  function toastFound(name, flavor) {
    const t = $('toast');
    t.textContent = '';
    const b = document.createElement('b'); b.textContent = name;
    t.appendChild(b);
    t.appendChild(document.createTextNode('— ' + flavor));
    t.classList.remove('gone');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('gone'), 5000);
  }

  function locate() {
    return new Promise((res, rej) => {
      if (!navigator.geolocation) return rej(new Error('no geolocation'));
      navigator.geolocation.getCurrentPosition(
        (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
        rej, { timeout: 8000, maximumAge: 60000 }
      );
    });
  }

  // ---------- Real places from OSM (Overpass), with a safe fallback ----------
  async function fetchWisps(lat, lng) {
    const around = `(around:1500,${lat},${lng})`;
    const q = `[out:json][timeout:10];(
      node${around}["name"]["amenity"~"cafe|restaurant|pub|library|place_of_worship|fountain|theatre|cinema|ice_cream"];
      node${around}["name"]["tourism"~"viewpoint|attraction|artwork|museum|gallery"];
      node${around}["name"]["historic"];
      node${around}["name"]["leisure"~"park|playground|garden"];
    );out 80;`;
    let cands = [];
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 9000);
    try {
      const r = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q)
      });
      const j = await r.json();
      cands = j.elements.map((e) => {
        const t = e.tags || {};
        const kind = t.amenity || t.tourism || t.historic || t.leisure || '';
        return { lat: e.lat, lng: e.lon, name: t.name, flavor: flavorFor(kind) };
      });
    } catch (err) { console.warn('Overpass failed, using fallback', err); }
    clearTimeout(to);

    const here = { lat, lng };
    const picked = [];
    for (const c of shuffle(cands)) {
      if (distM(here, c) < 150) continue;
      if (picked.some((p) => distM(p, c) < 150)) continue;
      picked.push(c);
      if (picked.length >= WISPS_N) break;
    }
    // Fallback: invented glades so the game always works
    while (picked.length < 4) {
      const b = Math.random() * 360 * rad, d = 350 + Math.random() * 1000;
      picked.push({
        lat: lat + (d * Math.cos(b)) / 111320,
        lng: lng + (d * Math.sin(b)) / (111320 * Math.cos(lat * rad)),
        name: 'A hidden glade', flavor: FLAVOR.glade
      });
    }
    return picked;
  }

  function setInteractive(on) {
    ['dragPan', 'scrollZoom', 'doubleClickZoom', 'keyboard', 'touchZoomRotate', 'dragRotate', 'boxZoom']
      .forEach((h) => map[h] && map[h][on ? 'enable' : 'disable']());
  }

  // ---------- Begin ----------
  async function begin(lat, lng, name) {
    loc = { lat, lng, name };
    spinning = false;
    state.phase = 'flying';
    hide($('hud'));
    $('end').classList.add('hidden');
    $('intro').classList.add('hidden');
    $('flightEnd').classList.add('hidden');
    clearMarkers();
    setInteractive(false);
    toast('Glim is gathering wisps near ' + name + '…', 0);

    const list = await fetchWisps(lat, lng);
    wisps = list.map((w) => {
      const el = document.createElement('div');
      el.className = 'wisp';
      w.marker = new maplibregl.Marker({ element: el }).setLngLat([w.lng, w.lat]).addTo(map);
      return w;
    });
    found = [];
    $('fhCount').textContent = `0 / ${wisps.length} wisps`;
    $('fhTime').textContent = '0:00';

    Glim.burst(innerWidth / 2, innerHeight / 2, 100);
    map.flyTo({
      center: [lng, lat], zoom: ZOOM, pitch: PITCH, bearing: 0,
      padding: { top: innerHeight * 0.32, bottom: 0, left: 0, right: 0 },
      duration: 6000, essential: true
    });
    map.once('moveend', run);
    toast('Glim has scattered ' + wisps.length + ' wisps nearby. Fly through them to find the places.', 6000);
  }

  function run() {
    if (state.phase !== 'flying') return;
    active = true;
    pos = { lat: loc.lat, lng: loc.lng };
    bearing = map.getBearing();
    steer = 0; speed = 100;
    last = startT = performance.now();
    show($('flightHud'));
    raf = requestAnimationFrame(tick);
  }

  function tick(now) {
    if (!active) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    // Steering: Glim turns toward where the cursor points, and stops when it is straight ahead
    const cx = innerWidth / 2, cy = innerHeight * 0.66;   // where Glim sits on screen
    const mx = mouse.x - cx, my = cy - mouse.y;
    const ang = Math.hypot(mx, my) < 60 ? 0 : Math.atan2(mx, my) / rad;  // -180..180, 0 = straight ahead
    let target = Math.max(-1, Math.min(1, ang / 45));
    if (keys['a'] || keys['arrowleft']) target = -1;
    if (keys['d'] || keys['arrowright']) target = 1;
    steer += (target - steer) * Math.min(1, dt * 4);
    bearing += steer * 55 * dt;
    

    const tgtSpeed = (keys['w'] || keys['arrowup']) ? 230 : (keys['s'] || keys['arrowdown']) ? 45 : 100;
    speed += (tgtSpeed - speed) * Math.min(1, dt * 3);

    const d = speed * dt, b = bearing * rad;
    pos.lat += (d * Math.cos(b)) / 111320;
    pos.lng += (d * Math.sin(b)) / (111320 * Math.cos(pos.lat * rad));

    map.jumpTo({ center: [pos.lng, pos.lat], bearing, pitch: PITCH, zoom: ZOOM });
    Glim.flyTo(innerWidth / 2 + steer * innerWidth * 0.12, innerHeight * 0.66 + Math.sin(now / 450) * 8);

    // Collect + compass
    let nearest = null, nd = Infinity;
    for (const w of wisps) {
      if (w.got) continue;
      const dd = distM(pos, w);
      if (dd < COLLECT_R) { collect(w); continue; }
      if (dd < nd) { nd = dd; nearest = w; }
    }
    if (nearest) {
      const rel = ((bearingTo(pos, nearest) - bearing) % 360 + 540) % 360 - 180;
      $('fhArrow').style.transform = `rotate(${rel}deg)`;
      $('fhDist').textContent = nd >= 1000 ? (nd / 1000).toFixed(1) + ' km' : Math.round(nd) + ' m';
    }
    $('fhTime').textContent = fmtTime((now - startT) / 1000);
    raf = requestAnimationFrame(tick);
  }

  function collect(w) {
    w.got = true;
    found.push(w);
    const p = map.project([w.lng, w.lat]);
    Glim.burst(p.x, p.y, 110);
    w.marker.remove();
    $('fhCount').textContent = `${found.length} / ${wisps.length} wisps`;
    toastFound(w.name, w.flavor + ' · ' + Math.round(distM(loc, w)) + ' m from where you began');
    if (found.length === wisps.length) setTimeout(finish, 2200);
  }

  function finish() {
    if (!active) return;
    active = false;
    cancelAnimationFrame(raf);
    state.phase = 'idle';
    hide($('flightHud'));
    $('toast').classList.add('gone');
    wisps.forEach((w) => w.marker && w.marker.remove());
    setInteractive(true);
    Glim.followMouse();

    const secs = (performance.now() - startT) / 1000;
    $('feTitle').textContent = found.length === wisps.length ? 'Dust Jar Full' : 'Glim Waits For You';
    $('feStats').textContent = `${found.length} of ${wisps.length} wisps near ${loc.name} in ${fmtTime(secs)}`;
    const ul = $('feList');
    ul.innerHTML = '';
    found.forEach((w) => {
      const li = document.createElement('li');
      const b = document.createElement('b'); b.textContent = w.name;
      const s = document.createElement('span'); s.textContent = w.flavor;
      li.append(b, s);
      ul.appendChild(li);
    });
    $('flightEnd').classList.remove('hidden');
    map.flyTo({ center: [loc.lng, loc.lat], zoom: 14, pitch: 55, bearing: bearing, padding: ZERO_PAD, duration: 3000, essential: true });
    setTimeout(() => Glim.burst(innerWidth / 2, innerHeight / 3, 150), 500);
  }

  $('feAgain').addEventListener('click', () => begin(loc.lat, loc.lng, loc.name));
  $('feWorld').addEventListener('click', () => {
    $('flightEnd').classList.add('hidden');
    map.flyTo({ pitch: 0, bearing: 0, padding: ZERO_PAD, duration: 1500 });
    startGame();
  });

  return { begin, locate };
})();