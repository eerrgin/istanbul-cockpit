import { describe, expect, it } from 'vitest';
import {
  classifyBikeInfrastructure,
  coordsToLineString,
  formatDistance,
  formatDuration,
  haversine,
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

describe('bisiklet altyapısı sınıflandırması', () => {
  it('ayrılmış bisiklet yolunu tanır', () => {
    expect(classifyBikeInfrastructure({ highway: 'cycleway' })).toBe('dedicated');
    expect(classifyBikeInfrastructure({ highway: 'residential', cycleway: 'track' })).toBe('dedicated');
  });

  it('yol üzeri bisiklet şeridini tanır', () => {
    expect(classifyBikeInfrastructure({ highway: 'primary', cycleway: 'lane' })).toBe('lane');
  });

  it('paylaşımlı ve bisiklete açık yolu ayırt eder', () => {
    expect(classifyBikeInfrastructure({ highway: 'residential', bicycle: 'designated' })).toBe('shared');
    expect(classifyBikeInfrastructure({ highway: 'path' })).toBe('shared');
  });

  it('bisiklet etiketi olmayan sıradan yolu dışarıda bırakır', () => {
    expect(classifyBikeInfrastructure({ highway: 'residential' })).toBeNull();
    expect(classifyBikeInfrastructure(null)).toBeNull();
  });
});

describe('haversine', () => {
  it('aynı koordinatta sıfır metre döner', () => {
    expect(haversine(41.0082, 28.9784, 41.0082, 28.9784)).toBe(0);
  });

  it('ekvatorda bir derece boylamı yaklaşık 111195 metre sayar', () => {
    expect(haversine(0, 0, 0, 1)).toBeCloseTo(111194.93, 1);
  });
});


describe('süre biçimi', () => {
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
