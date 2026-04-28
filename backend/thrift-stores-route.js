// thrift-stores-route.js
// List Assist thrift-store backend route
// Uses OpenStreetMap / Overpass as the free broad search.
// Optionally enriches only weak/missing records with Google Places when GOOGLE_MAPS_API_KEY is set.

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const GOOGLE_TEXT_SEARCH_URL =
  'https://places.googleapis.com/v1/places:searchText';

const DEFAULT_RADIUS_MILES = 25;
const DEFAULT_LIMIT = 50;
const MAX_RADIUS_MILES = 50;
const MAX_LIMIT = 75;
const REQUEST_TIMEOUT_MS = 18000;
const OVERPASS_CACHE_TTL_MS = 30 * 60 * 1000;
const GOOGLE_CACHE_TTL_MS =
  Number(process.env.GOOGLE_PLACES_CACHE_TTL_DAYS || 30) * 24 * 60 * 60 * 1000;
const GOOGLE_MAX_ENRICH_PER_REQUEST = Math.max(
  0,
  Math.min(Number(process.env.GOOGLE_PLACES_MAX_ENRICH_PER_REQUEST || 8), 20),
);
const GOOGLE_ENRICH_ENABLED =
  String(
    process.env.ENABLE_GOOGLE_PLACES_ENRICHMENT || 'true',
  ).toLowerCase() !== 'false';

const overpassCache = new Map();
const googlePlaceCache = new Map();

function toNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function normalizeText(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(
      /\b(the|inc|llc|store|stores|shop|shops|thrift|resale|donation|center|centre)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAddress(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/\b(unit|suite|ste|#|apt|room)\s*[a-z0-9-]+/gi, ' ')
    .replace(/\b(avenue)\b/g, 'ave')
    .replace(/\b(street)\b/g, 'st')
    .replace(/\b(road)\b/g, 'rd')
    .replace(/\b(boulevard)\b/g, 'blvd')
    .replace(/\b(drive)\b/g, 'dr')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function calculateDistanceMiles(lat1, lon1, lat2, lon2) {
  const earthRadiusMiles = 3958.8;
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function withTimeout(ms = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timeout) };
}

function getTag(tags = {}, key = '') {
  return String(tags?.[key] || '').trim();
}

function buildAddressFromTags(tags = {}) {
  const house = getTag(tags, 'addr:housenumber');
  const street = getTag(tags, 'addr:street');
  const unit = getTag(tags, 'addr:unit') || getTag(tags, 'addr:suite');
  const city = getTag(tags, 'addr:city');
  const state = getTag(tags, 'addr:state');
  const zip = getTag(tags, 'addr:postcode');

  const line1 = [house, street].filter(Boolean).join(' ').trim();
  const withUnit = [line1, unit ? `Unit ${unit}` : '']
    .filter(Boolean)
    .join(', ');
  const line2 = [city, state, zip]
    .filter(Boolean)
    .join(', ')
    .replace(/, (\d{5})$/, ' $1');
  return [withUnit, line2].filter(Boolean).join(', ').trim();
}

function formatOpeningHours(value = '') {
  const hours = String(value || '').trim();
  if (!hours) return '';
  return hours
    .replace(/09:00/g, '9 AM')
    .replace(/10:00/g, '10 AM')
    .replace(/11:00/g, '11 AM')
    .replace(/12:00/g, '12 PM')
    .replace(/13:00/g, '1 PM')
    .replace(/14:00/g, '2 PM')
    .replace(/15:00/g, '3 PM')
    .replace(/16:00/g, '4 PM')
    .replace(/17:00/g, '5 PM')
    .replace(/18:00/g, '6 PM')
    .replace(/19:00/g, '7 PM')
    .replace(/20:00/g, '8 PM')
    .replace(/21:00/g, '9 PM')
    .replace(/22:00/g, '10 PM');
}

function getStoreKind(tags = {}) {
  const shop = getTag(tags, 'shop').toLowerCase();
  const amenity = getTag(tags, 'amenity').toLowerCase();
  const name = getTag(tags, 'name');
  const lowerName = name.toLowerCase();

  if (shop === 'charity') return 'Thrift Store';
  if (shop === 'second_hand') return 'Second-hand Store';
  if (shop === 'used') return 'Used Goods Store';
  if (shop === 'antiques') return 'Antiques / Resale';
  if (shop === 'clothes' && /goodwill|salvation|thrift|resale/.test(lowerName))
    return 'Thrift Store';
  if (
    amenity === 'social_facility' &&
    /goodwill|salvation|thrift|resale/.test(lowerName)
  )
    return 'Thrift Store';
  return 'Thrift Store';
}

function looksLikeThriftStore(tags = {}) {
  const name = getTag(tags, 'name').toLowerCase();
  const shop = getTag(tags, 'shop').toLowerCase();
  const amenity = getTag(tags, 'amenity').toLowerCase();
  const brand = getTag(tags, 'brand').toLowerCase();
  const operator = getTag(tags, 'operator').toLowerCase();
  const combined = `${name} ${brand} ${operator}`;

  if (['charity', 'second_hand', 'used', 'antiques'].includes(shop))
    return true;
  if (
    shop === 'clothes' &&
    /goodwill|salvation|thrift|resale|savers/.test(combined)
  )
    return true;
  if (
    amenity === 'social_facility' &&
    /goodwill|salvation|thrift|resale/.test(combined)
  )
    return true;
  return /goodwill|salvation army|savers|thrift|resale|second hand|restore|habitat for humanity|consignment/.test(
    combined,
  );
}

function buildOverpassQuery(latitude, longitude, radiusMeters) {
  const filters = [
    'node["shop"~"charity|second_hand|used|antiques|clothes"]',
    'way["shop"~"charity|second_hand|used|antiques|clothes"]',
    'relation["shop"~"charity|second_hand|used|antiques|clothes"]',
    'node["name"~"Goodwill|Salvation Army|Savers|Thrift|Resale|Second Hand|ReStore|Habitat for Humanity|Consignment",i]',
    'way["name"~"Goodwill|Salvation Army|Savers|Thrift|Resale|Second Hand|ReStore|Habitat for Humanity|Consignment",i]',
    'relation["name"~"Goodwill|Salvation Army|Savers|Thrift|Resale|Second Hand|ReStore|Habitat for Humanity|Consignment",i]',
  ];

  const body = filters
    .map(
      (filter) => `${filter}(around:${radiusMeters},${latitude},${longitude});`,
    )
    .join('\n');

  return `[out:json][timeout:25];\n(\n${body}\n);\nout center tags;`;
}

function parseOverpassElement(element, originLatitude, originLongitude) {
  const tags = element?.tags || {};
  if (!looksLikeThriftStore(tags)) return null;

  const latitude = toNumber(element?.lat ?? element?.center?.lat);
  const longitude = toNumber(element?.lon ?? element?.center?.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const name = getTag(tags, 'name') || getTag(tags, 'brand') || 'Thrift Store';
  const address = buildAddressFromTags(tags);
  const openingHours = getTag(tags, 'opening_hours');
  const phone = getTag(tags, 'phone') || getTag(tags, 'contact:phone');
  const website = getTag(tags, 'website') || getTag(tags, 'contact:website');
  const distanceMiles = calculateDistanceMiles(
    originLatitude,
    originLongitude,
    latitude,
    longitude,
  );
  const storeKind = getStoreKind(tags);
  const osmId = `${element?.type || 'osm'}-${element?.id || `${latitude},${longitude}`}`;

  return {
    id: `osm-${osmId}`,
    title: name,
    name,
    subtitle: storeKind,
    storeKind,
    latitude,
    longitude,
    address: address || '',
    addressLabel: address || 'Address not provided',
    displayAddress: address || 'Tap for directions',
    mapAddress: address || '',
    mapsQuery: address
      ? `${name} ${address}`
      : `${name} ${latitude},${longitude}`,
    openingHours,
    hours: formatOpeningHours(openingHours),
    timeLabel: formatOpeningHours(openingHours) || 'Hours not listed',
    phone,
    website,
    source: 'OpenStreetMap / Overpass',
    distanceMiles: round2(distanceMiles),
    distanceLabel: `${round2(distanceMiles)} mi`,
  };
}

function needsGoogleEnrichment(store = {}) {
  const address = String(
    store.address || store.addressLabel || store.displayAddress || '',
  ).trim();
  const missingAddress =
    !address || /address not provided|tap for directions/i.test(address);
  const missingWebsite = !String(store.website || '').trim();
  const missingPhone = !String(store.phone || '').trim();
  return missingAddress || missingWebsite || missingPhone;
}

function buildGoogleCacheKey(store = {}) {
  const lat = Number(store.latitude).toFixed(4);
  const lng = Number(store.longitude).toFixed(4);
  return `${normalizeText(store.title || store.name)}__${lat}__${lng}`;
}

function getCachedGoogleEnrichment(key) {
  const cached = googlePlaceCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > GOOGLE_CACHE_TTL_MS) {
    googlePlaceCache.delete(key);
    return null;
  }
  return cached.value ? { ...cached.value } : null;
}

function setCachedGoogleEnrichment(key, value) {
  googlePlaceCache.set(key, {
    timestamp: Date.now(),
    value: value ? { ...value } : null,
  });
}

async function fetchGooglePlaceEnrichment(store) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey || !GOOGLE_ENRICH_ENABLED) return null;

  const cacheKey = buildGoogleCacheKey(store);
  const cached = getCachedGoogleEnrichment(cacheKey);
  if (cached) return cached;

  const query = [store.title || store.name, 'thrift store']
    .filter(Boolean)
    .join(' ');
  const { signal, done } = withTimeout(REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(GOOGLE_TEXT_SEARCH_URL, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': [
          'places.id',
          'places.displayName',
          'places.formattedAddress',
          'places.location',
          'places.nationalPhoneNumber',
          'places.internationalPhoneNumber',
          'places.websiteUri',
          'places.regularOpeningHours.weekdayDescriptions',
          'places.businessStatus',
          'places.types',
        ].join(','),
      },
      body: JSON.stringify({
        textQuery: query,
        locationBias: {
          circle: {
            center: {
              latitude: Number(store.latitude),
              longitude: Number(store.longitude),
            },
            radius: 900,
          },
        },
        maxResultCount: 5,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.warn(
        'Google Places enrichment failed:',
        response.status,
        text.slice(0, 300),
      );
      setCachedGoogleEnrichment(cacheKey, null);
      return null;
    }

    const data = await response.json();
    const places = Array.isArray(data?.places) ? data.places : [];
    const storeName = normalizeText(store.title || store.name);

    const best = places
      .map((place) => {
        const placeLat = toNumber(place?.location?.latitude);
        const placeLng = toNumber(place?.location?.longitude);
        const distanceMiles =
          Number.isFinite(placeLat) && Number.isFinite(placeLng)
            ? calculateDistanceMiles(
                store.latitude,
                store.longitude,
                placeLat,
                placeLng,
              )
            : 999;
        const name = normalizeText(place?.displayName?.text || '');
        const nameMatch =
          storeName && name
            ? name.includes(storeName) || storeName.includes(name)
            : false;
        const score = (nameMatch ? 100 : 0) - distanceMiles * 100;
        return { place, distanceMiles, score };
      })
      .filter((candidate) => candidate.distanceMiles <= 0.75)
      .sort((a, b) => b.score - a.score)[0]?.place;

    if (!best) {
      setCachedGoogleEnrichment(cacheKey, null);
      return null;
    }

    const weekdayDescriptions = Array.isArray(
      best?.regularOpeningHours?.weekdayDescriptions,
    )
      ? best.regularOpeningHours.weekdayDescriptions.join('; ')
      : '';

    const enrichment = {
      googlePlaceId: best.id || '',
      googleName: best?.displayName?.text || '',
      formattedAddress: best?.formattedAddress || '',
      phone: best?.nationalPhoneNumber || best?.internationalPhoneNumber || '',
      website: best?.websiteUri || '',
      openingHours: weekdayDescriptions,
      source: 'OpenStreetMap + Google Places verified',
    };

    setCachedGoogleEnrichment(cacheKey, enrichment);
    return enrichment;
  } catch (error) {
    console.warn('Google Places enrichment error:', error.message);
    setCachedGoogleEnrichment(cacheKey, null);
    return null;
  } finally {
    done();
  }
}

function applyGoogleEnrichment(store, enrichment) {
  if (!enrichment) return store;

  const address = String(enrichment.formattedAddress || '').trim();
  const phone = String(enrichment.phone || '').trim();
  const website = String(enrichment.website || '').trim();
  const googleHours = String(enrichment.openingHours || '').trim();

  return {
    ...store,
    address: address || store.address,
    addressLabel: address || store.addressLabel,
    displayAddress: address || store.displayAddress,
    mapAddress: address || store.mapAddress,
    mapsQuery: address ? `${store.title} ${address}` : store.mapsQuery,
    phone: phone || store.phone,
    website: website || store.website,
    openingHours: googleHours || store.openingHours,
    hours: googleHours || store.hours,
    timeLabel: googleHours || store.timeLabel,
    source: enrichment.source || store.source,
    googlePlaceId: enrichment.googlePlaceId,
  };
}

function dedupeStores(stores = []) {
  const result = [];

  for (const store of stores) {
    const titleKey = normalizeText(store.title || store.name);
    const addressKey = normalizeAddress(
      store.address || store.addressLabel || store.displayAddress,
    );

    const existingIndex = result.findIndex((existing) => {
      const existingTitleKey = normalizeText(existing.title || existing.name);
      const existingAddressKey = normalizeAddress(
        existing.address || existing.addressLabel || existing.displayAddress,
      );
      const distanceMiles = calculateDistanceMiles(
        existing.latitude,
        existing.longitude,
        store.latitude,
        store.longitude,
      );

      const sameBrand =
        titleKey &&
        existingTitleKey &&
        (titleKey.includes(existingTitleKey) ||
          existingTitleKey.includes(titleKey));
      const sameAddress =
        addressKey &&
        existingAddressKey &&
        (addressKey.includes(existingAddressKey) ||
          existingAddressKey.includes(addressKey));
      const veryClose = distanceMiles <= 0.12;
      return (
        (sameBrand && veryClose) ||
        (sameBrand && sameAddress) ||
        (sameAddress && veryClose)
      );
    });

    if (existingIndex === -1) {
      result.push(store);
      continue;
    }

    const existing = result[existingIndex];
    result[existingIndex] = {
      ...existing,
      ...store,
      address:
        existing.address &&
        !/address not provided|tap for directions/i.test(existing.address)
          ? existing.address
          : store.address,
      addressLabel:
        existing.addressLabel &&
        !/address not provided|tap for directions/i.test(existing.addressLabel)
          ? existing.addressLabel
          : store.addressLabel,
      displayAddress:
        existing.displayAddress &&
        !/address not provided|tap for directions/i.test(
          existing.displayAddress,
        )
          ? existing.displayAddress
          : store.displayAddress,
      phone: existing.phone || store.phone,
      website: existing.website || store.website,
      openingHours: existing.openingHours || store.openingHours,
      hours: existing.hours || store.hours,
      timeLabel:
        existing.timeLabel !== 'Hours not listed'
          ? existing.timeLabel
          : store.timeLabel,
      source:
        existing.source === store.source
          ? existing.source
          : `${existing.source} + ${store.source}`,
      distanceMiles: Math.min(
        existing.distanceMiles ?? 999,
        store.distanceMiles ?? 999,
      ),
      distanceLabel: `${round2(Math.min(existing.distanceMiles ?? 999, store.distanceMiles ?? 999))} mi`,
    };
  }

  return result;
}

async function fetchOverpassStores(latitude, longitude, radiusMiles, limit) {
  const radiusMeters = Math.round(radiusMiles * 1609.344);
  const cacheKey = `v6__${Number(latitude).toFixed(3)}__${Number(longitude).toFixed(3)}__${radiusMiles}__${limit}`;
  const cached = overpassCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < OVERPASS_CACHE_TTL_MS) {
    return cached.stores.map((store) => ({ ...store }));
  }

  const query = buildOverpassQuery(latitude, longitude, radiusMeters);
  const { signal, done } = withTimeout(REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(OVERPASS_URL, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': 'ListAssist/1.0 thrift-store-search',
      },
      body: new URLSearchParams({ data: query }).toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Overpass failed: ${response.status} ${text.slice(0, 200)}`,
      );
    }

    const data = await response.json();
    const elements = Array.isArray(data?.elements) ? data.elements : [];
    const stores = dedupeStores(
      elements
        .map((element) => parseOverpassElement(element, latitude, longitude))
        .filter(Boolean),
    )
      .filter((store) => store.distanceMiles <= radiusMiles)
      .sort((a, b) => a.distanceMiles - b.distanceMiles)
      .slice(0, limit);

    overpassCache.set(cacheKey, {
      timestamp: Date.now(),
      stores: stores.map((store) => ({ ...store })),
    });

    return stores;
  } finally {
    done();
  }
}

async function enrichStoresSelectively(stores = []) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey || !GOOGLE_ENRICH_ENABLED || GOOGLE_MAX_ENRICH_PER_REQUEST <= 0) {
    return stores;
  }

  let enrichCount = 0;
  const enriched = [];

  for (const store of stores) {
    if (
      needsGoogleEnrichment(store) &&
      enrichCount < GOOGLE_MAX_ENRICH_PER_REQUEST
    ) {
      enrichCount += 1;
      const enrichment = await fetchGooglePlaceEnrichment(store);
      enriched.push(applyGoogleEnrichment(store, enrichment));
    } else {
      enriched.push(store);
    }
  }

  return dedupeStores(enriched).sort(
    (a, b) => a.distanceMiles - b.distanceMiles,
  );
}

async function thriftStoresHandler(req, res) {
  try {
    const latitude = toNumber(req.query.latitude ?? req.query.lat);
    const longitude = toNumber(
      req.query.longitude ?? req.query.lon ?? req.query.lng,
    );

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({
        error: 'Missing latitude or longitude',
        message: 'Expected latitude and longitude query parameters.',
      });
    }

    const radiusMiles = clamp(
      toNumber(req.query.radiusMiles ?? req.query.radius, DEFAULT_RADIUS_MILES),
      1,
      MAX_RADIUS_MILES,
    );
    const limit = clamp(
      toNumber(req.query.limit ?? req.query.maxResults, DEFAULT_LIMIT),
      1,
      MAX_LIMIT,
    );

    const overpassStores = await fetchOverpassStores(
      latitude,
      longitude,
      radiusMiles,
      limit,
    );
    const stores = await enrichStoresSelectively(overpassStores);

    res.json({
      stores: stores.slice(0, limit),
      count: stores.length,
      source:
        process.env.GOOGLE_MAPS_API_KEY && GOOGLE_ENRICH_ENABLED
          ? 'OpenStreetMap / Overpass + selective Google Places enrichment'
          : 'OpenStreetMap / Overpass',
      googleEnrichmentEnabled: Boolean(
        process.env.GOOGLE_MAPS_API_KEY && GOOGLE_ENRICH_ENABLED,
      ),
      googleMaxEnrichPerRequest: GOOGLE_MAX_ENRICH_PER_REQUEST,
    });
  } catch (error) {
    console.error('Thrift stores route error:', error);
    res.status(500).json({
      error: 'Failed to load thrift stores',
      message: error.message,
    });
  }
}

module.exports = { thriftStoresHandler };
