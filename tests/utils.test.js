import { describe, expect, it } from 'vitest';
import {
  buildStopGraph,
  coordsToLineString,
  dijkstra,
  formatDistance,
  formatDuration,
  haversine,
  overpassToGeoJSON,
  readCache,
  wmoToTurkish,
  writeCache
} from '../utils.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(String(key), String(value));
    },
    removeItem(key) {
      data.delete(String(key));
    }
  };
}

describe('haversine', () => {
  it('aynı koordinatta sıfır metre döner', () => {
    expect(haversine(41.0082, 28.9784, 41.0082, 28.9784)).toBe(0);
  });

  it('ekvatorda bir derece boylamı yaklaşık 111195 metre sayar', () => {
    expect(haversine(0, 0, 0, 1)).toBeCloseTo(111194.93, 1);
  });
});


  it('saniyeyi olduğu gibi yazar', () => {
    expect(formatDuration(45)).toBe('45 sn');
  });

  it('dakika ve saniyeyi birlikte yazar', () => {
    expect(formatDuration(90)).toBe('1 dk 30 sn');
  });

  it('saati dakikaya çevirir', () => {
    expect(formatDuration(3661)).toBe('1 sa 1 dk');
  });

  it('tam saatte yalnızca saati yazar', () => {
    expect(formatDuration(7200)).toBe('2 sa');
  });

  it('sıfır ve geçersiz değerde sıfır saniye döner', () => {
    expect(formatDuration(0)).toBe('0 sn');
    expect(formatDuration(-8)).toBe('0 sn');
  });
});

describe('mesafe biçimi', () => {
  it('bin metrenin altında metre yazar', () => {
    expect(formatDistance(850)).toBe('850 m');
  });

  it('bin metre ve üzerinde kilometre yazar', () => {
    expect(formatDistance(1500)).toBe('1.5 km');
    expect(formatDistance(12500)).toBe('13 km');
  });
});

describe('WMO kodu', () => {
  it('açık havayı güneş ikonuyla çevirir', () => {
    expect(wmoToTurkish(0)).toEqual({ aciklama: 'Açık', ikon: 'sun' });
  });

  it('yağmuru yağmur ikonuyla çevirir', () => {
    expect(wmoToTurkish(63)).toEqual({ aciklama: 'Yağmur', ikon: 'cloud-rain' });
  });

  it('fırtınayı şimşek ikonuyla çevirir', () => {
    expect(wmoToTurkish(95).ikon).toBe('cloud-lightning');
    expect(wmoToTurkish(95).aciklama).toBe('Gök gürültülü fırtına');
  });

  it('bilinmeyen kodda yedek açıklama döner', () => {
    expect(wmoToTurkish(123)).toEqual({ aciklama: 'Bilinmeyen', ikon: 'cloud' });
  });
});

describe('Overpass GeoJSON dönüşümü', () => {
  it('örnek relation kaydını hat ve durak koleksiyonuna çevirir', () => {
    const geo = overpassToGeoJSON({
      elements: [
        { type: 'node', id: 5, lat: 41, lon: 29, tags: { name: 'Kabataş' } },
        {
          type: 'relation',
          id: 10,
          tags: { route: 'tram', name: 'T1' },
          members: [
            { type: 'way', ref: 1, geometry: [{ lat: 41, lon: 29 }, { lat: 41.01, lon: 29 }] },
            { type: 'way', ref: 2, geometry: [{ lat: 41.01, lon: 29 }, { lat: 41.02, lon: 29.01 }] },
            { type: 'node', ref: 5, role: 'stop', lat: 41, lon: 29 },
            { type: 'node', ref: 6, role: 'stop', lat: 41.02, lon: 29.01 }
          ]
        }
      ]
    });
    expect(geo.lines.type).toBe('FeatureCollection');
    expect(geo.stops.type).toBe('FeatureCollection');
    expect(geo.lines.features).toHaveLength(1);
    expect(geo.lines.features[0].geometry.type).toBe('LineString');
    expect(geo.lines.features[0].geometry.coordinates).toHaveLength(3);
    expect(geo.lines.features[0].properties).toMatchObject({ id: '10', name: 'T1', mode: 'tram' });
    expect(geo.routes[0].coordinates[0]).toEqual([29, 41]);
    expect(geo.stops.features).toHaveLength(2);
    expect(geo.stops.features[0].properties.name).toBe('Kabataş');
    expect(geo.stops.features[0].properties.lineId).toBe('10');
    expect(geo.stops.features[0].geometry.type).toBe('Point');
  });

  it('boş yanıtta boş koleksiyon döner', () => {
    const geo = overpassToGeoJSON({});
    expect(geo.lines.features).toEqual([]);
    expect(geo.stops.features).toEqual([]);
    expect(geo.routes).toEqual([]);
  });
});

describe('durak grafı ve dijkstra', () => {
  const stops = [
    { id: 'A', name: 'A', lat: 41, lon: 29, lineId: 'L1', sequence: 0 },
    { id: 'B', name: 'B', lat: 41.02, lon: 29.02, lineId: 'L1', sequence: 1 },
    { id: 'C', name: 'C', lat: 41.01, lon: 29, lineId: 'L1', sequence: 2 },
    { id: 'A', name: 'A', lat: 41, lon: 29, lineId: 'L2', sequence: 0 },
    { id: 'C', name: 'C', lat: 41.01, lon: 29, lineId: 'L2', sequence: 1 }
  ];

  it('aynı hat üzerindeki ardışık duraklar arasında kenar kurar', () => {
    const graph = buildStopGraph(stops);
    expect(Object.keys(graph.nodes).sort()).toEqual(['A', 'B', 'C']);
    const neighbors = graph.adj.B.map((edge) => edge.to).sort();
    expect(neighbors).toEqual(['A', 'C']);
    expect(graph.adj.A.some((edge) => edge.to === 'C')).toBe(true);
  });

  it('basit grafta en kısa yolu seçer', () => {
    const graph = buildStopGraph(stops);
    const direct = haversine(41, 29, 41.01, 29);
    const via = haversine(41, 29, 41.02, 29.02) + haversine(41.02, 29.02, 41.01, 29);
    const result = dijkstra(graph, 'A', 'C');
    expect(result.path).toEqual(['A', 'C']);
    expect(result.distance).toBeCloseTo(direct, 3);
    expect(result.distance).toBeLessThan(via);
  });

  it('bağlantısız durakta boş yol döner', () => {
    const graph = buildStopGraph([
      { id: 'A', lat: 0, lon: 0, lineId: 'L1', sequence: 0 },
      { id: 'B', lat: 0, lon: 1, lineId: 'L1', sequence: 1 },
      { id: 'Z', lat: 5, lon: 5, lineId: 'L2', sequence: 0 }
    ]);
    const missing = dijkstra(graph, 'A', 'Y');
    const disconnected = dijkstra(graph, 'A', 'Z');
    expect(missing).toEqual({ path: [], distance: Infinity });
    expect(disconnected.path).toEqual([]);
    expect(disconnected.distance).toBe(Infinity);
  });
});

describe('önbellek', () => {
  it('zaman damgasıyla yazar ve süresi dolmadan okur', () => {
    const storage = memoryStorage();
    writeCache(storage, 'hava', { sicaklik: 18 }, 1000, 5000);
    expect(readCache(storage, 'hava', 5500)).toEqual({ sicaklik: 18 });
  });

  it('süresi dolan kaydı geçersiz sayar', () => {
    const storage = memoryStorage();
    writeCache(storage, 'ucus', [1], 1000, 5000);
    expect(readCache(storage, 'ucus', 6001)).toBeNull();
    expect(storage.getItem('ucus')).toBeNull();
  });

  it('bozuk kaydı siler', () => {
    const storage = memoryStorage();
    storage.setItem('bozuk', '{');
    expect(readCache(storage, 'bozuk', 0)).toBeNull();
    expect(storage.getItem('bozuk')).toBeNull();
  });

  it('olmayan anahtarda null döner', () => {
    expect(readCache(memoryStorage(), 'yok', 0)).toBeNull();
  });
});

describe('GeoJSON çizgi', () => {
  it('koordinat dizisini MapLibre LineString yapar', () => {
    const feature = coordsToLineString([[29, 41], [29.1, 41.1]]);
    expect(feature.type).toBe('Feature');
    expect(feature.geometry.type).toBe('LineString');
    expect(feature.geometry.coordinates).toEqual([[29, 41], [29.1, 41.1]]);
  });
});
