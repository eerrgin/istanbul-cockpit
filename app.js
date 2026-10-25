import {
  bearing,
  buildStopGraph,
  coordsToLineString,
  dijkstra,
  formatDistance,
  formatDuration,
  haversine,
  normalizeAdsbLolAircraft,
  normalizeOpenSkyStates,
  overpassToGeoJSON,
  readCache,
  wmoToTurkish,
  writeCache
} from './utils.js';

const CENTER = { lat: 41.0082, lon: 28.9784 };
const FLIGHT_TTL = 10 * 60 * 1000;
const WEATHER_TTL = 10 * 60 * 1000;
const TRANSIT_TTL = 30 * 60 * 1000;
const PLACE_SEARCH_GAP = 700;
const OVERPASS_ENDPOINTS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];
const OVERPASS_QUERY = '[out:json][timeout:25];(relation["route"~"^(subway|light_rail|tram|ferry|train|monorail)$"](40.80,28.40,41.35,29.50););out geom;';
const LAYER_IDS = {
  lines: 'transit-lines',
  stops: 'transit-stops',
  flights: 'flights',
  weather: 'weather-point'
};
const PROFILE_LABEL = { foot: 'Yürüme', bike: 'Bisiklet', driving: 'Araba' };

let map = null;
let mapReady = false;
let liveDataStarted = false;
let profile = 'foot';
let stopRecords = [];
let stopGraph = null;
let weatherMarker = null;
let tileWarned = false;
let nomChain = Promise.resolve();
let nomAt = 0;
const searchSeq = { origin: 0, destination: 0 };
const debounceTimers = new Map();
const markers = { origin: null, destination: null };

function emptyCollection() {
  return { type: 'FeatureCollection', features: [] };
}

function toast(message, kind) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const el = document.createElement('div');
  const tone = kind || 'error';
  el.className = `toast toast-${tone}`;
  el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  el.textContent = message;
  box.append(el);
  setTimeout(() => {
    el.classList.add('toast-out');
    setTimeout(() => el.remove(), 280);
  }, 4600);
}

function hideLoading() {
  const el = document.getElementById('loading');
  if (el) el.hidden = true;
}

function setLucide(slotId, name) {
  const slot = document.getElementById(slotId);
  if (!slot) return;
  slot.replaceChildren();
  const icon = document.createElement('i');
  icon.setAttribute('data-lucide', name);
  slot.append(icon);
  if (window.lucide) window.lucide.createIcons();
}

async function fetchJson(url, options, timeoutMs, label) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...(options || {}), signal: ctrl.signal });
    if (!response.ok) throw new Error(`${label} yanıtı başarısız (${response.status})`);
    try {
      return await response.json();
    } catch (error) {
      throw new Error(`${label} yanıtı okunamadı`);
    }
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error(`${label} zaman aşımına uğradı`);
    if (error instanceof TypeError) throw new Error(`${label} ağına ulaşılamadı`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function storage() {
  return window.localStorage;
}

function modeLabel(mode) {
  if (mode === 'subway') return 'Metro';
  if (mode === 'light_rail') return 'Hafif ray';
  if (mode === 'tram') return 'Tramvay';
  if (mode === 'ferry') return 'Vapur';
  if (mode === 'train') return 'Tren / Marmaray';
  if (mode === 'monorail') return 'Monoray';
  return 'Hat';
}

function cardinal(degrees) {
  const names = ['kuzey', 'kuzeydoğu', 'doğu', 'güneydoğu', 'güney', 'güneybatı', 'batı', 'kuzeybatı'];
  const index = Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
  return names[index];
}

function readPoint(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  const lat = Number(el.dataset.lat);
  const lon = Number(el.dataset.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

function stepText(step) {
  const maneuver = step.maneuver || {};
  const type = maneuver.type || '';
  const modifier = maneuver.modifier || '';
  const words = {
    left: 'sola',
    right: 'sağa',
    'slight left': 'hafif sola',
    'slight right': 'hafif sağa',
    'sharp left': 'keskin sola',
    'sharp right': 'keskin sağa',
    straight: 'düz',
    uturn: 'U dönüşü'
  };
  const mod = words[modifier] || '';
  const name = step.name ? ` · ${step.name}` : '';
  const dist = formatDistance(step.distance || 0);
  if (type === 'arrive') return `Varış${name}`;
  if (type === 'depart') return `Yola çıkın${name} (${dist})`;
  if (type === 'roundabout' || type === 'rotary' || type === 'exit roundabout' || type === 'exit rotary') {
    const exit = maneuver.exit ? ` ${maneuver.exit}. çıkış` : '';
    return `Göbek${exit}${name} (${dist})`;
  }
  if (mod) {
    const label = `${mod.charAt(0).toUpperCase()}${mod.slice(1)}`;
    return `${label} ilerleyin${name} (${dist})`;
  }
  return `İlerleyin${name} (${dist})`;
}

function showSummary(title, seconds, meters) {
  const card = document.getElementById('summary');
  card.hidden = false;
  document.getElementById('summary-title').textContent = title;
  document.getElementById('summary-meta').textContent = `${formatDuration(seconds)} · ${formatDistance(meters)}`;
}

function renderSteps(lines) {
  const list = document.getElementById('steps');
  list.replaceChildren();
  lines.forEach((line) => {
    const item = document.createElement('li');
    item.textContent = line;
    list.append(item);
  });
}

function dropPin(which, lon, lat) {
  if (!map || !window.maplibregl) return;
  const color = which === 'origin' ? '#0f766e' : '#b45309';
  if (markers[which]) {
    markers[which].setLngLat([lon, lat]);
    return;
  }
  markers[which] = new maplibregl.Marker({ color }).setLngLat([lon, lat]).addTo(map);
}

function focusStop(stop) {
  if (!stop) return;
  if (map && map.getSource('nearest-stop')) {
    map.getSource('nearest-stop').setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [stop.lon, stop.lat] },
        properties: { name: stop.name }
      }]
    });
    map.flyTo({ center: [stop.lon, stop.lat], zoom: 14, essential: true });
  }
}

function nearestStop(lat, lon) {
  let best = null;
  let bestDistance = Infinity;
  const seen = new Set();
  for (const stop of stopRecords) {
    if (seen.has(stop.id)) continue;
    seen.add(stop.id);
    const distance = haversine(lat, lon, stop.lat, stop.lon);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = stop;
    }
  }
  return best ? { stop: best, distance: bestDistance } : null;
}

function renderStopList() {
  const list = document.getElementById('stop-list');
  const unique = [];
  const seen = new Set();
  for (const stop of stopRecords) {
    if (seen.has(stop.id)) continue;
    seen.add(stop.id);
    unique.push({ ...stop, distance: haversine(CENTER.lat, CENTER.lon, stop.lat, stop.lon) });
  }
  unique.sort((a, b) => a.distance - b.distance);
  const slice = unique.slice(0, 40);
  document.getElementById('stop-count').textContent = unique.length ? `${unique.length} durak` : '0 durak';
  list.replaceChildren();
  if (!slice.length) {
    const item = document.createElement('li');
    item.className = 'suggest-empty';
    item.textContent = 'Durak bulunamadı';
    list.append(item);
    return;
  }
  slice.forEach((stop) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'stop-item';
    button.textContent = `${stop.name} · ${modeLabel(stop.mode)}`;
    button.setAttribute('aria-label', `${stop.name} durağını haritada göster`);
    button.addEventListener('click', () => focusStop(stop));
    item.append(button);
    list.append(item);
  });
}

function decimate(coords, max) {
  if (!Array.isArray(coords)) return [];
  if (coords.length <= max) return coords.slice();
  const step = Math.ceil((coords.length - 1) / (max - 1));
  const out = [];
  for (let i = 0; i < coords.length; i += step) out.push(coords[i]);
  const last = coords[coords.length - 1];
  const tail = out[out.length - 1];
  if (!tail || tail[0] !== last[0] || tail[1] !== last[1]) out.push(last);
  return out;
}

function applyTransit(payload) {
  stopRecords = payload.records || [];
  try {
    stopGraph = buildStopGraph(stopRecords);
  } catch (error) {
    stopGraph = { nodes: {}, adj: {} };
    toast('Durak ağı kurulamadı');
  }
  if (mapReady && map && map.getSource('transit-lines')) {
    map.getSource('transit-lines').setData(payload.lines || emptyCollection());
    map.getSource('transit-stops').setData(payload.stops || emptyCollection());
  }
  renderStopList();
}

function payloadFromGeo(geo) {
  return {
    lines: {
      type: 'FeatureCollection',
      features: geo.lines.features.map((feature) => ({
        type: 'Feature',
        properties: feature.properties,
        geometry: { type: 'LineString', coordinates: decimate(feature.geometry.coordinates, 240) }
      }))
    },
    stops: geo.stops,
    records: geo.stops.features.map((feature) => ({
      id: String(feature.properties.id),
      name: feature.properties.name,
      lat: feature.geometry.coordinates[1],
      lon: feature.geometry.coordinates[0],
      lineId: String(feature.properties.lineId),
      sequence: feature.properties.sequence,
      mode: feature.properties.mode
    }))
  };
}

async function fetchOverpass() {
  let lastError = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const body = new URLSearchParams();
      body.set('data', OVERPASS_QUERY);
      const data = await fetchJson(endpoint, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body
      }, 28000, 'Overpass');
      if (!data || !Array.isArray(data.elements)) throw new Error('Overpass yanıtı beklenen biçimde değil');
      const geo = overpassToGeoJSON(data);
      if (geo.lines.features.length && geo.stops.features.length) return data;
      lastError = new Error('Bu sunucudan yeterli hat ve durak geometrisi alınamadı');
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Overpass erişilemedi');
    }
  }
  throw lastError || new Error('Overpass erişilemedi');
}

async function loadTransit(force = false) {
  const key = 'cockpit:transit:v2';
  try {
    const cached = force ? null : readCache(storage(), key);
    if (cached && cached.lines && cached.stops) {
      applyTransit(cached);
      updateFreshness('transit-updated', 'ÖNBELLEK');
      return;
    }
  } catch (error) {
    toast('Kayıtlı hatlar okunamadı', 'warn');
  }
  try {
    const data = await fetchOverpass();
    const payload = payloadFromGeo(overpassToGeoJSON(data));
    applyTransit(payload);
    updateFreshness('transit-updated', 'CANLI VERİ');
    try {
      writeCache(storage(), key, payload, TRANSIT_TTL);
    } catch (error) {
      toast('Hatlar önbelleğe yazılamadı', 'warn');
    }
    if (!payload.lines.features.length) toast('Toplu taşıma hattı bulunamadı', 'warn');
  } catch (error) {
    let cached = null;
    try { cached = readCache(storage(), key); } catch (readError) { cached = null; }
    if (cached && cached.lines && cached.stops) {
      applyTransit(cached);
      updateFreshness('transit-updated', 'ÖNBELLEK');
      toast('Canlı ulaşım verisi geçici olarak erişilemiyor; kayıtlı duraklar korunuyor.', 'warn');
    } else {
      updateFreshness('transit-updated', 'BAĞLANTI YOK');
      console.warn('All international transit feeds failed.', error);
      const list = document.getElementById('stop-list');
      if (list) {
        list.replaceChildren();
        const item = document.createElement('li');
        item.className = 'suggest-empty';
        item.textContent = 'Durak verisi şu an alınamıyor. Yeniden denenecek.';
        list.append(item);
      }
    }
  }
}

function updateFreshness(id, label) {
  const node = document.getElementById(id);
  if (!node) return;
  const time = new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date());
  node.textContent = `${label} · ${time} TRT`;
}

function renderWeather(data, freshness = 'GÜNCEL') {
  updateFreshness('weather-updated', freshness);
  const current = data.current || {};
  const info = wmoToTurkish(current.weather_code);
  const temp = Number(current.temperature_2m);
  document.getElementById('weather-temp').textContent = Number.isFinite(temp) ? `${Math.round(temp)}°C` : '—';
  document.getElementById('weather-desc').textContent = info.aciklama;
  const humidity = Number(current.relative_humidity_2m);
  const wind = Number(current.wind_speed_10m);
  const bits = [];
  const feelsLike = Number(current.apparent_temperature);
  if (Number.isFinite(feelsLike)) bits.push(`Hissedilen ${Math.round(feelsLike)}°C`);
  if (Number.isFinite(humidity)) bits.push(`Nem %${Math.round(humidity)}`);
  if (Number.isFinite(wind)) bits.push(`Rüzgâr ${Math.round(wind)} km/sa`);
  document.getElementById('weather-meta').textContent = bits.join(' · ');
  const daily = data.daily || {};
  const dayRoot = document.getElementById('weather-days');
  if (dayRoot) {
    dayRoot.replaceChildren();
    const dayTimes = Array.isArray(daily.time) ? daily.time : [];
    for (let i = 0; i < Math.min(4, dayTimes.length); i += 1) {
      const item = document.createElement('div');
      item.className = 'weather-day';
      const day = document.createElement('span');
      day.textContent = i === 0 ? 'BUGÜN' : new Intl.DateTimeFormat('tr-TR', {
        weekday: 'short',
        timeZone: 'Europe/Istanbul'
      }).format(new Date(`${dayTimes[i]}T12:00:00+03:00`)).toLocaleUpperCase('tr-TR');
      const condition = document.createElement('small');
      const weatherCode = Number(daily.weather_code && daily.weather_code[i]);
      condition.textContent = weatherCode <= 1 ? '☀' : weatherCode === 2 ? '◒' : weatherCode === 3 ? '☁' :
        weatherCode >= 45 && weatherCode <= 48 ? '≋' :
        weatherCode >= 51 && weatherCode <= 67 ? '☂' :
        weatherCode >= 71 && weatherCode <= 86 ? '❄' :
        weatherCode >= 95 ? 'ϟ' : '··';
      const low = Number(daily.temperature_2m_min && daily.temperature_2m_min[i]);
      const high = Number(daily.temperature_2m_max && daily.temperature_2m_max[i]);
      const range = document.createElement('strong');
      range.textContent = Number.isFinite(low) && Number.isFinite(high) ? `${Math.round(low)}° / ${Math.round(high)}°` : '—';
      item.title = wmoToTurkish(daily.weather_code && daily.weather_code[i]).aciklama || 'Tahmin';
      item.append(day, condition, range);
      dayRoot.append(item);
    }
  }
  setLucide('weather-icon', info.ikon);
  const hours = document.getElementById('weather-hours');
  hours.replaceChildren();
  const times = data.hourly && Array.isArray(data.hourly.time) ? data.hourly.time : [];
  const temps = data.hourly && Array.isArray(data.hourly.temperature_2m) ? data.hourly.temperature_2m : [];
  let start = times.findIndex((time) => Date.parse(time) >= Date.now() - 30 * 60 * 1000);
  if (start < 0) start = 0;
  for (let i = start; i < Math.min(times.length, start + 6); i += 1) {
    const item = document.createElement('div');
    item.className = 'hour';
    const hour = document.createElement('span');
    const when = new Date(times[i]);
    hour.textContent = Number.isNaN(when.getTime()) ? '—' : when.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    const value = document.createElement('strong');
    value.textContent = Number.isFinite(Number(temps[i])) ? `${Math.round(temps[i])}°` : '—';
    item.append(hour, value);
    hours.append(item);
  }
  if (Number.isFinite(temp) && mapReady && map && window.maplibregl) {
    const text = `${Math.round(temp)}°`;
    if (map.getSource('weather-point')) {
      map.getSource('weather-point').setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [CENTER.lon, CENTER.lat] },
          properties: { temp: text }
        }]
      });
    }
    const pin = document.createElement('div');
    pin.className = 'temp-pin';
    pin.textContent = text;
    if (weatherMarker) weatherMarker.remove();
    weatherMarker = new maplibregl.Marker({ element: pin, anchor: 'bottom' }).setLngLat([CENTER.lon, CENTER.lat]).addTo(map);
    const toggle = document.querySelector('.layer-btn[data-layer="weather"]');
    if (toggle && toggle.getAttribute('aria-pressed') !== 'true') pin.style.display = 'none';
  }
}

async function loadWeather(force) {
  const key = 'cockpit:weather:v2';
  if (!force) {
    try {
      const cached = readCache(storage(), key);
      if (cached) {
        renderWeather(cached, 'ÖNBELLEK');
        return;
      }
    } catch (error) {
      toast('Kayıtlı hava durumu okunamadı', 'warn');
    }
  }
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=41.0082&longitude=28.9784&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&hourly=temperature_2m,weather_code&daily=weather_code,temperature_2m_min,temperature_2m_max&timezone=Europe%2FIstanbul&forecast_hours=8&forecast_days=4&wind_speed_unit=kmh';
  try {
    const data = await fetchJson(url, { headers: { Accept: 'application/json' } }, 15000, 'Hava durumu');
    if (!data.current) throw new Error('Hava durumu verisi eksik');
    try {
      writeCache(storage(), key, data, WEATHER_TTL);
    } catch (error) {
      toast('Hava durumu önbelleğe yazılamadı', 'warn');
    }
    renderWeather(data, 'CANLI VERİ');
  } catch (error) {
    let cached = null;
    try { cached = readCache(storage(), key); } catch (readError) { cached = null; }
    if (cached) {
      renderWeather(cached, 'ÖNBELLEK');
      toast('Hava durumu alınamadı, önbellek kullanıldı', 'warn');
    } else {
      updateFreshness('weather-updated', 'BAĞLANTI YOK');
      toast(error.message || 'Hava durumu alınamadı');
    }
  }
}

function renderFlights(flights, freshness = 'GÜNCEL') {
  updateFreshness('flight-updated', freshness);
  const features = flights.map((flight) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [flight.boylam, flight.enlem] },
    properties: {
      callsign: flight.callsign || flight.icao24 || 'Bilinmiyor',
      altitude: flight.irtifa,
      heading: flight.yön,
      country: flight.ülke || ''
    }
  }));
  if (mapReady && map && map.getSource('flights')) {
    map.getSource('flights').setData({ type: 'FeatureCollection', features });
  }
  document.getElementById('flight-count').textContent = `${flights.length} uçuş`;
  if (!flights.length) {
    document.getElementById('flight-nearest').textContent = 'Bölgede uçuş yok';
    return;
  }
  let best = flights[0];
  let bestDistance = haversine(CENTER.lat, CENTER.lon, best.enlem, best.boylam);
  for (const flight of flights) {
    const distance = haversine(CENTER.lat, CENTER.lon, flight.enlem, flight.boylam);
    if (distance < bestDistance) {
      best = flight;
      bestDistance = distance;
    }
  }
  const direction = cardinal(bearing(CENTER.lat, CENTER.lon, best.enlem, best.boylam));
  const altitude = typeof best.irtifa === 'number' ? `${Math.round(best.irtifa)} m` : 'irtifa yok';
  const sign = best.callsign || best.icao24 || 'Bilinmiyor';
  document.getElementById('flight-nearest').textContent = `${sign} · ${altitude} · ${direction} · ${formatDistance(bestDistance)}`;
}

async function loadFlights(force) {
  const key = 'cockpit:flights:adsblol:v2';
  if (!force) {
    try {
      const cached = readCache(storage(), key);
      if (cached) {
        renderFlights(cached, 'ÖNBELLEK');
        return;
      }
    } catch (error) {
      console.warn('Cached flight data could not be read.', error);
    }
  }
  try {
    let flights;
    let freshness = 'CANLI VERİ';
    try {
      const url = `https://api.adsb.lol/v2/lat/${CENTER.lat}/lon/${CENTER.lon}/dist/100`;
      const data = await fetchJson(url, { headers: { Accept: 'application/json' } }, 18000, 'Uçuş radarı');
      if (!data || !Array.isArray(data.aircraft)) throw new Error('Uçuş yanıtının biçimi beklenenden farklı');
      flights = normalizeAdsbLolAircraft(data);
    } catch (primaryError) {
      const fallbackUrl = 'https://opensky-network.org/api/states/all?lamin=40.8&lomin=28.5&lamax=41.3&lomax=29.3';
      const fallback = await fetchJson(fallbackUrl, { headers: { Accept: 'application/json' } }, 18000, 'Yedek uçuş radarı');
      if (!fallback || !Array.isArray(fallback.states)) throw primaryError;
      flights = normalizeOpenSkyStates(fallback.states);
      freshness = 'YEDEK VERİ';
    }
    writeCache(storage(), key, flights, FLIGHT_TTL);
    renderFlights(flights, freshness);
  } catch (error) {
    let cached = null;
    try { cached = readCache(storage(), key); } catch (readError) { cached = null; }
    if (cached) {
      renderFlights(cached, 'ÖNBELLEK');
      toast('Canlı uçuş akışı geçici olarak erişilemiyor; son kayıt korunuyor.', 'warn');
    } else {
      updateFreshness('flight-updated', 'BAĞLANTI YOK');
      const count = document.getElementById('flight-count');
      const nearest = document.getElementById('flight-nearest');
      if (count) count.textContent = '—';
      if (nearest) nearest.textContent = 'Uçuş verisi şu an alınamıyor. Yeniden denenecek.';
      console.warn('Both international flight feeds failed.', error);
    }
  }
}

function searchPlaces(query) {
  const run = nomChain.then(async () => {
    const wait = PLACE_SEARCH_GAP - (Date.now() - nomAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    nomAt = Date.now();
    const url = new URL('https://photon.komoot.io/api/');
    url.searchParams.set('q', query);
    url.searchParams.set('limit', '5');
    url.searchParams.set('lang', 'tr');
    url.searchParams.set('lat', String(CENTER.lat));
    url.searchParams.set('lon', String(CENTER.lon));
    url.searchParams.set('bbox', '28.40,40.80,29.50,41.35');
    const payload = await fetchJson(url.toString(), { headers: { Accept: 'application/json' } }, 12000, 'Adres arama');
    const features = payload && Array.isArray(payload.features) ? payload.features : [];
    return features.flatMap((feature) => {
      const coords = feature && feature.geometry && feature.geometry.coordinates;
      const props = feature && feature.properties ? feature.properties : {};
      if (!Array.isArray(coords) || coords.length < 2) return [];
      const street = [props.housenumber, props.street].filter(Boolean).join(' ');
      const candidates = [props.name, street, props.district, props.city, props.state, props.country]
        .filter((value) => typeof value === 'string' && value.trim());
      const parts = candidates.filter((value, index) => candidates.indexOf(value) === index);
      const display_name = parts.join(', ') || query;
      return [{ display_name, lat: String(coords[1]), lon: String(coords[0]) }];
    });
  });
  nomChain = run.then(() => {}, () => {});
  return run;
}

function renderSuggestions(input, list, results) {
  list.replaceChildren();
  if (!Array.isArray(results) || !results.length) {
    const item = document.createElement('li');
    item.className = 'suggest-empty';
    item.textContent = 'Sonuç bulunamadı';
    list.append(item);
    return;
  }
  results.forEach((place) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'suggest-item';
    button.setAttribute('role', 'option');
    button.textContent = place.display_name || 'Adsız konum';
    button.addEventListener('click', () => {
      const lat = Number(place.lat);
      const lon = Number(place.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        toast('Seçilen adresin konumu geçersiz');
        return;
      }
      input.value = place.display_name || '';
      input.dataset.lat = String(lat);
      input.dataset.lon = String(lon);
      list.replaceChildren();
      dropPin(input.id === 'origin-input' ? 'origin' : 'destination', lon, lat);
    });
    item.append(button);
    list.append(item);
  });
}

function bindSearch(inputId, listId, key) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);
  input.addEventListener('input', () => {
    delete input.dataset.lat;
    delete input.dataset.lon;
    const query = input.value.trim();
    clearTimeout(debounceTimers.get(key));
    if (query.length < 3) {
      list.replaceChildren();
      return;
    }
    debounceTimers.set(key, setTimeout(async () => {
      const token = searchSeq[key] + 1;
      searchSeq[key] = token;
      try {
        const results = await searchPlaces(query);
        if (token !== searchSeq[key]) return;
        renderSuggestions(input, list, results);
      } catch (error) {
        if (token !== searchSeq[key]) return;
        toast(error.message || 'Adres araması başarısız');
      }
    }, 650));
  });
  list.addEventListener('keydown', (event) => {
    const buttons = [...list.querySelectorAll('button')];
    const index = buttons.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' && index >= 0 && index < buttons.length - 1) {
      event.preventDefault();
      buttons[index + 1].focus();
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (index <= 0) input.focus();
      else buttons[index - 1].focus();
    }
    if (event.key === 'Escape') {
      list.replaceChildren();
      input.focus();
    }
  });
  input.addEventListener('keydown', (event) => {
    const buttons = [...list.querySelectorAll('button')];
    if (event.key === 'ArrowDown' && buttons.length) {
      event.preventDefault();
      buttons[0].focus();
    }
    if (event.key === 'Escape') list.replaceChildren();
  });
}

function fitLine(coords) {
  if (!map || !window.maplibregl || coords.length < 2) return;
  const bounds = new maplibregl.LngLatBounds(coords[0], coords[0]);
  coords.forEach((coord) => bounds.extend(coord));
  map.fitBounds(bounds, { padding: 56, maxZoom: 15 });
}

async function calculateRoute() {
  const origin = readPoint('origin-input');
  const destination = readPoint('destination-input');
  if (!origin || !destination) {
    toast('Başlangıç ve bitiş için listeden bir adres seçin');
    return;
  }
  if (haversine(origin.lat, origin.lon, destination.lat, destination.lon) < 20) {
    toast('Başlangıç ve bitiş çok yakın');
    return;
  }
  if (!mapReady) {
    toast('Harita henüz hazır değil', 'warn');
    return;
  }
  const button = document.getElementById('route-btn');
  button.disabled = true;
  try {
    const engineProfile = profile === 'driving' ? 'routed-car' : profile === 'bike' ? 'routed-bike' : 'routed-foot';
    const coordinates = `${origin.lon},${origin.lat};${destination.lon},${destination.lat}`;
    const url = `https://routing.openstreetmap.de/${engineProfile}/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=true&alternatives=false`;
    const data = await fetchJson(url, { headers: { Accept: 'application/json' } }, 20000, 'Rota');
    if (!data.routes || !data.routes[0] || !data.routes[0].geometry) {
      throw new Error(data.message || 'Rota bulunamadı');
    }
    const route = data.routes[0];
    const coords = route.geometry.coordinates;
    map.getSource('route').setData(coordsToLineString(coords));
    fitLine(coords);
    showSummary(PROFILE_LABEL[profile] || 'Rota', route.duration, route.distance);
    const steps = route.legs && route.legs[0] && Array.isArray(route.legs[0].steps) ? route.legs[0].steps : [];
    renderSteps(steps.map(stepText));
  } catch (error) {
    console.warn('Route calculation failed.', error);
    toast('Rota şu an hesaplanamıyor. Adresleri kontrol edip yeniden dene.', 'warn');
  } finally {
    button.disabled = false;
  }
}

function calculateTransitRoute() {
  const origin = readPoint('origin-input');
  const destination = readPoint('destination-input');
  if (!origin || !destination) {
    toast('Durak rotası için başlangıç ve bitiş seçin');
    return;
  }
  if (!stopGraph || !stopRecords.length) {
    toast('Durak verisi henüz hazır değil');
    return;
  }
  const from = nearestStop(origin.lat, origin.lon);
  const to = nearestStop(destination.lat, destination.lon);
  if (!from || !to) {
    toast('Yakın durak bulunamadı');
    return;
  }
  const result = dijkstra(stopGraph, from.stop.id, to.stop.id);
  if (!result.path.length) {
    toast('Bu duraklar arasında yol bulunamadı');
    return;
  }
  const coords = result.path.map((id) => {
    const node = stopGraph.nodes[id];
    return [node.lon, node.lat];
  });
  if (map && map.getSource('route')) {
    map.getSource('route').setData(coordsToLineString(coords));
    fitLine(coords);
  }
  const names = result.path.map((id) => stopGraph.nodes[id].name || id);
  showSummary('Durak rotası', 0, result.distance);
  document.getElementById('summary-meta').textContent = `${names.length} durak · ${formatDistance(result.distance)}`;
  renderSteps(names);
  toast(`${from.stop.name} → ${to.stop.name}`, 'ok');
}

function locateNearest() {
  if (!navigator.geolocation) {
    toast('Konum servisi desteklenmiyor');
    return;
  }
  if (!stopRecords.length) {
    toast('Durak listesi henüz hazır değil');
    return;
  }
  navigator.geolocation.getCurrentPosition((position) => {
    const found = nearestStop(position.coords.latitude, position.coords.longitude);
    if (!found) {
      toast('Yakın durak bulunamadı');
      return;
    }
    focusStop(found.stop);
    toast(`${found.stop.name} · ${formatDistance(found.distance)}`, 'ok');
  }, () => {
    toast('Konum izni alınamadı');
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 });
}

function popup(lngLat, title, detail) {
  const box = document.createElement('div');
  const heading = document.createElement('strong');
  heading.textContent = title;
  const meta = document.createElement('p');
  meta.textContent = detail;
  box.append(heading, meta);
  new maplibregl.Popup({ offset: 10 }).setLngLat(lngLat).setDOMContent(box).addTo(map);
}

function addLayers() {
  map.addSource('transit-lines', { type: 'geojson', data: emptyCollection() });
  map.addLayer({
    id: 'transit-lines',
    type: 'line',
    source: 'transit-lines',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['match', ['get', 'mode'], 'subway', '#ff4138', 'light_rail', '#ff8a7d', 'tram', '#e3ad7c', 'ferry', '#e8c6cf', '#916b72'],
      'line-width': 3
    }
  });
  map.addSource('transit-stops', { type: 'geojson', data: emptyCollection() });
  map.addLayer({
    id: 'transit-stops',
    type: 'circle',
    source: 'transit-stops',
    paint: {
      'circle-radius': 4,
      'circle-color': '#ffffff',
      'circle-stroke-width': 2,
      'circle-stroke-color': '#3b1118'
    }
  });
  map.addSource('flights', { type: 'geojson', data: emptyCollection() });
  map.addLayer({
    id: 'flights',
    type: 'circle',
    source: 'flights',
    paint: {
      'circle-radius': 5,
      'circle-color': '#ff453b',
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#ffffff'
    }
  });
  map.addSource('weather-point', { type: 'geojson', data: emptyCollection() });
  map.addLayer({
    id: 'weather-point',
    type: 'circle',
    source: 'weather-point',
    paint: {
      'circle-radius': 8,
      'circle-color': '#ff3028',
      'circle-stroke-width': 2,
      'circle-stroke-color': '#3b1118'
    }
  });
  map.addSource('route', { type: 'geojson', data: emptyCollection() });
  map.addLayer({
    id: 'route-line',
    type: 'line',
    source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#dc2626', 'line-width': 5, 'line-opacity': 0.92 }
  });
  map.addSource('nearest-stop', { type: 'geojson', data: emptyCollection() });
  map.addLayer({
    id: 'nearest-stop',
    type: 'circle',
    source: 'nearest-stop',
    paint: {
      'circle-radius': 9,
      'circle-color': '#f0a08e',
      'circle-stroke-width': 3,
      'circle-stroke-color': '#ffffff'
    }
  });
  ['transit-stops', 'flights', 'transit-lines'].forEach((id) => {
    map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
  });
  map.on('click', 'transit-stops', (event) => {
    const feature = event.features && event.features[0];
    if (!feature) return;
    const name = feature.properties.name || 'Durak';
    const line = feature.properties.lineName || modeLabel(feature.properties.mode);
    popup(event.lngLat, name, line);
  });
  map.on('click', 'transit-lines', (event) => {
    const feature = event.features && event.features[0];
    if (!feature) return;
    popup(event.lngLat, feature.properties.name || 'Hat', modeLabel(feature.properties.mode));
  });
  map.on('click', 'flights', (event) => {
    const feature = event.features && event.features[0];
    if (!feature) return;
    const altitude = feature.properties.altitude == null || feature.properties.altitude === 'null' ? 'irtifa yok' : `${Math.round(Number(feature.properties.altitude))} m`;
    const country = feature.properties.country || '';
    popup(event.lngLat, feature.properties.callsign || 'Uçuş', `${altitude}${country ? ` · ${country}` : ''}`);
  });
}

function startLiveData() {
  if (liveDataStarted) return;
  liveDataStarted = true;
  loadWeather(false);
  loadFlights(false);
  loadTransit();
  window.setInterval(() => {
    if (navigator.onLine) loadWeather(true);
  }, WEATHER_TTL);
  window.setInterval(() => {
    if (navigator.onLine) loadFlights(true);
  }, 10 * 60 * 1000);
  window.setInterval(() => {
    if (navigator.onLine) loadTransit(true);
  }, 30 * 60 * 1000);
}

function initMap() {
  if (!window.maplibregl) {
    document.querySelector('.map-wrap')?.classList.add('map-unavailable');
    toast('Harita kütüphanesi yüklenemedi; açık veri kartları çalışmaya devam ediyor', 'warn');
    hideLoading();
    startLiveData();
    return;
  }
  map = new maplibregl.Map({
    container: 'map',
    center: [CENTER.lon, CENTER.lat],
    zoom: 11,
    attributionControl: true,
    style: {
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© OpenStreetMap contributors'
        }
      },
      layers: [{ id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-saturation': -0.72, 'raster-contrast': 0.12, 'raster-brightness-min': 0.02, 'raster-brightness-max': 0.72 } }]
    }
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-left');
  map.on('load', () => {
    mapReady = true;
    document.querySelector('.map-wrap')?.classList.remove('map-unavailable');
    addLayers();
    hideLoading();
    map.resize();
    startLiveData();
  });
  map.on('error', (event) => {
    if (!mapReady && !tileWarned) {
      tileWarned = true;
      document.querySelector('.map-wrap')?.classList.add('map-unavailable');
      toast('Harita yüklenirken sorun oluştu; veri kartları yükleniyor', 'warn');
      hideLoading();
      startLiveData();
      return;
    }
    if (event && event.tile && !tileWarned) {
      tileWarned = true;
      toast('Bazı harita karoları alınamadı', 'warn');
    }
  });
  setTimeout(() => {
    if (!mapReady) {
      document.querySelector('.map-wrap')?.classList.add('map-unavailable');
      hideLoading();
      toast('Harita geç yanıt veriyor; veri kartları yükleniyor', 'warn');
      startLiveData();
    }
  }, 20000);
  window.addEventListener('resize', () => { if (map) map.resize(); });
}

function renderNet() {
  const offline = navigator.onLine === false;
  document.body.classList.toggle('is-offline', offline);
  const banner = document.getElementById('offline-banner');
  banner.hidden = !offline;
  const status = document.getElementById('net-status');
  status.textContent = offline ? 'Çevrimdışı' : 'Çevrimiçi';
  status.dataset.state = offline ? 'off' : 'on';
}

function applyTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', next === 'light' ? '#f2e8df' : '#070103');
  setLucide('theme-icon', next === 'light' ? 'moon' : 'sun');
  try {
    localStorage.setItem('istanbul-cockpit-theme', next);
  } catch (error) {
    toast('Tema kaydedilemedi', 'warn');
  }
}

function bindUi() {
  setLucide('route-icon', 'route');
  setLucide('stop-icon', 'map-pin');
  setLucide('mode-foot', 'footprints');
  setLucide('mode-bike', 'bike');
  setLucide('mode-car', 'car');
  setLucide('flight-icon', 'plane');
  setLucide('weather-icon', 'cloud-sun');
  applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(next);
  });
  document.querySelectorAll('.mode-btn').forEach((button) => {
    button.addEventListener('click', () => {
      profile = button.dataset.mode || 'foot';
      document.querySelectorAll('.mode-btn').forEach((item) => {
        item.setAttribute('aria-pressed', item === button ? 'true' : 'false');
      });
    });
  });
  document.querySelectorAll('.layer-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const on = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
      const id = LAYER_IDS[button.dataset.layer];
      if (map && id && map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
      if (button.dataset.layer === 'weather' && weatherMarker) {
        weatherMarker.getElement().style.display = on ? '' : 'none';
      }
    });
  });
  document.getElementById('route-form').addEventListener('submit', (event) => {
    event.preventDefault();
    calculateRoute();
  });
  document.getElementById('nearest-btn').addEventListener('click', locateNearest);
  document.getElementById('transit-route-btn').addEventListener('click', calculateTransitRoute);
  document.getElementById('weather-refresh').addEventListener('click', () => loadWeather(true));
  document.getElementById('flight-refresh').addEventListener('click', () => loadFlights(true));
  bindSearch('origin-input', 'origin-suggest', 'origin');
  bindSearch('destination-input', 'destination-suggest', 'destination');
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    document.querySelectorAll('.suggest').forEach((list) => {
      const field = list.closest('.field');
      if (field && !field.contains(event.target)) list.replaceChildren();
    });
  });
  window.addEventListener('online', renderNet);
  window.addEventListener('offline', renderNet);
  renderNet();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

bindUi();
initMap();
