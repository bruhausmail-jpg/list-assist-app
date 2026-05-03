const express = require('express');
const axios = require('axios');

const router = express.Router();

const ESTATE_ROUTE_VERSION = 'source-assist-no-zip-sweep-v5-user-radius-only';

const ESTATE_SALES_ZIPS = []; // disabled: single user ZIP/radius search only
const REQUEST_TIMEOUT_MS = 15000;
const MAX_RESULTS = 100;
const DETAIL_FETCH_DELAY_MS = 700;
const MAX_DETAIL_FETCHES = 40;
const ESTATE_SALES_ZIP_SEARCH_BUFFER_MILES = 18;
const ZIP_FETCH_CONCURRENCY = 4;
const DETAIL_FETCH_CONCURRENCY = 6;
const DETAIL_ENRICH_TARGET_COUNT = 60;

const ZIP_CENTER_COORDS = {}; // disabled: no broad ZIP center sweep

const detailPageCache = new Map();
const estateSalesSearchCache = new Map();
const ESTATE_SALES_CACHE_TTL_MS = 10 * 60 * 1000;

function normalizeRequestedOriginCoordinate(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Number(parsed.toFixed(4));
}

function buildEstateSalesCacheKey(requestedDay = '', searchZips = []) {
  const normalizedDay = normalizeRequestedDay(requestedDay) || 'all-days';
  const zipSignature =
    Array.isArray(searchZips) && searchZips.length
      ? String(searchZips[0] || '60565')
      : '60565';

  return `${ESTATE_ROUTE_VERSION}__${normalizedDay}__${zipSignature}`;
}

function getCachedEstateSalesPool(requestedDay = '', searchZips = []) {
  const cacheKey = buildEstateSalesCacheKey(requestedDay, searchZips);
  const cached = estateSalesSearchCache.get(cacheKey);

  if (!cached) return null;
  if (Date.now() - cached.timestamp > ESTATE_SALES_CACHE_TTL_MS) {
    estateSalesSearchCache.delete(cacheKey);
    return null;
  }

  return Array.isArray(cached.sales)
    ? cached.sales.map((sale) => ({ ...sale }))
    : null;
}

function setCachedEstateSalesPool(
  requestedDay = '',
  searchZips = [],
  sales = [],
) {
  const cacheKey = buildEstateSalesCacheKey(requestedDay, searchZips);
  estateSalesSearchCache.set(cacheKey, {
    timestamp: Date.now(),
    sales: Array.isArray(sales) ? sales.map((sale) => ({ ...sale })) : [],
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapWithConcurrency(items = [], concurrency = 4, worker) {
  const safeItems = Array.isArray(items) ? items : [];
  const safeConcurrency = Math.max(1, Number(concurrency) || 1);
  const results = new Array(safeItems.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < safeItems.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(
        safeItems[currentIndex],
        currentIndex,
      );
    }
  }

  const workers = Array.from(
    { length: Math.min(safeConcurrency, safeItems.length) },
    () => runWorker(),
  );

  await Promise.all(workers);
  return results;
}

function stripHtml(value = '') {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeText(value = '') {
  return stripHtml(value).toLowerCase();
}

function decodeUrlPath(path = '') {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function makeStableId(url = '') {
  return `es-${Buffer.from(url).toString('base64').replace(/=/g, '')}`;
}

function extractLocationFromUrl(url = '') {
  const match = url.match(/\/IL\/([^/]+)\/(\d{5})\/(\d+)/i);

  if (!match) {
    return {
      city: '',
      state: 'IL',
      zip: '',
      sourceListingId: '',
    };
  }

  const rawCity = match[1] || '';
  const parsedZip = match[2] || '';
  const sourceListingId = match[3] || '';

  const city = rawCity
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');

  return {
    city,
    state: 'IL',
    zip: parsedZip,
    sourceListingId,
  };
}

function extractTitle(snippet = '', absoluteUrl = '') {
  const h3Match = snippet.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
  if (h3Match) {
    const title = stripHtml(h3Match[1]);
    if (title) return title;
  }

  const titleAttrMatch = snippet.match(/title="([^"]+)"/i);
  if (titleAttrMatch) {
    const title = stripHtml(titleAttrMatch[1]);
    if (title) return title;
  }

  const urlLocation = extractLocationFromUrl(absoluteUrl);
  if (urlLocation.city) {
    return `Estate Sale - ${urlLocation.city}`;
  }

  return 'Estate Sale';
}

function extractStatusText(snippet = '') {
  const text = stripHtml(snippet);

  const patterns = [
    /sale is over/i,
    /going on now/i,
    /starts today/i,
    /starts tomorrow/i,
    /starts in \d+ day(?:s)?/i,
    /\d+\s+day(?:s)?\s+away/i,
    /today/i,
    /tomorrow/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0];
  }

  return '';
}

function extractDateText(snippet = '') {
  const text = stripHtml(snippet);

  const patterns = [
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:\s*-\s*\d{1,2})?(?:,\s*\d{4})?/i,
    /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?(?:\s*-\s*\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)?/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0];
  }

  return '';
}

function extractCompany(snippet = '') {
  const text = stripHtml(snippet);

  const patterns = [
    /by\s+([A-Z0-9][A-Za-z0-9 '&,.\-]{2,80})/,
    /company[:\s]+([A-Z0-9][A-Za-z0-9 '&,.\-]{2,80})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return '';
}

function extractImageCount(snippet = '') {
  const text = stripHtml(snippet);
  const match = text.match(/(\d+)\s+photos?/i);
  return match ? Number(match[1]) : 0;
}

function extractDistanceMiles(snippet = '') {
  const text = stripHtml(snippet);
  const match = text.match(/(\d+(?:\.\d+)?)\s*miles?/i);
  return match ? Number(match[1]) : null;
}

function inferSaleType(title = '', snippet = '') {
  const text = `${title} ${stripHtml(snippet)}`.toLowerCase();

  if (text.includes('tag sale')) return 'tag-sale';
  if (text.includes('garage sale')) return 'garage-sale';
  if (text.includes('yard sale')) return 'yard-sale';
  if (text.includes('moving sale')) return 'moving-sale';
  if (text.includes('estate sale')) return 'estate-sale';

  return 'sale';
}

function addDeterministicJitter(baseValue, seed, spread = 0.012) {
  const hash = Array.from(String(seed || 'seed')).reduce(
    (acc, ch) => acc + ch.charCodeAt(0),
    0,
  );
  const normalized = (hash % 1000) / 999 - 0.5;
  return Number((baseValue + normalized * spread).toFixed(6));
}

function buildZipFallbackCoordinates(_zip = '', _seed = '') {
  // Disabled with the ZIP sweep. Detail-page coordinates are still used when
  // EstateSales.net exposes them.
  return null;
}

function isCurrentOrUpcoming(snippet = '') {
  const text = normalizeText(snippet);

  if (!text) return false;
  if (/sale\s+is\s+over/.test(text)) return false;

  const positiveSignals = [
    /going on now/,
    /starts today/,
    /starts tomorrow/,
    /starts in \d+ day/,
    /\b\d+\s+days?\s+away\b/,
    /\btoday\b/,
    /\btomorrow\b/,
    /\bthu(?:rsday)?\b/,
    /\bfri(?:day)?\b/,
    /\bsat(?:urday)?\b/,
    /\bsun(?:day)?\b/,
    /\bmon(?:day)?\b/,
    /\btue(?:sday)?\b/,
    /\bwed(?:nesday)?\b/,
  ];

  return positiveSignals.some((pattern) => pattern.test(text));
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function htmlDecode(value = '') {
  return String(value)
    .replace(/\\u0026/g, '&')
    .replace(/\\\//g, '/')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim();
}

function normalizeAddressLine(value = '') {
  return String(value)
    .replace(/\s+/g, ' ')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .trim();
}

function buildAddressLabel(parts = {}) {
  const street = normalizeAddressLine(parts.street || '');
  const city = normalizeAddressLine(parts.city || '');
  const state = normalizeAddressLine(parts.state || '');
  const zip = normalizeAddressLine(parts.zip || '');

  const locality = [city, state].filter(Boolean).join(', ');
  const tail = [locality, zip].filter(Boolean).join(locality && zip ? ' ' : '');
  return [street, tail].filter(Boolean).join(', ');
}

function extractCoordinatesFromHtml(html = '') {
  const patterns = [
    {
      regex:
        /"latitude"\s*:\s*"?(-?\d{1,3}\.\d+)"?[\s\S]*?"longitude"\s*:\s*"?(-?\d{1,3}\.\d+)"?/i,
      order: 'lat-lng',
    },
    {
      regex:
        /"longitude"\s*:\s*"?(-?\d{1,3}\.\d+)"?[\s\S]*?"latitude"\s*:\s*"?(-?\d{1,3}\.\d+)"?/i,
      order: 'lng-lat',
    },
    {
      regex:
        /lat(?:itude)?\s*[:=]\s*(-?\d{1,3}\.\d+)[\s\S]{0,80}?(?:lng|lon|longitude)\s*[:=]\s*(-?\d{1,3}\.\d+)/i,
      order: 'lat-lng',
    },
    {
      regex:
        /(?:lng|lon|longitude)\s*[:=]\s*(-?\d{1,3}\.\d+)[\s\S]{0,80}?lat(?:itude)?\s*[:=]\s*(-?\d{1,3}\.\d+)/i,
      order: 'lng-lat',
    },
    {
      regex:
        /data-lat(?:itude)?="(-?\d{1,3}\.\d+)"[\s\S]{0,120}?(?:data-lng|data-lon(?:gitude)?)="(-?\d{1,3}\.\d+)"/i,
      order: 'lat-lng',
    },
    {
      regex:
        /(?:data-lng|data-lon(?:gitude)?)="(-?\d{1,3}\.\d+)"[\s\S]{0,120}?data-lat(?:itude)?="(-?\d{1,3}\.\d+)"/i,
      order: 'lng-lat',
    },
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern.regex);
    if (!match) continue;

    const latitude = Number(pattern.order === 'lat-lng' ? match[1] : match[2]);
    const longitude = Number(pattern.order === 'lat-lng' ? match[2] : match[1]);

    if (
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      Math.abs(latitude) <= 90 &&
      Math.abs(longitude) <= 180
    ) {
      return { latitude, longitude };
    }
  }

  return null;
}

function extractAddressFromJsonLdObject(obj) {
  if (!obj || typeof obj !== 'object') return null;

  const address = obj.address || obj.location?.address;
  if (!address || typeof address !== 'object') return null;

  const street = normalizeAddressLine(address.streetAddress || '');
  const city = normalizeAddressLine(address.addressLocality || '');
  const state = normalizeAddressLine(address.addressRegion || 'IL');
  const zip = normalizeAddressLine(address.postalCode || '');
  const addressLabel = buildAddressLabel({ street, city, state, zip });

  if (!addressLabel) return null;

  return {
    street,
    city,
    state,
    zip,
    addressLabel,
  };
}

function extractAddressFromJsonLd(html = '') {
  const scriptMatches = [
    ...html.matchAll(
      /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];

  for (const match of scriptMatches) {
    const rawJson = htmlDecode(match[1] || '');
    const parsed = safeJsonParse(rawJson);
    if (!parsed) continue;

    const candidates = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed['@graph'])
        ? parsed['@graph']
        : [parsed];

    for (const candidate of candidates) {
      const extracted = extractAddressFromJsonLdObject(candidate);
      if (extracted) return extracted;
    }
  }

  return null;
}

function extractScheduleFromJsonLdObject(obj) {
  if (!obj || typeof obj !== 'object') return null;

  const candidates = [];

  if (obj.startDate || obj.endDate) {
    candidates.push(obj);
  }

  if (obj.eventSchedule && typeof obj.eventSchedule === 'object') {
    candidates.push(obj.eventSchedule);
  }

  if (Array.isArray(obj.subEvent)) {
    candidates.push(...obj.subEvent);
  }

  if (obj.location && typeof obj.location === 'object') {
    if (obj.location.startDate || obj.location.endDate) {
      candidates.push(obj.location);
    }
  }

  const scheduleEntries = [];

  for (const candidate of candidates) {
    const startRaw = String(candidate?.startDate || '').trim();
    const endRaw = String(candidate?.endDate || '').trim();
    if (!startRaw) continue;

    const start = new Date(startRaw);
    if (Number.isNaN(start.getTime())) continue;

    const end = endRaw ? new Date(endRaw) : null;
    const weekday = normalizeWeekdayLabel(
      start.toLocaleDateString('en-US', { weekday: 'long' }),
    );
    const dateLabel = start.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    const startTime = normalizeClockLabel(
      start.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }),
    );
    const endTime =
      end && !Number.isNaN(end.getTime())
        ? normalizeClockLabel(
            end.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
            }),
          )
        : '';

    scheduleEntries.push({
      dayLabel: weekday,
      dateLabel,
      timeLabel: endTime ? `${startTime} to ${endTime}` : startTime,
      startTime,
      endTime,
      startDate: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`,
      startDateTime: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}T${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}:00`,
      sortTimestamp: start.getTime(),
    });
  }

  if (!scheduleEntries.length) return null;

  scheduleEntries.sort((a, b) => a.sortTimestamp - b.sortTimestamp);
  const primary = scheduleEntries[0];
  const dateText = scheduleEntries
    .map((entry) =>
      [entry.dayLabel, entry.dateLabel, entry.timeLabel]
        .filter(Boolean)
        .join(' • '),
    )
    .filter(Boolean)
    .slice(0, 2)
    .join(' | ');

  return {
    dayLabel: primary.dayLabel || '',
    dateLabel: primary.dateLabel || '',
    timeLabel: stripLeadingWeekdayFromTime(primary.timeLabel || ''),
    startTime: primary.startTime || '',
    endTime: primary.endTime || '',
    startDate: primary.startDate || '',
    startDateTime: primary.startDateTime || '',
    dateText: dateText || primary.dateLabel || '',
    scheduleEntries,
  };
}

function extractScheduleFromJsonLd(html = '') {
  const scriptMatches = [
    ...html.matchAll(
      /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];

  for (const match of scriptMatches) {
    const rawJson = htmlDecode(match[1] || '');
    const parsed = safeJsonParse(rawJson);
    if (!parsed) continue;

    const candidates = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed['@graph'])
        ? parsed['@graph']
        : [parsed];

    for (const candidate of candidates) {
      const extracted = extractScheduleFromJsonLdObject(candidate);
      if (extracted) return extracted;
    }
  }

  return null;
}

function extractAddressFromInlineJson(html = '', fallbackLocation = {}) {
  const patterns = [
    /"streetAddress"\s*:\s*"([^"]+)"[\s\S]{0,500}?"addressLocality"\s*:\s*"([^"]+)"[\s\S]{0,200}?"addressRegion"\s*:\s*"([^"]{2})"[\s\S]{0,200}?"postalCode"\s*:\s*"(\d{5})"/i,
    /"address1"\s*:\s*"([^"]+)"[\s\S]{0,500}?"city"\s*:\s*"([^"]+)"[\s\S]{0,200}?"state"\s*:\s*"([^"]{2})"[\s\S]{0,200}?"zip"\s*:\s*"(\d{5})"/i,
    /"address"\s*:\s*\{[\s\S]{0,500}?"street"\s*:\s*"([^"]+)"[\s\S]{0,250}?"city"\s*:\s*"([^"]+)"[\s\S]{0,150}?"state"\s*:\s*"([^"]{2})"[\s\S]{0,150}?"zip"\s*:\s*"(\d{5})"/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;

    const street = normalizeAddressLine(match[1] || '');
    const city = normalizeAddressLine(match[2] || fallbackLocation.city || '');
    const state = normalizeAddressLine(
      match[3] || fallbackLocation.state || 'IL',
    );
    const zip = normalizeAddressLine(match[4] || fallbackLocation.zip || '');
    const addressLabel = buildAddressLabel({ street, city, state, zip });

    if (!addressLabel) continue;

    return { street, city, state, zip, addressLabel };
  }

  return null;
}

function extractMetaTagValue(html = '', attributeName = '') {
  if (!html || !attributeName) return '';

  const metaMatches = html.match(/<meta[^>]+>/gi) || [];

  for (const tag of metaMatches) {
    const nameMatch = tag.match(/(?:property|name|itemprop)="([^"]+)"/i);
    const contentMatch = tag.match(/content="([^"]+)"/i);
    if (!nameMatch?.[1] || !contentMatch?.[1]) continue;

    const normalizedName = String(nameMatch[1]).trim().toLowerCase();
    if (normalizedName !== String(attributeName).trim().toLowerCase()) continue;

    return normalizeAddressLine(contentMatch[1]);
  }

  return '';
}

function extractMetaContent(html = '', patterns = []) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return normalizeAddressLine(match[1]);
    }
  }

  return '';
}

function extractAddressFromMeta(html = '') {
  const street =
    extractMetaTagValue(html, 'og:street-address') ||
    extractMetaTagValue(html, 'street-address') ||
    extractMetaTagValue(html, 'streetAddress') ||
    extractMetaTagValue(html, 'address.street') ||
    extractMetaContent(html, [
      /(?:streetAddress|street-address)"?\s*[:=]\s*"([^"]+)"/i,
    ]) ||
    '';

  const city =
    extractMetaTagValue(html, 'og:locality') ||
    extractMetaTagValue(html, 'locality') ||
    extractMetaTagValue(html, 'addressLocality') ||
    extractMetaTagValue(html, 'city') ||
    extractMetaContent(html, [
      /(?:addressLocality|city)"?\s*[:=]\s*"([^"]+)"/i,
    ]) ||
    '';

  const state =
    extractMetaTagValue(html, 'og:region') ||
    extractMetaTagValue(html, 'region') ||
    extractMetaTagValue(html, 'addressRegion') ||
    extractMetaTagValue(html, 'state') ||
    extractMetaContent(html, [
      /(?:addressRegion|state)"?\s*[:=]\s*"([A-Z]{2})"/i,
    ]) ||
    'IL';

  const zip =
    extractMetaTagValue(html, 'og:postal-code') ||
    extractMetaTagValue(html, 'postal-code') ||
    extractMetaTagValue(html, 'postalCode') ||
    extractMetaTagValue(html, 'zip') ||
    extractMetaContent(html, [/(?:postalCode|zip)"?\s*[:=]\s*"(\d{5})"/i]) ||
    '';

  const addressLabel = buildAddressLabel({ street, city, state, zip });

  if (!addressLabel) return null;

  return { street, city, state, zip, addressLabel };
}

function extractStreetAddressFromVisibleText(html = '', fallbackLocation = {}) {
  const text = stripHtml(html);

  const numberedStreetPattern =
    /(\d{2,6}[A-Za-z0-9-]*\s+[A-Za-z0-9.'#\-\s]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Court|Ct|Circle|Cir|Boulevard|Blvd|Place|Pl|Way|Terrace|Ter|Parkway|Pkwy)\.?)/i;
  const crossStreetPattern =
    /((?:[A-Za-z0-9.'#\-]+\s+){0,4}(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Court|Ct|Circle|Cir|Boulevard|Blvd|Place|Pl|Way|Terrace|Ter|Parkway|Pkwy)\.?\s*(?:and|&)\s*(?:[A-Za-z0-9.'#\-]+\s+){0,4}(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Court|Ct|Circle|Cir|Boulevard|Blvd|Place|Pl|Way|Terrace|Ter|Parkway|Pkwy)\.?)/i;
  const streetOnlyPattern =
    /\b((?:[A-Za-z0-9.'#\-]+\s+){0,4}(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Court|Ct|Circle|Cir|Boulevard|Blvd|Place|Pl|Way|Terrace|Ter|Parkway|Pkwy))\b/i;

  const match =
    text.match(numberedStreetPattern) ||
    text.match(crossStreetPattern) ||
    text.match(streetOnlyPattern);

  if (!match) return null;

  const street = normalizeAddressLine(match[1]);
  if (!isMeaningfulStreet(street)) return null;

  const city = normalizeAddressLine(fallbackLocation.city || '');
  const state = normalizeAddressLine(fallbackLocation.state || 'IL');
  const zip = normalizeAddressLine(fallbackLocation.zip || '');
  const addressLabel = buildAddressLabel({ street, city, state, zip });

  if (!addressLabel) return null;

  return { street, city, state, zip, addressLabel };
}

function monthNameToNumber(monthName = '') {
  const key = String(monthName).trim().toLowerCase().slice(0, 3);
  const months = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };

  return months[key] || null;
}

function normalizeClockLabel(value = '') {
  const match = String(value)
    .replace(/\s+/g, ' ')
    .trim()
    .match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);

  if (!match) {
    return String(value)
      .replace(/\s+/g, ' ')
      .replace(/\b(am|pm)\b/gi, (part) => part.toLowerCase())
      .trim();
  }

  const hours = String(Number(match[1] || '0'));
  const minutes = String(match[2] || '00').padStart(2, '0');
  const meridiem = String(match[3] || '').toLowerCase();

  return `${hours}:${minutes}${meridiem}`;
}

function normalizeWeekdayLabel(value = '') {
  const key = String(value).trim().toLowerCase().replace(/\./g, '');
  const weekdays = {
    mon: 'Monday',
    monday: 'Monday',
    tue: 'Tuesday',
    tues: 'Tuesday',
    tuesday: 'Tuesday',
    wed: 'Wednesday',
    wednesday: 'Wednesday',
    thu: 'Thursday',
    thur: 'Thursday',
    thurs: 'Thursday',
    thursday: 'Thursday',
    fri: 'Friday',
    friday: 'Friday',
    sat: 'Saturday',
    saturday: 'Saturday',
    sun: 'Sunday',
    sunday: 'Sunday',
  };

  return weekdays[key] || String(value).trim();
}

function stripLeadingWeekdayFromTime(value = '') {
  return String(value)
    .replace(
      /^\s*(?:mon|monday|tue|tues|tuesday|wed|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|sun|sunday)\s*[•,\-]*\s*/i,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function streetHasHouseNumber(street = '') {
  return /^\d+[A-Za-z0-9-]*\s+/.test(String(street).trim());
}

function looksLikeCrossStreet(street = '') {
  const text = String(street).trim();
  if (!text) return false;

  return /\b(?:and|&|\/| at | near | corner of )\b/i.test(text);
}

function isMeaningfulStreet(street = '') {
  const text = String(street).trim();
  if (!text) return false;

  return (
    streetHasHouseNumber(text) ||
    looksLikeCrossStreet(text) ||
    /\b(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|circle|cir|boulevard|blvd|place|pl|way|terrace|ter|parkway|pkwy)\b/i.test(
      text,
    )
  );
}

function isProbableSaleAddress(street = '') {
  const text = String(street).trim();
  if (!text) return false;
  return !streetHasHouseNumber(text);
}

function shouldKeepSale(sale = {}) {
  const street = String(sale.street || '').trim();
  const city = String(sale.city || '').trim();
  const addressLabel = String(sale.addressLabel || '').trim();

  if (streetHasHouseNumber(street)) return true;
  if (looksLikeCrossStreet(street)) return true;
  if (street && city) return true;

  const normalizedAddress = addressLabel.toLowerCase();
  if (!street && (!city || ['il', 'illinois'].includes(normalizedAddress)))
    return false;
  if (!street && !addressLabel) return false;

  return false;
}

function formatMonthDay(monthName = '', day = '') {
  const month = String(monthName).trim().slice(0, 3);
  const dayNumber = String(day).trim();
  if (!month || !dayNumber) return '';
  return `${month} ${dayNumber}`;
}

function buildIsoDateTime(year, month, day, timeLabel = '') {
  const parsedYear = Number(year);
  const parsedMonth = Number(month);
  const parsedDay = Number(day);

  if (!parsedYear || !parsedMonth || !parsedDay) return '';

  const timeMatch = String(timeLabel)
    .trim()
    .match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);

  if (!timeMatch) {
    return `${parsedYear}-${String(parsedMonth).padStart(2, '0')}-${String(
      parsedDay,
    ).padStart(2, '0')}`;
  }

  let hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2] || '0');
  const meridiem = String(timeMatch[3]).toLowerCase();

  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;

  return `${parsedYear}-${String(parsedMonth).padStart(2, '0')}-${String(
    parsedDay,
  ).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(
    minutes,
  ).padStart(2, '0')}:00`;
}

function inferBestYearForSale(monthNumber, dayNumber) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  if (!monthNumber || !dayNumber) return currentYear;
  if (monthNumber + 6 < currentMonth) return currentYear + 1;

  return currentYear;
}

function extractDetailSchedule(html = '') {
  const text = stripHtml(html)
    .replace(
      /\bAddress Released\s*:\s*[A-Za-z]+,\s+[A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?\s+\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return null;

  const statusText = extractStatusText(text) || '';
  const entryPattern =
    /((?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)(?:day)?)\s*,?\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?\s+(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm))\s*(?:-|to)\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm))/gi;

  const entries = [];
  let match;

  while ((match = entryPattern.exec(text)) !== null) {
    const dayLabel = normalizeWeekdayLabel(match[1] || '');
    const monthName = String(match[2] || '').trim();
    const dayOfMonth = String(match[3] || '').trim();
    const explicitYear = Number(match[4] || '0') || null;
    const startTime = normalizeClockLabel(match[5] || '');
    const endTime = normalizeClockLabel(match[6] || '');
    const monthNumber = monthNameToNumber(monthName);
    const year =
      explicitYear || inferBestYearForSale(monthNumber, Number(dayOfMonth));

    if (!monthNumber || !dayOfMonth || !startTime || !endTime) continue;

    const dateLabel = formatMonthDay(monthName, dayOfMonth);
    entries.push({
      dayLabel,
      dateLabel,
      timeLabel: `${startTime} to ${endTime}`,
      startTime,
      endTime,
      startDate: `${year}-${String(monthNumber).padStart(2, '0')}-${String(
        dayOfMonth,
      ).padStart(2, '0')}`,
      startDateTime: buildIsoDateTime(year, monthNumber, dayOfMonth, startTime),
      sortTimestamp: new Date(
        buildIsoDateTime(year, monthNumber, dayOfMonth, startTime),
      ).getTime(),
    });
  }

  if (!entries.length) {
    const compactMatch = text.match(
      /\b(?:Dates|Days and Times)\b[:\s-]*([A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?)\s+(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm))\s*(?:-|to)\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm))/i,
    );

    if (compactMatch) {
      const monthDayText = compactMatch[1];
      const mdMatch = monthDayText.match(
        /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*(\d{4}))?/i,
      );

      if (mdMatch) {
        const monthName = mdMatch[1];
        const dayOfMonth = mdMatch[2];
        const explicitYear = Number(mdMatch[3] || '0') || null;
        const monthNumber = monthNameToNumber(monthName);
        const year =
          explicitYear || inferBestYearForSale(monthNumber, Number(dayOfMonth));
        const startTime = normalizeClockLabel(compactMatch[2] || '');
        const endTime = normalizeClockLabel(compactMatch[3] || '');

        if (monthNumber && dayOfMonth && startTime && endTime) {
          entries.push({
            dayLabel: '',
            dateLabel: formatMonthDay(monthName, dayOfMonth),
            timeLabel: `${startTime} to ${endTime}`,
            startTime,
            endTime,
            startDate: `${year}-${String(monthNumber).padStart(2, '0')}-${String(
              dayOfMonth,
            ).padStart(2, '0')}`,
            startDateTime: buildIsoDateTime(
              year,
              monthNumber,
              dayOfMonth,
              startTime,
            ),
            sortTimestamp: new Date(
              buildIsoDateTime(year, monthNumber, dayOfMonth, startTime),
            ).getTime(),
          });
        }
      }
    }
  }

  if (!entries.length) {
    return statusText ? { statusText } : null;
  }

  entries.sort((a, b) => {
    const aTime = Number.isFinite(a.sortTimestamp)
      ? a.sortTimestamp
      : Number.MAX_SAFE_INTEGER;
    const bTime = Number.isFinite(b.sortTimestamp)
      ? b.sortTimestamp
      : Number.MAX_SAFE_INTEGER;
    return aTime - bTime;
  });

  const primary = entries[0];
  const dateText = entries
    .map((entry) =>
      [entry.dayLabel, entry.dateLabel, entry.timeLabel]
        .filter(Boolean)
        .join(' • '),
    )
    .filter(Boolean)
    .slice(0, 2)
    .join(' | ');

  return {
    statusText,
    dayLabel: primary.dayLabel || '',
    dateLabel: primary.dateLabel || '',
    timeLabel: stripLeadingWeekdayFromTime(primary.timeLabel || ''),
    startTime: primary.startTime || '',
    endTime: primary.endTime || '',
    startDate: primary.startDate || '',
    startDateTime: primary.startDateTime || '',
    dateText: dateText || primary.dateLabel || '',
    scheduleEntries: entries,
  };
}

function mergeDetailIntoSale(sale, detail = {}) {
  const mergedZip = detail.zip || sale.zip || sale.requestedZip || '';
  const mergedCity = detail.city || sale.city || '';
  const mergedState = detail.state || sale.state || 'IL';

  let latitude = sale.latitude ?? null;
  let longitude = sale.longitude ?? null;
  let coordinateSource = sale.coordinateSource || 'missing';
  let probableLocation = sale.probableLocation ?? true;

  if (Number.isFinite(detail.latitude) && Number.isFinite(detail.longitude)) {
    latitude = detail.latitude;
    longitude = detail.longitude;
    coordinateSource = detail.coordinateSource || 'detail-page';
    probableLocation = false;
  }

  const street = detail.street || sale.street || '';
  const addressLabel =
    detail.addressLabel ||
    buildAddressLabel({
      street,
      city: mergedCity,
      state: mergedState,
      zip: mergedZip,
    }) ||
    sale.addressLabel;
  const probableSale = isProbableSaleAddress(street);
  const hasExactCoordinates =
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    coordinateSource === 'detail-page' &&
    probableSale === false;
  const isApproximateLocation =
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    !hasExactCoordinates;
  const mapAddress =
    addressLabel ||
    buildAddressLabel({
      street,
      city: mergedCity,
      state: mergedState,
      zip: mergedZip,
    });

  return {
    ...sale,
    city: mergedCity,
    state: mergedState,
    zip: mergedZip,
    latitude,
    longitude,
    coordinateSource,
    probableLocation: probableLocation || probableSale,
    street,
    addressLabel,
    mapAddress,
    mapsQuery: mapAddress,
    probableSale,
    isProbableSale: probableSale,
    hasExactCoordinates,
    isApproximateLocation,
    statusText: detail.statusText || sale.statusText || '',
    dateText: detail.dateText || sale.dateText || '',
    dayLabel: detail.dayLabel || sale.dayLabel || '',
    dateLabel: detail.dateLabel || sale.dateLabel || '',
    timeLabel: stripLeadingWeekdayFromTime(
      detail.timeLabel || sale.timeLabel || '',
    ),
    startTime: detail.startTime || sale.startTime || '',
    endTime: detail.endTime || sale.endTime || '',
    startDate: detail.startDate || sale.startDate || '',
    startDateTime: detail.startDateTime || sale.startDateTime || '',
    scheduleEntries: Array.isArray(detail.scheduleEntries)
      ? detail.scheduleEntries
      : Array.isArray(sale.scheduleEntries)
        ? sale.scheduleEntries
        : [],
  };
}

async function fetchDetailEnhancements(url, fallbackLocation = {}) {
  if (!url) return {};
  if (detailPageCache.has(url)) return detailPageCache.get(url);

  try {
    const response = await axios.get(url, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://www.google.com/',
        Connection: 'keep-alive',
      },
    });

    const html = typeof response.data === 'string' ? response.data : '';

    const coords = extractCoordinatesFromHtml(html);
    const address =
      extractAddressFromJsonLd(html) ||
      extractAddressFromMeta(html) ||
      extractAddressFromInlineJson(html, fallbackLocation) ||
      extractStreetAddressFromVisibleText(html, fallbackLocation) ||
      {};
    const schedule =
      extractScheduleFromJsonLd(html) || extractDetailSchedule(html) || {};

    const detail = {
      street: address.street || '',
      city: address.city || fallbackLocation.city || '',
      state: address.state || fallbackLocation.state || 'IL',
      zip: address.zip || fallbackLocation.zip || '',
      addressLabel:
        address.addressLabel ||
        buildAddressLabel({
          street: address.street || '',
          city: address.city || fallbackLocation.city || '',
          state: address.state || fallbackLocation.state || 'IL',
          zip: address.zip || fallbackLocation.zip || '',
        }),
      latitude: coords?.latitude,
      longitude: coords?.longitude,
      coordinateSource: coords ? 'detail-page' : undefined,
      mapAddress:
        address.addressLabel ||
        buildAddressLabel({
          street: address.street || '',
          city: address.city || fallbackLocation.city || '',
          state: address.state || fallbackLocation.state || 'IL',
          zip: address.zip || fallbackLocation.zip || '',
        }),
      mapsQuery:
        address.addressLabel ||
        buildAddressLabel({
          street: address.street || '',
          city: address.city || fallbackLocation.city || '',
          state: address.state || fallbackLocation.state || 'IL',
          zip: address.zip || fallbackLocation.zip || '',
        }),
      statusText: schedule.statusText || '',
      dateText: schedule.dateText || '',
      dayLabel: schedule.dayLabel || '',
      dateLabel: schedule.dateLabel || '',
      timeLabel: schedule.timeLabel || '',
      startTime: schedule.startTime || '',
      endTime: schedule.endTime || '',
      startDate: schedule.startDate || '',
      startDateTime: schedule.startDateTime || '',
      scheduleEntries: Array.isArray(schedule.scheduleEntries)
        ? schedule.scheduleEntries
        : [],
    };

    detailPageCache.set(url, detail);
    return detail;
  } catch (error) {
    console.error(`EstateSales detail fetch failed for ${url}:`, error.message);
    const detail = {};
    detailPageCache.set(url, detail);
    return detail;
  }
}

function parseEstateSalesFromHtml(html, requestedZip) {
  const results = [];
  const seenUrls = new Set();

  const linkMatches = [...html.matchAll(/href="(\/IL\/[^"]+\/\d+)"/gi)];

  for (const match of linkMatches) {
    const href = match[1];
    if (!href) continue;

    const absoluteUrl = `https://www.estatesales.net${decodeUrlPath(href)}`;

    if (seenUrls.has(absoluteUrl)) continue;
    seenUrls.add(absoluteUrl);

    const index = html.indexOf(href);
    if (index === -1) continue;

    const snippet = html.slice(Math.max(0, index - 1200), index + 1200);

    if (!isCurrentOrUpcoming(snippet)) continue;

    const location = extractLocationFromUrl(absoluteUrl);
    const title = extractTitle(snippet, absoluteUrl);
    const statusText = extractStatusText(snippet);
    const dateText = extractDateText(snippet);
    const company = extractCompany(snippet);
    const imageCount = extractImageCount(snippet);
    const distanceMiles = extractDistanceMiles(snippet);
    const saleType = inferSaleType(title, snippet);

    const fallbackCoordinates = buildZipFallbackCoordinates(
      location.zip || requestedZip || '',
      absoluteUrl,
    );

    results.push({
      id: makeStableId(absoluteUrl),
      sourceListingId: location.sourceListingId || '',
      title,
      saleType,
      source: 'estatesales-net',
      sourceLabel: 'EstateSales.net',
      url: absoluteUrl,
      externalUrl: absoluteUrl,
      city: location.city || '',
      state: location.state || 'IL',
      zip: location.zip || requestedZip || '',
      requestedZip,
      statusText,
      dateText,
      company,
      imageCount,
      distanceMiles,
      latitude: fallbackCoordinates?.latitude ?? null,
      longitude: fallbackCoordinates?.longitude ?? null,
      coordinateSource: fallbackCoordinates?.coordinateSource || 'missing',
      probableLocation: fallbackCoordinates?.probableLocation ?? true,
      probableSale: true,
      isProbableSale: true,
      hasExactCoordinates: false,
      isApproximateLocation: Boolean(fallbackCoordinates),
      street: '',
      mapAddress: [
        location.city,
        location.state || 'IL',
        location.zip || requestedZip || '',
      ]
        .filter(Boolean)
        .join(', '),
      mapsQuery: [
        location.city,
        location.state || 'IL',
        location.zip || requestedZip || '',
      ]
        .filter(Boolean)
        .join(', '),
      addressLabel: [
        location.city,
        location.state || 'IL',
        location.zip || requestedZip || '',
      ]
        .filter(Boolean)
        .join(', '),
      confidence: statusText || dateText ? 'high' : 'medium',
      dayLabel: '',
      dateLabel: '',
      timeLabel: '',
      startTime: '',
      endTime: '',
      startDate: '',
      startDateTime: '',
      scheduleEntries: [],
      rawSnippet: stripHtml(snippet).slice(0, 400),
    });
  }

  return results;
}

async async function fetchEstateSalesForZip(zip, radiusMiles = 50) {
  const safeZip = encodeURIComponent(String(zip || '60565').trim());
  const safeRadius = encodeURIComponent(String(radiusMiles || 50));

  // Single origin/radius search. This replaces the old:
  // https://www.estatesales.net/IL/Naperville/{zip}
  // called once for dozens of ZIPs.
  const urlsToTry = [
    `https://www.estatesales.net/sales/advancedSearch?zip=${safeZip}&radius=${safeRadius}`,
    `https://www.estatesales.net/IL/${safeZip}?radius=${safeRadius}`,
  ];

  let lastError = null;

  for (const url of urlsToTry) {
    try {
      const response = await axios.get(url, {
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          Referer: 'https://www.google.com/',
          Connection: 'keep-alive',
        },
      });

      const html = typeof response.data === 'string' ? response.data : '';
      const parsed = parseEstateSalesFromHtml(html, zip);

      console.log(
        `[estate-sales-route] ${ESTATE_ROUTE_VERSION} userZip=${zip} radius=${safeRadius} parsed=${parsed.length} url=${url}`,
      );

      if (parsed.length || url === urlsToTry[urlsToTry.length - 1]) {
        return parsed;
      }
    } catch (error) {
      lastError = error;
      console.warn(
        `[estate-sales-route] ${ESTATE_ROUTE_VERSION} fetch failed userZip=${zip} radius=${safeRadius}: ${error.message}`,
      );
    }
  }

  if (lastError) throw lastError;
  return [];
}

async function enrichSalesWithDetailPages(sales = []) {
  const limit = Math.min(sales.length, MAX_DETAIL_FETCHES);
  const salesToEnrich = sales.slice(0, limit);
  const remainingSales = sales.slice(limit);

  const enrichedSales = await mapWithConcurrency(
    salesToEnrich,
    DETAIL_FETCH_CONCURRENCY,
    async (sale) => {
      const detail = await fetchDetailEnhancements(sale.url, {
        city: sale.city,
        state: sale.state,
        zip: sale.zip || sale.requestedZip,
      });

      return mergeDetailIntoSale(sale, detail);
    },
  );

  return [...enrichedSales, ...remainingSales];
}

function dedupeSales(sales = []) {
  const map = new Map();

  for (const sale of sales) {
    const key =
      sale.url || `${sale.title}-${sale.city}-${sale.zip}-${sale.dateText}`;

    if (!map.has(key)) {
      map.set(key, sale);
      continue;
    }

    const existing = map.get(key);

    const existingScore =
      (existing.imageCount || 0) +
      (existing.statusText ? 10 : 0) +
      (existing.dateText ? 5 : 0) +
      (existing.street ? 25 : 0) +
      (existing.coordinateSource === 'detail-page' ? 20 : 0);

    const incomingScore =
      (sale.imageCount || 0) +
      (sale.statusText ? 10 : 0) +
      (sale.dateText ? 5 : 0) +
      (sale.street ? 25 : 0) +
      (sale.coordinateSource === 'detail-page' ? 20 : 0);

    if (incomingScore > existingScore) {
      map.set(key, sale);
    }
  }

  return [...map.values()];
}

function sortSales(sales = []) {
  const statusRank = (status = '') => {
    const text = (status || '').toLowerCase();

    if (text.includes('going on now')) return 0;
    if (text.includes('starts today')) return 1;
    if (text.includes('today')) return 2;
    if (text.includes('starts tomorrow')) return 3;
    if (text.includes('tomorrow')) return 4;
    if (text.includes('starts in')) return 5;
    if (/\b\d+\s+days?\s+away\b/.test(text)) return 6;

    return 9;
  };

  return [...sales].sort((a, b) => {
    const rankDiff = statusRank(a.statusText) - statusRank(b.statusText);
    if (rankDiff !== 0) return rankDiff;

    const addressScoreA = a.street ? 1 : 0;
    const addressScoreB = b.street ? 1 : 0;
    if (addressScoreA !== addressScoreB) return addressScoreB - addressScoreA;

    const imageDiff = (b.imageCount || 0) - (a.imageCount || 0);
    if (imageDiff !== 0) return imageDiff;

    const distanceA =
      a.distanceMiles == null ? Number.MAX_SAFE_INTEGER : a.distanceMiles;
    const distanceB =
      b.distanceMiles == null ? Number.MAX_SAFE_INTEGER : b.distanceMiles;

    if (distanceA !== distanceB) return distanceA - distanceB;

    return (a.title || '').localeCompare(b.title || '');
  });
}

function normalizeRequestedRadiusMiles(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed <= 0) return null;
  return parsed;
}

function calculateDistanceMiles(lat1, lon1, lat2, lon2) {
  const values = [lat1, lon1, lat2, lon2].map(Number);
  if (values.some((value) => !Number.isFinite(value))) return null;

  const [aLat, aLon, bLat, bLon] = values;
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;

  const dLat = toRadians(bLat - aLat);
  const dLon = toRadians(bLon - aLon);
  const startLat = toRadians(aLat);
  const endLat = toRadians(bLat);

  const haversine =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(dLon / 2) ** 2;

  const arc = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  return Number((earthRadiusMiles * arc).toFixed(2));
}

function getSearchZipsForRequest(
  _requestedRadiusMiles = null,
  requestedOrigin = {},
) {
  const requestedZip = String(
    requestedOrigin?.zip ||
      requestedOrigin?.postalCode ||
      requestedOrigin?.postal ||
      requestedOrigin?.requestedZip ||
      '',
  )
    .trim()
    .replace(/[^0-9]/g, '');

  // Source Assist should search from the user's location only.
  // No surrounding ZIP expansion. No 74-ZIP sweep.
  return requestedZip ? [requestedZip] : ['60565'];
}

function getClosestZipCenterDistanceMiles(_sale = {}) {
  // Disabled with the ZIP sweep. We no longer infer distance from a large
  // table of ZIP centers because it caused broad searching and muddy filtering.
  return null;
}

function getEffectiveDistanceMiles(sale = {}, requestedOrigin = {}) {
  const originLatitude = Number(requestedOrigin?.latitude);
  const originLongitude = Number(requestedOrigin?.longitude);
  const saleLatitude = Number(sale.latitude);
  const saleLongitude = Number(sale.longitude);

  if (
    Number.isFinite(originLatitude) &&
    Number.isFinite(originLongitude) &&
    Number.isFinite(saleLatitude) &&
    Number.isFinite(saleLongitude)
  ) {
    const directDistance = calculateDistanceMiles(
      originLatitude,
      originLongitude,
      saleLatitude,
      saleLongitude,
    );

    if (Number.isFinite(directDistance)) {
      return directDistance;
    }
  }

  const explicitDistance = Number(sale.distanceMiles);
  if (Number.isFinite(explicitDistance) && explicitDistance >= 0) {
    return explicitDistance;
  }

  return getClosestZipCenterDistanceMiles(sale);
}

function filterSalesByRadius(
  sales = [],
  requestedRadiusMiles = null,
  requestedOrigin = {},
) {
  const normalizedSales = sales.map((sale) => {
    const effectiveDistance = getEffectiveDistanceMiles(sale, requestedOrigin);
    return Number.isFinite(effectiveDistance)
      ? { ...sale, distanceMiles: effectiveDistance }
      : { ...sale };
  });

  if (!Number.isFinite(requestedRadiusMiles) || requestedRadiusMiles <= 0) {
    return normalizedSales;
  }

  return normalizedSales.filter((sale) => {
    const effectiveDistance = Number(sale.distanceMiles);
    return (
      Number.isFinite(effectiveDistance) &&
      effectiveDistance <= requestedRadiusMiles
    );
  });
}

function normalizeRequestedDay(value = '') {
  const normalized = String(value).trim().toLowerCase().replace(/\./g, '');

  if (normalized === 'today') return 'today';
  if (normalized === 'tomorrow') return 'tomorrow';
  if (
    [
      'nexttwoweeks',
      'next-2-weeks',
      'next2weeks',
      'two-weeks',
      '2weeks',
    ].includes(normalized)
  ) {
    return 'unsupported';
  }

  return normalized;
}

function getWeekdayFromDateLikeValue(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';

  return normalizeRequestedDay(
    parsed.toLocaleDateString('en-US', { weekday: 'long' }),
  );
}

function getRequestedDateWindow(requestedDay = '') {
  const normalizedRequestedDay = normalizeRequestedDay(requestedDay);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (normalizedRequestedDay === 'today') {
    const end = new Date(today);
    end.setHours(23, 59, 59, 999);
    return { start: today, end };
  }

  if (normalizedRequestedDay === 'tomorrow') {
    const start = new Date(today);
    start.setDate(start.getDate() + 1);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  return null;
}

function getComparableSaleDateValue(sale = {}) {
  const candidates = [
    sale.startDateTime,
    sale.startDate,
    sale.saleDateTime,
    sale.saleDate,
    sale.date,
    sale.dateLabel,
  ];

  for (const candidate of candidates) {
    const parsed = new Date(String(candidate || '').trim());
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  if (Array.isArray(sale.scheduleEntries)) {
    for (const entry of sale.scheduleEntries) {
      const parsed = getComparableSaleDateValue(entry || {});
      if (parsed) return parsed;
    }
  }

  return null;
}

function getSaleDatesForComparison(sale = {}) {
  const results = [];
  const seen = new Set();

  const pushDate = (value) => {
    const parsed = new Date(String(value || '').trim());
    if (Number.isNaN(parsed.getTime())) return;
    const key = parsed.toISOString();
    if (seen.has(key)) return;
    seen.add(key);
    results.push(parsed);
  };

  pushDate(sale.startDateTime);
  pushDate(sale.startDate);
  pushDate(sale.saleDateTime);
  pushDate(sale.saleDate);
  pushDate(sale.date);
  pushDate(sale.dateLabel);

  if (Array.isArray(sale.scheduleEntries)) {
    for (const entry of sale.scheduleEntries) {
      pushDate(entry?.startDateTime);
      pushDate(entry?.startDate);
      pushDate(entry?.saleDateTime);
      pushDate(entry?.saleDate);
      pushDate(entry?.date);
      pushDate(entry?.dateLabel);
    }
  }

  return results;
}

function saleHasDayConfirmationData(sale = {}) {
  if (normalizeRequestedDay(sale.dayLabel || '')) return true;
  if (getWeekdayFromDateLikeValue(sale.startDateTime || sale.startDate || '')) {
    return true;
  }

  if (Array.isArray(sale.scheduleEntries)) {
    return sale.scheduleEntries.some((entry) => {
      return Boolean(
        normalizeRequestedDay(entry?.dayLabel || '') ||
        getWeekdayFromDateLikeValue(
          entry?.startDateTime || entry?.startDate || '',
        ),
      );
    });
  }

  return false;
}

function saleMatchesRequestedDay(sale = {}, requestedDay = '') {
  const normalizedRequestedDay = normalizeRequestedDay(requestedDay);
  if (!normalizedRequestedDay) return true;

  const requestedWindow = getRequestedDateWindow(normalizedRequestedDay);
  if (requestedWindow) {
    const entryDates =
      Array.isArray(sale.scheduleEntries) && sale.scheduleEntries.length
        ? sale.scheduleEntries.flatMap((entry) =>
            getSaleDatesForComparison(entry || {}),
          )
        : [];

    const comparableDates = entryDates.length
      ? entryDates
      : getSaleDatesForComparison(sale);

    if (!comparableDates.length) return false;

    return comparableDates.some((comparableDate) => {
      return (
        comparableDate.getTime() >= requestedWindow.start.getTime() &&
        comparableDate.getTime() <= requestedWindow.end.getTime()
      );
    });
  }

  const candidates = [];

  if (sale.dayLabel) {
    candidates.push(String(sale.dayLabel));
  }

  const saleWeekdayFromDate = getWeekdayFromDateLikeValue(
    sale.startDateTime || sale.startDate || '',
  );
  if (saleWeekdayFromDate) {
    candidates.push(saleWeekdayFromDate);
  }

  if (Array.isArray(sale.scheduleEntries)) {
    for (const entry of sale.scheduleEntries) {
      if (entry?.dayLabel) {
        candidates.push(String(entry.dayLabel));
      }

      const entryWeekdayFromDate = getWeekdayFromDateLikeValue(
        entry?.startDateTime || entry?.startDate || '',
      );
      if (entryWeekdayFromDate) {
        candidates.push(entryWeekdayFromDate);
      }
    }
  }

  return candidates.some((candidate) => {
    const normalizedCandidate = normalizeRequestedDay(candidate);
    return (
      normalizedCandidate === normalizedRequestedDay ||
      normalizedCandidate.startsWith(normalizedRequestedDay)
    );
  });
}

function projectSaleToRequestedDay(sale = {}, requestedDay = '') {
  const normalizedRequestedDay = normalizeRequestedDay(requestedDay);
  if (!normalizedRequestedDay) return sale;

  const entries = Array.isArray(sale.scheduleEntries)
    ? sale.scheduleEntries
    : [];
  const requestedWindow = getRequestedDateWindow(normalizedRequestedDay);

  const matchingEntries = entries.filter((entry) => {
    if (requestedWindow) {
      const entryDates = getSaleDatesForComparison(entry || {});
      return entryDates.some((entryDate) => {
        return (
          entryDate.getTime() >= requestedWindow.start.getTime() &&
          entryDate.getTime() <= requestedWindow.end.getTime()
        );
      });
    }

    const normalizedEntryDay = normalizeRequestedDay(entry?.dayLabel || '');
    const normalizedEntryDateDay = getWeekdayFromDateLikeValue(
      entry?.startDateTime || entry?.startDate || '',
    );
    return (
      normalizedEntryDay === normalizedRequestedDay ||
      normalizedEntryDay.startsWith(normalizedRequestedDay) ||
      normalizedEntryDateDay === normalizedRequestedDay ||
      normalizedEntryDateDay.startsWith(normalizedRequestedDay)
    );
  });

  const matchedEntry = matchingEntries.slice().sort((a, b) => {
    const aDate =
      getComparableSaleDateValue(a) || new Date('9999-12-31T00:00:00');
    const bDate =
      getComparableSaleDateValue(b) || new Date('9999-12-31T00:00:00');
    return aDate.getTime() - bDate.getTime();
  })[0];

  if (!matchedEntry) {
    return sale;
  }

  return {
    ...sale,
    dayLabel: matchedEntry.dayLabel || sale.dayLabel || '',
    dateLabel: matchedEntry.dateLabel || sale.dateLabel || '',
    timeLabel: stripLeadingWeekdayFromTime(
      matchedEntry.timeLabel || sale.timeLabel || '',
    ),
    startTime: matchedEntry.startTime || sale.startTime || '',
    endTime: matchedEntry.endTime || sale.endTime || '',
    startDate: matchedEntry.startDate || sale.startDate || '',
    startDateTime: matchedEntry.startDateTime || sale.startDateTime || '',
  };
}

function formatSaleForSourceAssist(sale = {}) {
  const scheduleEntries = Array.isArray(sale.scheduleEntries)
    ? sale.scheduleEntries
    : [];

  const saleDateKeys = Array.from(
    new Set(
      [
        sale.startDate,
        sale.saleDate,
        sale.date,
        ...scheduleEntries.map((entry) => entry?.startDate),
      ]
        .map((value) => String(value || '').trim().slice(0, 10))
        .filter((value) => /^20\d{2}-\d{2}-\d{2}$/.test(value)),
    ),
  );

  const saleDateLabels = Array.from(
    new Set(
      [
        sale.dateText,
        sale.dateLabel,
        ...scheduleEntries.map((entry) =>
          [entry?.dayLabel, entry?.dateLabel, entry?.timeLabel]
            .filter(Boolean)
            .join(' • '),
        ),
      ]
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    ),
  );

  const website = sale.externalUrl || sale.url || sale.website || '';
  const saleDate = saleDateKeys[0] || sale.startDate || sale.saleDate || '';
  const saleDateTime =
    sale.startDateTime ||
    sale.saleDateTime ||
    scheduleEntries.find((entry) => entry?.startDateTime)?.startDateTime ||
    saleDate;

  return {
    ...sale,
    saleType: 'estate',
    type: 'estate',
    source: sale.source || 'estatesales-net',
    sourceLabel: sale.sourceLabel || 'EstateSales.net',
    website,
    craigslistUrl: website,
    saleDate,
    saleDateTime,
    saleDateKeys,
    saleDateLabels,
    openingHours: sale.timeLabel || sale.openingHours || '',
    address:
      sale.addressLabel ||
      sale.mapAddress ||
      [sale.street, sale.city, sale.state, sale.zip].filter(Boolean).join(', '),
    addressLabel:
      sale.addressLabel ||
      sale.mapAddress ||
      [sale.street, sale.city, sale.state, sale.zip].filter(Boolean).join(', '),
    displayAddress:
      sale.addressLabel ||
      sale.mapAddress ||
      [sale.street, sale.city, sale.state, sale.zip].filter(Boolean).join(', '),
    descriptionPreview:
      sale.descriptionPreview ||
      sale.rawSnippet ||
      [sale.statusText, sale.dateText, sale.company].filter(Boolean).join(' • '),
  };
}


async function fetchAllEstateSales(
  requestedDay = '',
  requestedRadiusMiles = null,
  requestedOrigin = {},
) {
  const normalizedRequestedDay = normalizeRequestedDay(requestedDay);

  if (normalizedRequestedDay === 'unsupported') {
    return [];
  }
  const searchZips = getSearchZipsForRequest(
    requestedRadiusMiles,
    requestedOrigin,
  );
  const cachedDayFiltered = getCachedEstateSalesPool(requestedDay, searchZips);
  let dayFiltered = null;
  let cacheHit = false;

  if (cachedDayFiltered) {
    dayFiltered = cachedDayFiltered;
    cacheHit = true;
  } else {
    const zipResultSets = await mapWithConcurrency(
      searchZips,
      ZIP_FETCH_CONCURRENCY,
      async (zip) => {
        try {
          const zipResults = await fetchEstateSalesForZip(zip, requestedRadiusMiles);
          console.log(`EstateSales.net ${zip}: ${zipResults.length} listings`);
          return zipResults;
        } catch (error) {
          console.error(
            `EstateSales.net fetch failed for ${zip}:`,
            error.message,
          );
          return [];
        }
      },
    );

    const allResults = zipResultSets.flat();
    const deduped = dedupeSales(allResults);
    const preliminaryRadiusFiltered = filterSalesByRadius(
      deduped,
      requestedRadiusMiles,
      requestedOrigin,
    );
    const prioritizedSales = sortSales(
      preliminaryRadiusFiltered.length ? preliminaryRadiusFiltered : deduped,
    );

    const enrichmentTargetCount = Math.max(
      MAX_DETAIL_FETCHES,
      DETAIL_ENRICH_TARGET_COUNT,
    );
    const enriched = await enrichSalesWithDetailPages(
      prioritizedSales.slice(0, enrichmentTargetCount),
    );
    const combinedSales = dedupeSales([
      ...enriched,
      ...prioritizedSales.slice(enrichmentTargetCount),
    ]);
    const addressFiltered = combinedSales.filter((sale) =>
      shouldKeepSale(sale),
    );

    if (normalizedRequestedDay) {
      const initiallyMatched = addressFiltered
        .map((sale) => projectSaleToRequestedDay(sale, requestedDay))
        .filter((sale) => saleMatchesRequestedDay(sale, requestedDay));

      const unresolvedForRequestedDay = addressFiltered.filter((sale) => {
        return !saleMatchesRequestedDay(sale, requestedDay);
      });

      const confirmationCandidates = sortSales(
        filterSalesByRadius(
          unresolvedForRequestedDay,
          requestedRadiusMiles,
          requestedOrigin,
        ),
      );

      const confirmationFetchLimit = MAX_DETAIL_FETCHES;

      const confirmedDaySales = confirmationCandidates.length
        ? await enrichSalesWithDetailPages(
            confirmationCandidates.slice(0, confirmationFetchLimit),
          )
        : [];

      const confirmedMatches = confirmedDaySales
        .map((sale) => projectSaleToRequestedDay(sale, requestedDay))
        .filter((sale) => saleMatchesRequestedDay(sale, requestedDay));

      const strictDayMatches = dedupeSales([
        ...initiallyMatched,
        ...confirmedMatches,
      ]);

      // Source Assist needs visible estate-sale results first. EstateSales.net
      // often lists multi-day sales in formats that do not survive a strict
      // today/tomorrow comparison on the backend. If the strict day match comes
      // back empty, fall back to all current/upcoming sales inside the radius and
      // let the app/card display the best available schedule details.
      dayFiltered = strictDayMatches.length
        ? strictDayMatches
        : addressFiltered.map((sale) => projectSaleToRequestedDay(sale, requestedDay));
    } else {
      dayFiltered = addressFiltered;
    }

    setCachedEstateSalesPool(requestedDay, searchZips, dayFiltered);

    console.log(
      '[estate-sales-route] counts',
      JSON.stringify({
        raw: allResults.length,
        deduped: deduped.length,
        preliminaryRadiusFiltered: preliminaryRadiusFiltered.length,
        enriched: enriched.length,
        addressFiltered: addressFiltered.length,
        dayFiltered: dayFiltered.length,
        cacheHit: false,
        requestedDay: normalizedRequestedDay || null,
        requestedRadiusMiles: requestedRadiusMiles ?? null,
        searchedZipCount: 1,
      }),
    );
  }

  const radiusFiltered = filterSalesByRadius(
    dayFiltered,
    requestedRadiusMiles,
    requestedOrigin,
  );
  const sorted = sortSales(radiusFiltered);

  console.log(
    '[estate-sales-route] response',
    JSON.stringify({
      cacheHit,
      dayFiltered: dayFiltered.length,
      radiusFiltered: radiusFiltered.length,
      requestedDay: normalizedRequestedDay || null,
      requestedRadiusMiles: requestedRadiusMiles ?? null,
      requestedLatitude: requestedOrigin?.latitude ?? null,
      requestedLongitude: requestedOrigin?.longitude ?? null,
      searchedZipCount: 1,
    }),
  );

  return sorted.slice(0, MAX_RESULTS);
}

router.get('/', async (req, res) => {
  console.log(`[estate-sales-route] source-assist-no-zip-sweep-v5-user-radius-only NO_ZIP_SWEEP route start`);
  const requestStartedAt = Date.now();
  const requestedDay = normalizeRequestedDay(req.query?.day || '');
  const requestedRadiusMiles = normalizeRequestedRadiusMiles(
    req.query?.radiusMiles,
  );
  const requestedOrigin = {
    latitude: normalizeRequestedOriginCoordinate(req.query?.latitude),
    longitude: normalizeRequestedOriginCoordinate(req.query?.longitude),
  };

  try {
    const sales = await fetchAllEstateSales(
      requestedDay,
      requestedRadiusMiles,
      requestedOrigin,
    );
    const sourceAssistSales = sales.map(formatSaleForSourceAssist);

    return res.json({
      success: true,
      routeVersion: ESTATE_ROUTE_VERSION,
      source: 'estatesales-net',
      requestedDay,
      requestedRadiusMiles,
      count: sourceAssistSales.length,
      fetchedAt: new Date().toISOString(),
      elapsedMs: Date.now() - requestStartedAt,
      sales: sourceAssistSales,
      estateSales: sourceAssistSales,
    });
  } catch (error) {
    console.error('EstateSales route error:', error.message);

    return res.status(500).json({
      success: false,
      error: 'ESTATE_SALES_FETCH_FAILED',
      message: error.message,
      fetchedAt: new Date().toISOString(),
      elapsedMs: Date.now() - requestStartedAt,
      sales: [],
    });
  }
});

module.exports = router;
