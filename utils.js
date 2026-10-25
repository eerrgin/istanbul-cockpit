const EARTH_RADIUS = 6371000;

function toRadians(value) {
  return (value * Math.PI) / 180;
}

export function classifyBikeInfrastructure(tags = {}) {
  if (!tags || typeof tags !== 'object') return null;
  const values = ['cycleway', 'cycleway:left', 'cycleway:right', 'cycleway:both']
    .map((key) => tags[key]).filter((value) => typeof value === 'string');
  if (tags.highway === 'cycleway' || values.includes('track')) return 'dedicated';
  if (values.some((value) => ['lane', 'opposite_lane'].includes(value))) return 'lane';
  if (tags.bicycle === 'designated' ||
      values.some((value) => ['shared_lane', 'share_busway', 'opposite_track'].includes(value)) ||
      ['path', 'footway', 'track'].includes(tags.highway)) return 'shared';
  return null;
}

export function haversine(lat1, lon1, lat2, lon2) {
  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const Δφ = toRadians(lat2 - lat1);
  const Δλ = toRadians(lon2 - lon1);
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDuration(seconds) {
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
