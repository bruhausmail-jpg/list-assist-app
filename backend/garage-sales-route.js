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


function normalizePostalCode(value) {
  const match = String(value || '').match(/\b\d{5}(?:-\d{4})?\b/);
  return match ? match[0].slice(0, 5) : '';
}

function inferPostalFromCoords(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return '60565';
  }

  // Good local defaults for the Naperville / west-suburban sourcing area.
  // This keeps Craigslist's postal-radius search alive even when the app only
  // sends GPS coordinates and no ZIP/postal code.
  const candidates = [
    { zip: '60565', latitude: 41.724, longitude: -88.155 }, // south Naperville
    { zip: '60540', latitude: 41.771, longitude: -88.148 }, // central Naperville
    { zip: '60563', latitude: 41.803, longitude: -88.139 }, // north Naperville
    { zip: '60564', latitude: 41.706, longitude: -88.202 }, // southwest Naperville
    { zip: '60504', latitude: 41.748, longitude: -88.236 }, // Aurora / Route 59
    { zip: '60517', latitude: 41.746, longitude: -88.050 }, // Woodridge
    { zip: '60585', latitude: 41.682, longitude: -88.203 }, // Plainfield
  ];

  let best = candidates[0];
  let bestDistance = Infinity;

  for (const candidate of candidates) {
    const miles = distanceMiles(lat, lon, candidate.latitude, candidate.longitude);
    if (Number.isFinite(miles) && miles < bestDistance) {
      best = candidate;
      bestDistance = miles;
    }
  }

  return best.zip;
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
    return fallbackDay === 'dayaftertomorrow'
      ? '2 Days Out'
      : fallbackDay === 'tomorrow'
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

  const houseNumber = '(?:\\d+[A-Za-z]+\\d+|\\d+[A-Za-z]?|\\d+-\\d+)';
  const streetSuffix = '(?:Ave(?:nue)?|St(?:reet)?|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court|Cir|Circle|Blvd|Boulevard|Pkwy|Parkway|Pl|Place|Ter|Terrace|Way|Trail|Trl|Highway|Hwy|Route|Rt)';
  const patterns = [
    new RegExp(
      `\\b(${houseNumber}\\s+(?:[NSEW]\\.?\\s+)?[A-Za-z0-9.#'\\-]+(?:\\s+[A-Za-z0-9.#'\\-]+){0,7}\\s${streetSuffix}\\.?)\\b`,
      'i',
    ),
    new RegExp(
      `\\b(${houseNumber}\\s+(?:[NSEW]\\.?\\s+)?[A-Za-z][A-Za-z0-9.#'\\-]+(?:\\s+[A-Za-z0-9.#'\\-]+){1,4})\\b`,
      'i',
    ),
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const candidate = String(match[1])
        .replace(/[,:;.-]+$/g, '')
        .trim();
      const candidateHasRoadSuffix = hasRoadSuffix(candidate);

      // Avoid treating listing years or item/size text like "24 month" and
      // "100 Years Old Books" as a street address. Prefer real road suffixes
      // and the map/address block from the Craigslist detail page.
      if (
        (!candidateHasRoadSuffix && hasYearLikeHouseNumberPrefix(candidate)) ||
        looksLikeSaleItemNotAddress(candidate)
      ) {
        continue;
      }

      return candidate;
    }
  }

  return '';
}

function extractExactAddressFromText(value) {
  const text = cleanAddressFragment(value)
    .replace(/\b(?:location|address|sale address|located at)\s*:?\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) {
    return { street: '', city: '', state: '', zip: '', addressLabel: '' };
  }

  const streetSuffix =
    '(?:Ave(?:nue)?|St(?:reet)?|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court|Cir|Circle|Blvd|Boulevard|Pkwy|Parkway|Pl|Place|Ter|Terrace|Way|Trail|Trl|Highway|Hwy)';

  const exactPattern = new RegExp(
    "\\b((?:\\d+[A-Za-z]\\d+|\\d+[A-Za-z]?|\\d+-\\d+)\\s+(?:[NSEW]\\.?\\s+)?[A-Za-z0-9.#'\\-]+(?:\\s+[A-Za-z0-9.#'\\-]+){0,7}\\s" +
      streetSuffix +
      "\\.?)(?:,)?\\s+([A-Za-z][A-Za-z .'\\-]{1,40}?)(?:,)?\\s+([A-Z]{2})\\s*(\\d{5}(?:-\\d{4})?)?\\b",
    'i',
  );

  const exactMatch = text.match(exactPattern);
  if (exactMatch && exactMatch[1]) {
    const street = normalizeRoadAbbreviation(exactMatch[1]);
    const city = cleanAddressFragment(exactMatch[2]);
    const state = cleanAddressFragment(exactMatch[3]).toUpperCase();
    const zip = cleanAddressFragment(exactMatch[4] || '');

    if (looksLikeRealStreetAddress(street) && isLikelyCityLabel(city)) {
      return {
        street,
        city,
        state,
        zip,
        addressLabel: buildMapsQuery([street, city, state, zip]),
      };
    }
  }

  const streetOnly = cleanAddressFragment(extractStreetAddressFromText(text));
  if (streetOnly && looksLikeRealStreetAddress(streetOnly)) {
    return {
      street: normalizeRoadAbbreviation(streetOnly),
      city: '',
      state: '',
      zip: '',
      addressLabel: normalizeRoadAbbreviation(streetOnly),
    };
  }

  return { street: '', city: '', state: '', zip: '', addressLabel: '' };
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
    .replace(/\bSt\.?\b/gi, 'Street')
    .replace(/\bRd\.?\b/gi, 'Road')
    .replace(/\bDr\.?\b/gi, 'Drive')
    .replace(/\bLn\.?\b/gi, 'Lane')
    .replace(/\bCt\.?\b/gi, 'Court')
    .replace(/\bCir\.?\b/gi, 'Circle')
    .replace(/\bBlvd\.?\b/gi, 'Boulevard')
    .replace(/\bPkwy\.?\b/gi, 'Parkway')
    .replace(/\bPl\.?\b/gi, 'Place')
    .replace(/\bTer\.?\b/gi, 'Terrace')
    .replace(/\bTrl\.?\b/gi, 'Trail')
    .replace(/\bHwy\.?\b/gi, 'Highway')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeNearAddressText(value) {
  return cleanAddressFragment(value)
    .replace(
      /\s*\((?:church on corner|corner|near corner|by park|park district).*?\)\s*/gi,
      ' ',
    )
    .replace(/\bnear\s+near\b/gi, 'near')
    .replace(/\s*&\s*/g, ' & ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasHouseNumberPrefix(value) {
  const text = cleanAddressFragment(value);
  return /^(?:\d+[A-Za-z]+\d+|\d+[A-Za-z]?|\d+-\d+)\b/i.test(text);
}
function hasYearLikeHouseNumberPrefix(value) {
  const text = cleanAddressFragment(value);
  const match = text.match(/^(19\d{2}|20\d{2})\b/);
  return Boolean(match);
}

function hasRoadSuffix(value) {
  return /\b(?:Ave(?:nue)?|St(?:reet)?|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court|Cir|Circle|Blvd|Boulevard|Pkwy|Parkway|Pl|Place|Ter|Terrace|Way|Trail|Trl|Highway|Hwy|Route|Rt)\b/i.test(
    String(value || ''),
  );
}

function looksLikeSaleItemNotAddress(value) {
  const text = cleanAddressFragment(value).toLowerCase();
  if (!text) return false;
  if (/^\d+\s*(?:month|months|mo|mos|yr|yrs|year|years|t|x|xl|xxl|inch|inches|cm|mm)\b/i.test(text)) return true;
  if (/^\d+\s+years?\s+old\b/i.test(text)) return true;
  if (/^\d+\s*(?:books?|clothing|clothes|shoes?|toys?|comics?|records?|dvds?|cds?|watches?|games?)\b/i.test(text)) return true;
  if (/\b(?:boys?|girls?|children|kids?|toddler|baby|women|womens|men|mens|clothing|clothes|shoes?|books?|toys?|coach|skecher|madden|toms|comics?|watches?)\b/i.test(text) && !hasRoadSuffix(text)) return true;
  return false;
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

  return /^(?:\d+[A-Za-z]+\d+|\d+[A-Za-z]?|\d+-\d+)\s+[A-Za-z0-9.#'\-]+(?:\s+[A-Za-z0-9.#'\-]+){0,5}$/i.test(
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

  const zipMatch = text.match(/\b(\d{5})(?:-\d{4})?\b/);
  const zip = zipMatch ? zipMatch[1] : '';

  let withoutZip = text
    .replace(/\b\d{5}(?:-\d{4})?\b/g, '')
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
  bodyText,
  locationDetail,
}) {
  const combined = [
    cleanAddressFragment(hood),
    cleanAddressFragment(title),
    cleanAddressFragment(mapAddress),
    cleanAddressFragment(approximateAddress),
    cleanAddressFragment(bodyText),
    cleanAddressFragment(locationDetail),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (combined.includes('carillon lakes')) return 'Crest Hill';
  if (combined.includes('crest hill')) return 'Crest Hill';
  if (combined.includes('lemont')) return 'Lemont';
  if (combined.includes('woodridge')) return 'Woodridge';
  if (combined.includes('downers grove')) return 'Downers Grove';
  if (combined.includes('bolingbrook')) return 'Bolingbrook';
  if (combined.includes('romeoville')) return 'Romeoville';
  if (combined.includes('naperville')) return 'Naperville';
  if (combined.includes('plainfield')) return 'Plainfield';
  if (combined.includes('darien')) return 'Darien';
  if (combined.includes('lisle')) return 'Lisle';
  if (combined.includes('aurora')) return 'Aurora';
  if (combined.includes('oswego')) return 'Oswego';
  if (combined.includes('wheaton')) return 'Wheaton';
  if (combined.includes('lockport')) return 'Lockport';
  if (combined.includes('yorkville')) return 'Yorkville';

  return '';
}


const CITY_FALLBACK_COORDINATES = {
  aurora: { latitude: 41.7606, longitude: -88.3201, label: 'Aurora, IL' },
  bolingbrook: { latitude: 41.6986, longitude: -88.0684, label: 'Bolingbrook, IL' },
  'carillon lakes': { latitude: 41.5578, longitude: -88.1120, label: 'Crest Hill, IL' },
  'carol stream': { latitude: 41.9125, longitude: -88.1348, label: 'Carol Stream, IL' },
  'crest hill': { latitude: 41.5548, longitude: -88.0987, label: 'Crest Hill, IL' },
  darien: { latitude: 41.7456, longitude: -87.9784, label: 'Darien, IL' },
  'downers grove': { latitude: 41.8089, longitude: -88.0112, label: 'Downers Grove, IL' },
  elmhurst: { latitude: 41.8995, longitude: -87.9403, label: 'Elmhurst, IL' },
  lemont: { latitude: 41.6736, longitude: -88.0017, label: 'Lemont, IL' },
  lisle: { latitude: 41.8011, longitude: -88.0748, label: 'Lisle, IL' },
  lockport: { latitude: 41.5895, longitude: -88.0578, label: 'Lockport, IL' },
  naperville: { latitude: 41.7508, longitude: -88.1535, label: 'Naperville, IL' },
  'north aurora': { latitude: 41.8061, longitude: -88.3273, label: 'North Aurora, IL' },
  oswego: { latitude: 41.6828, longitude: -88.3515, label: 'Oswego, IL' },
  plainfield: { latitude: 41.6322, longitude: -88.2120, label: 'Plainfield, IL' },
  'river forest': { latitude: 41.8978, longitude: -87.8139, label: 'River Forest, IL' },
  romeoville: { latitude: 41.6475, longitude: -88.0895, label: 'Romeoville, IL' },
  streamwood: { latitude: 42.0256, longitude: -88.1784, label: 'Streamwood, IL' },
  wheaton: { latitude: 41.8661, longitude: -88.1070, label: 'Wheaton, IL' },
  willowbrook: { latitude: 41.7698, longitude: -87.9359, label: 'Willowbrook, IL' },
  woodridge: { latitude: 41.7469, longitude: -88.0503, label: 'Woodridge, IL' },
  yorkville: { latitude: 41.6411, longitude: -88.4473, label: 'Yorkville, IL' },
  'west chicagoland': { latitude: 41.8011, longitude: -88.0748, label: 'West Chicagoland, IL' },
};

function normalizeCityLookupKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findFallbackCityCoordinates(...values) {
  const combined = normalizeCityLookupKey(values.filter(Boolean).join(' '));
  if (!combined) return null;

  // Prefer the longest city names first so "north aurora" wins before "aurora".
  const entries = Object.entries(CITY_FALLBACK_COORDINATES).sort(
    (a, b) => b[0].length - a[0].length,
  );

  for (const [cityKey, coords] of entries) {
    const normalizedCityKey = normalizeCityLookupKey(cityKey);
    const cityPattern = escapeRegExp(normalizedCityKey).replace(/\\s+/g, '\\s+');
    if (new RegExp(`(^|\\s)${cityPattern}(\\s|$)`).test(combined)) {
      return { ...coords, cityKey };
    }
  }

  return null;
}

function getFallbackCoordinatesForSale({
  city,
  hood,
  title,
  mapAddress,
  approximateAddress,
  addressLabel,
  bodyText,
  locationDetail,
}) {
  return findFallbackCityCoordinates(
    city,
    hood,
    mapAddress,
    approximateAddress,
    addressLabel,
    locationDetail,
    title,
    bodyText,
  );
}


function isGenericCraigslistRegion(value) {
  const text = normalizeCityLookupKey(value);
  if (!text) return false;
  return [
    'west chicagoland',
    'north chicagoland',
    'south chicagoland',
    'northwest suburbs',
    'western suburbs',
    'southwest suburbs',
    'chicago suburbs',
  ].includes(text);
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
  bodyText,
  locationDetail,
}) {
  const cleanMapAddress = normalizeNearAddressText(mapAddress);
  const cleanApproximateAddress = normalizeNearAddressText(approximateAddress);
  const cleanHood = cleanAddressFragment(hood);
  const cleanFallback = cleanAddressFragment(fallbackAddressLabel);
  const cleanBodyText = cleanAddressFragment(bodyText);
  const cleanLocationDetail = cleanAddressFragment(locationDetail);

  const titleStreet = cleanAddressFragment(
    extractStreetAddressFromText(stripDateNoiseFromText(title)),
  );

  // Craigslist's best human-facing location is the text directly under the map
  // on the ad detail page (the circled spot in the user's screenshots). Use that
  // before scanning the ad body, because the body can contain item/size text like
  // "24 month" or "8 and 10" that looks address-ish but is not the sale address.
  const mapExactAddress = extractExactAddressFromText(cleanMapAddress);
  const mapParts = splitNearAddress(cleanMapAddress);
  const mapHasUsableAddress = Boolean(
    mapExactAddress.street || mapParts.street || mapParts.crossStreet,
  );

  const locationExactAddress = extractExactAddressFromText(cleanLocationDetail);
  const bodyExactAddress = extractExactAddressFromText(cleanBodyText);
  const exactBodyAddress = locationExactAddress.addressLabel
    ? locationExactAddress
    : bodyExactAddress;

  const approxParts = splitNearAddress(cleanApproximateAddress);
  const hoodParts = parseCityStateZip(cleanHood);

  const trustedTitleStreet =
    hasHouseNumberPrefix(titleStreet) && looksLikeRealStreetAddress(titleStreet)
      ? normalizeRoadAbbreviation(titleStreet)
      : '';

  const street =
    mapExactAddress.street ||
    mapParts.street ||
    (!mapHasUsableAddress ? exactBodyAddress.street : '') ||
    trustedTitleStreet ||
    approxParts.street ||
    '';

  const crossStreet =
    mapExactAddress.street || mapParts.street || exactBodyAddress.street
      ? mapParts.crossStreet || ''
      : approxParts.crossStreet || '';

  const contextualCity = getDefaultCityFromContext({
    hood: cleanHood,
    title,
    mapAddress: cleanMapAddress,
    approximateAddress: cleanApproximateAddress,
    bodyText: cleanBodyText,
    locationDetail: cleanLocationDetail,
  });

  const inferredCity =
    mapExactAddress.city ||
    (!mapHasUsableAddress ? exactBodyAddress.city : '') ||
    contextualCity ||
    (isGenericCraigslistRegion(cleanHood) ? '' : hoodParts.city);

  const city =
    inferredCity ||
    (!street && !crossStreet && isLikelyCityLabel(cleanMapAddress)
      ? cleanMapAddress
      : '') ||
    (!street && !crossStreet && isLikelyCityLabel(cleanApproximateAddress)
      ? cleanApproximateAddress
      : '');

  const state =
    mapExactAddress.state ||
    (!mapHasUsableAddress ? exactBodyAddress.state : '') ||
    hoodParts.state ||
    'IL';
  const zip =
    mapExactAddress.zip ||
    (!mapHasUsableAddress ? exactBodyAddress.zip : '') ||
    hoodParts.zip ||
    '';

  const mapBasedAddress = buildMapsQuery([
    street,
    crossStreet ? `near ${crossStreet}` : '',
    city,
    state,
    zip,
  ]);

  const displayAddress =
    mapBasedAddress ||
    mapExactAddress.addressLabel ||
    (!mapHasUsableAddress ? exactBodyAddress.addressLabel : '') ||
    cleanMapAddress ||
    cleanApproximateAddress ||
    cleanHood ||
    cleanFallback ||
    'Approximate location';

  const mapsQuery =
    buildPreferredMapsQuery({
      street,
      crossStreet,
      city,
      state,
      zip,
      mapAddress: cleanMapAddress,
      approximateAddress: cleanApproximateAddress,
      fallbackAddressLabel: cleanFallback,
    }) ||
    mapExactAddress.addressLabel ||
    (!mapHasUsableAddress ? exactBodyAddress.addressLabel : '');

  return {
    street,
    crossStreet,
    city,
    state,
    zip,
    country: 'USA',
    addressLabel: displayAddress,
    displayAddress,
    mapAddress:
      buildMapsQuery([
        street,
        crossStreet ? `near ${crossStreet}` : '',
        city,
        state,
        zip,
      ]) ||
      mapExactAddress.addressLabel ||
      cleanMapAddress ||
      cleanApproximateAddress ||
      cleanHood ||
      '',
    mapsQuery: mapsQuery || displayAddress,
  };
}
function stripDateNoiseFromText(value) {
  return cleanAddressFragment(value)
    .replace(
      /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b\s*\d{1,2}(?:\s*[-/,]\s*\d{1,2})?(?:\s*,?\s*\d{2,4})?/gi,
      ' ',
    )
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, ' ')
    .replace(/\b\d{4}\b/g, ' ')
    .replace(/\b\d{1,2}\s*(?:am|pm)\b/gi, ' ')
    .replace(
      /\b(?:today|tomorrow|thursday|friday|saturday|sunday|monday|tuesday|wednesday)\b/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeRealStreetAddress(value) {
  const text = cleanAddressFragment(value);
  if (!text) return false;
  if (looksLikeSaleItemNotAddress(text)) return false;
  if (/\b(?:\d+[A-Za-z]+\d+|\d+[A-Za-z]?|\d+-\d+)\s+[A-Za-z]/.test(text) && hasRoadSuffix(text)) {
    return true;
  }
  return /^(?:\d+[A-Za-z]+\d+|\d+[A-Za-z]?|\d+-\d+)\s+[A-Za-z][A-Za-z0-9.#'\-]*(?:\s+[A-Za-z0-9.#'\-]+){1,3}$/i.test(text);
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
      /^(garage|yard|estate|moving|church|community|subdivision)\b/i.test(
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

function extractCraigslistAttributeText($) {
  // Craigslist puts high-quality structured details in attrgroup blocks, e.g.
  // "dates: friday 2026-05-01 saturday 2026-05-02 start time: 10".
  // Keep this separate from the body so date/time parsing sees it clearly.
  try {
    return $('.attrgroup, .mapaddress, .postingtitletext')
      .toArray()
      .map((node) => $(node).text())
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch (_error) {
    return '';
  }
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


function dateKeyFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dateFromDateKey(dateKey) {
  const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 9, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatSaleDateKeyLabel(dateKey) {
  const date = dateFromDateKey(dateKey);
  return date ? formatSaleDateLabel(date) : '';
}

function formatSaleDateKeyDayLabel(dateKey) {
  const date = dateFromDateKey(dateKey);
  return date ? formatSaleDayLabel(date) : '';
}

function uniqueDateKeysList(values) {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))].sort();
}

function saleDateKeysFromSearchRow({ title, metaText, hood, dateText }, referenceDate) {
  const searchText = [title, metaText, hood, dateText]
    .filter(Boolean)
    .join(' ');
  return extractSaleDatesFromText(searchText, referenceDate).map(dateKeyFromDate);
}

function uniqueDates(dates) {
  const seen = new Set();
  const result = [];
  for (const date of dates) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) continue;
    const key = dateKeyFromDate(date);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(date);
  }
  return result.sort((a, b) => a.getTime() - b.getTime());
}

function extractSaleDatesFromText(text, referenceDate) {
  const haystack = normalizeTimingText(text);
  if (!haystack) return [];

  const ref = referenceDate instanceof Date ? referenceDate : new Date();
  const lower = haystack.toLowerCase();
  const dates = [];

  if (/\btoday\b/.test(lower)) {
    const result = new Date(ref);
    result.setHours(9, 0, 0, 0);
    dates.push(result);
  }

  if (/\btomorrow\b/.test(lower)) {
    const result = new Date(ref);
    result.setDate(result.getDate() + 1);
    result.setHours(9, 0, 0, 0);
    dates.push(result);
  }

  // Craigslist detail pages often render structured sale dates like
  // "friday 2026-05-01" / "saturday 2026-05-02" in the right rail.
  // The old parser only understood text dates and numeric dates, so those
  // structured ISO dates could be missed or misread as a future weekday.
  for (const isoMatch of haystack.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g)) {
    const parsed = buildSaleDateValue({
      month: Number(isoMatch[2]) - 1,
      day: Number(isoMatch[3]),
      year: Number(isoMatch[1]),
    }, ref);
    if (parsed) dates.push(parsed);
  }

  const weekdayIndexes = {
    sunday: 0,
    sun: 0,
    monday: 1,
    mon: 1,
    tuesday: 2,
    tue: 2,
    tues: 2,
    wednesday: 3,
    wed: 3,
    thursday: 4,
    thu: 4,
    thur: 4,
    thurs: 4,
    friday: 5,
    fri: 5,
    saturday: 6,
    sat: 6,
  };

  for (const weekdayMatch of haystack.matchAll(/\b(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\b/gi)) {
    const key = weekdayMatch[1].toLowerCase();
    const dayIndex = weekdayIndexes[key];
    if (Number.isFinite(dayIndex)) dates.push(nextDateForWeekday(dayIndex, ref));
  }

  for (const monthMatch of haystack.matchAll(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*(?:-|–|to|through|thru|and|&)\s*(\d{1,2})(?:st|nd|rd|th)?)?(?:\s*,?\s*(\d{2,4}))?/gi)) {
    const monthIndex = monthNameToIndex(monthMatch[1]);
    const firstDay = Number(monthMatch[2]);
    const secondDay = monthMatch[3] ? Number(monthMatch[3]) : null;
    const year = monthMatch[4] ? Number(monthMatch[4]) : null;
    const first = buildSaleDateValue({ month: monthIndex, day: firstDay, year }, ref);
    if (first) dates.push(first);
    if (Number.isFinite(secondDay)) {
      const second = buildSaleDateValue({ month: monthIndex, day: secondDay, year }, ref);
      if (second) dates.push(second);
    }
  }

  for (const numericMatch of haystack.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
    const month = Number(numericMatch[1]) - 1;
    const day = Number(numericMatch[2]);
    const year = numericMatch[3] ? Number(numericMatch[3]) : null;
    const parsed = buildSaleDateValue({ month, day, year }, ref);
    if (parsed) dates.push(parsed);
  }

  return uniqueDates(dates);
}

function normalizeClockLabel(hours, minutes, meridiem) {
  const numericHours = Number(hours);
  const numericMinutes = Number(minutes || 0);
  const mm = String(numericMinutes).padStart(2, '0');
  const suffix = meridiem ? ` ${String(meridiem).toUpperCase()}` : '';

  if (numericMinutes === 0) {
    return `${numericHours}${suffix}`;
  }
  return `${numericHours}:${mm}${suffix}`;
}

function inferGarageSaleMeridiem(hour, role, pairedHour) {
  const numericHour = Number(hour);
  const numericPair = Number(pairedHour);

  if (!Number.isFinite(numericHour)) return '';
  if (numericHour >= 12) return 'PM';

  if (role === 'start') {
    if (numericHour >= 5 && numericHour <= 11) return 'AM';
    if (
      numericHour >= 1 &&
      numericHour <= 4 &&
      Number.isFinite(numericPair) &&
      numericPair <= 7
    )
      return 'PM';
    return 'AM';
  }

  if (role === 'end') {
    if (numericHour >= 1 && numericHour <= 7) return 'PM';
    if (numericHour >= 8 && numericHour <= 11) return 'AM';
    return 'PM';
  }

  if (numericHour >= 5 && numericHour <= 11) return 'AM';
  if (numericHour >= 1 && numericHour <= 7) return 'PM';
  return '';
}

function normalizeTimeMatchToLabel(match, options = {}) {
  const startHours = Number(match[1]);
  const startMinutes = Number(match[2] || 0);
  const rawStartMeridiem = String(match[3] || '').toUpperCase();
  const endHours = Number(match[4]);
  const endMinutes = Number(match[5] || 0);
  const rawEndMeridiem = String(match[6] || '').toUpperCase();

  const startMeridiem =
    rawStartMeridiem || inferGarageSaleMeridiem(startHours, 'start', endHours);
  const endMeridiem =
    rawEndMeridiem ||
    rawStartMeridiem ||
    inferGarageSaleMeridiem(endHours, 'end', startHours);

  const startTime = normalizeClockLabel(
    startHours,
    startMinutes,
    startMeridiem,
  );
  const endTime = Number.isFinite(endHours)
    ? normalizeClockLabel(endHours, endMinutes, endMeridiem)
    : '';

  return {
    startTime,
    endTime,
    timeLabel: endTime ? `${startTime} - ${endTime}` : startTime,
    timePattern: options.timePattern || 'time_range',
  };
}

function extractSaleTimeLabel(text) {
  const haystack = normalizeTimingText(text)
    .replace(/\bnoon\b/gi, '12 PM')
    .replace(/\bmidnight\b/gi, '12 AM');
  if (!haystack)
    return { timeLabel: '', endTime: '', startTime: '', timePattern: '' };

  // Craigslist often renders this as "start time: 8:30 am" near the
  // bottom of the posting. Prefer that labeled value when present so we do
  // not accidentally grab a random number from the title, address, or dates.
  const labeledStartMatch = haystack.match(
    /\b(?:start\s*time|starts?|opens?|begin(?:s)?|sale\s*starts?|hours?)\s*:?\s*(now|\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i,
  );

  if (labeledStartMatch) {
    const labeledValue = String(labeledStartMatch[1] || '').trim();
    if (/^now$/i.test(labeledValue)) {
      return {
        startTime: 'Now',
        endTime: '',
        timeLabel: 'Now',
        timePattern: 'starts_now',
      };
    }

    const match = labeledValue.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (match) {
      const hours = Number(match[1]);
      const minutes = Number(match[2] || 0);
      const meridiem =
        String(match[3] || '').toUpperCase() ||
        inferGarageSaleMeridiem(hours, 'start');
      const label = normalizeClockLabel(hours, minutes, meridiem);
      return {
        startTime: label,
        endTime: '',
        timeLabel: label,
        timePattern: match[3]
          ? 'labeled_start'
          : 'labeled_start_inferred_meridiem',
      };
    }
  }

  const labeledRangeMatch = haystack.match(
    /\b(?:time|times|hours?|open|sale\s*time)\s*:?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to|until|through|thru)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i,
  );

  const rangeWithMeridiemMatch = haystack.match(
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(?:-|–|—|to|until|through|thru)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i,
  );

  const compactRangeMatch = haystack.match(
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to|until|through|thru)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i,
  );

  const rangeMatch =
    labeledRangeMatch || rangeWithMeridiemMatch || compactRangeMatch;

  if (rangeMatch) {
    return normalizeTimeMatchToLabel(rangeMatch, {
      timePattern: labeledRangeMatch
        ? 'labeled_range'
        : rangeWithMeridiemMatch
          ? 'range_with_meridiem'
          : 'range_inferred_meridiem',
    });
  }

  const singleMatch = haystack.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (singleMatch) {
    const meridiem = String(singleMatch[3] || '').toUpperCase();
    const hours = Number(singleMatch[1]);
    const minutes = Number(singleMatch[2] || 0);
    const label = normalizeClockLabel(hours, minutes, meridiem);
    return {
      startTime: label,
      endTime: '',
      timeLabel: label,
      timePattern: 'single_time_with_meridiem',
    };
  }

  return { timeLabel: '', endTime: '', startTime: '', timePattern: '' };
}


function splitTimingLines(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => normalizeTimingText(line))
    .filter(Boolean);
}

function extractTimeForDateKeyFromText(text, targetDateKey, referenceDate) {
  if (!targetDateKey) return null;

  const lines = splitTimingLines(text);
  for (const line of lines) {
    const lineDateKeys = extractSaleDatesFromText(line, referenceDate).map(dateKeyFromDate);
    if (!lineDateKeys.includes(targetDateKey)) continue;

    const timeInfo = extractSaleTimeLabel(line);
    if (timeInfo && timeInfo.timeLabel) {
      return {
        ...timeInfo,
        sourceLine: line,
      };
    }
  }

  // Some Craigslist bodies paste the schedule as one compact paragraph. Look
  // around the target date text and grab the nearest time window after it.
  const compact = normalizeTimingText(text);
  const targetDate = dateFromDateKey(targetDateKey);
  if (!compact || !targetDate) return null;

  const weekday = formatSaleDayLabel(targetDate);
  const monthName = targetDate.toLocaleDateString('en-US', { month: 'long' });
  const monthShort = targetDate.toLocaleDateString('en-US', { month: 'short' });
  const day = targetDate.getDate();
  const probes = [
    `${weekday}, ${monthName} ${day}`,
    `${weekday} ${monthName} ${day}`,
    `${weekday}, ${monthShort} ${day}`,
    `${weekday} ${monthShort} ${day}`,
    `${monthName} ${day}`,
    `${monthShort} ${day}`,
    `${targetDate.getMonth() + 1}/${day}`,
  ].map((probe) => probe.toLowerCase());

  const lower = compact.toLowerCase();
  for (const probe of probes) {
    const idx = lower.indexOf(probe);
    if (idx < 0) continue;
    const snippet = compact.slice(idx, idx + 180);
    const timeInfo = extractSaleTimeLabel(snippet);
    if (timeInfo && timeInfo.timeLabel) {
      return {
        ...timeInfo,
        sourceLine: snippet,
      };
    }
  }

  return null;
}

function nextDateForWeekday(dayIndex, referenceDate) {
  const ref =
    referenceDate instanceof Date ? new Date(referenceDate) : new Date();
  ref.setHours(9, 0, 0, 0);
  const diff = (dayIndex + 7 - ref.getDay()) % 7;
  const result = new Date(ref);
  result.setDate(ref.getDate() + diff);
  return result;
}

function extractSaleDateFromText(text, referenceDate) {
  return extractSaleDatesFromText(text, referenceDate)[0] || null;
}

function extractPostingBodyText($) {
  return normalizeTimingText(
    $('#postingbody').text() ||
      $('section#postingbody').text() ||
      $('.postingbody').text() ||
      $('body').text(),
  );
}

function cleanGarageSaleDetailText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:•\-–—]+|[\s:•\-–—]+$/g, '')
    .trim();
}

function limitGarageSaleDetailText(value, maxLength = 220) {
  const text = cleanGarageSaleDetailText(value);
  if (!text || text.length <= maxLength) return text;
  const trimmed = text.slice(0, maxLength + 1);
  const lastBreak = Math.max(
    trimmed.lastIndexOf('. '),
    trimmed.lastIndexOf('; '),
    trimmed.lastIndexOf(', '),
    trimmed.lastIndexOf(' '),
  );
  return `${trimmed.slice(0, lastBreak > 80 ? lastBreak : maxLength).trim()}…`;
}

function uniqueCleanList(values, limit = 12) {
  const seen = new Set();
  const output = [];

  for (const value of values || []) {
    const cleaned = cleanGarageSaleDetailText(value)
      .replace(/\s+/g, ' ')
      .replace(/^[,;:•\-–—]+|[,;:•\-–—]+$/g, '')
      .trim();
    if (!cleaned) continue;

    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);
    if (output.length >= limit) break;
  }

  return output;
}

function normalizeForKeywordScan(value) {
  return String(value || '')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/&amp;/gi, '&')
    .replace(/[^a-zA-Z0-9$&+/#.'\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const GARAGE_SALE_ITEM_CATEGORIES = [
  {
    category: 'High resale potential',
    weight: 18,
    terms: [
      'vintage',
      'antique',
      'antiques',
      'collectible',
      'collectibles',
      'mid century',
      'mcm',
      'danish modern',
      'sterling',
      'silver',
      'gold',
      'jewelry',
      'watches',
      'coins',
      'records',
      'vinyl',
      'video games',
      'nintendo',
      'sega',
      'playstation',
      'xbox',
      'pokemon',
      'sports cards',
      'trading cards',
      'comic books',
      'comics',
      'camera',
      'cameras',
      'lenses',
      'guitar',
      'musical instruments',
      'turntable',
      'audio equipment',
      'stereo',
    ],
  },
  {
    category: 'Tools and garage',
    weight: 14,
    terms: [
      'tools',
      'power tools',
      'hand tools',
      'tool box',
      'toolbox',
      'snap-on',
      'snap on',
      'craftsman',
      'dewalt',
      'milwaukee tools',
      'makita',
      'bosch',
      'ryobi',
      'air compressor',
      'ladder',
      'garage items',
      'hardware',
      'lawn mower',
      'snowblower',
      'generator',
    ],
  },
  {
    category: 'Home and furniture',
    weight: 10,
    terms: [
      'furniture',
      'dresser',
      'desk',
      'table',
      'chairs',
      'sofa',
      'couch',
      'bookshelf',
      'bookcase',
      'lamps',
      'rugs',
      'home decor',
      'decor',
      'art',
      'framed art',
      'mirrors',
      'kitchenware',
      'pyrex',
      'fiesta',
      'fiestaware',
      'corningware',
      'le creuset',
      'cast iron',
    ],
  },
  {
    category: 'Clothing and accessories',
    weight: 7,
    terms: [
      'clothing',
      'clothes',
      'mens clothing',
      'women clothing',
      "women's clothing",
      'shoes',
      'boots',
      'sneakers',
      'purses',
      'handbags',
      'coach',
      'kate spade',
      'designer',
      'vintage clothing',
      'costume jewelry',
    ],
  },
  {
    category: 'Kids and toys',
    weight: 6,
    terms: [
      'toys',
      'lego',
      'legos',
      'barbie',
      'american girl',
      'hot wheels',
      'matchbox',
      'baby items',
      'baby gear',
      'stroller',
      'crib',
      'kids clothes',
      'children',
      'board games',
      'puzzles',
    ],
  },
  {
    category: 'Books and media',
    weight: 5,
    terms: [
      'books',
      'dvds',
      'cds',
      'blu ray',
      'bluray',
      'records',
      'vinyl',
      'magazines',
      'sheet music',
    ],
  },
  {
    category: 'Electronics',
    weight: 9,
    terms: [
      'electronics',
      'computer',
      'laptop',
      'ipad',
      'iphone',
      'tablet',
      'monitor',
      'speakers',
      'receiver',
      'amplifier',
      'printer',
      'gaming',
    ],
  },
  {
    category: 'Outdoor and sporting goods',
    weight: 6,
    terms: [
      'bikes',
      'bicycles',
      'sporting goods',
      'golf clubs',
      'fishing',
      'camping',
      'patio furniture',
      'grill',
      'cooler',
      'yard tools',
    ],
  },
];

const GARAGE_SALE_WARNING_PATTERNS = [
  {
    label: 'Possible dealer / reseller language',
    pattern: /\b(?:dealer|dealers|vendor|vendors|flea market vendor)\b/i,
  },
  { label: 'Cash only', pattern: /\bcash\s+only\b/i },
  { label: 'No early birds', pattern: /\bno\s+early\s+birds?\b/i },
  { label: 'Rain date mentioned', pattern: /\brain\s+date\b/i },
  {
    label: 'Canceled or postponed language',
    pattern: /\b(?:cancelled|canceled|postponed|rescheduled)\b/i,
  },
  { label: 'Everything must go', pattern: /\beverything\s+must\s+go\b/i },
  {
    label: 'Bring help / large items',
    pattern: /\b(?:bring\s+help|must\s+haul|you\s+haul|pickup\s+only)\b/i,
  },
];

function extractMentionedItemsFromText(value) {
  const text = normalizeForKeywordScan(value).toLowerCase();
  if (!text) {
    return { itemsMentioned: [], bestItems: [], itemCategories: [] };
  }

  const matchedItems = [];
  const matchedCategories = [];
  const bestItems = [];

  for (const group of GARAGE_SALE_ITEM_CATEGORIES) {
    const groupMatches = [];
    for (const term of group.terms) {
      const escaped = escapeRegexText(term.toLowerCase()).replace(
        /\s+/g,
        '\\s+',
      );
      const regex = new RegExp(`\\b${escaped}\\b`, 'i');
      if (regex.test(text)) {
        const label = term
          .split(' ')
          .map((part) =>
            part ? part.charAt(0).toUpperCase() + part.slice(1) : part,
          )
          .join(' ');
        groupMatches.push(label);
        matchedItems.push(label);
      }
    }

    if (groupMatches.length) {
      matchedCategories.push({
        category: group.category,
        count: groupMatches.length,
        weight: group.weight,
        items: uniqueCleanList(groupMatches, 8),
      });
      bestItems.push(...groupMatches.slice(0, 4));
    }
  }

  matchedCategories.sort((a, b) => b.weight * b.count - a.weight * a.count);

  return {
    itemsMentioned: uniqueCleanList(matchedItems, 20),
    bestItems: uniqueCleanList(bestItems, 8),
    itemCategories: matchedCategories.slice(0, 6),
  };
}

function extractWarningFlagsFromText(value) {
  const text = normalizeForKeywordScan(value);
  if (!text) return [];
  return GARAGE_SALE_WARNING_PATTERNS.filter((warning) =>
    warning.pattern.test(text),
  ).map((warning) => warning.label);
}

function calculateLocationConfidence({
  hasExactCoordinates,
  hasApproximateCoordinates,
  geoSource,
  street,
  crossStreet,
  city,
  zip,
  mapsQuery,
}) {
  let score = 0;
  const reasons = [];

  if (hasExactCoordinates) {
    score += 40;
    reasons.push('exact coordinates');
  } else if (hasApproximateCoordinates) {
    score += 22;
    reasons.push('approximate geocode');
  }

  if (geoSource === 'posting_page') {
    score += 18;
    reasons.push('coordinates from posting page');
  } else if (geoSource === 'search_row') {
    score += 14;
    reasons.push('coordinates from search result');
  } else if (geoSource === 'geocoder') {
    score += 8;
    reasons.push('coordinates from geocoder');
  }

  if (street && hasHouseNumberPrefix(street)) {
    score += 24;
    reasons.push('full street address');
  } else if (street && crossStreet) {
    score += 18;
    reasons.push('street and cross street');
  } else if (street || crossStreet) {
    score += 12;
    reasons.push('street-level location');
  }

  if (city) score += 8;
  if (zip) score += 4;
  if (mapsQuery) score += 4;

  const normalizedScore = Math.max(0, Math.min(100, Math.round(score)));
  const label =
    normalizedScore >= 78
      ? 'high'
      : normalizedScore >= 50
        ? 'medium'
        : normalizedScore >= 25
          ? 'low'
          : 'very_low';

  return {
    label,
    score: normalizedScore,
    reasons: uniqueCleanList(reasons, 6),
  };
}

function normalizeConfidenceLabel(value) {
  const text = String(value || '').toLowerCase();
  if (['high', 'medium', 'low', 'very_low'].includes(text)) return text;
  return 'low';
}

function calculateTimeConfidence({
  saleDate,
  dayLabel,
  timeLabel,
  startTime,
  endTime,
  timingConfidence,
}) {
  let score = 0;
  const reasons = [];

  if (saleDate) {
    score += 32;
    reasons.push('sale date found');
  }
  if (dayLabel) {
    score += 12;
    reasons.push('day label found');
  }
  if (timeLabel || startTime) {
    score += 34;
    reasons.push('start time found');
  }
  if (endTime) {
    score += 10;
    reasons.push('end time found');
  }

  const normalized = normalizeConfidenceLabel(timingConfidence);
  if (normalized === 'high') score += 12;
  if (normalized === 'medium') score += 6;

  const normalizedScore = Math.max(0, Math.min(100, Math.round(score)));
  const label =
    normalizedScore >= 72
      ? 'high'
      : normalizedScore >= 42
        ? 'medium'
        : normalizedScore > 0
          ? 'low'
          : 'very_low';

  return {
    label,
    score: normalizedScore,
    reasons: uniqueCleanList(reasons, 6),
  };
}

function calculateSaleScore({
  title,
  saleType,
  bodyText,
  descriptionPreview,
  locationConfidence,
  timeConfidence,
  itemCategories,
  warningFlags,
  distanceMiles: saleDistanceMiles,
}) {
  const scanText = normalizeForKeywordScan(
    [title, bodyText, descriptionPreview].filter(Boolean).join(' '),
  );
  let score = 35;
  const reasons = [];

  if (saleType === 'estate') {
    score += 12;
    reasons.push('estate sale');
  }

  if (
    /\b(?:multi\s*family|community|subdivision|neighborhood|block sale|church sale|rummage)\b/i.test(
      scanText,
    )
  ) {
    score += 10;
    reasons.push('larger sale format');
  }

  for (const category of itemCategories || []) {
    const categoryScore = Math.min(
      22,
      Math.max(4, category.weight) + Math.min(8, category.count * 2),
    );
    score += categoryScore;
    reasons.push(category.category);
  }

  if (descriptionPreview && descriptionPreview.length > 80) {
    score += 8;
    reasons.push('useful item description');
  }

  if (locationConfidence?.label === 'high') score += 8;
  else if (locationConfidence?.label === 'medium') score += 4;
  else if (locationConfidence?.label === 'very_low') score -= 8;

  if (timeConfidence?.label === 'high') score += 8;
  else if (timeConfidence?.label === 'medium') score += 4;
  else if (timeConfidence?.label === 'very_low') score -= 8;

  const distance = Number(saleDistanceMiles);
  if (Number.isFinite(distance)) {
    if (distance <= 5) score += 6;
    else if (distance <= 12) score += 3;
    else if (distance > 35) score -= 5;
  }

  if ((warningFlags || []).some((flag) => /canceled|postponed/i.test(flag))) {
    score -= 35;
    reasons.push('possible cancellation warning');
  }
  if ((warningFlags || []).some((flag) => /dealer/i.test(flag))) {
    score -= 8;
  }

  const normalizedScore = Math.max(0, Math.min(100, Math.round(score)));
  const label =
    normalizedScore >= 82
      ? 'excellent'
      : normalizedScore >= 65
        ? 'strong'
        : normalizedScore >= 48
          ? 'fair'
          : 'low';

  return {
    score: normalizedScore,
    label,
    reasons: uniqueCleanList(reasons, 8),
  };
}

function normalizeSaleTitleForDedupe(value) {
  return String(value || '')
    .toLowerCase()
    .replace(
      /\b(?:garage|yard|estate|moving|rummage|sale|multi|family|huge|big|today|tomorrow|sat|sun|fri|saturday|sunday|friday)\b/g,
      ' ',
    )
    .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPhotoUrlsFromPostingPage($, html) {
  const urls = [];
  $('img').each((_index, element) => {
    const $img = $(element);
    const src =
      $img.attr('src') || $img.attr('data-src') || $img.attr('data-full-image');
    if (src && /^https?:\/\//i.test(src)) urls.push(src);
  });

  const htmlText = String(html || '');
  const imageMatches =
    htmlText.match(/https?:\/\/images\.craigslist\.org\/[^"'\s<>]+/gi) || [];
  urls.push(...imageMatches);

  return uniqueCleanList(urls, 12);
}

function buildFallbackDescriptionPreview(bodyText, notes) {
  const body = normalizePostingBodyForDetails(bodyText || notes);
  if (!body) return '';

  const resaleKeywords =
    /\b(?:vintage|antiques?|collectibles?|furniture|clothing|tools?|toys?|books?|records?|vinyl|ceramics?|silver|jewelry|electronics?|art supplies|holiday|christmas|halloween|textiles?|fabric|kitchen|decor|baby gear|bikes?|y2k)\b/i;
  const parts = body
    .replace(
      /\b(?:location|address|dates?|time|hours?|start time)\s*:?\s*[^.]{0,160}/gi,
      ' ',
    )
    .replace(
      /\b(?:friday|saturday|sunday|monday|tuesday|wednesday|thursday)\b[^.]{0,120}/gi,
      ' ',
    )
    .split(/(?<=[.!?])\s+|\s*[•\-–—]\s*/g)
    .map(cleanGarageSaleDetailText)
    .filter((part) => part.length >= 12 && resaleKeywords.test(part))
    .slice(0, 4);

  return parts.length ? limitGarageSaleDetailText(parts.join(' • '), 320) : '';
}

function escapeRegexText(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePostingBodyForDetails(value) {
  return cleanGarageSaleDetailText(value)
    .replace(/\s*\n\s*/g, ' ')
    .replace(/✨/g, ' ')
    .replace(/📍/g, ' Location: ')
    .replace(/🗓️|📅|🗓/g, ' Dates: ')
    .replace(/⏰|🕘|🕙|🕗/g, ' Time: ')
    .replace(/🪑|💵|🚗/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractLabelValueFromPostingBody(bodyText, labels, stopLabels) {
  const body = normalizePostingBodyForDetails(bodyText);
  if (!body) return '';

  const labelPattern = labels.map(escapeRegexText).join('|');
  const stopPattern = stopLabels.map(escapeRegexText).join('|');
  const regex = new RegExp(
    `(?:^|\\s)(?:${labelPattern})\\s*:?\\s*(.*?)(?=\\s(?:${stopPattern})\\s*:?|$)`,
    'i',
  );
  const match = body.match(regex);
  return match && match[1] ? cleanGarageSaleDetailText(match[1]) : '';
}

function extractLocationDetailFromPostingBody(bodyText) {
  const body = normalizePostingBodyForDetails(bodyText);
  const locationText = extractLabelValueFromPostingBody(
    body,
    ['Location', 'Address', 'Located at', 'Sale address'],
    [
      'Dates',
      'Date',
      'Time',
      'Hours',
      'What you’ll find',
      "What you'll find",
      'What you will find',
      'You will find',
      'Items',
      'For sale',
      'Includes',
      'Early arrival',
      'Cash',
      'Venmo',
      'Please',
      'Parking',
      'Start time',
      'dates',
      'start time',
    ],
  );

  if (locationText) return limitGarageSaleDetailText(locationText, 220);

  const fallbackMatch = body.match(
    /\b(\d{1,6}\s+[A-Za-z0-9.#'\-]+(?:\s+[A-Za-z0-9.#'\-]+){0,8}(?:Ave(?:nue)?|St(?:reet)?|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court|Cir|Circle|Blvd|Boulevard|Pkwy|Parkway|Pl|Place|Ter|Terrace|Way|Trail|Trl|Highway|Hwy)\b(?:\s*,?\s*[A-Za-z .'-]+)?(?:\s*\([^)]{3,80}\))?)/i,
  );

  return fallbackMatch && fallbackMatch[1]
    ? limitGarageSaleDetailText(fallbackMatch[1], 220)
    : '';
}

function extractDescriptionPreviewFromPostingBody(bodyText) {
  const body = normalizePostingBodyForDetails(bodyText);
  if (!body) return '';

  const whatYouWillFind = extractLabelValueFromPostingBody(
    body,
    [
      'What you’ll find',
      "What you'll find",
      'What you will find',
      'You will find',
      'Items include',
      'Items',
      'For sale',
      'Includes',
    ],
    [
      'Location',
      'Address',
      'Dates',
      'Date',
      'Time',
      'Hours',
      'Early arrival',
      'Cash',
      'Venmo',
      'Please',
      'Parking',
      'dates',
      'start time',
    ],
  );

  if (whatYouWillFind) {
    return limitGarageSaleDetailText(whatYouWillFind, 300);
  }

  const resaleKeywords = [
    'vintage',
    'antiques?',
    'collectibles?',
    'furniture',
    'clothing',
    'tools?',
    'toys?',
    'books?',
    'records?',
    'vinyl',
    'ceramics?',
    'silver',
    'jewelry',
    'electronics?',
    'art supplies',
    'holiday',
    'christmas',
    'halloween',
    'textiles?',
    'fabric',
    'kitchen',
    'decor',
    'baby gear',
    'bikes?',
    'y2k',
  ];
  const keywordRegex = new RegExp(`\\b(?:${resaleKeywords.join('|')})\\b`, 'i');
  const sentences = body
    .split(/(?<=[.!?])\s+|\s{2,}|(?:\s*[•\-–—]\s*)/)
    .map(cleanGarageSaleDetailText)
    .filter((part) => part.length >= 12 && keywordRegex.test(part))
    .slice(0, 4);

  if (sentences.length) {
    return limitGarageSaleDetailText(sentences.join(' • '), 300);
  }

  const cleaned = body
    .replace(
      /\b(?:dates?|time|hours?|location|address|start time)\s*:?\s*[^.]{0,140}/gi,
      ' ',
    )
    .replace(
      /\b(?:friday|saturday|sunday|monday|tuesday|wednesday|thursday)\b[^.]{0,100}/gi,
      ' ',
    )
    .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b[^.]{0,80}/gi, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned || cleaned.length < 35) return '';
  return limitGarageSaleDetailText(cleaned, 260);
}

function buildFullLocationText({
  locationDetail,
  displayAddress,
  mapAddress,
  city,
  state,
}) {
  const cleanLocationDetail = cleanGarageSaleDetailText(locationDetail);
  const address = cleanGarageSaleDetailText(displayAddress || mapAddress);
  const cleanCity = cleanGarageSaleDetailText(city);
  const cleanState = cleanGarageSaleDetailText(state);
  const cityState = [cleanCity, cleanState].filter(Boolean).join(', ');

  if (cleanLocationDetail) {
    const lowerDetail = cleanLocationDetail.toLowerCase();
    if (
      cityState &&
      cleanCity &&
      !lowerDetail.includes(cleanCity.toLowerCase())
    ) {
      return `${cleanLocationDetail}, ${cityState}`;
    }
    return cleanLocationDetail;
  }

  if (!address) return '';
  const lowerAddress = address.toLowerCase();

  if (
    cityState &&
    cleanCity &&
    !lowerAddress.includes(cleanCity.toLowerCase())
  ) {
    return `${address}, ${cityState}`;
  }

  return address;
}

function extractTimingDetailsFromPosting({
  title,
  bodyText,
  html,
  referenceDate,
}) {
  const candidates = [
    normalizeTimingText(bodyText),
    normalizeTimingText(html).slice(0, 12000),
    normalizeTimingText(title),
  ].filter(Boolean);

  let bestDate = null;
  let bestDateLabel = '';
  let bestDayLabel = '';
  let bestTime = { timeLabel: '', startTime: '', endTime: '' };
  let foundDateSource = '';
  let foundTimeSource = '';
  const allSaleDates = [];

  for (const candidate of candidates) {
    const candidateSaleDates = extractSaleDatesFromText(candidate, referenceDate);
    if (candidateSaleDates.length) {
      allSaleDates.push(...candidateSaleDates);
      if (!bestDate) {
        bestDate = candidateSaleDates[0];
        bestDateLabel = formatSaleDateLabel(bestDate);
        bestDayLabel = formatSaleDayLabel(bestDate);
        foundDateSource = candidate;
      }
    }

    if (!bestTime.timeLabel) {
      const timeInfo = extractSaleTimeLabel(candidate);
      if (timeInfo.timeLabel) {
        bestTime = timeInfo;
        foundTimeSource = candidate;
      }
    }

    if (bestDate && bestTime.timeLabel) {
      break;
    }
  }

  if (bestDate || bestTime.timeLabel) {
    return {
      saleDate: bestDate,
      saleDateLabel: bestDateLabel,
      saleDateKeys: uniqueDates(allSaleDates).map(dateKeyFromDate),
      saleDateLabels: uniqueDates(allSaleDates).map(formatSaleDateLabel),
      dayLabel: bestDayLabel,
      timeLabel: bestTime.timeLabel,
      startTime: bestTime.startTime,
      endTime: bestTime.endTime,
      timePattern: bestTime.timePattern || '',
      timingConfidence:
        bestDate && bestTime.timeLabel
          ? 'high'
          : bestDate || bestTime.timeLabel
            ? 'medium'
            : 'low',
      timingSource: bestTime.timeLabel
        ? 'posting_body_or_html'
        : foundDateSource
          ? 'posting_date'
          : '',
    };
  }

  return {
    saleDate: null,
    saleDateLabel: '',
    saleDateKeys: [],
    saleDateLabels: [],
    dayLabel: '',
    timeLabel: '',
    startTime: '',
    endTime: '',
    timePattern: '',
    timingConfidence: 'low',
    timingSource: '',
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
      saleDateKeys: [],
      saleDateLabels: [],
      dayLabel: '',
      timeLabel: '',
      startTime: '',
      endTime: '',
      timingConfidence: 'low',
      timingSource: '',
      locationDetail: '',
      descriptionPreview: '',
      photoUrls: [],
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
        saleDateKeys: [],
        saleDateLabels: [],
        dayLabel: '',
        timeLabel: '',
        startTime: '',
        endTime: '',
        timingConfidence: 'low',
        locationDetail: '',
        descriptionPreview: '',
      };
      postingPageDetailCache.set(postingUrl, fallback);
      return fallback;
    }

    const html = String(response.data || '');
    const $ = cheerio.load(html);
    const parsedMapAddress = parseMapAddressFromPage($, html);
    const bodyText = extractPostingBodyText($);
    const attributeText = extractCraigslistAttributeText($);
    const locationDetail = extractLocationDetailFromPostingBody(bodyText);
    const descriptionPreview =
      extractDescriptionPreviewFromPostingBody(bodyText);
    const photoUrls = extractPhotoUrlsFromPostingPage($, html);
    const timing = extractTimingDetailsFromPosting({
      title: $('title').first().text() || '',
      bodyText: [attributeText, bodyText].filter(Boolean).join('\n'),
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
      locationDetail,
      descriptionPreview,
      photoUrls,
      saleDate: timing.saleDateLabel,
      saleDateTime: timing.saleDate ? timing.saleDate.toISOString() : '',
      saleDateKeys: Array.isArray(timing.saleDateKeys) ? timing.saleDateKeys : [],
      saleDateLabels: Array.isArray(timing.saleDateLabels) ? timing.saleDateLabels : [],
      dayLabel: timing.dayLabel,
      timeLabel: timing.timeLabel,
      startTime: timing.startTime,
      endTime: timing.endTime,
      timingConfidence: timing.timingConfidence,
      timingSource: timing.timingSource || '',
      timePattern: timing.timePattern || '',
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
      saleDateKeys: [],
      saleDateLabels: [],
      dayLabel: '',
      timeLabel: '',
      startTime: '',
      endTime: '',
      timingConfidence: 'low',
      timingSource: '',
      locationDetail: '',
      descriptionPreview: '',
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

function detectCraigslistSaleType({ title, metaText, hood, bodyText }) {
  const haystack = [title, metaText, hood, bodyText]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const blockedPatterns = [
    /\bbmw\b/,
    /\bmercedes\b/,
    /\btoyota\b/,
    /\bhonda\b/,
    /\bford\b/,
    /\bchevy\b/,
    /\bvehicle\b/,
    /\bcar\b/,
    /\btruck\b/,
    /\bmotorcycle\b/,
    /\bstorage\s+unit\b/,
    /\bauction\b/,
    /\bapartment\b/,
    /\brental\b/,
  ];

  if (blockedPatterns.some((pattern) => pattern.test(haystack))) {
    return 'blocked';
  }

  if (/\bestate\b|estate sale|estate liquidation|estate tag sale/.test(haystack)) {
    return 'estate';
  }

  if (/\bmoving\b|moving sale|move out|must go|relocation/.test(haystack)) {
    return 'moving';
  }

  if (
    /yard sale|garage sale|rummage sale|flea market|multi\s*family sale|multi-family sale|community garage sale|subdivision sale|tag sale|church sale|block sale/.test(
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

  const titleKey = normalizeSaleTitleForDedupe(sale?.title).slice(0, 80);
  const dateKey = String(sale?.saleDate || sale?.dayLabel || '').toLowerCase();

  return `${coordKey}|${addressKey}|${titleKey}|${dateKey}`;
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
    if (sale?.saleScore) total += Number(sale.saleScore) / 10;
    if (Array.isArray(sale?.itemsMentioned))
      total += Math.min(4, sale.itemsMentioned.length);
    if (sale?.timeLabel) total += 2;
    if (sale?.descriptionPreview) total += 2;
    total += Math.max(0, 120 - (String(sale?.title || '').length || 0)) / 120;
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
  searchRadiusMiles,
  day,
  postal,
}) {
  const baseUrl = `https://${area}.craigslist.org`;
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const dayAfterTomorrow = new Date(today);
  dayAfterTomorrow.setDate(today.getDate() + 2);
  const normalizedTargetDay =
    day === 'today' || day === 'tomorrow' || day === 'dayaftertomorrow'
      ? day
      : null;
  const targetDate =
    normalizedTargetDay === 'dayaftertomorrow'
      ? dayAfterTomorrow
      : normalizedTargetDay === 'tomorrow'
        ? tomorrow
        : normalizedTargetDay === 'today'
          ? today
          : null;
  const targetDateKey = targetDate ? dateKeyFromDate(targetDate) : '';

  const postalCode = normalizePostalCode(postal) || inferPostalFromCoords(latitude, longitude);

  // Craigslist radius is not perfectly aligned with exact map/geocode distance.
  // For sourcing, missing a good estate sale is worse than showing an extra
  // nearby listing, so overfetch modestly and let the app sort hyper-local
  // results first. This catches listings like Carillon Lakes / Crest Hill that
  // Craigslist shows in the user's 60565 view but exact geocoding may place
  // outside a strict 10-mile circle.
  const requestedRadius = Math.max(1, Math.min(Number(radiusMiles) || 25, 50));
  const craigslistRadius = Math.max(
    requestedRadius,
    Math.min(Number(searchRadiusMiles) || requestedRadius, 50),
  );

  const baseQuery = new URLSearchParams({
    search_distance: String(craigslistRadius || 25),
    sort: 'date',
  });

  if (postalCode) {
    // Postal searches match Craigslist's own UI much better than lat/lon searches
    // and prevent valid listings from disappearing.
    baseQuery.set('postal', postalCode);
  } else if (Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))) {
    baseQuery.set('lat', String(latitude));
    baseQuery.set('lon', String(longitude));
  }

  function buildSearchUrl(extraParams = {}) {
    const query = new URLSearchParams(baseQuery.toString());
    Object.entries(extraParams).forEach(([key, value]) => {
      if (value !== null && value !== undefined && String(value).trim()) {
        query.set(key, String(value));
      }
    });
    return `${baseUrl}/search/gms?${query.toString()}`;
  }

  const searchUrls = [];
  const addSearchUrl = (candidateUrl) => {
    if (candidateUrl && !searchUrls.includes(candidateUrl)) searchUrls.push(candidateUrl);
  };

  // Pull more than one Craigslist view. The normal upcoming page sometimes omits
  // rows that appear when the calendar/day view is active, and vice versa.
  addSearchUrl(buildSearchUrl());
  if (normalizedTargetDay) addSearchUrl(buildSearchUrl({ sale_date: normalizedTargetDay }));
  if (targetDateKey) addSearchUrl(buildSearchUrl({ sale_date: targetDateKey }));

  // Craigslist's plain gms page can still miss/reshuffle some estate and moving
  // sale rows. Add focused category searches so high-value sourcing sales are
  // not lost when the generic page changes its grouping or calendar view.
  ['estate sale', 'moving sale', 'garage sale', 'yard sale'].forEach((query) => {
    addSearchUrl(buildSearchUrl({ query }));
    if (targetDateKey) addSearchUrl(buildSearchUrl({ query, sale_date: targetDateKey }));
  });

  const craigslistHeaders = {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: baseUrl,
    DNT: '1',
    Connection: 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
  };

  const pageResults = await Promise.all(
    searchUrls.map(async (searchUrl) => {
      try {
        const response = await axios.get(searchUrl, {
          timeout: 20000,
          validateStatus: () => true,
          headers: craigslistHeaders,
        });

        if (response.status >= 400) {
          return { searchUrl, html: '', error: `Craigslist responded with status ${response.status}` };
        }

        const html = String(response.data || '');
        if (!html || html.trim().startsWith('{')) {
          return { searchUrl, html: '', error: 'Craigslist HTML was not returned.' };
        }

        return { searchUrl, html, error: '' };
      } catch (error) {
        return { searchUrl, html: '', error: error?.message || 'Craigslist request failed' };
      }
    }),
  );

  const goodPages = pageResults.filter((page) => page.html);
  if (!goodPages.length) {
    throw new Error(pageResults.map((page) => page.error).filter(Boolean).join(' | ') || 'Craigslist HTML was not returned.');
  }

  const rowEntries = [];
  const seenPostingUrlsFromSearch = new Set();

  for (const page of goodPages) {
    const page$ = cheerio.load(page.html);
    const pageRows = page$(
      '.cl-search-result, .result-row, li.cl-static-search-result, li.result-row, .gallery-card',
    ).toArray();

    pageRows.forEach((node) => {
      const $row = page$(node);
      const href = $row
        .find('.result-title, .posting-title, .title, a')
        .first()
        .attr('href');
      const postingUrl = parsePostingUrl(href, baseUrl);
      const title =
        $row.find('.result-title, .posting-title, .title').first().text().trim() ||
        $row.find('a').first().text().trim();
      const fallbackKey = `${title}|${$row.text().replace(/\s+/g, ' ').trim().slice(0, 160)}`;
      const searchKey = postingUrl || fallbackKey;

      if (searchKey && seenPostingUrlsFromSearch.has(searchKey)) return;
      if (searchKey) seenPostingUrlsFromSearch.add(searchKey);

      rowEntries.push({ $: page$, node, searchUrl: page.searchUrl });
    });
  }

  const rows = rowEntries;
  const resolvedSales = await Promise.all(
    rows.map(async (rowEntry, index) => {
      const page$ = rowEntry.$;
      const $row = page$(rowEntry.node);
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

      // Important: Craigslist's <time> on the search row is usually the POSTED date,
      // not the sale date. Do not filter on it or good multi-day sales disappear.

      const rowGeo = parseGeoFromRow($row);
      const rowHasUsableGeo = isUsableCoordinatePair(
        rowGeo.latitude,
        rowGeo.longitude,
      );
      const pageDetails = await fetchPostingPageDetails(postingUrl, baseUrl);
      const rowSaleDateKeys = saleDateKeysFromSearchRow(
        { title, metaText, hood, dateText },
        new Date(),
      );
      const detailSaleDateKeys = Array.isArray(pageDetails.saleDateKeys)
        ? pageDetails.saleDateKeys.filter(Boolean)
        : [];
      // Use BOTH the Craigslist search-row date chips and the posting page dates.
      // The search row is often the most reliable source for multi-day listings
      // like "5/1, 5/2", while the posting body is better for times/addresses.
      const saleDateKeys = uniqueDateKeysList([
        ...rowSaleDateKeys,
        ...detailSaleDateKeys,
      ]);
      if (targetDateKey && saleDateKeys.length && !saleDateKeys.includes(targetDateKey)) {
        return null;
      }
      const selectedSaleDateKey =
        targetDateKey && saleDateKeys.includes(targetDateKey)
          ? targetDateKey
          : saleDateKeys[0] || '';
      const selectedSaleDateLabel =
        selectedSaleDateKey ? formatSaleDateKeyLabel(selectedSaleDateKey) : '';
      const selectedDayLabel =
        targetDateKey && selectedSaleDateKey === targetDateKey && normalizedTargetDay
          ? normalizedTargetDay === 'dayaftertomorrow'
            ? '2 Days Out'
            : normalizedTargetDay === 'tomorrow'
              ? 'Tomorrow'
              : 'Today'
          : selectedSaleDateKey
            ? formatSaleDateKeyDayLabel(selectedSaleDateKey)
            : '';
      const targetSpecificTiming = selectedSaleDateKey
        ? extractTimeForDateKeyFromText(
            [pageDetails.bodyText, title, metaText].filter(Boolean).join('\n'),
            selectedSaleDateKey,
            new Date(),
          )
        : null;
      const selectedTimeLabel =
        cleanAddressFragment(targetSpecificTiming?.timeLabel) ||
        cleanAddressFragment(pageDetails.timeLabel) ||
        '';
      const selectedStartTime =
        cleanAddressFragment(targetSpecificTiming?.startTime) ||
        cleanAddressFragment(pageDetails.startTime) ||
        '';
      const selectedEndTime =
        cleanAddressFragment(targetSpecificTiming?.endTime) ||
        cleanAddressFragment(pageDetails.endTime) ||
        '';
      const selectedTimePattern =
        cleanAddressFragment(targetSpecificTiming?.timePattern) ||
        cleanAddressFragment(pageDetails.timePattern) ||
        '';
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
      const geocodeCandidates = [
        ...buildGeocodeCandidates({
          mapAddress: pageDetails.mapAddress,
          addressLabel: resolvedAddressLabel,
          hood,
          title,
        }),
        cleanAddressFragment(pageDetails.locationDetail),
      ].filter(Boolean);
      const cityFallbackGeo = getFallbackCoordinatesForSale({
        city: '',
        hood,
        title,
        mapAddress: pageDetails.mapAddress,
        approximateAddress: '',
        addressLabel: resolvedAddressLabel,
        bodyText: pageDetails.bodyText,
        locationDetail: pageDetails.locationDetail,
      });
      const approximateGeo = !isUsableCoordinatePair(
        exactGeo.latitude,
        exactGeo.longitude,
      )
        ? (await geocodeWithFallbacks(geocodeCandidates, area))
        : { latitude: null, longitude: null, approximateAddress: '' };
      if (
        !isUsableCoordinatePair(approximateGeo.latitude, approximateGeo.longitude) &&
        cityFallbackGeo
      ) {
        approximateGeo.latitude = cityFallbackGeo.latitude;
        approximateGeo.longitude = cityFallbackGeo.longitude;
        approximateGeo.approximateAddress = cityFallbackGeo.label;
      }
      const hasExactCoordinates = isUsableCoordinatePair(
        exactGeo.latitude,
        exactGeo.longitude,
      );
      let hasApproximateCoordinates = isUsableCoordinatePair(
        approximateGeo.latitude,
        approximateGeo.longitude,
      );
      let geo = hasExactCoordinates
        ? exactGeo
        : hasApproximateCoordinates
          ? {
              latitude: approximateGeo.latitude,
              longitude: approximateGeo.longitude,
            }
          : { latitude: null, longitude: null };
      let milesAway = distanceMiles(
        latitude,
        longitude,
        geo.latitude,
        geo.longitude,
      );
      let distanceLabel = hasExactCoordinates
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
        bodyText: pageDetails.bodyText,
        locationDetail: pageDetails.locationDetail,
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
      const saleType = detectCraigslistSaleType({
        title,
        metaText,
        hood,
        bodyText: pageDetails.bodyText,
      });
      if (saleType === 'blocked') {
        return null;
      }
      const saleLabel =
        saleType === 'estate'
          ? 'Estate Sale'
          : saleType === 'moving'
            ? 'Moving Sale'
            : 'Garage/Yard Sale';
      const rawNotes =
        [metaText, price].filter(Boolean).join(' • ') ||
        `${saleLabel} listing from Craigslist`;
      const notes =
        !hasExactCoordinates && hasApproximateCoordinates
          ? `${rawNotes} • Approximate location from listing area.`
          : rawNotes;
      const locationDetail = cleanGarageSaleDetailText(
        pageDetails.locationDetail,
      );
      const bodyPreview = limitGarageSaleDetailText(pageDetails.bodyText, 500);
      const descriptionPreview =
        cleanGarageSaleDetailText(pageDetails.descriptionPreview) ||
        buildFallbackDescriptionPreview(pageDetails.bodyText, notes);
      const fullLocationText = buildFullLocationText({
        locationDetail,
        displayAddress:
          finalAddress.displayAddress || finalAddress.addressLabel,
        mapAddress: finalAddress.mapAddress,
        city: finalAddress.city,
        state: finalAddress.state,
      });
      const qualityScanText = [
        title,
        metaText,
        notes,
        pageDetails.bodyText,
        descriptionPreview,
        fullLocationText,
      ]
        .filter(Boolean)
        .join(' ');
      const itemData = extractMentionedItemsFromText(qualityScanText);
      const warningFlags = extractWarningFlagsFromText(qualityScanText);
      const locationConfidence = calculateLocationConfidence({
        hasExactCoordinates,
        hasApproximateCoordinates,
        geoSource: hasExactCoordinates
          ? rowHasUsableGeo
            ? 'search_row'
            : pageHasUsableGeo
              ? 'posting_page'
              : 'unknown'
          : hasApproximateCoordinates
            ? 'geocoder'
            : 'none',
        street: finalAddress.street,
        crossStreet: finalAddress.crossStreet,
        city: finalAddress.city,
        zip: finalAddress.zip,
        mapsQuery: finalAddress.mapsQuery,
      });
      const timeConfidence = calculateTimeConfidence({
        saleDate:
          selectedSaleDateLabel ||
          cleanAddressFragment(pageDetails.saleDate) ||
          (dateText ? parseCraigslistDate(dateText, normalizedTargetDay) : ''),
        dayLabel:
          selectedDayLabel ||
          cleanAddressFragment(pageDetails.dayLabel) ||
          (normalizedTargetDay
            ? normalizedTargetDay === 'dayaftertomorrow'
              ? '2 Days Out'
              : normalizedTargetDay === 'tomorrow'
                ? 'Tomorrow'
                : 'Today'
            : ''),
        timeLabel: selectedTimeLabel,
        startTime: selectedStartTime,
        endTime: selectedEndTime,
        timingConfidence: pageDetails.timingConfidence,
      });
      const saleScoreData = calculateSaleScore({
        title,
        saleType,
        bodyText: pageDetails.bodyText,
        descriptionPreview,
        locationConfidence,
        timeConfidence,
        itemCategories: itemData.itemCategories,
        warningFlags,
        distanceMiles: milesAway,
      });
      const helpfulSummaryParts = [
        saleScoreData.label ? `${saleScoreData.label} sale` : '',
        itemData.bestItems.length
          ? `Best mentions: ${itemData.bestItems.slice(0, 5).join(', ')}`
          : '',
        selectedTimeLabel ? `Time: ${selectedTimeLabel}` : '',
        fullLocationText ? `Location: ${fullLocationText}` : '',
      ].filter(Boolean);
      const helpfulSummary = helpfulSummaryParts.join(' • ');

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
        displayAddress:
          finalAddress.displayAddress || finalAddress.addressLabel,
        fullLocationText,
        locationNote: locationDetail,
        descriptionPreview,
        bodyPreview,
        helpfulSummary,
        photoUrls: Array.isArray(pageDetails.photoUrls)
          ? pageDetails.photoUrls
          : [],
        itemsMentioned: itemData.itemsMentioned,
        bestItems: itemData.bestItems,
        itemCategories: itemData.itemCategories,
        warningFlags,
        locationConfidence: locationConfidence.label,
        locationConfidenceScore: locationConfidence.score,
        locationConfidenceReasons: locationConfidence.reasons,
        timeConfidence: timeConfidence.label,
        timeConfidenceScore: timeConfidence.score,
        timeConfidenceReasons: timeConfidence.reasons,
        saleScore: saleScoreData.score,
        saleScoreLabel: saleScoreData.label,
        saleScoreReasons: saleScoreData.reasons,
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
          selectedSaleDateLabel ||
          cleanAddressFragment(pageDetails.saleDate) ||
          (dateText ? parseCraigslistDate(dateText, normalizedTargetDay) : ''),
        saleDateTime: pageDetails.saleDateTime || '',
        saleDateKeys,
        saleDateLabels: saleDateKeys.map(formatSaleDateKeyLabel),
        startTime: selectedStartTime,
        endTime: selectedEndTime,
        timeLabel: selectedTimeLabel,
        dayLabel:
          selectedDayLabel ||
          cleanAddressFragment(pageDetails.dayLabel) ||
          (normalizedTargetDay
            ? normalizedTargetDay === 'dayaftertomorrow'
              ? '2 Days Out'
              : normalizedTargetDay === 'tomorrow'
                ? 'Tomorrow'
                : 'Today'
            : ''),
        timingConfidence:
          pageDetails.timingConfidence ||
          (cleanAddressFragment(pageDetails.saleDate) ? 'high' : 'low'),
        timePattern: selectedTimePattern,
        isProbableSale:
          !cleanAddressFragment(pageDetails.saleDate) &&
          !cleanAddressFragment(pageDetails.dayLabel) &&
          !cleanAddressFragment(pageDetails.timeLabel),
        notes,
        query: `${title} ${finalAddress.addressLabel}`.trim(),
        mapsQuery: finalAddress.mapsQuery,
        pinColor:
          saleType === 'estate'
            ? '#7c3aed'
            : saleType === 'moving'
              ? '#ea580c'
              : '#2563eb',
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
    const aScore = Number.isFinite(Number(a.saleScore))
      ? Number(a.saleScore)
      : 0;
    const bScore = Number.isFinite(Number(b.saleScore))
      ? Number(b.saleScore)
      : 0;
    if (bScore !== aScore) return bScore - aScore;

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
    withLocationDetail: sales.filter((sale) => sale.locationNote).length,
    withDescriptionPreview: sales.filter((sale) => sale.descriptionPreview)
      .length,
    withItemsMentioned: sales.filter(
      (sale) =>
        Array.isArray(sale.itemsMentioned) && sale.itemsMentioned.length,
    ).length,
    withHighLocationConfidence: sales.filter(
      (sale) => sale.locationConfidence === 'high',
    ).length,
    withHighTimeConfidence: sales.filter(
      (sale) => sale.timeConfidence === 'high',
    ).length,
    averageSaleScore: sales.length
      ? Math.round(
          sales.reduce(
            (total, sale) => total + (Number(sale.saleScore) || 0),
            0,
          ) / sales.length,
        )
      : 0,
    deduped: Math.max(0, salesBeforeDedupe.length - sales.length),
    returned: sales.length,
  };

  return { sales, sourceUrl: searchUrls[0], sourceUrls: searchUrls, diagnostics };
}

async function handleGarageSales(req, res) {
  try {
    const latitude = Number(req.query.latitude);
    const longitude = Number(req.query.longitude);
    const radiusMiles = Math.max(
      1,
      Math.min(Number(req.query.radiusMiles) || 25, 50),
    );
    const searchRadiusMiles = Math.max(
      radiusMiles,
      Math.min(
        Number(req.query.searchRadiusMiles || req.query.craigslistRadiusMiles) ||
          (radiusMiles <= 10 ? 25 : radiusMiles <= 25 ? 35 : radiusMiles),
        50,
      ),
    );
    const postal = normalizePostalCode(
      req.query.postal || req.query.zip || req.query.postalCode || '',
    );
    const rawDay = String(req.query.day || '').toLowerCase().trim();
    const day =
      rawDay === 'dayaftertomorrow' ||
      rawDay === 'day-after-tomorrow' ||
      rawDay === '2daysout' ||
      rawDay === 'two-days-out'
        ? 'dayaftertomorrow'
        : rawDay === 'tomorrow'
          ? 'tomorrow'
          : rawDay === 'today'
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
      searchRadiusMiles,
      day,
      postal,
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
      searchRadiusMiles,
      postal: postal || inferPostalFromCoords(latitude, longitude),
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
