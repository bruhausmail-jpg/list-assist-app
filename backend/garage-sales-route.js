const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const router = express.Router();

function toRadians(value) {
  return (Number(value) * Math.PI) / 180;
}

function distanceMiles(startLat, startLon, endLat, endLon) {
  if (
    startLat === null ||
    startLat === undefined ||
    startLon === null ||
    startLon === undefined ||
    endLat === null ||
    endLat === undefined ||
    endLon === null ||
    endLon === undefined ||
    !Number.isFinite(Number(startLat)) ||
    !Number.isFinite(Number(startLon)) ||
    !Number.isFinite(Number(endLat)) ||
    !Number.isFinite(Number(endLon))
  ) {
    return null;
  }

  const earthRadiusMiles = 3958.8;
  const dLat = toRadians(Number(endLat) - Number(startLat));
  const dLon = toRadians(Number(endLon) - Number(startLon));
  const lat1 = toRadians(Number(startLat));
  const lat2 = toRadians(Number(endLat));

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(earthRadiusMiles * c * 100) / 100;
}

function parseCoordinateValue(value) {
  if (value === null || value === undefined) return null;

  const text = String(value).trim();
  if (!text) return null;

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function isUsableCoordinatePair(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return false;
  }

  // Reject placeholder / empty-parsed coords like 0,0.
  if (Math.abs(lat) < 0.000001 && Math.abs(lon) < 0.000001) {
    return false;
  }

  // Craigslist garage sale results for this feature are US-only.
  if (lat < 24 || lat > 50 || lon > -66 || lon < -125) {
    return false;
  }

  return true;
}

function normalizeAreaFromCoords(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return 'chicago';
  }

  if (lat >= 41 && lat <= 43.5 && lon >= -89.5 && lon <= -86.5)
    return 'chicago';
  if (lat >= 42 && lat <= 44.5 && lon >= -89 && lon <= -87) return 'milwaukee';
  if (lat >= 43 && lat <= 44.5 && lon >= -90.5 && lon <= -88.5)
    return 'madison';
  if (lat >= 44 && lat <= 46 && lon >= -94.5 && lon <= -92)
    return 'minneapolis';
  if (lat >= 39 && lat <= 41 && lon >= -87 && lon <= -84.5)
    return 'indianapolis';

  return 'chicago';
}

function parseCraigslistDate(textValue, fallbackDay) {
  const text = String(textValue || '').trim();
  if (!text)
    return fallbackDay === 'tomorrow'
      ? 'Tomorrow'
      : fallbackDay === 'today'
        ? 'Today'
        : '';

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;

  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

function parsePostingUrl(href, baseUrl) {
  if (!href) return '';
  if (/^https?:\/\//i.test(href)) return href;
  return new URL(href, baseUrl).toString();
}

function parseGeoFromElement($element) {
  const lat = parseCoordinateValue(
    $element.attr('data-latitude') ||
      $element.attr('data-lat') ||
      $element.attr('latitude'),
  );
  const lon = parseCoordinateValue(
    $element.attr('data-longitude') ||
      $element.attr('data-lon') ||
      $element.attr('longitude'),
  );

  if (isUsableCoordinatePair(lat, lon)) {
    return { latitude: lat, longitude: lon };
  }

  return null;
}

function parseGeoFromHtml(html) {
  const htmlText = String(html || '');
  if (!htmlText) return { latitude: null, longitude: null };

  const patterns = [
    /data-latitude=["']([\-\d.]+)["'][^>]*data-longitude=["']([\-\d.]+)["']/i,
    /data-longitude=["']([\-\d.]+)["'][^>]*data-latitude=["']([\-\d.]+)["']/i,
    /"latitude"\s*:\s*([\-\d.]+)\s*,\s*"longitude"\s*:\s*([\-\d.]+)/i,
    /lat=([\-\d.]+).*?lon=([\-\d.]+)/i,
  ];

  for (const pattern of patterns) {
    const match = htmlText.match(pattern);
    if (!match) continue;
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (/data-longitude=.*data-latitude/i.test(String(match[0]))) {
      if (isUsableCoordinatePair(second, first)) {
        return { latitude: second, longitude: first };
      }
      continue;
    }

    if (isUsableCoordinatePair(first, second)) {
      return { latitude: first, longitude: second };
    }
  }

  return { latitude: null, longitude: null };
}

function extractStreetAddressFromText(value) {
  const text = String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return '';

  const patterns = [
    /\b(\d{1,6}\s+(?:[NSEW]\.?\s+)?[A-Za-z0-9.#'\-]+(?:\s+[A-Za-z0-9.#'\-]+){0,6}\s(?:Ave(?:nue)?|St(?:reet)?|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court|Cir|Circle|Blvd|Boulevard|Pkwy|Parkway|Pl|Place|Ter|Terrace|Way|Trail|Trl|Highway|Hwy))\b/i,
    /\b(\d{1,6}\s+(?:[NSEW]\.?\s+)?[A-Za-z0-9.#'\-]+(?:\s+[A-Za-z0-9.#'\-]+){0,6})\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return String(match[1])
        .replace(/[,:;.-]+$/g, '')
        .trim();
    }
  }

  return '';
}

function buildAddressLabel(parts) {
  const cleanParts = parts
    .map((part) =>
      String(part || '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean);

  return cleanParts.join(', ').replace(/,\s*,/g, ', ').trim();
}

function parseMapAddressFromPage($, html) {
  const htmlText = String(html || '');

  const directCandidates = [
    $('.mapaddress').first().text().trim(),
    $('[data-mapaddress]').first().attr('data-mapaddress'),
    $('[itemprop="streetAddress"]').first().text().trim(),
    $('[itemprop="streetAddress"]').first().attr('content'),
    $('meta[property="og:street-address"]').attr('content'),
    $('meta[name="geo.placename"]').attr('content'),
  ].filter(Boolean);

  for (const candidate of directCandidates) {
    const cleaned = String(candidate || '').trim();
    if (cleaned) return cleaned;
  }

  const jsonLikePatterns = [
    /"mapaddress"\s*:\s*"([^"]+)"/i,
    /"streetAddress"\s*:\s*"([^"]+)"/i,
    /"addressLocality"\s*:\s*"([^"]+)"/i,
    /data-mapaddress=["']([^"']+)["']/i,
  ];

  for (const pattern of jsonLikePatterns) {
    const match = htmlText.match(pattern);
    if (match && match[1]) {
      const cleaned = String(match[1])
        .replace(/\\u002F/gi, '/')
        .replace(/\\u0026/gi, '&')
        .replace(/\\"/g, '"')
        .trim();
      if (cleaned) return cleaned;
    }
  }

  return '';
}

function cleanAddressFragment(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[,:;.-]+$/g, '')
    .trim();
}

function normalizeRoadAbbreviation(value) {
  return String(value || '')
    .replace(/St\.?/gi, 'Street')
    .replace(/Rd\.?/gi, 'Road')
    .replace(/Dr\.?/gi, 'Drive')
    .replace(/Ln\.?/gi, 'Lane')
    .replace(/Ct\.?/gi, 'Court')
    .replace(/Cir\.?/gi, 'Circle')
    .replace(/Blvd\.?/gi, 'Boulevard')
    .replace(/Pkwy\.?/gi, 'Parkway')
    .replace(/Pl\.?/gi, 'Place')
    .replace(/Ter\.?/gi, 'Terrace')
    .replace(/Trl\.?/gi, 'Trail')
    .replace(/Hwy\.?/gi, 'Highway')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeNearAddressText(value) {
  return cleanAddressFragment(value)
    .replace(
      /\s*\((?:church on corner|corner|near corner|by park|park district).*?\)\s*/gi,
      ' ',
    )
    .replace(/near\s+near/gi, 'near')
    .replace(/\s*&\s*/g, ' & ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasHouseNumberPrefix(value) {
  const text = cleanAddressFragment(value);
  return /^(?:\d+[A-Za-z]\d+|\d+[A-Za-z]?|\d+-\d+)\b/i.test(text);
}

function isLikelyStreetName(value) {
  const text = normalizeRoadAbbreviation(value);
  if (!text) return false;

  if (
    /\b(?:Street|Road|Drive|Lane|Court|Circle|Boulevard|Parkway|Place|Terrace|Way|Trail|Highway|Ave(?:nue)?|Route)\b/i.test(
      text,
    )
  ) {
    return true;
  }

  return /^(?:\d+[A-Za-z]\d+|\d+[A-Za-z]?|\d+-\d+)\s+[A-Za-z0-9.#'\-]+(?:\s+[A-Za-z0-9.#'\-]+){0,5}$/i.test(
    text,
  );
}

function isLikelyCrossStreet(value) {
  const text = normalizeRoadAbbreviation(value);
  if (!text) return false;

  if (/\s(?:&|and)\s/i.test(` ${text} `)) return true;
  if (/^(?:[NESW]\s+)?\d{1,3}(?:st|nd|rd|th)\b/i.test(text)) return true;
  if (/^(?:Route|Rt)\s*\d+\b/i.test(text)) return true;

  return isLikelyStreetName(text);
}

function isLikelyCityLabel(value) {
  const text = cleanAddressFragment(value);
  if (!text) return false;
  if (/\d/.test(text)) return false;
  if (/\bnear\b/i.test(text)) return false;
  if (/[/&]/.test(text)) return false;
  if (text.length < 2 || text.length > 40) return false;

  return /^[A-Za-z][A-Za-z .'-]+$/.test(text);
}

function parseCityStateZip(value) {
  const text = cleanAddressFragment(value);
  if (!text) {
    return { city: '', state: '', zip: '' };
  }

  const zipMatch = text.match(/(\d{5})(?:-\d{4})?/);
  const zip = zipMatch ? zipMatch[1] : '';

  let withoutZip = text
    .replace(/\d{5}(?:-\d{4})?/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const cityStateMatch = withoutZip.match(/^(.+?),\s*([A-Z]{2})$/);
  if (cityStateMatch) {
    return {
      city: cleanAddressFragment(cityStateMatch[1]),
      state: cityStateMatch[2].toUpperCase(),
      zip,
    };
  }

  const stateOnlyMatch = withoutZip.match(/^(.+?)\s+([A-Z]{2})$/);
  if (stateOnlyMatch && isLikelyCityLabel(stateOnlyMatch[1])) {
    return {
      city: cleanAddressFragment(stateOnlyMatch[1]),
      state: stateOnlyMatch[2].toUpperCase(),
      zip,
    };
  }

  return {
    city: isLikelyCityLabel(withoutZip) ? withoutZip : '',
    state: '',
    zip,
  };
}

function splitNearAddress(rawValue) {
  const text = normalizeNearAddressText(rawValue);
  if (!text) {
    return {
      street: '',
      crossStreet: '',
      raw: '',
    };
  }

  if (/^near\s+/i.test(text)) {
    const crossStreetOnly = normalizeRoadAbbreviation(
      text.replace(/^near\s+/i, ''),
    );
    return {
      street: '',
      crossStreet: isLikelyCrossStreet(crossStreetOnly) ? crossStreetOnly : '',
      raw: text,
    };
  }

  const nearMatch = text.match(/^(.+?)\s+near\s+(.+)$/i);
  if (nearMatch) {
    const left = normalizeRoadAbbreviation(nearMatch[1]);
    const right = normalizeRoadAbbreviation(nearMatch[2]);

    const leftLooksStreet = isLikelyStreetName(left);
    const rightLooksStreet = isLikelyCrossStreet(right);
    const leftHasHouseNumber = hasHouseNumberPrefix(left);

    if (leftHasHouseNumber && leftLooksStreet) {
      return {
        street: left,
        crossStreet: rightLooksStreet ? right : '',
        raw: text,
      };
    }

    // Final street-only enhancement:
    // when we clearly have "Street near CrossStreet", keep the street even
    // without a house number so map users can still get to the block.
    if (leftLooksStreet && rightLooksStreet) {
      return {
        street: left,
        crossStreet: right,
        raw: text,
      };
    }

    if (!leftHasHouseNumber && rightLooksStreet) {
      return {
        street: '',
        crossStreet: right,
        raw: text,
      };
    }

    return {
      street: '',
      crossStreet: '',
      raw: text,
    };
  }

  const street = normalizeRoadAbbreviation(text);
  return {
    street:
      isLikelyStreetName(street) && hasHouseNumberPrefix(street) ? street : '',
    crossStreet: '',
    raw: text,
  };
}

function buildMapsQuery(parts) {
  return parts
    .map((part) => cleanAddressFragment(part))
    .filter(Boolean)
    .join(', ')
    .replace(/,\s*,/g, ', ')
    .trim();
}

function getDefaultCityFromContext({
  hood,
  title,
  mapAddress,
  approximateAddress,
}) {
  const combined = [
    cleanAddressFragment(hood),
    cleanAddressFragment(title),
    cleanAddressFragment(mapAddress),
    cleanAddressFragment(approximateAddress),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (combined.includes('lemont')) return 'Lemont';
  if (combined.includes('woodridge')) return 'Woodridge';
  if (combined.includes('downers grove')) return 'Downers Grove';
  if (combined.includes('bolingbrook')) return 'Bolingbrook';
  if (combined.includes('romeoville')) return 'Romeoville';
  if (combined.includes('naperville')) return 'Naperville';
  if (combined.includes('plainfield')) return 'Plainfield';
  if (combined.includes('darien')) return 'Darien';
  if (combined.includes('lisle')) return 'Lisle';

  return '';
}

function buildPreferredMapsQuery({
  street,
  crossStreet,
  city,
  state,
  zip,
  mapAddress,
  approximateAddress,
  fallbackAddressLabel,
}) {
  const cleanStreet = cleanAddressFragment(street);
  const cleanCrossStreet = cleanAddressFragment(crossStreet);
  const cleanCity = cleanAddressFragment(city);
  const cleanState = cleanAddressFragment(state);
  const cleanZip = cleanAddressFragment(zip);

  const hasExactStreetAddress =
    cleanStreet && hasHouseNumberPrefix(cleanStreet);

  if (hasExactStreetAddress) {
    return buildMapsQuery([cleanStreet, cleanCity, cleanState, cleanZip]);
  }

  if (cleanStreet && cleanCrossStreet) {
    return buildMapsQuery([
      `${cleanStreet} & ${cleanCrossStreet}`,
      cleanCity,
      cleanState,
      cleanZip,
    ]);
  }

  if (cleanStreet) {
    return buildMapsQuery([cleanStreet, cleanCity, cleanState, cleanZip]);
  }

  if (cleanCrossStreet) {
    return buildMapsQuery([cleanCrossStreet, cleanCity, cleanState, cleanZip]);
  }

  return (
    buildMapsQuery([
      cleanAddressFragment(mapAddress),
      cleanCity,
      cleanState,
      cleanZip,
    ]) ||
    buildMapsQuery([
      cleanAddressFragment(approximateAddress),
      cleanCity,
      cleanState,
      cleanZip,
    ]) ||
    buildMapsQuery([
      cleanAddressFragment(fallbackAddressLabel),
      cleanCity,
      cleanState,
      cleanZip,
    ])
  );
}

function buildFinalAddressData({
  title,
  hood,
  mapAddress,
  approximateAddress,
  fallbackAddressLabel,
}) {
  const cleanMapAddress = normalizeNearAddressText(mapAddress);
  const cleanApproximateAddress = normalizeNearAddressText(approximateAddress);
  const cleanHood = cleanAddressFragment(hood);
  const cleanFallback = cleanAddressFragment(fallbackAddressLabel);

  const titleStreet = cleanAddressFragment(
    extractStreetAddressFromText(stripDateNoiseFromText(title)),
  );

  const mapParts = splitNearAddress(cleanMapAddress);
  const approxParts = splitNearAddress(cleanApproximateAddress);
  const hoodParts = parseCityStateZip(cleanHood);

  const trustedTitleStreet =
    hasHouseNumberPrefix(titleStreet) && looksLikeRealStreetAddress(titleStreet)
      ? normalizeRoadAbbreviation(titleStreet)
      : '';

  const street =
    mapParts.street || trustedTitleStreet || approxParts.street || '';

  const crossStreet = mapParts.crossStreet || approxParts.crossStreet || '';

  const inferredCity =
    hoodParts.city ||
    getDefaultCityFromContext({
      hood: cleanHood,
      title,
      mapAddress: cleanMapAddress,
      approximateAddress: cleanApproximateAddress,
    });

  const city =
    inferredCity ||
    (!street && !crossStreet && isLikelyCityLabel(cleanMapAddress)
      ? cleanMapAddress
      : '') ||
    (!street && !crossStreet && isLikelyCityLabel(cleanApproximateAddress)
      ? cleanApproximateAddress
      : '');

  const state = hoodParts.state || 'IL';
  const zip = hoodParts.zip || '';

  const displayAddress =
    buildMapsQuery([
      street,
      crossStreet ? `near ${crossStreet}` : '',
      city,
      state,
    ]) ||
    cleanMapAddress ||
    cleanApproximateAddress ||
    cleanHood ||
    cleanFallback ||
    'Approximate location';

  const mapsQuery = buildPreferredMapsQuery({
    street,
    crossStreet,
    city,
    state,
    zip,
    mapAddress: cleanMapAddress,
    approximateAddress: cleanApproximateAddress,
    fallbackAddressLabel: cleanFallback,
  });

  return {
    street,
    crossStreet,
    city,
    state,
    zip,
    country: 'USA',
    addressLabel: displayAddress,
    displayAddress,
    mapAddress: cleanMapAddress || cleanApproximateAddress || cleanHood || '',
    mapsQuery: mapsQuery || displayAddress,
  };
}

function stripDateNoiseFromText(value) {
  return cleanAddressFragment(value)
    .replace(
      /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s*\d{1,2}(?:\s*[-/,]\s*\d{1,2})?(?:\s*,?\s*\d{2,4})?/gi,
      ' ',
    )
    .replace(/\d{1,2}\/\d{1,2}(?:\/\d{2,4})?/g, ' ')
    .replace(/\d{4}/g, ' ')
    .replace(/\d{1,2}\s*(?:am|pm)/gi, ' ')
    .replace(
      /(?:today|tomorrow|thursday|friday|saturday|sunday|monday|tuesday|wednesday)/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeRealStreetAddress(value) {
  const text = cleanAddressFragment(value);
  if (!text) return false;
  if (
    /\d{1,6}\s+[A-Za-z]/.test(text) &&
    /(?:Ave(?:nue)?|St(?:reet)?|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court|Cir|Circle|Blvd|Boulevard|Pkwy|Parkway|Pl|Place|Ter|Terrace|Way|Trail|Trl|Highway|Hwy)/i.test(
      text,
    )
  ) {
    return true;
  }
  return /^\d{1,6}\s+[A-Za-z][A-Za-z0-9.#'\-]*(?:\s+[A-Za-z0-9.#'\-]+){0,4}$/i.test(
    text,
  );
}

function buildBestAddressLabel({ mapAddress, title, hood }) {
  const cleanedMapAddress = cleanAddressFragment(mapAddress);
  if (cleanedMapAddress) {
    return cleanedMapAddress;
  }

  const extractedStreet = cleanAddressFragment(
    extractStreetAddressFromText(stripDateNoiseFromText(title)),
  );
  if (looksLikeRealStreetAddress(extractedStreet)) {
    return buildAddressLabel([extractedStreet, hood]);
  }

  return '';
}

function buildGeocodeCandidates({ mapAddress, addressLabel, hood, title }) {
  const candidates = [
    cleanAddressFragment(mapAddress),
    cleanAddressFragment(addressLabel),
    cleanAddressFragment(hood),
    buildAddressLabel([
      cleanAddressFragment(
        extractStreetAddressFromText(stripDateNoiseFromText(title)),
      ),
      cleanAddressFragment(hood),
    ]),
    cleanAddressFragment(stripDateNoiseFromText(title)),
  ].filter(Boolean);

  return [...new Set(candidates)].filter((candidate) => {
    if (!candidate) return false;
    if (
      /^(garage|yard|estate|moving|church|community|subdivision)/i.test(
        candidate,
      )
    ) {
      return false;
    }
    return true;
  });
}

async function geocodeWithFallbacks(candidates, area) {
  for (const candidate of candidates) {
    const result = await geocodeApproximateLocation(candidate, area);
    if (
      Number.isFinite(Number(result.latitude)) &&
      Number.isFinite(Number(result.longitude))
    ) {
      return result;
    }
  }

  return { latitude: null, longitude: null, approximateAddress: '' };
}

const postingPageDetailCache = new Map();
const approximateGeocodeCache = new Map();

function getAreaGeocodeSuffix(area) {
  switch (String(area || '').toLowerCase()) {
    case 'milwaukee':
      return 'Wisconsin, USA';
    case 'madison':
      return 'Wisconsin, USA';
    case 'minneapolis':
      return 'Minnesota, USA';
    case 'indianapolis':
      return 'Indiana, USA';
    case 'chicago':
    default:
      return 'Illinois, USA';
  }
}

function buildApproximateGeocodeQuery(rawValue, area) {
  const value = String(rawValue || '')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!value) return '';

  const suffix = getAreaGeocodeSuffix(area);
  if (value.toLowerCase().includes(suffix.toLowerCase())) {
    return value;
  }

  return `${value}, ${suffix}`;
}

async function geocodeApproximateLocation(rawValue, area) {
  const query = buildApproximateGeocodeQuery(rawValue, area);
  if (!query) {
    return { latitude: null, longitude: null, approximateAddress: '' };
  }

  const cacheKey = `${String(area || '').toLowerCase()}::${query.toLowerCase()}`;
  if (approximateGeocodeCache.has(cacheKey)) {
    return approximateGeocodeCache.get(cacheKey);
  }

  try {
    const response = await axios.get(
      'https://nominatim.openstreetmap.org/search',
      {
        timeout: 12000,
        params: {
          q: query,
          format: 'jsonv2',
          limit: 1,
          countrycodes: 'us',
          addressdetails: 1,
        },
        headers: {
          'User-Agent': 'ListAssist/1.0 (garage-sale geocoder)',
          Accept: 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        validateStatus: () => true,
      },
    );

    if (
      response.status >= 400 ||
      !Array.isArray(response.data) ||
      !response.data.length
    ) {
      const fallback = {
        latitude: null,
        longitude: null,
        approximateAddress: '',
      };
      approximateGeocodeCache.set(cacheKey, fallback);
      return fallback;
    }

    const first = response.data[0] || {};
    const latitude = Number(first.lat);
    const longitude = Number(first.lon);
    const approximateAddress = String(first.display_name || query).trim();

    const result = {
      latitude: Number.isFinite(latitude) ? latitude : null,
      longitude: Number.isFinite(longitude) ? longitude : null,
      approximateAddress,
    };
    approximateGeocodeCache.set(cacheKey, result);
    return result;
  } catch (_error) {
    const fallback = {
      latitude: null,
      longitude: null,
      approximateAddress: '',
    };
    approximateGeocodeCache.set(cacheKey, fallback);
    return fallback;
  }
}

function normalizeTimingText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function monthNameToIndex(value) {
  const text = String(value || '')
    .trim()
    .toLowerCase();
  const months = {
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    sept: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11,
  };

  return Object.prototype.hasOwnProperty.call(months, text) ? months[text] : -1;
}

function buildSaleDateValue({ month, day, year }, referenceDate) {
  const ref = referenceDate instanceof Date ? referenceDate : new Date();
  const normalizedYear = Number(year) > 0 ? Number(year) : ref.getFullYear();
  const fullYear =
    normalizedYear < 100 ? 2000 + normalizedYear : normalizedYear;
  const parsed = new Date(fullYear, Number(month), Number(day), 9, 0, 0, 0);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  if (!year) {
    const refStart = new Date(ref);
    refStart.setHours(0, 0, 0, 0);
    const maybeNextYear = new Date(parsed);
    maybeNextYear.setFullYear(parsed.getFullYear() + 1);

    if (parsed.getTime() < refStart.getTime() - 45 * 24 * 60 * 60 * 1000) {
      return maybeNextYear;
    }
  }

  return parsed;
}

function formatSaleDateLabel(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

function formatSaleDayLabel(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { weekday: 'long' });
}

function normalizeClockLabel(hours, minutes, meridiem) {
  const mm = String(minutes || 0).padStart(2, '0');
  if (Number(minutes || 0) === 0) {
    return `${hours} ${meridiem}`;
  }
  return `${hours}:${mm} ${meridiem}`;
}

function extractSaleTimeLabel(text) {
  const haystack = normalizeTimingText(text);
  if (!haystack) return { timeLabel: '', endTime: '', startTime: '' };

  const rangeMatch = haystack.match(
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(?:-|–|to|until|through)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i,
  );

  if (rangeMatch) {
    const startMeridiem = String(rangeMatch[3] || '').toUpperCase();
    const endMeridiem = String(
      rangeMatch[6] || rangeMatch[3] || '',
    ).toUpperCase();
    const startHours = Number(rangeMatch[1]);
    const startMinutes = Number(rangeMatch[2] || 0);
    const endHours = Number(rangeMatch[4]);
    const endMinutes = Number(rangeMatch[5] || 0);

    return {
      startTime: normalizeClockLabel(startHours, startMinutes, startMeridiem),
      endTime: normalizeClockLabel(endHours, endMinutes, endMeridiem),
      timeLabel: `${normalizeClockLabel(startHours, startMinutes, startMeridiem)} - ${normalizeClockLabel(endHours, endMinutes, endMeridiem)}`,
    };
  }

  const singleMatch = haystack.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (singleMatch) {
    const meridiem = String(singleMatch[3] || '').toUpperCase();
    const hours = Number(singleMatch[1]);
    const minutes = Number(singleMatch[2] || 0);
    return {
      startTime: normalizeClockLabel(hours, minutes, meridiem),
      endTime: '',
      timeLabel: normalizeClockLabel(hours, minutes, meridiem),
    };
  }

  return { timeLabel: '', endTime: '', startTime: '' };
}

function extractSaleDateFromText(text, referenceDate) {
  const haystack = normalizeTimingText(text);
  if (!haystack) return null;

  const monthMatch = haystack.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*(?:-|–|to|through|thru|and|&)\s*(\d{1,2})(?:st|nd|rd|th)?)?(?:\s*,?\s*(\d{2,4}))?/i,
  );

  if (monthMatch) {
    const monthIndex = monthNameToIndex(monthMatch[1]);
    const day = Number(monthMatch[2]);
    const year = monthMatch[4] ? Number(monthMatch[4]) : null;
    const parsed = buildSaleDateValue(
      { month: monthIndex, day, year },
      referenceDate,
    );
    if (parsed) return parsed;
  }

  const numericMatch = haystack.match(
    /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s*(?:-|–|to|through|thru|and|&)\s*(\d{1,2})(?:\/(\d{1,2}))?)?/i,
  );

  if (numericMatch) {
    const month = Number(numericMatch[1]) - 1;
    const day = Number(numericMatch[2]);
    const year = numericMatch[3] ? Number(numericMatch[3]) : null;
    const parsed = buildSaleDateValue({ month, day, year }, referenceDate);
    if (parsed) return parsed;
  }

  return null;
}

function extractPostingBodyText($) {
  return normalizeTimingText(
    $('#postingbody').text() ||
      $('section#postingbody').text() ||
      $('.postingbody').text() ||
      $('body').text(),
  );
}

function extractTimingDetailsFromPosting({
  title,
  bodyText,
  html,
  referenceDate,
}) {
  const candidates = [
    normalizeTimingText(title),
    normalizeTimingText(bodyText),
    normalizeTimingText(html).slice(0, 8000),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const saleDate = extractSaleDateFromText(candidate, referenceDate);
    const timeInfo = extractSaleTimeLabel(candidate);

    if (saleDate || timeInfo.timeLabel) {
      return {
        saleDate,
        saleDateLabel: saleDate ? formatSaleDateLabel(saleDate) : '',
        dayLabel: saleDate ? formatSaleDayLabel(saleDate) : '',
        timeLabel: timeInfo.timeLabel,
        startTime: timeInfo.startTime,
        endTime: timeInfo.endTime,
        timingConfidence: saleDate
          ? 'high'
          : timeInfo.timeLabel
            ? 'medium'
            : 'low',
      };
    }
  }

  return {
    saleDate: null,
    saleDateLabel: '',
    dayLabel: '',
    timeLabel: '',
    startTime: '',
    endTime: '',
    timingConfidence: 'low',
  };
}

async function fetchPostingPageDetails(postingUrl, baseUrl) {
  if (!postingUrl) {
    return {
      latitude: null,
      longitude: null,
      mapAddress: '',
      bodyText: '',
      saleDate: '',
      saleDateTime: '',
      dayLabel: '',
      timeLabel: '',
      startTime: '',
      endTime: '',
      timingConfidence: 'low',
    };
  }

  if (postingPageDetailCache.has(postingUrl)) {
    return postingPageDetailCache.get(postingUrl);
  }

  try {
    const response = await axios.get(postingUrl, {
      timeout: 15000,
      validateStatus: () => true,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: baseUrl,
        DNT: '1',
        Connection: 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
    });

    if (response.status >= 400) {
      const fallback = {
        latitude: null,
        longitude: null,
        mapAddress: '',
        bodyText: '',
        saleDate: '',
        saleDateTime: '',
        dayLabel: '',
        timeLabel: '',
        startTime: '',
        endTime: '',
        timingConfidence: 'low',
      };
      postingPageDetailCache.set(postingUrl, fallback);
      return fallback;
    }

    const html = String(response.data || '');
    const $ = cheerio.load(html);
    const parsedMapAddress = parseMapAddressFromPage($, html);
    const bodyText = extractPostingBodyText($);
    const timing = extractTimingDetailsFromPosting({
      title: $('title').first().text() || '',
      bodyText,
      html,
      referenceDate: new Date(),
    });
    const directGeo =
      parseGeoFromElement($('#map')) ||
      parseGeoFromElement($('[data-latitude][data-longitude]').first()) ||
      parseGeoFromElement($('[data-lat][data-lon]').first()) ||
      parseGeoFromHtml(html);
    const detail = {
      latitude: directGeo.latitude,
      longitude: directGeo.longitude,
      mapAddress: parsedMapAddress,
      bodyText,
      saleDate: timing.saleDateLabel,
      saleDateTime: timing.saleDate ? timing.saleDate.toISOString() : '',
      dayLabel: timing.dayLabel,
      timeLabel: timing.timeLabel,
      startTime: timing.startTime,
      endTime: timing.endTime,
      timingConfidence: timing.timingConfidence,
    };
    postingPageDetailCache.set(postingUrl, detail);
    return detail;
  } catch (_error) {
    const fallback = {
      latitude: null,
      longitude: null,
      mapAddress: '',
      bodyText: '',
      saleDate: '',
      saleDateTime: '',
      dayLabel: '',
      timeLabel: '',
      startTime: '',
      endTime: '',
      timingConfidence: 'low',
    };
    postingPageDetailCache.set(postingUrl, fallback);
    return fallback;
  }
}

function parseGeoFromRow($row) {
  const direct =
    parseGeoFromElement($row) ||
    parseGeoFromElement($row.find('[data-latitude][data-longitude]').first()) ||
    parseGeoFromElement($row.find('[data-lat][data-lon]').first()) ||
    parseGeoFromHtml($row.html());

  if (isUsableCoordinatePair(direct.latitude, direct.longitude)) {
    return direct;
  }

  return { latitude: null, longitude: null };
}

function detectCraigslistSaleType({ title, metaText, hood }) {
  const haystack = [title, metaText, hood]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const blockedPatterns = [
    /bmw/,
    /mercedes/,
    /toyota/,
    /honda/,
    /ford/,
    /chevy/,
    /vehicle/,
    /car/,
    /truck/,
    /motorcycle/,
    /storage unit/,
    /auction/,
    /apartment/,
    /rental/,
  ];

  if (blockedPatterns.some((pattern) => pattern.test(haystack))) {
    return 'blocked';
  }

  if (/estate sale|estate\s+liquidation|estate\s+tag\s+sale/.test(haystack)) {
    return 'estate';
  }

  if (
    /yard sale|garage sale|moving sale|rummage sale|flea market|multi\s*family sale|community garage sale|subdivision sale/.test(
      haystack,
    )
  ) {
    return 'garage';
  }

  return 'garage';
}

function isSameCalendarDay(dateA, dateB) {
  return (
    dateA.getFullYear() === dateB.getFullYear() &&
    dateA.getMonth() === dateB.getMonth() &&
    dateA.getDate() === dateB.getDate()
  );
}

function buildSaleDedupKey(sale) {
  const lat = Number(sale?.latitude);
  const lon = Number(sale?.longitude);
  const coordKey =
    Number.isFinite(lat) && Number.isFinite(lon)
      ? `${lat.toFixed(4)}|${lon.toFixed(4)}`
      : 'no-coords';

  const addressKey = String(
    sale?.mapAddress ||
      sale?.street ||
      sale?.crossStreet ||
      sale?.addressLabel ||
      sale?.mapsQuery ||
      sale?.hood ||
      '',
  )
    .toLowerCase()
    .replace(/\bnear\b/g, ' ')
    .replace(
      /\b(?:sat|sun|fri|apr|may|today|tomorrow|rain|shine|or|and)\b/g,
      ' ',
    )
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return `${coordKey}|${addressKey}`;
}

function chooseBetterDuplicateSale(currentSale, nextSale) {
  const score = (sale) => {
    let total = 0;
    if (sale?.street) total += 5;
    if (sale?.crossStreet) total += 2;
    if (sale?.city) total += 2;
    if (sale?.state) total += 1;
    if (sale?.zip) total += 1;
    if (sale?.hasExactCoordinates) total += 3;
    if (sale?.geoSource === 'posting_page') total += 2;
    total += Math.max(0, 120 - (Number(sale?.title || '').length || 0)) / 120;
    return total;
  };

  return score(nextSale) > score(currentSale) ? nextSale : currentSale;
}

function dedupeSales(sales) {
  const seen = new Map();

  for (const sale of sales) {
    const key = buildSaleDedupKey(sale);
    if (!seen.has(key)) {
      seen.set(key, sale);
      continue;
    }
    seen.set(key, chooseBetterDuplicateSale(seen.get(key), sale));
  }

  return Array.from(seen.values());
}

async function fetchCraigslistGarageSales({
  area,
  latitude,
  longitude,
  radiusMiles,
  day,
}) {
  const baseUrl = `https://${area}.craigslist.org`;
  const query = new URLSearchParams({
    search_distance: String(radiusMiles || 25),
    sort: 'date',
  });

  if (Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))) {
    query.set('lat', String(latitude));
    query.set('lon', String(longitude));
  }

  const url = `${baseUrl}/search/gms?${query.toString()}`;

  const response = await axios.get(url, {
    timeout: 20000,
    validateStatus: () => true,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: baseUrl,
      DNT: '1',
      Connection: 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
    },
  });

  if (response.status >= 400) {
    throw new Error(`Craigslist responded with status ${response.status}`);
  }

  const html = String(response.data || '');
  if (!html || html.trim().startsWith('{')) {
    throw new Error('Craigslist HTML was not returned.');
  }

  const $ = cheerio.load(html);
  const rows = $(
    '.cl-search-result, .result-row, li.cl-static-search-result',
  ).toArray();
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const normalizedTargetDay =
    day === 'today' || day === 'tomorrow' ? day : null;
  const targetDate =
    normalizedTargetDay === 'tomorrow'
      ? tomorrow
      : normalizedTargetDay === 'today'
        ? today
        : null;

  const resolvedSales = await Promise.all(
    rows.map(async (row, index) => {
      const $row = $(row);
      const title =
        $row
          .find('.result-title, .posting-title, .title')
          .first()
          .text()
          .trim() ||
        $row.find('a').first().text().trim() ||
        `Garage Sale ${index + 1}`;

      const postingUrl = parsePostingUrl(
        $row
          .find('.result-title, .posting-title, .title, a')
          .first()
          .attr('href'),
        baseUrl,
      );

      const hood = $row
        .find('.meta .nearby, .result-hood, .location')
        .first()
        .text()
        .trim();
      const price = $row.find('.price').first().text().trim();
      const metaText = $row
        .find('.meta, .supertitle, .details')
        .text()
        .replace(/\s+/g, ' ')
        .trim();
      const dateText =
        $row.find('time').first().attr('datetime') ||
        $row.find('time').first().text().trim() ||
        $row.find('.meta time').first().text().trim();

      const postingDate = dateText ? new Date(dateText) : null;
      if (
        targetDate &&
        postingDate &&
        !Number.isNaN(postingDate.getTime()) &&
        !isSameCalendarDay(postingDate, targetDate)
      ) {
        return null;
      }

      const rowGeo = parseGeoFromRow($row);
      const rowHasUsableGeo = isUsableCoordinatePair(
        rowGeo.latitude,
        rowGeo.longitude,
      );
      const pageDetails =
        !rowHasUsableGeo || !hood
          ? await fetchPostingPageDetails(postingUrl, baseUrl)
          : { latitude: null, longitude: null, mapAddress: '' };
      const pageHasUsableGeo = isUsableCoordinatePair(
        pageDetails.latitude,
        pageDetails.longitude,
      );
      const exactGeo = rowHasUsableGeo
        ? rowGeo
        : pageHasUsableGeo
          ? {
              latitude: pageDetails.latitude,
              longitude: pageDetails.longitude,
            }
          : { latitude: null, longitude: null };
      const resolvedAddressLabel = buildBestAddressLabel({
        mapAddress: pageDetails.mapAddress,
        title,
        hood,
      });
      const geocodeCandidates = buildGeocodeCandidates({
        mapAddress: pageDetails.mapAddress,
        addressLabel: resolvedAddressLabel,
        hood,
        title,
      });
      const approximateGeo = !isUsableCoordinatePair(
        exactGeo.latitude,
        exactGeo.longitude,
      )
        ? await geocodeWithFallbacks(geocodeCandidates, area)
        : { latitude: null, longitude: null, approximateAddress: '' };
      const hasExactCoordinates = isUsableCoordinatePair(
        exactGeo.latitude,
        exactGeo.longitude,
      );
      const hasApproximateCoordinates = isUsableCoordinatePair(
        approximateGeo.latitude,
        approximateGeo.longitude,
      );
      const geo = hasExactCoordinates
        ? exactGeo
        : hasApproximateCoordinates
          ? {
              latitude: approximateGeo.latitude,
              longitude: approximateGeo.longitude,
            }
          : { latitude: null, longitude: null };
      const milesAway = distanceMiles(
        latitude,
        longitude,
        geo.latitude,
        geo.longitude,
      );
      const distanceLabel = hasExactCoordinates
        ? milesAway !== null
          ? `${milesAway} mi away`
          : 'Use map for area'
        : hasApproximateCoordinates
          ? milesAway !== null
            ? `Approx. ${milesAway} mi away`
            : 'Approximate area'
          : 'Use map for area';
      const approximateAddressLabel = cleanAddressFragment(
        approximateGeo.approximateAddress,
      );
      const hoodLabel = cleanAddressFragment(hood);
      const finalAddress = buildFinalAddressData({
        title,
        hood,
        mapAddress: pageDetails.mapAddress,
        approximateAddress: approximateAddressLabel,
        fallbackAddressLabel: resolvedAddressLabel || hoodLabel,
      });

      if (
        !finalAddress.street &&
        !finalAddress.crossStreet &&
        /\bnear\b/i.test(finalAddress.addressLabel) &&
        !/\bnear\b/i.test(hoodLabel)
      ) {
        const reparsed = splitNearAddress(finalAddress.addressLabel);
        if (reparsed.street || reparsed.crossStreet) {
          finalAddress.street = reparsed.street || finalAddress.street;
          finalAddress.crossStreet =
            reparsed.crossStreet || finalAddress.crossStreet;
        }
      }
      const saleType = detectCraigslistSaleType({ title, metaText, hood });
      if (saleType === 'blocked') {
        return null;
      }
      const saleLabel =
        saleType === 'estate' ? 'Estate Sale' : 'Garage/Yard Sale';
      const rawNotes =
        [metaText, price].filter(Boolean).join(' • ') ||
        `${saleLabel} listing from Craigslist`;
      const notes =
        !hasExactCoordinates && hasApproximateCoordinates
          ? `${rawNotes} • Approximate location from listing area.`
          : rawNotes;

      return {
        id: `garage-${area}-${index + 1}`,
        saleType,
        title,
        subtitle: `${saleLabel} • ${distanceLabel}`,
        latitude: geo.latitude,
        longitude: geo.longitude,
        lat: geo.latitude,
        lon: geo.longitude,
        address: finalAddress.addressLabel,
        addressLabel: finalAddress.addressLabel,
        mapAddress: finalAddress.mapAddress,
        street: finalAddress.street,
        crossStreet: finalAddress.crossStreet,
        city: finalAddress.city,
        state: finalAddress.state,
        zip: finalAddress.zip,
        country: finalAddress.country,
        hood: hoodLabel,
        hasExactCoordinates,
        isApproximateLocation:
          !hasExactCoordinates && hasApproximateCoordinates,
        saleDate:
          cleanAddressFragment(pageDetails.saleDate) ||
          (dateText ? parseCraigslistDate(dateText, normalizedTargetDay) : ''),
        saleDateTime: pageDetails.saleDateTime || '',
        startTime: pageDetails.startTime || '',
        endTime: pageDetails.endTime || '',
        timeLabel: cleanAddressFragment(pageDetails.timeLabel) || '',
        dayLabel:
          cleanAddressFragment(pageDetails.dayLabel) ||
          (normalizedTargetDay
            ? normalizedTargetDay === 'tomorrow'
              ? 'Tomorrow'
              : 'Today'
            : ''),
        timingConfidence:
          pageDetails.timingConfidence ||
          (cleanAddressFragment(pageDetails.saleDate) ? 'high' : 'low'),
        isProbableSale:
          !cleanAddressFragment(pageDetails.saleDate) &&
          !cleanAddressFragment(pageDetails.dayLabel) &&
          !cleanAddressFragment(pageDetails.timeLabel),
        notes,
        query: `${title} ${finalAddress.addressLabel}`.trim(),
        mapsQuery: finalAddress.mapsQuery,
        pinColor: saleType === 'estate' ? '#7c3aed' : '#2563eb',
        craigslistUrl: postingUrl,
        geoSource: hasExactCoordinates
          ? rowHasUsableGeo
            ? 'search_row'
            : pageHasUsableGeo
              ? 'posting_page'
              : 'unknown'
          : hasApproximateCoordinates
            ? 'geocoder'
            : 'none',
        geocodeQuery:
          !hasExactCoordinates && hasApproximateCoordinates
            ? buildApproximateGeocodeQuery(
                geocodeCandidates[0] || finalAddress.addressLabel,
                area,
              )
            : '',
        distanceMiles: milesAway,
        distanceLabel,
      };
    }),
  );

  const salesBeforeDedupe = resolvedSales.filter(Boolean);
  const sales = dedupeSales(salesBeforeDedupe).sort((a, b) => {
    const aDistance = Number.isFinite(Number(a.distanceMiles))
      ? Number(a.distanceMiles)
      : 9999;
    const bDistance = Number.isFinite(Number(b.distanceMiles))
      ? Number(b.distanceMiles)
      : 9999;
    return aDistance - bDistance;
  });

  const diagnostics = {
    sourceRows: rows.length,
    afterDayFilter: resolvedSales.filter((item) => item !== null).length,
    exactCoords: sales.filter((sale) => sale.hasExactCoordinates).length,
    approximateCoords: sales.filter((sale) => sale.isApproximateLocation)
      .length,
    withStreet: sales.filter((sale) => sale.street).length,
    withCity: sales.filter((sale) => sale.city).length,
    fromPostingPage: sales.filter((sale) => sale.geoSource === 'posting_page')
      .length,
    fromGeocoder: sales.filter((sale) => sale.geoSource === 'geocoder').length,
    deduped: Math.max(0, salesBeforeDedupe.length - sales.length),
    returned: sales.length,
  };

  return { sales, sourceUrl: url, diagnostics };
}

async function handleGarageSales(req, res) {
  try {
    const latitude = Number(req.query.latitude);
    const longitude = Number(req.query.longitude);
    const radiusMiles = Math.max(
      1,
      Math.min(Number(req.query.radiusMiles) || 25, 50),
    );
    const day =
      req.query.day === 'tomorrow'
        ? 'tomorrow'
        : req.query.day === 'today'
          ? 'today'
          : null;
    const area =
      String(req.query.area || normalizeAreaFromCoords(latitude, longitude))
        .trim()
        .toLowerCase() || 'chicago';

    const { sales, sourceUrl, diagnostics } = await fetchCraigslistGarageSales({
      area,
      latitude,
      longitude,
      radiusMiles,
      day,
    });
    const debugEnabled =
      req.query.debug === '1' ||
      req.query.debug === 'true' ||
      req.query.debug === 'yes';

    return res.json({
      ok: true,
      area,
      source: 'craigslist',
      sourceUrl,
      day: day || 'all',
      radiusMiles,
      sales,
      count: sales.length,
      ...(debugEnabled ? { diagnostics } : {}),
      message: sales.length
        ? `Loaded ${sales.length} Craigslist sale listings.`
        : 'No Craigslist garage, yard, or estate sale listings matched this area and radius.',
    });
  } catch (error) {
    console.error('Garage sales route failed:', error?.message || error);
    return res.status(500).json({
      ok: false,
      error: 'garage_sales_fetch_failed',
      message: 'Could not load garage sales from Craigslist right now.',
      detail: error?.message || String(error),
    });
  }
}

router.get('/garage-sales-health', (_req, res) => {
  return res.json({ ok: true, route: 'garage-sales-route', mounted: true });
});

router.get('/garage-sales', handleGarageSales);
router.get('/api/garage-sales', handleGarageSales);

module.exports = router;
