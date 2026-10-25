import {
  classifyBikeInfrastructure,
  coordsToLineString,
  formatDistance,
  formatDuration,
  haversine,
  readCache,
  wmoToTurkish,
  writeCache
} from './utils.js';

const CENTER = { lat: 41.0082, lon: 28.9784 };
const WEATHER_TTL = 10 * 60 * 1000;
const BIKE_TTL = 45 * 60 * 1000;
const PLACE_SEARCH_GAP = 700;
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];
const LAYER_IDS = {
  bikeways: 'bikeways',
  weather: 'weather-point'
};
const PROFILE_LABEL = { foot: 'Yürüme', bike: 'Bisiklet', driving: 'Araba' };

let map = null;
let mapReady = false;
let liveDataStarted = false;
let profile = 'bike';
let bikewaysCollection = emptyCollection();
let weatherMarker = null;
let tileWarned = false;
let nomChain = Promise.resolve();
let nomAt = 0;
const searchSeq = { origin: 0, destination: 0 };
const debounceTimers = new Map();
const markers = { origin: null, destination: null };
let notesTimer = null;
let bikeLoading = false;
let bikeReloadQueued = false;
let bikeReloadTimer = null;
let lastBikeQueryCenter = null;

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

function bikeCategoryLabel(category) {
  if (category === 'dedicated') return 'Ayrılmış bisiklet yolu';
  if (category === 'lane') return 'Yol üzeri bisiklet şeridi';
  if (category === 'shared') return 'Paylaşımlı / bisiklete açık güzergâh';
  return 'Bisiklet altyapısı';
}

function bikeNetworkFromOverpass(data) {
  const elements = data && Array.isArray(data.elements) ? data.elements : [];
  const features = [];
  for (const way of elements) {
    if (!way || way.type !== 'way' || !Array.isArray(way.geometry)) continue;
    const tags = way.tags && typeof way.tags === 'object' ? way.tags : {};
    const category = classifyBikeInfrastructure(tags);
    if (!category) continue;
    const coords = way.geometry
      .filter((point) => point && Number.isFinite(point.lat) && Number.isFinite(point.lon))
      .map((point) => [point.lon, point.lat]);
    if (coords.length < 2) continue;
    features.push({
      type: 'Feature',
      id: String(way.id),
      geometry: { type: 'LineString', coordinates: decimate(coords, 180) },
      properties: {
        id: String(way.id),
        name: tags.name || tags.ref || '',
        category,
        surface: tags.surface || tags['cycleway:surface'] || 'belirtilmemiş',
        segregated: tags.segregated || 'bilinmiyor',
        lit: tags.lit || 'bilinmiyor',
        oneway: tags.oneway || 'bilinmiyor'
      }
    });
  }
  return { type: 'FeatureCollection', features };
}

function renderBikeNetwork(collection, freshness = 'GÜNCEL') {
  bikewaysCollection = collection && Array.isArray(collection.features) ? collection : emptyCollection();
  if (mapReady && map && map.getSource('bikeways')) map.getSource('bikeways').setData(bikewaysCollection);
  const features = bikewaysCollection.features;
  const count = (category) => features.filter((feature) => feature.properties.category === category).length;
  const countNode = document.getElementById('bike-count');
  const detailNode = document.getElementById('bike-detail');
  const summaryNode = document.getElementById('bike-summary');
  if (countNode) countNode.textContent = `${features.length.toLocaleString('tr-TR')} bölüm`;
  if (detailNode) detailNode.textContent = `${count('dedicated')} ayrılmış · ${count('lane')} şerit · ${count('shared')} paylaşımlı`;
  if (summaryNode) summaryNode.textContent = features.length
    ? 'Haritada kayıtlı bisiklet altyapısı bulundu. Çizgiler, kayıtlı altyapı türüne göre renklendirilmiştir.'
    : 'Bu çevrede etiketlenmiş bisiklet güzergâhı bulunamadı. Haritayı kaydırıp tekrar sorgulayabilirsin.';
  updateFreshness('bike-updated', features.length ? freshness : (freshness === 'CANLI VERİ' ? 'CANLI VERİ · KAYIT YOK' : freshness));
}

function bikeQueryForCurrentArea() {
  const center = map && map.getCenter ? map.getCenter() : { lat: CENTER.lat, lng: CENTER.lon };
  const lon = Number(center.lng ?? center.lon ?? CENTER.lon);
  const lat = Number(center.lat ?? CENTER.lat);
  // A compact neighborhood window prevents a city-wide geometry request from timing out.
  const west = Math.max(-180, lon - 0.095);
  const east = Math.min(180, lon + 0.095);
  const south = Math.max(-90, lat - 0.065);
  const north = Math.min(90, lat + 0.065);
  const box = `(${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)})`;
  lastBikeQueryCenter = { lat, lon, zoom: map && map.getZoom ? map.getZoom() : 11 };
  return `[out:json][timeout:15];(
    way["highway"="cycleway"]${box};
    way["cycleway"~"^(lane|track|shared_lane|share_busway|opposite_lane|opposite_track)$"]${box};
    way["cycleway:left"~"^(lane|track|shared_lane|share_busway)$"]${box};
    way["cycleway:right"~"^(lane|track|shared_lane|share_busway)$"]${box};
    way["cycleway:both"~"^(lane|track|shared_lane|share_busway)$"]${box};
    way["bicycle"="designated"]["highway"~"^(path|footway|track)$"]${box};
  );out tags geom;`;
}

async function fetchBikeNetwork() {
  let lastError = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const body = new URLSearchParams();
      body.set('data', bikeQueryForCurrentArea());
      const data = await fetchJson(endpoint, {
        method: 'POST', headers: { Accept: 'application/json' }, body
      }, 11000, 'Bisiklet haritası');
      if (!data || !Array.isArray(data.elements)) throw new Error('Bisiklet verisi beklenen biçimde değil');
      if (data.remark && /timed out|run out of memory|runtime error/i.test(data.remark)) throw new Error('Bisiklet sorgusu sunucu sınırına takıldı');
      const collection = bikeNetworkFromOverpass(data);
      return collection;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Bisiklet verisine ulaşılamadı');
    }
  }
  throw lastError || new Error('Bisiklet ağına ulaşılamadı');
}

async function loadBikeNetwork(force = false) {
  if (bikeLoading) {
    if (force) bikeReloadQueued = true;
    return;
  }
  bikeLoading = true;
  const key = 'ergin-lab:bikeways:v2';
  const countNode = document.getElementById('bike-count');
  const summaryNode = document.getElementById('bike-summary');
  updateFreshness('bike-updated', 'SORGULANIYOR');
  if (countNode) countNode.textContent = '…';
  if (summaryNode) summaryNode.textContent = 'Harita merkezinin çevresindeki bisiklet altyapısı aranıyor.';
  try {
    if (!force) {
      try {
        const cached = readCache(storage(), key);
        if (cached && cached.type === 'FeatureCollection' && Array.isArray(cached.features) && cached.features.length) {
          renderBikeNetwork(cached, 'ÖNBELLEK');
          return;
        }
      } catch (error) { console.warn('Bike infrastructure cache could not be read.', error); }
    }
    const collection = await fetchBikeNetwork();
    renderBikeNetwork(collection, 'CANLI VERİ');
    try { writeCache(storage(), key, collection, BIKE_TTL); }
    catch (error) { console.warn('Bike infrastructure cache could not be written.', error); }
    if (!collection.features.length) {
      if (summaryNode) summaryNode.textContent = 'Bu çevrede haritada bisiklet altyapısı olarak işaretlenmiş çizgi bulunamadı. Haritayı sahil hattına veya başka bir bölgeye taşıyıp yenileyebilirsin.';
    }
  } catch (error) {
    let cached = null;
    try { cached = readCache(storage(), key); } catch (readError) { cached = null; }
    if (cached && cached.type === 'FeatureCollection' && Array.isArray(cached.features)) {
      renderBikeNetwork(cached, 'ÖNBELLEK');
      if (summaryNode) summaryNode.textContent = 'Canlı istek başarısız oldu; son kayıtlı bisiklet verisi gösteriliyor.';
    } else {
      updateFreshness('bike-updated', 'BAĞLANTI YOK');
      if (countNode) countNode.textContent = '—';
      if (summaryNode) summaryNode.textContent = 'Açık harita servisi şu an yanıt vermedi. Harita görünümünü daraltıp yeniden dene.';
      console.warn('All bicycle infrastructure feeds failed.', error);
    }
  } finally {
    bikeLoading = false;
    if (bikeReloadQueued) {
      bikeReloadQueued = false;
      window.setTimeout(() => loadBikeNetwork(true), 500);
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
      if (map) map.flyTo({ center: [lon, lat], zoom: 14, essential: true });
    });
    item.append(button);
    list.append(item);
  });
}

function bindSearch(inputId, listId, key) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);
  input.addEventListener('input', () => {
    const token = ++searchSeq[key];
    delete input.dataset.lat;
    delete input.dataset.lon;
    const query = input.value.trim();
    clearTimeout(debounceTimers.get(key));
    list.replaceChildren();
    if (query.length < 2) return;
    debounceTimers.set(key, window.setTimeout(async () => {
      if (token !== searchSeq[key]) return;
      const pending = document.createElement('li');
      pending.className = 'suggest-empty';
      pending.textContent = 'Adres aranıyor…';
      list.append(pending);
      try {
        const results = await searchPlaces(query);
        if (token !== searchSeq[key]) return;
        renderSuggestions(input, list, results);
      } catch (error) {
        if (token !== searchSeq[key]) return;
        list.replaceChildren();
        const item = document.createElement('li');
        item.className = 'suggest-empty';
        item.textContent = 'Arama servisi şu an yanıt vermedi. Birkaç saniye sonra yeniden deneyebilirsin.';
        list.append(item);
        console.warn('Photon address search failed.', error);
      }
    }, 400));
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
    if (mapReady && map && map.getSource('route')) {
      map.getSource('route').setData(coordsToLineString(coords));
      fitLine(coords);
    }
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
  map.addSource('bikeways', { type: 'geojson', data: bikewaysCollection });
  map.addLayer({
    id: 'bikeways', type: 'line', source: 'bikeways',
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'visible' },
    paint: {
      'line-color': ['match', ['get', 'category'], 'dedicated', '#65e3ad', 'lane', '#ff8a7d', 'shared', '#d8b6ff', '#ff4138'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.6, 15, 4.5],
      'line-opacity': 0.94
    }
  });
  map.addSource('weather-point', { type: 'geojson', data: emptyCollection() });
  map.addLayer({
    id: 'weather-point', type: 'circle', source: 'weather-point',
    paint: { 'circle-radius': 8, 'circle-color': '#ff3028', 'circle-stroke-width': 2, 'circle-stroke-color': '#3b1118' }
  });
  map.addSource('route', { type: 'geojson', data: emptyCollection() });
  map.addLayer({
    id: 'route-line', type: 'line', source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#dc2626', 'line-width': 5, 'line-opacity': 0.92 }
  });
  map.on('mouseenter', 'bikeways', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'bikeways', () => { map.getCanvas().style.cursor = ''; });
  map.on('click', 'bikeways', (event) => {
    const feature = event.features && event.features[0];
    if (!feature) return;
    const p = feature.properties || {};
    const details = [
      bikeCategoryLabel(p.category),
      p.surface && p.surface !== 'belirtilmemiş' ? `Zemin: ${p.surface}` : '',
      p.segregated && p.segregated !== 'bilinmiyor' ? `Yaya ayrımı: ${p.segregated}` : '',
      p.lit && p.lit !== 'bilinmiyor' ? `Aydınlatma: ${p.lit}` : ''
    ].filter(Boolean).join(' · ');
    popup(event.lngLat, p.name || 'Bisiklet güzergâhı', details);
  });
}

function startLiveData() {
  if (liveDataStarted) return;
  liveDataStarted = true;
  loadWeather(false);
  loadBikeNetwork();
  window.setInterval(() => {
    if (navigator.onLine) loadWeather(true);
  }, WEATHER_TTL);
  window.setInterval(() => {
    if (navigator.onLine) loadBikeNetwork(true);
  }, BIKE_TTL);
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
  map.on('moveend', () => {
    if (!mapReady || !lastBikeQueryCenter || bikeReloadTimer) return;
    const center = map.getCenter();
    const moved = Math.abs(center.lng - lastBikeQueryCenter.lon) > 0.045 ||
      Math.abs(center.lat - lastBikeQueryCenter.lat) > 0.035 ||
      Math.abs(map.getZoom() - lastBikeQueryCenter.zoom) > 1.25;
    if (!moved) return;
    bikeReloadTimer = window.setTimeout(() => {
      bikeReloadTimer = null;
      loadBikeNetwork(true);
    }, 900);
  });
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

function bindNotes() {
  const area = document.getElementById('lab-notes');
  const status = document.getElementById('notes-status');
  const count = document.getElementById('notes-count');
  const saveButton = document.getElementById('notes-save');
  const clearButton = document.getElementById('notes-clear');
  const exportButton = document.getElementById('notes-export');
  if (!area || !status || !count) return;
  const key = 'ergin-lab:field-notes:v1';
  const setCount = () => { count.textContent = `${area.value.length.toLocaleString('tr-TR')} / 6000 karakter`; };
  const save = () => {
    try {
      window.localStorage.setItem(key, area.value);
      status.textContent = 'Bu cihazda kaydedildi';
    } catch (error) {
      status.textContent = 'Tarayıcı kaydına izin vermedi';
    }
    setCount();
  };
  try {
    area.value = window.localStorage.getItem(key) || '';
    status.textContent = 'Notlar bu cihazda saklanır';
  } catch (error) {
    status.textContent = 'Yerel kayıt kullanılamıyor';
  }
  setCount();
  area.addEventListener('input', () => {
    status.textContent = 'Kaydediliyor…';
    setCount();
    if (notesTimer) window.clearTimeout(notesTimer);
    notesTimer = window.setTimeout(save, 300);
  });
  if (saveButton) saveButton.addEventListener('click', () => {
    if (notesTimer) window.clearTimeout(notesTimer);
    save();
  });
  if (clearButton) clearButton.addEventListener('click', () => {
    if (!area.value) return;
    if (!window.confirm('Bu cihazda saklanan deney notları silinsin mi?')) return;
    area.value = '';
    if (notesTimer) window.clearTimeout(notesTimer);
    try { window.localStorage.removeItem(key); } catch (error) {}
    status.textContent = 'Notlar temizlendi';
    setCount();
  });
  if (exportButton) exportButton.addEventListener('click', () => {
    const blob = new Blob([area.value], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ergin-lab-deney-notlari.txt';
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = 'Not dosyası dışa aktarıldı';
  });
}

function bindUi() {
  setLucide('route-icon', 'route');
  setLucide('bike-icon', 'bike');
  setLucide('notes-icon', 'notebook-pen');
  setLucide('mode-foot', 'footprints');
  setLucide('mode-bike', 'bike');
  setLucide('mode-car', 'car');
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
  document.getElementById('weather-refresh').addEventListener('click', () => loadWeather(true));
  bindSearch('origin-input', 'origin-suggest', 'origin');
  bindSearch('destination-input', 'destination-suggest', 'destination');
  const bikeRefresh = document.getElementById('bike-refresh');
  if (bikeRefresh) bikeRefresh.addEventListener('click', () => loadBikeNetwork(true));
  const separatedOnly = document.getElementById('bike-separated-toggle');
  if (separatedOnly) separatedOnly.addEventListener('change', () => {
    if (map && map.getLayer('bikeways')) {
      map.setFilter('bikeways', separatedOnly.checked ? ['==', ['get', 'category'], 'dedicated'] : null);
    }
  });
  bindNotes();
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
startLiveData();
