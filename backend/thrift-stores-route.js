// thrift-stores-route.js
// List Assist thrift-store backend route
// Production Google Places version
// - Google Places API (New) primary source
// - Multi-query search
// - Dedupe by Google place id, name/address, and nearby coordinates
// - Distance sorting
// - Better labels: Thrift Store, Resale Shop, Consignment Shop, Antiques / Resale, Used Goods Store
// - In-memory cache to keep it fast and reduce Google API calls
// - Wider 25/50 mile coverage using multiple search origins
// - v7 coverage tune: fuller results, looser useful-store filter, stronger radius coverage

const GOOGLE_TEXT_SEARCH_URL =
  'https://places.googleapis.com/v1/places:searchText';

const DEFAULT_RADIUS_MILES = 25;
const DEFAULT_LIMIT = 50;
const MAX_RADIUS_MILES = 50;
const MAX_LIMIT = 100;
const EARTH_RADIUS_MILES = 3958.8;
const REQUEST_TIMEOUT_MS = Number(process.env.THRIFT_ROUTE_TIMEOUT_MS || 18000);
const GOOGLE_CACHE_TTL_MS =
  Number(process.env.GOOGLE_PLACES_CACHE_TTL_DAYS || 7) * 24 * 60 * 60 * 1000;
const GOOGLE_QUERY_LIMIT = Math.max(
  1,
  Math.min(Number(process.env.GOOGLE_PLACES_THRIFT_QUERY_LIMIT || 10), 10),
);

const cache = new Map();

const fetch = (...args) => {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch(...args);
  return import('node-fetch').then(({ default: nodeFetch }) =>
    nodeFetch(...args),
  );
};

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
      /\b(the|inc|llc|corp|corporation|company|store|stores|shop|shops|center|centre|donation|retail)\b/g,
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
    .replace(/\b(lane)\b/g, 'ln')
    .replace(/\b(court)\b/g, 'ct')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function calculateDistanceMiles(lat1, lon1, lat2, lon2) {
  const earthRadiusMiles = EARTH_RADIUS_MILES;
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

function cleanOpeningHoursText(value = '') {
  return String(value || '')
    .replace(/\u202f/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/10 AM\s*AM/g, '10 AM')
    .replace(/11 AM\s*AM/g, '11 AM')
    .replace(/12 PM\s*PM/g, '12 PM')
    .replace(/1 PM\s*PM/g, '1 PM')
    .replace(/2 PM\s*PM/g, '2 PM')
    .replace(/3 PM\s*PM/g, '3 PM')
    .replace(/4 PM\s*PM/g, '4 PM')
    .replace(/5 PM\s*PM/g, '5 PM')
    .replace(/6 PM\s*PM/g, '6 PM')
    .replace(/7 PM\s*PM/g, '7 PM')
    .replace(/8 PM\s*PM/g, '8 PM')
    .replace(/9 PM\s*PM/g, '9 PM')
    .replace(/10 AM\s*PM/g, '10 PM')
    .replace(/11 AM\s*PM/g, '11 PM')
    .trim();
}

function formatOpeningHours(value = '') {
  const hours = Array.isArray(value)
    ? value.map(cleanOpeningHoursText).join('; ')
    : cleanOpeningHoursText(value);
  if (!hours) return '';
  return hours;
}

function getStoreKind(title = '', address = '', types = []) {
  const text = `${title} ${address} ${types.join(' ')}`.toLowerCase();

  if (/consignment/.test(text)) return 'Consignment Shop';
  if (/antique|antiques/.test(text)) return 'Antiques / Resale';
  if (/second.hand|used goods|used_store/.test(text)) return 'Used Goods Store';
  if (/resale|restore|habitat|family shelter/.test(text)) return 'Resale Shop';
  if (
    /goodwill|salvation army|savers|st vincent|value village|unique thrift|arc thrift|thrift|charity shop/.test(
      text,
    )
  ) {
    return 'Thrift Store';
  }

  return 'Thrift Store';
}

function isLikelyBadResult(place = {}) {
  const name = String(place?.displayName?.text || '').toLowerCase();
  const address = String(place?.formattedAddress || '').toLowerCase();
  const types = Array.isArray(place?.types)
    ? place.types.join(' ').toLowerCase()
    : '';
  const text = `${name} ${address} ${types}`;

  // Keep obviously bad matches out, but do not over-filter resale-style places.
  // Google can classify legit thrift/resale spots broadly, so this stays focused
  // on categories we definitely do NOT want.
  return /pawn|vape|liquor|tobacco|gun|firearm|adult|casino|storage|car dealer|auto dealer|motorcycle|boat|junkyard|scrap|recycling center|landfill|restaurant|bar|coffee|gas station|convenience store|hotel|motel|bank|atm|pharmacy/.test(
    text,
  );
}

function looksLikeUsefulStore(place = {}) {
  if (isLikelyBadResult(place)) return false;

  const name = String(place?.displayName?.text || '').toLowerCase();
  const address = String(place?.formattedAddress || '').toLowerCase();
  const types = Array.isArray(place?.types)
    ? place.types.join(' ').toLowerCase()
    : '';
  const text = `${name} ${address} ${types}`;

  if (
    /goodwill|salvation army|savers|thrift|resale|second hand|second-hand|restore|habitat for humanity|consignment|st vincent|st\. vincent|value village|arc thrift|unique thrift|family shelter|charity shop|hope chest|new uses|out of the attic|mission mart|plato'?s closet|once upon a child|clothes mentor|uptown cheapskate|style encore|play it again sports|half price books|used books|used furniture|used clothing|vintage shop|antique mall|antique store|re-use|reuse|donation center/.test(
      text,
    )
  ) {
    return true;
  }

  // Google often returns broad store categories from thrift/resale text searches.
  // Keep these when they came from thrift/resale queries; bad categories were
  // already removed above. This brings back useful hidden resale stops.
  return /thrift_store|used_store|discount_store|clothing_store|home_goods_store|furniture_store|book_store|shoe_store|store/.test(
    types,
  );
}

function buildSearchQueries(radiusMiles = DEFAULT_RADIUS_MILES) {
  const queryLimit = getEffectiveQueryLimit(radiusMiles);
  return [
    'thrift store',
    'resale shop',
    'consignment shop',
    'second hand store',
    'used goods store',
    'Goodwill thrift store',
    'Salvation Army thrift store',
    'Habitat for Humanity ReStore',
    'Savers thrift store',
    'charity shop',
    'used furniture store',
    'used clothing store',
    'vintage resale shop',
    'antique resale shop',
    'donation resale store',
  ].slice(0, queryLimit);
}

function getOffsetCoordinate(
  latitude,
  longitude,
  distanceMiles,
  bearingDegrees,
) {
  const angularDistance = distanceMiles / EARTH_RADIUS_MILES;
  const bearing = (bearingDegrees * Math.PI) / 180;
  const lat1 = (latitude * Math.PI) / 180;
  const lon1 = (longitude * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );

  return {
    latitude: (lat2 * 180) / Math.PI,
    longitude: (lon2 * 180) / Math.PI,
  };
}

function getSearchOrigins(latitude, longitude, radiusMiles) {
  const origins = [{ latitude, longitude, label: 'center' }];

  // For larger radius searches, Google Text Search tends to favor the closest
  // cluster and can under-fill the selected area. These extra origins spread
  // coverage across the selected radius, then results are deduped and sorted
  // from the user's true location.
  if (radiusMiles >= 25) {
    const ringDistance = radiusMiles >= 50 ? 30 : 15;
    const bearings =
      radiusMiles >= 50
        ? [0, 45, 90, 135, 180, 225, 270, 315]
        : [0, 45, 90, 135, 180, 225, 270, 315];

    for (const bearing of bearings) {
      origins.push({
        ...getOffsetCoordinate(latitude, longitude, ringDistance, bearing),
        label: `ring-${bearing}`,
      });
    }
  }

  return origins;
}

function getEffectiveQueryLimit(radiusMiles) {
  const requested = GOOGLE_QUERY_LIMIT;
  if (radiusMiles >= 50) return Math.max(requested, 10);
  if (radiusMiles >= 25) return Math.max(requested, 10);
  return Math.max(requested, 8);
}

function getCacheKey(latitude, longitude, radiusMiles, limit) {
  return `google_places_thrift_v8_full_address__${Number(latitude).toFixed(3)}__${Number(longitude).toFixed(3)}__${radiusMiles}__${limit}__${GOOGLE_QUERY_LIMIT}`;
}

function getCached(key) {
  const cached = cache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > GOOGLE_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return cached.payload;
}

function setCached(key, payload) {
  cache.set(key, {
    timestamp: Date.now(),
    payload,
  });
}


function getAddressComponent(place, componentType) {
  const components = Array.isArray(place?.addressComponents)
    ? place.addressComponents
    : [];

  const match = components.find((component) => {
    const types = Array.isArray(component?.types) ? component.types : [];
    return types.includes(componentType);
  });

  return String(match?.shortText || match?.longText || '').trim();
}

function normalizeStreetSuffixes(value = '') {
  return String(value || '')
    .replace(/\bDr\.?\b/gi, 'Drive')
    .replace(/\bSt\.?\b/gi, 'Street')
    .replace(/\bRd\.?\b/gi, 'Road')
    .replace(/\bAve\.?\b/gi, 'Avenue')
    .replace(/\bBlvd\.?\b/gi, 'Boulevard')
    .replace(/\bLn\.?\b/gi, 'Lane')
    .replace(/\bCt\.?\b/gi, 'Court')
    .replace(/\bCir\.?\b/gi, 'Circle')
    .replace(/\bPkwy\.?\b/gi, 'Parkway')
    .replace(/\s+/g, ' ')
    .trim();
}

function addressHasCityState(value = '') {
  const text = String(value || '').trim();
  return /,\s*[A-Za-z][A-Za-z .'-]+,\s*[A-Z]{2}\b/.test(text) ||
    /\b[A-Za-z][A-Za-z .'-]+,\s*[A-Z]{2}\b/.test(text);
}

function buildFullGooglePlaceAddress(place = {}) {
  const formattedAddress = String(place?.formattedAddress || '')
    .replace(/,\s*USA\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  const streetNumber = getAddressComponent(place, 'street_number');
  const route = getAddressComponent(place, 'route');
  const city =
    getAddressComponent(place, 'locality') ||
    getAddressComponent(place, 'postal_town') ||
    getAddressComponent(place, 'sublocality') ||
    getAddressComponent(place, 'administrative_area_level_3');
  const state = getAddressComponent(place, 'administrative_area_level_1');
  const zip = getAddressComponent(place, 'postal_code');
  const street = normalizeStreetSuffixes([streetNumber, route].filter(Boolean).join(' '));

  if (street && city && state) {
    return [street, `${city}, ${[state, zip].filter(Boolean).join(' ')}`]
      .filter(Boolean)
      .join(', ')
      .trim();
  }

  if (formattedAddress && addressHasCityState(formattedAddress)) {
    return normalizeStreetSuffixes(formattedAddress);
  }

  return normalizeStreetSuffixes(formattedAddress);
}

function parseGooglePlace(place, originLatitude, originLongitude) {
  if (!looksLikeUsefulStore(place)) return null;

  const latitude = toNumber(place?.location?.latitude);
  const longitude = toNumber(place?.location?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const title = String(place?.displayName?.text || 'Thrift Store').trim();
  const address = buildFullGooglePlaceAddress(place);
  const types = Array.isArray(place?.types) ? place.types : [];
  const distanceMiles = calculateDistanceMiles(
    originLatitude,
    originLongitude,
    latitude,
    longitude,
  );
  const storeKind = getStoreKind(title, address, types);
  const weekdayDescriptions =
    place?.currentOpeningHours?.weekdayDescriptions ||
    place?.regularOpeningHours?.weekdayDescriptions ||
    [];
  const openingHours = formatOpeningHours(weekdayDescriptions);
  const openNow = place?.currentOpeningHours?.openNow;
  const phone = String(
    place?.nationalPhoneNumber || place?.internationalPhoneNumber || '',
  ).trim();
  const website = String(place?.websiteUri || '').trim();
  const googleMapsUri = String(place?.googleMapsUri || '').trim();
  const rating = toNumber(place?.rating);
  const userRatingCount = toNumber(place?.userRatingCount);
  const businessStatus = String(place?.businessStatus || '').trim();

  return {
    id: place?.id
      ? `google-${place.id}`
      : `google-${normalizeText(title)}-${latitude},${longitude}`,
    googlePlaceId: place?.id || '',
    title,
    name: title,
    subtitle: storeKind,
    storeKind,
    latitude,
    longitude,
    address,
    fullAddress: address,
    formattedAddress: address,
    addressLabel: address || 'Address not provided',
    displayAddress: address || 'Tap for directions',
    mapAddress: address,
    mapsQuery:
      googleMapsUri ||
      (address ? `${title} ${address}` : `${title} ${latitude},${longitude}`),
    googleMapsUri,
    openingHours,
    hours: openingHours,
    openNow: typeof openNow === 'boolean' ? openNow : null,
    businessStatus,
    timeLabel:
      openingHours ||
      (openNow === true
        ? 'Open now'
        : openNow === false
          ? 'Closed now'
          : 'Hours not listed'),
    phone,
    website,
    rating: Number.isFinite(rating) ? rating : null,
    userRatingCount: Number.isFinite(userRatingCount) ? userRatingCount : null,
    source: 'Google Places',
    distanceMiles: round2(distanceMiles),
    distanceLabel: `${round2(distanceMiles)} mi`,
    notes: `${storeKind}. Tap Map for directions${website ? ' or View for store details' : ''}.`,
  };
}

function storeQualityScore(store) {
  const text = `${store.title} ${store.storeKind}`.toLowerCase();
  let score = 0;

  if (
    /goodwill|savers|salvation army|habitat|restore|st vincent|value village|arc thrift|unique thrift/.test(
      text,
    )
  )
    score += 30;
  if (/thrift/.test(text)) score += 20;
  if (/resale|consignment|second.hand|used goods/.test(text)) score += 14;
  if (store.rating) score += Math.min(15, Number(store.rating) * 3);
  if (store.userRatingCount)
    score += Math.min(10, Math.log10(Number(store.userRatingCount) + 1) * 4);
  if (store.website) score += 4;
  if (store.phone) score += 3;
  if (store.openNow === true) score += 3;
  if (/antiques/.test(text)) score -= 4;

  return score;
}

function dedupeStores(stores = []) {
  const result = [];

  for (const store of stores) {
    const placeId = String(store.googlePlaceId || '').trim();
    const titleKey = normalizeText(store.title || store.name);
    const addressKey = normalizeAddress(
      store.address || store.addressLabel || '',
    );

    const existingIndex = result.findIndex((existing) => {
      if (placeId && existing.googlePlaceId === placeId) return true;

      const existingTitleKey = normalizeText(existing.title || existing.name);
      const existingAddressKey = normalizeAddress(
        existing.address || existing.addressLabel || '',
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
      const veryClose = distanceMiles <= 0.05;

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
    const preferred =
      storeQualityScore(store) >= storeQualityScore(existing)
        ? store
        : existing;
    const secondary = preferred === store ? existing : store;
    const nearestDistance = Math.min(
      existing.distanceMiles ?? 9999,
      store.distanceMiles ?? 9999,
    );

    result[existingIndex] = {
      ...secondary,
      ...preferred,
      address: preferred.address || secondary.address,
      addressLabel: preferred.addressLabel || secondary.addressLabel,
      displayAddress: preferred.displayAddress || secondary.displayAddress,
      phone: preferred.phone || secondary.phone,
      website: preferred.website || secondary.website,
      openingHours: preferred.openingHours || secondary.openingHours,
      hours: preferred.hours || secondary.hours,
      timeLabel:
        preferred.timeLabel && preferred.timeLabel !== 'Hours not listed'
          ? preferred.timeLabel
          : secondary.timeLabel,
      rating: preferred.rating ?? secondary.rating ?? null,
      userRatingCount:
        preferred.userRatingCount ?? secondary.userRatingCount ?? null,
      googleMapsUri: preferred.googleMapsUri || secondary.googleMapsUri,
      mapsQuery: preferred.mapsQuery || secondary.mapsQuery,
      distanceMiles: round2(nearestDistance),
      distanceLabel: `${round2(nearestDistance)} mi`,
    };
  }

  return result;
}

async function fetchGooglePlacesQuery({
  apiKey,
  query,
  latitude,
  longitude,
  radiusMeters,
  maxResultCount,
}) {
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
          'places.addressComponents',
          'places.location',
          'places.nationalPhoneNumber',
          'places.internationalPhoneNumber',
          'places.websiteUri',
          'places.googleMapsUri',
          'places.rating',
          'places.userRatingCount',
          'places.currentOpeningHours.openNow',
          'places.currentOpeningHours.weekdayDescriptions',
          'places.regularOpeningHours.weekdayDescriptions',
          'places.businessStatus',
          'places.types',
        ].join(','),
      },
      body: JSON.stringify({
        textQuery: query,
        locationBias: {
          circle: {
            center: { latitude, longitude },
            radius: radiusMeters,
          },
        },
        maxResultCount,
      }),
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `Google Places failed for "${query}": ${response.status} ${text.slice(0, 500)}`,
      );
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(
        `Could not parse Google Places response for "${query}": ${text.slice(0, 500)}`,
      );
    }
  } finally {
    done();
  }
}

async function fetchStores(latitude, longitude, radiusMiles, limit) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return {
      stores: [],
      errors: ['Missing GOOGLE_MAPS_API_KEY'],
    };
  }

  const cacheKey = getCacheKey(latitude, longitude, radiusMiles, limit);
  const cached = getCached(cacheKey);
  if (cached) return { ...cached, cacheHit: true };

  const queries = buildSearchQueries(radiusMiles);
  const origins = getSearchOrigins(latitude, longitude, radiusMiles);
  const searchRadiusMeters = Math.round(
    Math.min(radiusMiles, radiusMiles >= 25 ? 25 : radiusMiles) * 1609.344,
  );
  const perQueryLimit =
    radiusMiles >= 25
      ? 20
      : Math.max(15, Math.min(20, Math.ceil(limit / queries.length) + 10));
  const allStores = [];
  const errors = [];

  for (const origin of origins) {
    for (const query of queries) {
      try {
        const data = await fetchGooglePlacesQuery({
          apiKey,
          query,
          latitude: origin.latitude,
          longitude: origin.longitude,
          radiusMeters: searchRadiusMeters,
          maxResultCount: perQueryLimit,
        });

        const places = Array.isArray(data?.places) ? data.places : [];
        for (const place of places) {
          // Always calculate distance from the true user location, not the
          // expanded coverage point.
          const store = parseGooglePlace(place, latitude, longitude);
          if (!store) continue;
          if (store.distanceMiles <= radiusMiles) allStores.push(store);
        }
      } catch (error) {
        errors.push(error.message);
        console.warn('Thrift Google query failed:', error.message);
      }
    }
  }

  const stores = dedupeStores(allStores)
    .filter((store) => Number(store.distanceMiles) <= radiusMiles)
    .sort((a, b) => {
      const distanceSort = Number(a.distanceMiles) - Number(b.distanceMiles);
      if (distanceSort !== 0) return distanceSort;
      return storeQualityScore(b) - storeQualityScore(a);
    })
    .slice(0, limit);

  const payload = {
    stores,
    errors,
    cacheHit: false,
    queriesUsed: queries,
    searchOriginsUsed: origins.map((origin) => origin.label),
  };

  setCached(cacheKey, payload);
  return payload;
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

    const result = await fetchStores(latitude, longitude, radiusMiles, limit);

    return res.json({
      stores: result.stores,
      count: result.stores.length,
      source: 'Google Places',
      googlePlacesEnabled: Boolean(process.env.GOOGLE_MAPS_API_KEY),
      googleQueryLimit: GOOGLE_QUERY_LIMIT,
      effectiveGoogleQueryLimit: getEffectiveQueryLimit(radiusMiles),
      radiusMiles,
      limit,
      cacheHit: Boolean(result.cacheHit),
      warnings: result.errors || [],
      searchOriginsUsed: result.searchOriginsUsed || [],
    });
  } catch (error) {
    console.error('Thrift stores route error:', error);
    return res.status(500).json({
      error: 'Failed to load thrift stores',
      message: error.message,
    });
  }
}

module.exports = { thriftStoresHandler };
