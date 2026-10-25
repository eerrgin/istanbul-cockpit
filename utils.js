const EARTH_RADIUS = 6371000;

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function samePoint(a, b) {
  return Math.abs(a[0] - b[0]) < 1e-5 && Math.abs(a[1] - b[1]) < 1e-5;
}

function geomToCoords(geom) {
  if (!Array.isArray(geom)) return [];
  const coords = [];
  for (const point of geom) {
    if (Array.isArray(point) && point.length >= 2 && typeof point[0] === 'number' && typeof point[1] === 'number') {
      coords.push([point[0], point[1]]);
    } else if (point && typeof point.lat === 'number' && typeof point.lon === 'number') {
      coords.push([point.lon, point.lat]);
    }
  }
  return coords;
}

function wayCoords(member, wayById, nodeById) {
  if (member.geometry) return geomToCoords(member.geometry);
  const way = wayById.get(member.ref);
  if (!way) return [];
  if (way.geometry) return geomToCoords(way.geometry);
  if (!Array.isArray(way.nodes)) return [];
  const geom = [];
  for (const id of way.nodes) {
    const node = nodeById.get(id);
    if (node && typeof node.lat === 'number' && typeof node.lon === 'number') geom.push(node);
  }
  return geomToCoords(geom);
}

function stitchSegments(segments) {
  const parts = segments.filter((segment) => Array.isArray(segment) && segment.length > 0).map((segment) => segment.slice());
  if (!parts.length) return [];
  const used = new Array(parts.length).fill(false);
  used[0] = true;
  let line = parts[0].slice();
  let guard = 0;
  while (guard < parts.length * 3) {
    guard += 1;
    const start = line[0];
    const end = line[line.length - 1];
    let hit = false;
    for (let i = 0; i < parts.length; i += 1) {
      if (used[i]) continue;
      const segment = parts[i];
      const first = segment[0];
      const last = segment[segment.length - 1];
      if (samePoint(end, first)) {
        line = line.concat(segment.slice(1));
        used[i] = true;
        hit = true;
        break;
      }
      if (samePoint(end, last)) {
        const reversed = segment.slice().reverse();
        line = line.concat(reversed.slice(1));
        used[i] = true;
        hit = true;
        break;
      }
      if (samePoint(start, last)) {
        line = segment.concat(line.slice(1));
        used[i] = true;
        hit = true;
        break;
      }
      if (samePoint(start, first)) {
        const reversed = segment.slice().reverse();
        line = reversed.concat(line.slice(1));
        used[i] = true;
        hit = true;
        break;
      }
    }
    if (!hit) break;
  }
  for (let i = 0; i < parts.length; i += 1) {
    if (!used[i]) line = line.concat(parts[i]);
  }
  return line;
}

function stopFromMember(member, nodeById, lineName) {
  const node = nodeById.get(member.ref);
  const lat = typeof member.lat === 'number' ? member.lat : node && node.lat;
  const lon = typeof member.lon === 'number' ? member.lon : node && node.lon;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  const name = (node && node.tags && node.tags.name) || (member.tags && member.tags.name) || lineName || `Durak ${member.ref}`;
  return { ref: member.ref, lat, lon, name };
}

export function haversine(lat1, lon1, lat2, lon2) {
  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const Δφ = toRadians(lat2 - lat1);
  const Δλ = toRadians(lon2 - lon1);
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remain = total % 60;
  const parts = [];
  if (hours > 0) parts.push(`${hours} sa`);
  if (minutes > 0) parts.push(`${minutes} dk`);
  if (remain > 0 && hours === 0) parts.push(`${remain} sn`);
  if (!parts.length) return '0 sn';
  return parts.join(' ');
}

export function formatDistance(meters) {
  const value = Math.max(0, Number(meters) || 0);
  if (value >= 1000) {
    const km = value / 1000;
    const text = km >= 10 ? km.toFixed(0) : km.toFixed(1);
    return `${text} km`;
  }
  return `${Math.round(value)} m`;
}

export function wmoToTurkish(code) {
  const table = {
    0: ['Açık', 'sun'],
    1: ['Çoğunlukla açık', 'sun'],
    2: ['Parçalı bulutlu', 'cloud-sun'],
    3: ['Kapalı', 'cloud'],
    45: ['Sisli', 'cloud-fog'],
    48: ['Kırağılı sis', 'cloud-fog'],
    51: ['Hafif çisenti', 'cloud-drizzle'],
    53: ['Çisenti', 'cloud-drizzle'],
    55: ['Yoğun çisenti', 'cloud-drizzle'],
    56: ['Dondurucu çisenti', 'cloud-drizzle'],
    57: ['Yoğun dondurucu çisenti', 'cloud-drizzle'],
    61: ['Hafif yağmur', 'cloud-rain'],
    63: ['Yağmur', 'cloud-rain'],
    65: ['Şiddetli yağmur', 'cloud-rain'],
    66: ['Dondurucu yağmur', 'cloud-rain'],
    67: ['Şiddetli dondurucu yağmur', 'cloud-rain'],
    71: ['Hafif kar', 'snowflake'],
    73: ['Kar', 'snowflake'],
    75: ['Yoğun kar', 'snowflake'],
    77: ['Kar taneleri', 'snowflake'],
    80: ['Hafif sağanak', 'cloud-rain'],
    81: ['Sağanak', 'cloud-rain'],
    82: ['Şiddetli sağanak', 'cloud-rain'],
    85: ['Hafif kar sağanağı', 'snowflake'],
    86: ['Yoğun kar sağanağı', 'snowflake'],
    95: ['Gök gürültülü fırtına', 'cloud-lightning'],
    96: ['Dolulu fırtına', 'cloud-lightning'],
    99: ['Şiddetli dolu fırtınası', 'cloud-lightning']
  };
  const hit = table[code] || ['Bilinmeyen', 'cloud'];
  return { aciklama: hit[0], ikon: hit[1] };
}

export function overpassToGeoJSON(data) {
  const elements = data && Array.isArray(data.elements) ? data.elements : [];
  const nodeById = new Map();
  const wayById = new Map();
  for (const element of elements) {
    if (element.type === 'node') nodeById.set(element.id, element);
    if (element.type === 'way') wayById.set(element.id, element);
  }
  const lineFeatures = [];
  const stopFeatures = [];
  const routes = [];
  for (const rel of elements) {
    if (rel.type !== 'relation') continue;
    const tags = rel.tags || {};
    const mode = tags.route || 'unknown';
    const name = tags.name || (tags.ref ? `Hat ${tags.ref}` : `Hat ${rel.id}`);
    const members = Array.isArray(rel.members) ? rel.members : [];
    const segments = [];
    for (const member of members) {
      if (member.type !== 'way') continue;
      const coords = wayCoords(member, wayById, nodeById);
      if (coords.length) segments.push(coords);
    }
    const coordinates = stitchSegments(segments);
    if (coordinates.length >= 2) {
      lineFeatures.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates },
        properties: { id: String(rel.id), name, mode }
      });
      routes.push({ id: String(rel.id), name, mode, coordinates });
    }
    const preferred = members.filter((member) => member.role === 'stop' || member.role === 'stop_entry_only' || member.role === 'stop_exit_only');
    const platforms = members.filter((member) => member.role === 'platform');
    const chosen = preferred.length ? preferred : platforms;
    let sequence = 0;
    for (const member of chosen) {
      let stop = null;
      if (member.type === 'node') {
        stop = stopFromMember(member, nodeById, name);
      } else if (member.type === 'way') {
        const coords = wayCoords(member, wayById, nodeById);
        if (coords.length) {
          const center = coords.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0]);
          stop = {
            ref: member.ref,
            lon: center[0] / coords.length,
            lat: center[1] / coords.length,
            name: (member.tags && (member.tags.name || member.tags.ref)) || (wayById.get(member.ref)?.tags?.name) || `${name} · platform`
          };
        }
      }
      if (!stop) continue;
      stopFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [stop.lon, stop.lat] },
        properties: {
          id: String(stop.ref),
          name: stop.name,
          mode,
          lineId: String(rel.id),
          lineName: name,
          sequence
        }
      });
      sequence += 1;
    }
  }
  return {
    lines: { type: 'FeatureCollection', features: lineFeatures },
    stops: { type: 'FeatureCollection', features: stopFeatures },
    routes
  };
}

export function buildStopGraph(stops) {
  const nodes = {};
  const adj = {};
  const groups = new Map();
  (Array.isArray(stops) ? stops : []).forEach((stop, index) => {
    if (!stop || stop.id == null) return;
    if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lon)) return;
    const id = String(stop.id);
    if (!nodes[id]) nodes[id] = { id, name: stop.name || '', lat: stop.lat, lon: stop.lon };
    if (!adj[id]) adj[id] = [];
    const lineId = String(stop.lineId ?? 'hat');
    if (!groups.has(lineId)) groups.set(lineId, []);
    groups.get(lineId).push({
      id,
      lat: stop.lat,
      lon: stop.lon,
      order: stop.sequence ?? index
    });
  });
  for (const list of groups.values()) {
    const sorted = list.slice().sort((a, b) => a.order - b.order);
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const from = sorted[i];
      const to = sorted[i + 1];
      if (from.id === to.id) continue;
      const weight = haversine(from.lat, from.lon, to.lat, to.lon);
      if (!Number.isFinite(weight)) continue;
      adj[from.id].push({ to: to.id, weight });
      adj[to.id].push({ to: from.id, weight });
    }
  }
  return { nodes, adj };
}

export function dijkstra(graph, startId, endId) {
  const start = String(startId);
  const end = String(endId);
  const nodes = graph && graph.nodes ? graph.nodes : {};
  const adj = graph && graph.adj ? graph.adj : {};
  if (!nodes[start] || !nodes[end]) return { path: [], distance: Infinity };
  const dist = new Map();
  const prev = new Map();
  const visited = new Set();
  for (const id of Object.keys(nodes)) dist.set(id, Infinity);
  dist.set(start, 0);
  while (visited.size < dist.size) {
    let current = null;
    let best = Infinity;
    for (const [id, value] of dist) {
      if (!visited.has(id) && value < best) {
        best = value;
        current = id;
      }
    }
    if (current == null || best === Infinity) break;
    if (current === end) break;
    visited.add(current);
    for (const edge of adj[current] || []) {
      if (visited.has(edge.to)) continue;
      const alt = best + edge.weight;
      if (alt < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, alt);
        prev.set(edge.to, current);
      }
    }
  }
  if ((dist.get(end) ?? Infinity) === Infinity) return { path: [], distance: Infinity };
  const path = [];
  let cursor = end;
  const guard = dist.size + 1;
  while (cursor && path.length <= guard) {
    path.push(cursor);
    cursor = prev.get(cursor);
  }
  path.reverse();
  return { path, distance: dist.get(end) };
}

export function writeCache(storage, key, value, ttlMs, now = Date.now()) {
  const payload = { value, expiresAt: now + ttlMs, savedAt: now };
  storage.setItem(key, JSON.stringify(payload));
  return payload;
}

export function readCache(storage, key, now = Date.now()) {
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw);
    if (!payload || typeof payload.expiresAt !== 'number' || now > payload.expiresAt) {
      storage.removeItem(key);
      return null;
    }
    return payload.value;
  } catch (error) {
    storage.removeItem(key);
    return null;
  }
}

export function coordsToLineString(coords) {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: Array.isArray(coords) ? coords : []
    }
  };
}
