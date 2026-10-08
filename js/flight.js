// Glim's Flight: wisps scatter, then YOU fly around and find them one by one.
const Flight = (() => {
  const WISPS_N = 8, PITCH = 68, ZOOM = 16.2;
  const COLLECT_PX = 90;       // collect radius in screen pixels
  const REVEAL_PX = 260;       // wisps shimmer (and become tappable) inside this radius
  const MOVE_PX_S = 320;       // flying speed in pixels/second (Shift = 2x)
  const TURN_DEG_S = 70;       // Q/E turn speed
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

  let active = false, raf = 0, startT = 0, lastT = 0, session = 0;
  let wisps = [], found = [], loc = null, currentTarget = null;
  const keys = new Set();

  const rad = Math.PI / 180;
  const distM = (a, b) => haversine(a.lat, a.lng, b.lat, b.lng) * 1000;
  const mpp = () => 78271.517 * Math.cos(map.getCenter().lat * rad) / Math.pow(2, map.getZoom());
  function bearingTo(a, b) {
    const dl = (b.lng - a.lng) * rad;
    const y = Math.sin(dl) * Math.cos(b.lat * rad);
    const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos(dl);
    return Math.atan2(y, x) / rad;
  }
  const fmtTime = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const camTo = (opts) => new Promise((res) => { map.once('moveend', res); map.easeTo({ essential: true, ...opts }); });

  // ---------- Keyboard (we handle it ourselves; MapLibre's keyboard handler is off) ----------
  window.addEventListener('keydown', (e) => {
    if (!active) return;
    if (e.key === 'Escape') { finish(); return; }
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    keys.add(e.key.toLowerCase());
    if (e.key.startsWith('Arrow') || e.key === ' ') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());

  // ---------- Toasts ----------
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

  // ---------- Location ----------
  function locate() {
    return new Promise((res, rej) => {
      if (!navigator.geolocation) return rej(new Error('no geolocation'));
      navigator.geolocation.getCurrentPosition(
        (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
        rej, { timeout: 8000, maximumAge: 60000 }
      );
    });
  }
  async function locateByIp() {
    const sources = [
      async () => {
        const r = await fetch('https://ipwho.is/');
        const j = await r.json();
        if (!j.success) throw new Error(j.message || 'ipwho.is failed');
        return { lat: j.latitude, lng: j.longitude, name: [j.city, j.region, j.country].filter(Boolean).join(', ') || 'your area' };
      },
      async () => {
        const r = await fetch('https://ipapi.co/json/');
        if (!r.ok) throw new Error('ipapi.co failed');
        const j = await r.json();
        return { lat: j.latitude, lng: j.longitude, name: [j.city, j.region, j.country_name].filter(Boolean).join(', ') || 'your area' };
      }
    ];
    for (const source of sources) {
      try {
        const l = await source();
        if (Number.isFinite(l.lat) && Number.isFinite(l.lng)) return l;
      } catch (err) { console.warn('IP location lookup failed:', err); }
    }
    throw new Error('unable to determine location');
  }
  async function locateBestEffort() {
    try { return await locate(); }
    catch (err) {
      console.warn('Browser geolocation failed, falling back to IP lookup:', err);
      return await locateByIp();
    }
  }

    const compass8 = (deg) => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round((((deg % 360) + 360) % 360) / 45) % 8];

  async function fetchWisps(lat, lng) {
    const around = `(around:1400,${lat},${lng})`;
    const q = `[out:json][timeout:10];(
      node${around}["name"]["amenity"~"cafe|restaurant|pub|library|place_of_worship|fountain|theatre|cinema|ice_cream"];
      node${around}["name"]["tourism"~"viewpoint|attraction|artwork|museum|gallery"];
      node${around}["name"]["historic"];
      node${around}["name"]["leisure"~"park|playground|garden"];
    );out 200;`;
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
      cands = j.elements.filter((e) => e.lat != null).map((e) => {
        const t = e.tags || {};
        const kind = t.amenity || t.tourism || t.historic || t.leisure || '';
        return { lat: e.lat, lng: e.lon, name: t.name, flavor: flavorFor(kind) };
      });
    } catch (err) { console.warn('Overpass failed, using fallback', err); }
    clearTimeout(to);

    const here = { lat, lng };
    const sector = (c) => Math.floor((((bearingTo(here, c) % 360) + 360) % 360) / 45);

    // Bucket candidates into 8 compass sectors, then take one per sector in rounds
    // so the wisps end up spread all around the player.
    const sectors = Array.from({ length: 8 }, () => []);
    shuffle(cands.filter((c) => { const d = distM(here, c); return d >= 200 && d <= 1400; }))
      .forEach((c) => sectors[sector(c)].push(c));

    const picked = [];
    for (const gap of [300, 200, 120]) {             // relax spacing only if we must
      let added = true;
      while (picked.length < WISPS_N && added) {
        added = false;
        for (const s of shuffle(sectors)) {
          if (picked.length >= WISPS_N) break;
          const i = s.findIndex((c) => picked.every((p) => distM(p, c) >= gap && p.name !== c.name));
          if (i >= 0) { picked.push(s.splice(i, 1)[0]); added = true; }
        }
      }
    }

    // Fallback: invented glades in different directions so the game always works
    let k = 0;
    while (picked.length < 4) {
      const b = (k++ * 90 + Math.random() * 40) * rad, d = 400 + Math.random() * 700;
      picked.push({
        lat: lat + (d * Math.cos(b)) / 111320,
        lng: lng + (d * Math.sin(b)) / (111320 * Math.cos(lat * rad)),
        name: 'A hidden glade', flavor: FLAVOR.glade
      });
    }

    // Clue = what it is + roughly where it is from the start
    picked.forEach((w) => {
      const d = Math.max(200, Math.round(distM(here, w) / 100) * 100);
      w.clue = `${w.flavor}, about ${d} m ${compass8(bearingTo(here, w))} of where you began`;
    });
    return picked;
  }

  // ---------- Map interaction ----------
  function setInteractive(on, keyboard = on) {
    ['dragPan', 'scrollZoom', 'doubleClickZoom', 'touchZoomRotate', 'dragRotate', 'boxZoom']
      .forEach((h) => map[h] && map[h][on ? 'enable' : 'disable']());
    if (map.keyboard) map.keyboard[keyboard ? 'enable' : 'disable']();
  }

  // ---------- Wisp markers ----------
    function makeWisp(w) 
    {
    const wrap = document.createElement('div');
    wrap.className = 'wisp-wrap';
    const glow = document.createElement('div'); glow.className = 'wisp';
    const label = document.createElement('div'); label.className = 'wisp-label';
    wrap.append(glow, label);
    // Tapping a wisp that is shimmering (revealed) catches it
    wrap.addEventListener('click', (e) => {
      e.stopPropagation();
      if (active && !w.got && wrap.classList.contains('revealed')) collect(w);
    });
        w.el = wrap; w.label = label;
        w.marker = new maplibregl.Marker({ element: wrap }).setLngLat([w.lng, w.lat]).addTo(map);
    }

      function hideWisps() {   // after the scatter: fade everything out; hudTick reveals them by proximity
    wisps.forEach((w) => {
      if (!w.el) return;
      w.el.style.opacity = '';
      w.el.classList.remove('revealed', 'near');
    });
  }

  function ensureHud() {
    if ($('fhClues')) return;
    const clues = document.createElement('div');
    clues.id = 'fhClues';
    clues.innerHTML = '<h3>Glim senses…</h3><ul id="fhClueList"></ul>';
    $('flightHud').appendChild(clues);
    const hint = document.createElement('span');
    hint.id = 'fhHint';
    $('fhCompass').appendChild(hint);
  }

  function renderFlightClues() {
    const ul = $('fhClueList');
    ul.textContent = '';
    wisps.forEach((w) => {
      const li = document.createElement('li');
      if (w.got) {
        li.className = 'done';
        const b = document.createElement('b'); b.textContent = w.name;
        li.append(b, document.createTextNode(w.flavor));
      } else li.textContent = w.clue;
      ul.appendChild(li);
    });
  }

  // Warmth meter: gets warmer/colder as you move; direction only appears when you're close
  const BANDS = [
    [120, 'Burning hot', '#ff7a59'], [250, 'Hot', '#ffb347'], [450, 'Warm', '#ffd978'],
    [800, 'Cool', '#6ff2e0'], [Infinity, 'Cold', '#8fb8ff']
  ];
  let prevD = null, trend = 0, trendT = 0;
  function updateHint(w, d, here, now) {
    const arrow = $('fhArrow'), dist = $('fhDist'), hint = $('fhHint');
    if (!w) { arrow.style.opacity = 0; dist.textContent = ''; hint.textContent = ''; return; }
    if (now - trendT > 700) {
      trend = prevD == null ? 0 : d < prevD - 10 ? 1 : d > prevD + 10 ? -1 : 0;
      prevD = d; trendT = now;
    }
    const [, label, color] = BANDS.find((b) => d < b[0]);
    dist.textContent = label + (trend > 0 ? ' ▲ warmer' : trend < 0 ? ' ▼ colder' : '');
    dist.style.color = color;
    arrow.style.color = color;
    const rel = ((bearingTo(here, w) - map.getBearing()) % 360 + 540) % 360 - 180;
    if (d < 450) {
      arrow.style.opacity = d < 250 ? 1 : 0.55;
      arrow.style.transform = `rotate(${rel}deg)`;
      const a = Math.abs(rel);
      hint.textContent = d < 250
        ? 'A wisp is ' + (a < 35 ? 'just ahead' : a > 145 ? 'right behind you' : rel > 0 ? 'to your right' : 'to your left')
        : 'Something shimmers nearby…';
    } else {
      arrow.style.opacity = 0;
      hint.textContent = d < 800 ? 'Keep exploring. Check the clues for a direction.' : 'Nothing close. Follow the clues on the left.';
    }
  }
    // Wisps appear at their real places; only their visibility changes over time.
  function disperse(ms = 3000) {
    return new Promise((res) => {
      const n = wisps.length, stagger = 0.05, span = 1 - stagger * (n - 1);
      wisps.forEach((w, i) => setTimeout(() => {
        if (!w.el) return;
        w.el.style.opacity = '1';
        w.el.classList.add('revealed');
        const p = map.project([w.lng, w.lat]);
        Glim.burst(p.x, p.y, 18);
      }, i * stagger * ms));
      setTimeout(res, ms);
    });
  }

  // ---------- Per-frame: move, collect, HUD ----------
  function nearestWisp() {
    const c = map.getCenter(), here = { lat: c.lat, lng: c.lng };
    let best = null, bd = Infinity;
    for (const w of wisps) {
      if (w.got) continue;
      const d = distM(here, w);
      if (d < bd) { bd = d; best = w; }
    }
    return best ? { w: best, d: bd } : null;
  }

    function hudTick(now) {
    if (!active) return;
    const dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;
    $('fhTime').textContent = fmtTime((now - startT) / 1000);

    // Fly with WASD / arrows, turn with Q/E
    const f = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
    const r = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    const t = (keys.has('e') ? 1 : 0) - (keys.has('q') ? 1 : 0);
    if (f || r || t) {
      const c0 = map.getCenter();
      const b = map.getBearing() * rad;
      const dist = MOVE_PX_S * (keys.has('shift') ? 2 : 1) * mpp() * dt;
      const north = (f * Math.cos(b) - r * Math.sin(b)) * dist;
      const east = (f * Math.sin(b) + r * Math.cos(b)) * dist;
      map.jumpTo({
        center: [c0.lng + east / (111320 * Math.cos(c0.lat * rad)), c0.lat + north / 111320],
        bearing: map.getBearing() + t * TURN_DEG_S * dt
      });
    }

    // Reveal / collect by proximity
    const c = map.getCenter(), here = { lat: c.lat, lng: c.lng };
    const m = mpp();
    const collectR = Math.max(40, COLLECT_PX * m);
    const revealR = Math.max(110, REVEAL_PX * m);
    let nearest = null, nd = Infinity;
    for (const w of wisps) {
      if (w.got) continue;
      const d = distM(here, w);
      if (d < collectR) { collect(w); continue; }
      w.el.classList.toggle('revealed', d < revealR);
      w.el.classList.toggle('near', d < collectR * 1.8);
      if (d < nd) { nd = d; nearest = w; }
    }
    updateHint(nearest, nd, here, now);
    raf = requestAnimationFrame(hudTick);
  }

    
  // ---------- Begin ----------
  async function begin(lat, lng, name) {
    Music.start('flight');
    const my = ++session;
    loc = { lat, lng, name };
    spinning = false;
    state.phase = 'flying';
    active = false;
    keys.clear();
    hide($('hud'));
    $('end').classList.add('hidden');
    $('intro').classList.add('hidden');
    $('flightEnd').classList.add('hidden');
    clearMarkers();
    setInteractive(false);
    toast('Glim is gathering wisps near ' + name + '…', 0);

    const list = await fetchWisps(lat, lng);
    if (my !== session) return;
    wisps = list;
    found = [];
    wisps.forEach(makeWisp);
    ensureHud();
    renderFlightClues();

    $('fhCount').textContent = `0 / ${wisps.length} wisps`;
    $('fhTime').textContent = '0:00';
    $('fhArrow').style.transform = 'rotate(0deg)';
    $('fhDist').textContent = '';
    $('fhHelp').textContent = 'Drag to pan · Right-drag to turn · WASD / arrows to fly · Q/E turn · Tap a shimmering wisp to catch it · Esc to land';

    // 1) swoop in to the spot
    Glim.flyTo(innerWidth / 2, innerHeight * 0.66);
    Glim.burst(innerWidth / 2, innerHeight / 2, 100);
    map.flyTo({
      center: [lng, lat], zoom: ZOOM, pitch: PITCH, bearing: 0,
      padding: { top: innerHeight * 0.32, bottom: 0, left: 0, right: 0 },
      duration: 6000, essential: true
    });
    await new Promise((res) => map.once('moveend', res));
    if (my !== session) return;

        // 2) pull back a little and watch the wisps scatter... then vanish into hiding
    toast('Glim scatters her wisps across the neighbourhood…', 0);
    await camTo({ zoom: 15, pitch: 55, duration: 1500 });
    if (my !== session) return;
    await disperse(3000);
    if (my !== session) return;
    await wait(700);
    toast('…and they sink into hiding. Explore to find them!', 3500);
    hideWisps();
    await wait(1000);
    if (my !== session) return;

    // 3) drop back down to fairy scale and hand over control
    await camTo({ zoom: ZOOM, pitch: PITCH, duration: 2000 });
    if (my !== session) return;
    run();
  }

  function run() {
    if (state.phase !== 'flying') return;
    active = true;
    map.setMinZoom(13.5);
    map.setMaxZoom(18.5);
    setInteractive(true, false);   // free look, but we handle keys ourselves
    show($('flightHud'));
    prevD = null;
    Glim.flyTo(innerWidth / 2, innerHeight * 0.66);
    toast(`${wisps.length} wisps are hiding nearby. Fly around and find them! Follow the arrow if you get lost.`, 7000);
    startT = lastT = performance.now();
    raf = requestAnimationFrame(hudTick);
  }

    function collect(w) {
    if (w.got) return;
    w.got = true;
    found.push(w);
    w.el.classList.remove('near');
    w.el.classList.add('revealed', 'found');
    w.label.textContent = w.name;
    const p = map.project([w.lng, w.lat]);
    Glim.burst(p.x, p.y, 140);
    const fc = $('fhCount');
    fc.textContent = `${found.length} / ${wisps.length} wisps`;
    fc.classList.remove('bump'); void fc.offsetWidth; fc.classList.add('bump');
    renderFlightClues();
    toastFound(w.name, w.flavor + ' · ' + Math.round(distM(loc, w)) + ' m from where you began');
    if (found.length === wisps.length) setTimeout(finish, 3500);
  }

  function finish() {
    if (!active) return;
    active = false;
    session++;
    cancelAnimationFrame(raf);
    keys.clear();
    Music.stop();
    state.phase = 'idle';
    hide($('flightHud'));
    $('toast').classList.add('gone');
    wisps.forEach((w) => w.marker && w.marker.remove());
    map.setMinZoom(1.2);
    map.setMaxZoom(22);
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
    map.flyTo({ center: [loc.lng, loc.lat], zoom: 14, pitch: 55, bearing: 0, padding: ZERO_PAD, duration: 3000, essential: true });
    setTimeout(() => Glim.burst(innerWidth / 2, innerHeight / 3, 150), 500);
  }

  $('feAgain').addEventListener('click', () => begin(loc.lat, loc.lng, loc.name));
  $('feWorld').addEventListener('click', () => {
    $('flightEnd').classList.add('hidden');
    map.flyTo({ pitch: 0, bearing: 0, padding: ZERO_PAD, duration: 1500 });
    startGame();
  });

  return { begin, locate: locateBestEffort };
})();