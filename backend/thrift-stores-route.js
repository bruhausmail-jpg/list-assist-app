const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

const thriftCache = new Map();

const CACHE_TIME_MS = 6 * 60 * 60 * 1000; // 6 hours
const STALE_CACHE_TIME_MS = 48 * 60 * 60 * 1000; // 48 hours fallback if Overpass is busy
const DEFAULT_RADIUS_MILES = 10;
const MAX_RADIUS_MILES = 50;
const METERS_PER_MILE = 1609.344;
const OVERPASS_TIMEOUT_MS = 9000;
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || '';
const GOOGLE_PLACES_TIMEOUT_MS = 4500;
const GOOGLE_PLACES_ENRICH_LIMIT = Math.max(
  0,
  Number(process.env.GOOGLE_PLACES_ENRICH_LIMIT || 18),
);
const GOOGLE_PLACES_TEXT_SEARCH_URL =
  'https://places.googleapis.com/v1/places:searchText';

// lz4 has been the most reliable/fastest in local testing, so try it first.
const OVERPASS_ENDPOINTS = [
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

// Starter fallback based on known local thrift results around Naperville.
// This keeps the app useful even when Overpass is slow or rate-limited.
const LOCAL_THRIFT_STARTER_STORES = [
  {
    id: 'local-goodwill-fort-hill-naperville',
    title: 'Goodwill',
    subtitle: 'Goodwill',
    latitude: 41.7648028,
    longitude: -88.1970536,
    addressLabel: '539 Fort Hill Drive, Naperville, IL 60540',
    mapAddress: '539 Fort Hill Drive, Naperville, IL 60540',
    timeLabel: 'Hours vary',
    openingHours: '',
    phone: '',
    website: 'https://www.amazinggoodwill.com/',
    notes: 'Goodwill • Website available',
    saleType: 'thrift',
    pinColor: '#0f766e',
    source: 'Local fallback + OpenStreetMap verified',
    tags: { shop: 'charity', brand: 'Goodwill', operator: '' },
  },
  {
    id: 'local-restore-route-59-naperville',
    title: 'Habitat for Humanity ReStore',
    subtitle: 'Habitat ReStore',
    latitude: 41.7552481,
    longitude: -88.2019689,
    addressLabel: '868 South Illinois Route 59, Naperville, IL 60540',
    mapAddress: '868 South Illinois Route 59, Naperville, IL 60540',
    timeLabel: 'Hours vary',
    openingHours: '',
    phone: '+1 630 297 9189',
    website: 'https://gohabitatrestore.com/shop-naperville/',
    notes: 'Habitat ReStore • Phone: +1 630 297 9189 • Website available',
    saleType: 'thrift',
    pinColor: '#0f766e',
    source: 'Local fallback + OpenStreetMap verified',
    tags: {
      shop: 'charity',
      brand: 'Habitat for Humanity ReStore',
      operator: '',
    },
  },
  {
    id: 'local-serendipity-aurora',
    title: 'Serendipity',
    subtitle: 'Thrift / second-hand shop',
    latitude: 41.7495525,
    longitude: -88.208617,
    addressLabel: '461 South Route 59, Aurora, IL 60504',
    mapAddress: '461 South Route 59, Aurora, IL 60504',
    timeLabel: 'Hours vary',
    openingHours: '',
    phone: '',
    website: '',
    notes: 'Thrift / second-hand shop',
    saleType: 'thrift',
    pinColor: '#0f766e',
    source: 'Local fallback + OpenStreetMap verified',
    tags: { shop: 'second_hand', brand: '', operator: '' },
  },
  {
    id: 'local-savers-ogden-naperville',
    title: 'Savers',
    subtitle: 'Savers / Value Village',
    latitude: 41.7937025,
    longitude: -88.1275684,
    addressLabel: '1125 East Ogden Avenue, Naperville, IL 60563',
    mapAddress: '1125 East Ogden Avenue, Naperville, IL 60563',
    timeLabel: 'Hours vary',
    openingHours: '',
    phone: '',
    website:
      'https://stores.savers.com/il/naperville/savers-thrift-store-1250.html',
    notes: 'Savers / Value Village • Website available',
    saleType: 'thrift',
    pinColor: '#0f766e',
    source: 'Local fallback + OpenStreetMap verified',
    tags: { shop: 'second_hand', brand: 'Savers', operator: '' },
  },
  {
    id: 'local-family-shelter-resale-naperville',
    title: 'Family Shelter Resale Shop',
    subtitle: 'Consignment / resale shop',
    latitude: 41.7980161,
    longitude: -88.1177492,
    addressLabel: '1512 Naper Boulevard, Unit 172, Naperville, IL 60563',
    mapAddress: '1512 Naper Boulevard, Unit 172, Naperville, IL 60563',
    timeLabel: 'Mo, We, Fr, Sa 10:00-12:00, 13:00-16:00',
    openingHours: 'Mo, We, Fr, Sa 10:00-12:00, 13:00-16:00',
    phone: '',
    website:
      'https://www.metrofamily.org/the-family-shelter-service-resale-shop-in-naperville-is-re-opening-as-of-monday-august-10/',
    notes: 'Consignment / resale shop • Website available',
    saleType: 'thrift',
    pinColor: '#0f766e',
    source: 'Local fallback + OpenStreetMap verified',
    tags: { shop: 'second_hand', brand: '', operator: '' },
  },
  {
    id: 'local-goodwill-woodridge',
    title: 'Goodwill',
    subtitle: 'Goodwill',
    latitude: 41.7297054,
    longitude: -88.0275685,
    addressLabel: '8615 Woodward Avenue, Woodridge, IL 60517',
    mapAddress: '8615 Woodward Avenue, Woodridge, IL 60517',
    timeLabel: 'Hours vary',
    openingHours: '',
    phone: '+1 630 9100387',
    website: 'https://www.goodwill.org/',
    notes: 'Goodwill • Phone: +1 630 9100387 • Website available',
    saleType: 'thrift',
    pinColor: '#0f766e',
    source: 'Local fallback + OpenStreetMap verified',
    tags: { shop: 'charity', brand: 'Goodwill', operator: '' },
  },
  {
    id: 'local-salvation-army-darien',
    title: 'The Salvation Army',
    subtitle: 'Salvation Army',
    latitude: 41.735774,
    longitude: -88.0117045,
    addressLabel: '7511 Lemont Road, Darien, IL 60561',
    mapAddress: '7511 Lemont Road, Darien, IL 60561',
    timeLabel: 'Mo-Sa 09:00-21:00',
    openingHours: 'Mo-Sa 09:00-21:00',
    phone: '',
    website: '',
    notes: 'Salvation Army',
    saleType: 'thrift',
    pinColor: '#0f766e',
    source: 'Local fallback + OpenStreetMap verified',
    tags: { shop: 'charity', brand: 'The Salvation Army', operator: '' },
  },
  {
    id: 'local-goodwill-montgomery',
    title: 'Goodwill',
    subtitle: 'Goodwill',
    latitude: 41.7210155,
    longitude: -88.2842689,
    addressLabel: '1901 Hill Avenue, Montgomery, IL 60538',
    mapAddress: '1901 Hill Avenue, Montgomery, IL 60538',
    timeLabel: 'Hours vary',
    openingHours: '',
    phone: '',
    website: '',
    notes: 'Goodwill',
    saleType: 'thrift',
    pinColor: '#0f766e',
    source: 'Local fallback + OpenStreetMap verified',
    tags: { shop: 'charity', brand: 'Goodwill', operator: '' },
  },
  {
    id: 'local-acostas-consignment-wheaton',
    title: "Acosta's Consignment",
    subtitle: 'Consignment / resale shop',
    latitude: 41.8592059,
    longitude: -88.0937435,
    addressLabel: '901 East Roosevelt Road, Wheaton, IL 60187',
    mapAddress: '901 East Roosevelt Road, Wheaton, IL 60187',
    timeLabel: 'Hours vary',
    openingHours: '',
    phone: '',
    website: '',
    notes: 'Consignment / resale shop',
    saleType: 'thrift',
    pinColor: '#0f766e',
    source: 'Local fallback + OpenStreetMap verified',
    tags: { shop: 'second_hand', brand: '', operator: '' },
  },
  {
    id: 'local-goodwill-plainfield',
    title: 'Goodwill',
    subtitle: 'Goodwill',
    latitude: 41.6329523,
    longitude: -88.2005894,
    addressLabel: '13565 Illinois Route 59, Plainfield, IL 60544',
    mapAddress: '13565 Illinois Route 59, Plainfield, IL 60544',
    timeLabel: 'Hours vary',
    openingHours: '',
    phone: '',
    website: '',
    notes: 'Goodwill',
    saleType: 'thrift',
    pinColor: '#0f766e',
    source: 'Local fallback + OpenStreetMap verified',
    tags: { shop: 'charity', brand: 'Goodwill', operator: '' },
  },
];

function buildCacheKey(lat, lng, radiusMiles) {
  return `${Number(lat).toFixed(3)}|${Number(lng).toFixed(3)}|${Number(radiusMiles)}`;
}

function isValidCoordinate(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function clampRadiusMiles(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RADIUS_MILES;
  return Math.min(Math.max(parsed, 1), MAX_RADIUS_MILES);
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function getDistanceMiles(lat1, lng1, lat2, lng2) {
  if (!isValidCoordinate(lat1, lng1) || !isValidCoordinate(lat2, lng2)) {
    return null;
  }

  const earthRadiusMiles = 3958.7613;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMiles * c;
}

function cleanString(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getTag(tags, keys) {
  for (const key of keys) {
    const value = cleanString(tags?.[key]);
    if (value) return value;
  }
  return '';
}

function buildStreetAddress(tags = {}) {
  const houseNumber = cleanString(tags['addr:housenumber']);
  const street = cleanString(tags['addr:street']);
  const unit = cleanString(tags['addr:unit'] || tags['addr:suite']);
  const line1 = [houseNumber, street].filter(Boolean).join(' ');
  return [line1, unit ? `Unit ${unit}` : ''].filter(Boolean).join(', ');
}

function buildCityStateZip(tags = {}) {
  const city = cleanString(
    tags['addr:city'] ||
      tags['addr:town'] ||
      tags['addr:village'] ||
      tags['addr:suburb'],
  );
  const state = cleanString(tags['addr:state']);
  const zip = cleanString(tags['addr:postcode']);
  const cityState = [city, state].filter(Boolean).join(', ');
  return [cityState, zip].filter(Boolean).join(' ');
}

function buildAddressLabel(tags = {}) {
  const line1 = buildStreetAddress(tags);
  const line2 = buildCityStateZip(tags);
  const full = [line1, line2].filter(Boolean).join(', ');
  return full || 'Tap for directions';
}

function normalizeWebsite(value) {
  const cleaned = cleanString(value);
  if (!cleaned) return '';
  if (/^https?:\/\//i.test(cleaned)) return cleaned;
  return `https://${cleaned}`;
}

function getWebsiteFromTags(tags = {}) {
  return normalizeWebsite(
    getTag(tags, [
      'website',
      'contact:website',
      'contact:homepage',
      'website:mobile',
      'url',
      'contact:url',
      'brand:website',
      'operator:website',
    ]),
  );
}

function buildWebsiteSearchUrl(store = {}) {
  const address = cleanString(
    store.mapAddress || store.addressLabel || store.displayAddress || '',
  ).replace(/Tap for directions/gi, '');
  const search = [store.title, address, 'official website hours']
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!search) return '';
  return `https://www.google.com/search?q=${encodeURIComponent(search)}`;
}

function ensureWebsiteFallback(store) {
  if (!store) return store;
  if (store.website) return { ...store, websiteIsSearchFallback: false };

  const websiteSearchUrl = buildWebsiteSearchUrl(store);
  return {
    ...store,
    website: websiteSearchUrl,
    websiteIsSearchFallback: Boolean(websiteSearchUrl),
  };
}

function inferStoreKind(tags = {}) {
  const joined =
    `${tags.name || ''} ${tags.brand || ''} ${tags.shop || ''} ${tags.operator || ''}`.toLowerCase();
  if (/goodwill/.test(joined)) return 'Goodwill';
  if (/salvation\s+army/.test(joined)) return 'Salvation Army';
  if (/savers|value\s+village/.test(joined)) return 'Savers / Value Village';
  if (/habitat|restore/.test(joined)) return 'Habitat ReStore';
  if (/consign|consignment|resale|re-sale/.test(joined))
    return 'Consignment / resale shop';
  if (/charity/.test(joined)) return 'Charity shop';
  if (
    /second_hand|second hand|second-hand|2nd hand|thrift|used goods|used clothing|used furniture/.test(
      joined,
    )
  ) {
    return 'Thrift / second-hand shop';
  }
  return 'Second-hand / resale shop';
}

function getName(tags = {}) {
  return (
    cleanString(tags.name) ||
    cleanString(tags.brand) ||
    cleanString(tags.operator) ||
    'Thrift Store'
  );
}

function buildMapsQuery(store) {
  const address = store.mapAddress || store.addressLabel;
  if (address && address !== 'Tap for directions')
    return `${store.title} ${address}`;
  return `${store.title} ${store.latitude},${store.longitude}`;
}

function buildNotes(tags = {}, storeKind) {
  const parts = [storeKind];
  const phone = getTag(tags, ['phone', 'contact:phone']);
  const website = getWebsiteFromTags(tags);
  if (phone) parts.push(`Phone: ${phone}`);
  if (website) parts.push('Website available');
  return parts.join(' • ');
}

function buildOverpassQuery(radiusMeters, lat, lng) {
  return `
    [out:json][timeout:18];
    (
      node["shop"~"^(second_hand|charity|thrift)$"](around:${radiusMeters},${lat},${lng});
      way["shop"~"^(second_hand|charity|thrift)$"](around:${radiusMeters},${lat},${lng});
      relation["shop"~"^(second_hand|charity|thrift)$"](around:${radiusMeters},${lat},${lng});
    );
    out center tags 75;
  `;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOverpass(query) {
  let lastError = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetchWithTimeout(
        endpoint,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain;charset=UTF-8',
            Accept: 'application/json',
            'User-Agent': 'ListAssist/1.0 thrift-store-finder',
          },
          body: query,
        },
        OVERPASS_TIMEOUT_MS,
      );

      const text = await response.text();
      if (!response.ok)
        throw new Error(`Overpass ${response.status}: ${text.slice(0, 160)}`);
      if (text.trim().startsWith('<'))
        throw new Error('Overpass returned HTML instead of JSON');
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      console.warn(`Overpass endpoint failed: ${endpoint}`, error.message);
    }
  }

  throw lastError || new Error('All Overpass endpoints failed');
}

function mapOverpassElement(el, originLat, originLng) {
  const tags = el.tags || {};
  const latitude = Number(el.lat ?? el.center?.lat);
  const longitude = Number(el.lon ?? el.center?.lon);
  if (!isValidCoordinate(latitude, longitude)) return null;

  const title = getName(tags);
  const addressLabel = buildAddressLabel(tags);
  const mapAddress = addressLabel === 'Tap for directions' ? '' : addressLabel;
  const storeKind = inferStoreKind(tags);
  const distanceMiles = getDistanceMiles(
    originLat,
    originLng,
    latitude,
    longitude,
  );
  const openingHours = getTag(tags, ['opening_hours', 'opening_hours:covid19']);
  const phone = getTag(tags, ['phone', 'contact:phone']);
  const website = getWebsiteFromTags(tags);

  const store = {
    id: `thrift-${el.type}-${el.id}`,
    title,
    subtitle: storeKind,
    latitude,
    longitude,
    addressLabel,
    mapAddress,
    mapsQuery: '',
    timeLabel: openingHours || 'Hours vary',
    openingHours: openingHours || '',
    phone,
    website,
    notes: buildNotes(tags, storeKind),
    saleType: 'thrift',
    pinColor: '#0f766e',
    distanceMiles:
      distanceMiles === null ? null : Number(distanceMiles.toFixed(2)),
    distanceLabel:
      distanceMiles === null ? '' : `${distanceMiles.toFixed(1)} mi`,
    source: 'OpenStreetMap / Overpass',
    osmType: el.type,
    osmId: el.id,
    tags: {
      shop: tags.shop || '',
      brand: tags.brand || '',
      operator: tags.operator || '',
    },
  };

  store.mapsQuery = buildMapsQuery(store);
  return ensureWebsiteFallback(store);
}

function addDistanceAndMaps(store, originLat, originLng) {
  const distanceMiles = getDistanceMiles(
    originLat,
    originLng,
    store.latitude,
    store.longitude,
  );
  const next = {
    ...store,
    distanceMiles:
      distanceMiles === null ? null : Number(distanceMiles.toFixed(2)),
    distanceLabel:
      distanceMiles === null ? '' : `${distanceMiles.toFixed(1)} mi`,
  };
  next.mapsQuery = buildMapsQuery(next);
  return ensureWebsiteFallback(next);
}

function getFallbackStores(originLat, originLng, radiusMiles) {
  return LOCAL_THRIFT_STARTER_STORES.map((store) =>
    addDistanceAndMaps(store, originLat, originLng),
  )
    .filter(
      (store) =>
        store.distanceMiles === null || store.distanceMiles <= radiusMiles,
    )
    .sort((a, b) => (a.distanceMiles ?? 9999) - (b.distanceMiles ?? 9999));
}

function getTodayGoogleHours(weekdayDescriptions = []) {
  if (!Array.isArray(weekdayDescriptions) || !weekdayDescriptions.length)
    return '';
  const jsDay = new Date().getDay();
  const googleIndex = jsDay === 0 ? 6 : jsDay - 1;
  const todayLine = weekdayDescriptions[googleIndex] || '';
  return cleanString(String(todayLine).replace(/^[^:]+:\s*/, ''));
}

function buildGooglePlacesTextQuery(store) {
  return [
    store.title,
    store.mapAddress || store.addressLabel || store.displayAddress,
    'thrift store',
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/Tap for directions/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getGooglePlaceDistanceMiles(place, store) {
  const lat = Number(place?.location?.latitude);
  const lng = Number(place?.location?.longitude);
  if (!isValidCoordinate(lat, lng)) return null;
  return getDistanceMiles(store.latitude, store.longitude, lat, lng);
}

function scoreGooglePlaceCandidate(place, store) {
  const placeName = cleanString(place?.displayName?.text || '').toLowerCase();
  const storeName = cleanString(store.title || '').toLowerCase();
  const placeAddress = cleanString(place?.formattedAddress || '').toLowerCase();
  const storeAddress = cleanString(
    store.mapAddress || store.addressLabel || '',
  ).toLowerCase();
  const distance = getGooglePlaceDistanceMiles(place, store);
  let score = 0;

  if (placeName && storeName) {
    if (placeName === storeName) score += 60;
    else if (placeName.includes(storeName) || storeName.includes(placeName))
      score += 40;
    else {
      const storeTokens = storeName
        .split(/\s+/)
        .filter((token) => token.length >= 3);
      const matches = storeTokens.filter((token) =>
        placeName.includes(token),
      ).length;
      score += matches * 12;
    }
  }

  if (placeAddress && storeAddress) {
    const addressTokens = storeAddress
      .split(/\W+/)
      .filter((token) => token.length >= 3);
    const matches = addressTokens.filter((token) =>
      placeAddress.includes(token),
    ).length;
    score += Math.min(30, matches * 5);
  }

  if (distance !== null) {
    if (distance <= 0.1) score += 35;
    else if (distance <= 0.25) score += 25;
    else if (distance <= 0.5) score += 12;
    else if (distance > 1.5) score -= 40;
  }

  if (place?.currentOpeningHours || place?.regularOpeningHours) score += 20;
  if (place?.websiteUri) score += 4;
  if (place?.nationalPhoneNumber || place?.internationalPhoneNumber) score += 4;
  return score;
}

async function fetchGooglePlaceForStore(store) {
  if (!GOOGLE_PLACES_API_KEY) return null;
  const textQuery = buildGooglePlacesTextQuery(store);
  if (!textQuery) return null;

  const body = {
    textQuery,
    maxResultCount: 3,
    locationBias: {
      circle: {
        center: { latitude: store.latitude, longitude: store.longitude },
        radius: 1200,
      },
    },
  };

  try {
    const response = await fetchWithTimeout(
      GOOGLE_PLACES_TEXT_SEARCH_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
          'X-Goog-FieldMask': [
            'places.id',
            'places.displayName',
            'places.formattedAddress',
            'places.location',
            'places.currentOpeningHours',
            'places.regularOpeningHours',
            'places.nationalPhoneNumber',
            'places.internationalPhoneNumber',
            'places.websiteUri',
            'places.googleMapsUri',
          ].join(','),
        },
        body: JSON.stringify(body),
      },
      GOOGLE_PLACES_TIMEOUT_MS,
    );

    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        payload?.error?.message || `Google Places ${response.status}`,
      );

    const places = Array.isArray(payload?.places) ? payload.places : [];
    if (!places.length) return null;

    const scored = places
      .map((place) => ({
        place,
        score: scoreGooglePlaceCandidate(place, store),
      }))
      .sort((a, b) => b.score - a.score);
    return scored[0]?.score >= 35 ? scored[0].place : null;
  } catch (error) {
    console.warn(
      `Google Places enrichment failed for ${store.title}:`,
      error.message,
    );
    return null;
  }
}

function enrichStoreFromGooglePlace(store, place) {
  if (!place) return store;
  const currentHours = place.currentOpeningHours || null;
  const regularHours = place.regularOpeningHours || null;
  const weekdayDescriptions =
    currentHours?.weekdayDescriptions ||
    regularHours?.weekdayDescriptions ||
    [];
  const todayHours = getTodayGoogleHours(weekdayDescriptions);
  const openNow =
    typeof currentHours?.openNow === 'boolean' ? currentHours.openNow : null;
  const placeWebsite = normalizeWebsite(place.websiteUri || '');
  const website = placeWebsite || store.website || '';
  const phone = cleanString(
    place.nationalPhoneNumber ||
      place.internationalPhoneNumber ||
      store.phone ||
      '',
  );
  const googleMapsUri = normalizeWebsite(place.googleMapsUri || '');

  let timeLabel = store.timeLabel;
  if (todayHours) {
    if (openNow === true) timeLabel = `Open now • ${todayHours}`;
    else if (openNow === false) timeLabel = `Closed now • ${todayHours}`;
    else timeLabel = todayHours;
  }

  const next = {
    ...store,
    timeLabel,
    openingHours: weekdayDescriptions.length
      ? weekdayDescriptions.join('; ')
      : store.openingHours,
    phone,
    website: website || store.website,
    websiteIsSearchFallback: placeWebsite
      ? false
      : Boolean(store.websiteIsSearchFallback),
    googleMapsUri: googleMapsUri || store.googleMapsUri,
    hoursSource: weekdayDescriptions.length
      ? 'Google Places'
      : store.hoursSource,
    source: store.source ? `${store.source} + Google Places` : 'Google Places',
  };

  const noteParts = [
    inferStoreKind(next.tags || {}),
    phone ? `Phone: ${phone}` : '',
    website && !next.websiteIsSearchFallback ? 'Website available' : '',
  ];
  next.notes = noteParts.filter(Boolean).join(' • ') || store.notes;
  return next;
}

async function enrichStoresWithGooglePlaces(stores) {
  if (!GOOGLE_PLACES_API_KEY || GOOGLE_PLACES_ENRICH_LIMIT <= 0) return stores;
  const enriched = [];
  const limit = Math.min(GOOGLE_PLACES_ENRICH_LIMIT, stores.length);

  for (let i = 0; i < stores.length; i += 1) {
    if (i >= limit) {
      enriched.push(stores[i]);
      continue;
    }
    const place = await fetchGooglePlaceForStore(stores[i]);
    enriched.push(enrichStoreFromGooglePlace(stores[i], place));
  }
  return enriched;
}

function scoreStoreCompleteness(store) {
  let score = 0;
  if (store.title && store.title !== 'Thrift Store') score += 2;
  if (store.mapAddress) score += 3;
  if (store.openingHours) score += 2;
  if (store.phone) score += 1;
  if (store.website) score += 1;
  if (store.distanceMiles !== null) score += 1;
  if (store.source && /OpenStreetMap/.test(store.source)) score += 1;
  return score;
}

function dedupeStores(stores) {
  const byKey = new Map();
  for (const store of stores) {
    const titleKey = store.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    const coordKey = `${Number(store.latitude).toFixed(4)}|${Number(store.longitude).toFixed(4)}`;
    const addressKey = String(store.mapAddress || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    const key = addressKey || `${titleKey}|${coordKey}`;
    const existing = byKey.get(key);
    if (
      !existing ||
      scoreStoreCompleteness(store) > scoreStoreCompleteness(existing)
    )
      byKey.set(key, store);
  }
  return Array.from(byKey.values());
}

function sortStores(stores) {
  return stores.sort((a, b) => {
    const aDistance = Number.isFinite(a.distanceMiles) ? a.distanceMiles : 9999;
    const bDistance = Number.isFinite(b.distanceMiles) ? b.distanceMiles : 9999;
    return aDistance - bDistance || a.title.localeCompare(b.title);
  });
}

function isTruthyQueryValue(value) {
  return value === true || value === 'true' || value === '1' || value === 'yes';
}

function summarizeElement(el) {
  const tags = el.tags || {};
  return {
    type: el.type,
    id: el.id,
    lat: el.lat ?? el.center?.lat ?? null,
    lon: el.lon ?? el.center?.lon ?? null,
    name: tags.name || '',
    brand: tags.brand || '',
    operator: tags.operator || '',
    shop: tags.shop || '',
    addr: buildAddressLabel(tags),
    opening_hours: tags.opening_hours || '',
    phone: tags.phone || tags['contact:phone'] || '',
    website:
      tags.website ||
      tags['contact:website'] ||
      tags['contact:homepage'] ||
      tags['website:mobile'] ||
      tags.url ||
      tags['contact:url'] ||
      tags['brand:website'] ||
      tags['operator:website'] ||
      '',
  };
}

async function thriftStoresHandler(req, res) {
  try {
    const lat = Number(req.query.latitude);
    const lng = Number(req.query.longitude);
    const radius = clampRadiusMiles(req.query.radiusMiles);
    const debug = isTruthyQueryValue(req.query.debug);
    const clearCache = isTruthyQueryValue(req.query.clearCache);

    if (!isValidCoordinate(lat, lng)) {
      return res
        .status(400)
        .json({ error: 'Valid latitude and longitude are required.' });
    }

    const cacheKey = buildCacheKey(lat, lng, radius);
    if (clearCache) thriftCache.delete(cacheKey);
    const cached = thriftCache.get(cacheKey);

    if (!debug && cached && Date.now() - cached.timestamp < CACHE_TIME_MS) {
      console.log(`Serving thrift stores from cache: ${cacheKey}`);
      return res.json(cached.data);
    }

    const radiusMeters = Math.round(radius * METERS_PER_MILE);
    const query = buildOverpassQuery(radiusMeters, lat, lng);
    const fallbackStores = getFallbackStores(lat, lng, radius);

    let elements = [];
    let overpassError = '';

    try {
      const data = await fetchOverpass(query);
      elements = Array.isArray(data?.elements) ? data.elements : [];
    } catch (error) {
      overpassError = error.message;
      console.warn(
        'Using fallback thrift data after Overpass failure:',
        overpassError,
      );
    }

    const overpassStores = elements
      .map((el) => mapOverpassElement(el, lat, lng))
      .filter(Boolean);
    let mergedStores = sortStores(
      dedupeStores([...overpassStores, ...fallbackStores]),
    );
    mergedStores = await enrichStoresWithGooglePlaces(mergedStores);
    const payload = sortStores(mergedStores.map(ensureWebsiteFallback)).slice(
      0,
      100,
    );

    if (!debug && payload.length) {
      thriftCache.set(cacheKey, { data: payload, timestamp: Date.now() });
    }

    if (debug) {
      return res.json({
        debug: true,
        cacheKey,
        radiusMiles: radius,
        radiusMeters,
        origin: { latitude: lat, longitude: lng },
        overpassError,
        googlePlacesEnabled: Boolean(GOOGLE_PLACES_API_KEY),
        googlePlacesEnrichLimit: GOOGLE_PLACES_ENRICH_LIMIT,
        rawElementCount: elements.length,
        rawElementsSample: elements.slice(0, 35).map(summarizeElement),
        overpassStoreCount: overpassStores.length,
        fallbackStoreCount: fallbackStores.length,
        dedupedStoreCount: payload.length,
        stores: payload,
        query,
      });
    }

    console.log(
      `Returned ${payload.length} thrift stores for ${cacheKey} (overpass=${overpassStores.length}, fallback=${fallbackStores.length})`,
    );
    return res.json(payload);
  } catch (err) {
    console.error('Thrift store error:', err.message);
    return res
      .status(500)
      .json({ error: 'Failed to fetch thrift stores', message: err.message });
  }
}

module.exports = { thriftStoresHandler };
