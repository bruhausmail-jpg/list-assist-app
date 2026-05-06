const express = require('express');
const axios = require('axios');

const router = express.Router();

// Defensive no-op global used to prevent a bare `g` typo in deployed regex edits
// from crashing the whole estate-sale route. Regex flags still use /.../g normally.
const g = 'g';

const ESTATE_ROUTE_VERSION = 'source-assist-v53-upcoming-include-lower-future-section';
const ESTATE_ROUTE_DEPLOY_STAMP = '2026-05-06-v53-upcoming-include-lower-future-section';

const ESTATE_SALES_ZIPS = []; // disabled: single user ZIP/radius search only
const REQUEST_TIMEOUT_MS = 15000;
const MAX_RESULTS = 150;
const DETAIL_FETCH_DELAY_MS = 700;
const MAX_DETAIL_FETCHES = 220;
const ESTATE_SALES_ZIP_SEARCH_BUFFER_MILES = 18;
const ZIP_FETCH_CONCURRENCY = 5;
const DETAIL_FETCH_CONCURRENCY = 8;
const DETAIL_ENRICH_TARGET_COUNT = 220;
const UPCOMING_MAX_DAYS_OUT = 14;
const ESTATE_SALES_DEFAULT_PAGE_LIMIT = 1;
const ESTATE_SALES_UPCOMING_PAGE_LIMIT = 4;
const ZIP_CENTER_COORDS = {}; // disabled: no broad ZIP center sweep

const detailPageCache = new Map();
const estateSalesSearchCache = new Map();
const ESTATE_SALES_CACHE_TTL_MS = 10 * 60 * 1000;

function setNoCacheHeaders(res) {
  if (!res || typeof res.set !== 'function') return;

  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0',
    Pragma: 'no-cache',
    Expires: '0',
    'Surrogate-Control': 'no-store',
    'X-Estate-Route-Version': ESTATE_ROUTE_VERSION,
    'X-Estate-Route-Deploy-Stamp': ESTATE_ROUTE_DEPLOY_STAMP,
  });
}



router.get('/health', (req, res) => {
  setNoCacheHeaders(res);
  res.json({
    success: true,
    route: 'estate-sales',
    routeVersion: ESTATE_ROUTE_VERSION,
    deployStamp: ESTATE_ROUTE_DEPLOY_STAMP,
    serverTime: new Date().toISOString(),
    cacheBust: req.query?._t || req.query?.cacheBust || null,
    cache: {
      detailPageCacheSize: detailPageCache.size,
      estateSalesSearchCacheSize: estateSalesSearchCache.size,
      estateSalesCacheTtlMs: ESTATE_SALES_CACHE_TTL_MS,
    },
    verifyUrls: {
      health: '/api/estate-sales/health?_t=' + Date.now(),
      today: '/api/estate-sales?day=today&_t=' + Date.now(),
      tomorrow: '/api/estate-sales?day=tomorrow&_t=' + Date.now(),
      upcoming: '/api/estate-sales?day=upcoming&_t=' + Date.now(),
    },
  });
});

router.get('/version', (req, res) => {
  setNoCacheHeaders(res);
  res.json({
    success: true,
    routeVersion: ESTATE_ROUTE_VERSION,
    deployStamp: ESTATE_ROUTE_DEPLOY_STAMP,
    serverTime: new Date().toISOString(),
    cacheBust: req.query?._t || req.query?.cacheBust || null,
  });
});

function normalizeRequestedOriginCoordinate(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Number(parsed.toFixed(4));
}

function buildEstateSalesCacheKey(
  requestedDay = '',
  searchZips = [],
  requestedRadiusMiles = null,
  requestedOrigin = {},
) {
  const normalizedDay = normalizeRequestedDay(requestedDay) || 'all-days';
  const zipSignature =
    Array.isArray(searchZips) && searchZips.length
      ? searchZips.map((zip) => String(zip || '').trim()).filter(Boolean).join('-') || '60565'
      : '60565';
  const radiusSignature = Number.isFinite(Number(requestedRadiusMiles))
    ? String(Number(requestedRadiusMiles))
    : 'all-radius';
  const latSignature = Number.isFinite(Number(requestedOrigin?.latitude))
    ? String(Number(requestedOrigin.latitude).toFixed(3))
    : 'no-lat';
  const lonSignature = Number.isFinite(Number(requestedOrigin?.longitude))
    ? String(Number(requestedOrigin.longitude).toFixed(3))
    : 'no-lon';

  return `${ESTATE_ROUTE_VERSION}__${normalizedDay}__${zipSignature}__r${radiusSignature}__${latSignature}_${lonSignature}`;
}

function getCachedEstateSalesPool(
  requestedDay = '',
  searchZips = [],
  requestedRadiusMiles = null,
  requestedOrigin = {},
) {
  const cacheKey = buildEstateSalesCacheKey(
    requestedDay,
    searchZips,
    requestedRadiusMiles,
    requestedOrigin,
  );
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
  requestedRadiusMiles = null,
  requestedOrigin = {},
) {
  const cacheKey = buildEstateSalesCacheKey(
    requestedDay,
    searchZips,
    requestedRadiusMiles,
    requestedOrigin,
  );
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
  const match = url.match(/\/(IL|IN)\/([^/]+)\/(\d{5})\/(\d+)/i);

  if (!match) {
    return {
      city: '',
      state: 'IL',
      zip: '',
      sourceListingId: '',
    };
  }

  const parsedState = String(match[1] || 'IL').toUpperCase();
  const rawCity = match[2] || '';
  const parsedZip = match[3] || '';
  const sourceListingId = match[4] || '';

  const city = rawCity
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');

  return {
    city,
    state: parsedState,
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

  const monthName = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*';
  const patterns = [
    // EstateSales.net often renders: "May 1, 2, 3, 4".
    new RegExp(`\\b${monthName}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:\\s*,\\s*\\d{1,2}(?:st|nd|rd|th)?){1,10}(?:,?\\s*20\\d{2})?`, 'i'),
    // Handles: "May 2 to May 5", "Apr 30 to May 5", "May 2 - 5".
    new RegExp(`\\b${monthName}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s*20\\d{2})?\\s*(?:-|–|to|through|thru)\\s*(?:${monthName}\\s+)?\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s*20\\d{2})?`, 'i'),
    new RegExp(`\\b${monthName}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,\\s*\\d{4})?`, 'i'),
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

function inferSaleType(_title = '', _snippet = '') {
  // Every listing pulled by this route comes from EstateSales.net. Some valid
  // EstateSales.net detail pages show the small "Estate Sale" badge on the
  // page but do not repeat those words in the listing title or preview text.
  // Returning estate-sale here prevents those real listings from being dropped
  // later by frontend/backend filters that expect saleType === 'estate-sale'.
  return 'estate-sale';
}

function buildOnlineOnlyDetectionText(value = '') {
  const raw = htmlDecode(String(value || ''));

  // Keep BOTH versions:
  // 1) stripHtml() gives us the normal visible page/listing text.
  // 2) rawWithoutTags keeps words that EstateSales.net may place inside JSON,
  //    script payloads, aria labels, or app-state data. The prior filter only
  //    looked at visible text, so detail pages that rendered "Online Only
  //    Auction" from app data could slip through as false in-person sales.
  const visibleText = stripHtml(raw);
  const rawWithoutTags = raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\u0026/g, '&')
    .replace(/\u003c/gi, '<')
    .replace(/\u003e/gi, '>')
    .replace(/\u002f/gi, '/')
    .replace(/\\//g, '/');

  return `${visibleText} ${rawWithoutTags}`
    .toLowerCase()
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[-–—_]+/g, ' ')
    .replace(/&nbsp;|&amp;|&quot;|&#39;|&apos;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isOnlineOnlyEstateSaleText(value = '') {
  const text = buildOnlineOnlyDetectionText(value);
  if (!text) return false;

  const onlineOnlySignals = [
    /\bonline\s+only\s+auction\b/i,
    /\bonline\s+only\s+sale\b/i,
    /\bonline\s+only\s+estate\s+sale\b/i,
    /\bonline\s+auction\s+only\b/i,
    /\bonline\s+bidding\s+only\b/i,
    /\bbidding\s+only\b/i,
    /\bnot\s+available\s*\(\s*online\s+only\s+auction\s*\)/i,
    /\blocation\s+not\s+available\s*\(\s*online\s+only\s+auction\s*\)/i,
    /\baddress\s+not\s+available\s*\(\s*online\s+only\s+auction\s*\)/i,
    /\bthis\s+is\s+an\s+online\s+only\s+auction\b/i,
    /\bsale\s+type\s*[:=]\s*online\s+only\s+auction\b/i,
    /\bsale\s+format\s*[:=]\s*online\s+only\b/i,
  ];

  return onlineOnlySignals.some((pattern) => pattern.test(text));
}

function shouldExcludeOnlineOnlySale(sale = {}) {
  if (sale.isOnlineOnly === true) return true;

  // Detail-page evidence is more trustworthy than the wide search-result
  // snippet. EstateSales.net pages can render nearby listings close together,
  // so a real in-person sale can inherit text from an adjacent online-only
  // auction in rawSnippet. Once the detail page has confirmed this is an
  // in-person sale, do not let the contaminated listing snippet remove it.
  const strongOwnOnlineOnlyText = [sale.title, sale.saleFormat, sale.detailSaleBadge]
    .filter(Boolean)
    .join(' ');
  if (/\bonline\b/i.test(String(sale.title || '')) || isOnlineOnlyEstateSaleText(strongOwnOnlineOnlyText)) {
    return true;
  }

  if (sale.detailFetched === true && sale.saleFormat === 'in-person-estate-sale') {
    return false;
  }

  const searchableText = [
    sale.title,
    sale.saleType,
    sale.saleBadge,
    sale.detailSaleBadge,
    sale.statusText,
    sale.dateText,
    sale.company,
    sale.street,
    sale.addressLabel,
    sale.mapAddress,
    sale.mapsQuery,
    sale.descriptionPreview,
    sale.rawSnippet,
  ]
    .filter(Boolean)
    .join(' ');

  return isOnlineOnlyEstateSaleText(searchableText);
}

function extractDetailSaleBadge(html = '') {
  const text = stripHtml(html);
  if (!text) return '';

  const badgePatterns = [
    /\bestate\s+sale\b/i,
    /\btag\s+sale\b/i,
    /\bmoving\s+sale\b/i,
    /\bgarage\s+sale\b/i,
    /\byard\s+sale\b/i,
  ];

  for (const pattern of badgePatterns) {
    const match = text.match(pattern);
    if (match?.[0]) {
      return match[0]
        .toLowerCase()
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
    }
  }

  return '';
}

function isExactEstateSaleBadge(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase() === 'estate sale';
}

function cleanDetailTitle(value = '') {
  return stripHtml(value)
    .replace(/\s*[|\-–—]\s*EstateSales\.NET.*$/i, '')
    .replace(/\s*[|\-–—]\s*EstateSales\.net.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDetailTitle(html = '') {
  if (!html) return '';

  const titleSources = [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i,
  ];

  for (const pattern of titleSources) {
    const match = html.match(pattern);
    const title = cleanDetailTitle(htmlDecode(match?.[1] || ''));
    if (title && !/^estate\s+sale$/i.test(title)) {
      return title;
    }
  }

  return '';
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
  if (/ended|closed|completed/.test(text) && !/going on now|resumes|starts|today|tomorrow/.test(text)) {
    return false;
  }

  const positiveSignals = [
    /going on now/,
    /resumes today/,
    /resumes tomorrow/,
    /ends today/,
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
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}/,
    /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/,
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
    // EstateSales.net detail pages expose JSON-LD date/times with Chicago sale times.
    // Render runs in UTC, so using plain toLocaleTimeString() shifted the cards by
    // about five hours (for example 11am-3pm became 3pm-8pm). Always render and
    // build date keys in America/Chicago so Today matches the EstateSales.net app.
    const startParts = getChicagoDateParts(start);
    const endParts = end && !Number.isNaN(end.getTime()) ? getChicagoDateParts(end) : null;
    const weekday = startParts.weekday || '';
    const dateLabel = getChicagoMonthDayLabel(start);
    const startTime = startParts.timeLabel || '';
    const endTime = endParts?.timeLabel || '';
    const startDate = getChicagoDateKey(start);

    scheduleEntries.push({
      dayLabel: weekday,
      dateLabel,
      timeLabel: endTime ? `${startTime} to ${endTime}` : startTime,
      startTime,
      endTime,
      startDate,
      startDateTime: buildChicagoIsoDateTime(startDate, startTime),
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


const ESTATE_SALES_TIME_ZONE = 'America/Chicago';

function getChicagoDateParts(date = new Date()) {
  const safeDate = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: ESTATE_SALES_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(safeDate).map((part) => [part.type, part.value]),
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: normalizeWeekdayLabel(parts.weekday || ''),
    timeLabel: normalizeClockLabel(`${parts.hour || ''}:${parts.minute || '00'} ${parts.dayPeriod || ''}`),
  };
}

function getChicagoDateKey(date = new Date()) {
  const parts = getChicagoDateParts(date);
  if (!parts.year || !parts.month || !parts.day) return '';
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function addDaysToDateKey(dateKey = '', days = 0) {
  const match = String(dateKey || '').match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(days || 0), 12, 0, 0));
  return date.toISOString().slice(0, 10);
}

function getTargetDateKeyForRequestedDay(requestedDay = '') {
  const todayKey = getChicagoDateKey(new Date());
  const normalizedRequestedDay = normalizeRequestedDay(requestedDay || 'today');
  if (normalizedRequestedDay === 'tomorrow') return addDaysToDateKey(todayKey, 1);
  if (normalizedRequestedDay === 'upcoming') return addDaysToDateKey(todayKey, 2);
  if (normalizedRequestedDay === 'today') return todayKey;
  return '';
}

function dateKeyFromDetailMonthDay(monthText = '', dayText = '', fallbackYear = null) {
  const monthNumber = monthNameToNumber(monthText);
  const dayNumber = Number(String(dayText || '').replace(/\D+/g, ''));
  const year = Number(fallbackYear) || getChicagoDateParts(new Date()).year;
  if (!monthNumber || !dayNumber || !year) return '';
  const date = new Date(Date.UTC(year, monthNumber - 1, dayNumber, 12, 0, 0));
  return date.toISOString().slice(0, 10);
}

function extractDetailScheduleDateKeys(detailHtmlOrText = '', fallbackYear = null) {
  const text = stripHtml(detailHtmlOrText)
    .replace(/\s+/g, ' ')
    .trim();
  const keys = [];
  const seen = new Set();
  const pushKey = (key) => {
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(String(key || ''))) return;
    if (seen.has(key)) return;
    seen.add(key);
    keys.push(key);
  };

  const year = Number(fallbackYear) || getChicagoDateParts(new Date()).year;
  const monthWord = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';

  // Detail-page cards render like: Thu May 7 9am to 3:30pm.
  const dayCardPattern = new RegExp(
    `\b(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)(?:day)?\b\s+${monthWord}\s+(\d{1,2})(?:st|nd|rd|th)?\b`,
    'gi',
  );
  for (const match of text.matchAll(dayCardPattern)) {
    pushKey(dateKeyFromDetailMonthDay(match[1], match[2], year));
  }

  // Detail/list text can also render like: May 6, 7, 8.
  const compactListPattern = new RegExp(
    `\b${monthWord}\s+(\d{1,2}(?:st|nd|rd|th)?(?:\s*,\s*\d{1,2}(?:st|nd|rd|th)?){1,10})`,
    'gi',
  );
  for (const match of text.matchAll(compactListPattern)) {
    const monthName = match[1];
    const dayNumbers = String(match[2] || '')
      .split(/\s*,\s*/)
      .map((part) => Number(String(part).replace(/\D+/g, '')))
      .filter((day) => Number.isFinite(day) && day >= 1 && day <= 31);
    for (const day of dayNumbers) {
      pushKey(dateKeyFromDetailMonthDay(monthName, String(day), year));
    }
  }

  // Use single detail-card dates only when they are near a weekday/schedule card.
  // Avoid using random SEO text like “address released May 6” as sale proof.
  const scheduleLikePattern = new RegExp(
    `\b(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)(?:day)?\b[\s\S]{0,40}?${monthWord}\s+(\d{1,2})(?:st|nd|rd|th)?[\s\S]{0,40}?\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b`,
    'gi',
  );
  for (const match of text.matchAll(scheduleLikePattern)) {
    pushKey(dateKeyFromDetailMonthDay(match[1], match[2], year));
  }

  return keys.sort();
}

function collectSaleDateKeysFromText(value = '', fallbackYear = null) {
  const text = stripHtml(value)
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return [];

  const keys = [];
  const seen = new Set();
  const year = Number(fallbackYear) || getChicagoDateParts(new Date()).year;
  const monthWord = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';

  const pushKey = (key) => {
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(String(key || ''))) return;
    if (seen.has(key)) return;
    seen.add(key);
    keys.push(key);
  };

  // May 8, 9, 10
  const compactListPattern = new RegExp(
    `\\b${monthWord}\\s+(\\d{1,2}(?:st|nd|rd|th)?(?:\\s*,\\s*\\d{1,2}(?:st|nd|rd|th)?){0,12})`,
    'gi',
  );
  for (const match of text.matchAll(compactListPattern)) {
    const monthName = match[1];
    const dayNumbers = String(match[2] || '')
      .split(/\s*,\s*/)
      .map((part) => Number(String(part).replace(/\D+/g, '')))
      .filter((day) => Number.isFinite(day) && day >= 1 && day <= 31);

    for (const day of dayNumbers) {
      pushKey(dateKeyFromDetailMonthDay(monthName, String(day), year));
    }
  }

  // May 8 to May 10 / May 8 - 10 / May 8 thru May 10
  const rangePattern = new RegExp(
    `\\b${monthWord}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*20\\d{2})?\\s*(?:-|–|to|through|thru)\\s*(?:(${monthWord})\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*20\\d{2})?`,
    'gi',
  );
  for (const match of text.matchAll(rangePattern)) {
    const startMonth = match[1];
    const startDay = Number(match[2]);
    const endMonth = match[3] || startMonth;
    const endDay = Number(match[4]);
    const startMonthNumber = monthNameToNumber(startMonth);
    const endMonthNumber = monthNameToNumber(endMonth);
    if (!startMonthNumber || !endMonthNumber || !startDay || !endDay) continue;

    const startDate = new Date(Date.UTC(year, startMonthNumber - 1, startDay, 12, 0, 0));
    const endDate = new Date(Date.UTC(year, endMonthNumber - 1, endDay, 12, 0, 0));
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) continue;

    const stepDate = new Date(startDate);
    let guard = 0;
    while (stepDate <= endDate && guard < 45) {
      pushKey(stepDate.toISOString().slice(0, 10));
      stepDate.setUTCDate(stepDate.getUTCDate() + 1);
      guard += 1;
    }
  }

  return keys.sort();
}

function saleMatchesRequestedDetailDate(sale = {}, requestedDay = '') {
  const normalizedRequestedDay = normalizeRequestedDay(requestedDay);
  const targetDateKey = getTargetDateKeyForRequestedDay(requestedDay);
  if (!targetDateKey && normalizedRequestedDay !== 'upcoming') return true;

  const hasFullAddress =
    sale.searchHasFullAddress === true ||
    streetHasHouseNumber(sale.street || '') ||
    streetHasHouseNumber(sale.addressLabel || '') ||
    streetHasHouseNumber(sale.mapAddress || '') ||
    streetHasHouseNumber(sale.displayAddress || '') ||
    streetHasHouseNumber(sale.address || '');

  const dateKeyCandidates = [];
  const pushDateKey = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return;

    const direct = raw.slice(0, 10);
    if (/^20\d{2}-\d{2}-\d{2}$/.test(direct)) {
      dateKeyCandidates.push(direct);
      return;
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      dateKeyCandidates.push(getChicagoDateKey(parsed));
    }
  };

  if (Array.isArray(sale.detailDateKeys)) {
    sale.detailDateKeys.forEach(pushDateKey);
  }

  if (Array.isArray(sale.scheduleEntries)) {
    for (const entry of sale.scheduleEntries) {
      pushDateKey(entry?.startDate);
      pushDateKey(entry?.startDateTime);
      pushDateKey(entry?.saleDate);
      pushDateKey(entry?.saleDateTime);
      pushDateKey(entry?.date);
    }
  }

  pushDateKey(sale.startDate);
  pushDateKey(sale.startDateTime);
  pushDateKey(sale.saleDate);
  pushDateKey(sale.saleDateTime);
  pushDateKey(sale.date);

  const uniqueDateKeyCandidates = Array.from(new Set(dateKeyCandidates.filter(Boolean)));
  const hasExactTodayDate = uniqueDateKeyCandidates.includes(targetDateKey);

  // Today rule, locked down:
  // A sale gets into Today only when it has a full address AND the sale's own
  // detail/listing date evidence shows today. If date keys exist and none are
  // today's date, it must stay out even if nearby snippet text says "Going on Now".
  if (normalizedRequestedDay === 'today') {
    if (!hasFullAddress) return false;

    if (hasExactTodayDate) return true;

    // If we have explicit date keys but none match today, trust those keys and reject it.
    // This blocks tomorrow sales with full addresses from sneaking into Today.
    if (uniqueDateKeyCandidates.length) return false;

    const todayWeekday = getChicagoDateParts(new Date()).weekday.toLowerCase();
    const todayShort = todayWeekday.slice(0, 3);
    const todayMonthDay = getChicagoMonthDayLabel(new Date()).toLowerCase();

    const searchableText = [
      sale.statusText,
      sale.dateText,
      sale.dayLabel,
      sale.dateLabel,
      sale.timeLabel,
      sale.rawSnippet,
      sale.descriptionPreview,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const saysToday =
      /\b(today|starts today|ends today|going on now)\b/i.test(searchableText) ||
      (searchableText.includes(todayShort) && searchableText.includes(todayMonthDay));

    return saysToday;
  }

  // Tomorrow rule:
  // 1) Full address + sale is going on tomorrow = pass.
  // 2) No full address + sale is going on tomorrow + Estate Sale badge = pass.
  //
  // Important: a sale that started today and also runs tomorrow must be shown
  // in Tomorrow too. Some EstateSales.net pages only expose today's date in
  // the primary structured field, while the visible text says "May 6, 7, 8".
  // So for Tomorrow we check both exact parsed date keys AND the sale's visible
  // date text for tomorrow evidence.
  // Today logic above is intentionally left untouched.
  if (normalizedRequestedDay === 'tomorrow') {
    const hasExactTomorrowDate = uniqueDateKeyCandidates.includes(targetDateKey);

    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowMonthDay = getChicagoMonthDayLabel(tomorrowDate).toLowerCase();
    const tomorrowWeekday = getChicagoDateParts(tomorrowDate).weekday.toLowerCase();
    const tomorrowShort = tomorrowWeekday.slice(0, 3);

    const searchableTomorrowText = [
      sale.statusText,
      sale.dateText,
      sale.dayLabel,
      sale.dateLabel,
      sale.timeLabel,
      sale.rawSnippet,
      sale.descriptionPreview,
      sale.bodyPreview,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const hasTomorrowTextEvidence =
      /\b(tomorrow|starts tomorrow|resumes tomorrow)\b/i.test(searchableTomorrowText) ||
      searchableTomorrowText.includes(tomorrowMonthDay) ||
      (searchableTomorrowText.includes(tomorrowShort) &&
        searchableTomorrowText.includes(tomorrowMonthDay));

    const isGoingOnTomorrow = hasExactTomorrowDate || hasTomorrowTextEvidence;

    if (!isGoingOnTomorrow) return false;

    if (hasFullAddress) return true;

    const badgeText = [
      sale.detailSaleBadge,
      sale.saleBadge,
      sale.saleType,
      sale.detailSaleBadgeConfirmed === true && isExactEstateSaleBadge(sale.detailSaleBadge) ? 'Estate Sale' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return /\bestate\s+sale\b/i.test(badgeText);
  }

  // Upcoming rule, locked down:
  // Upcoming means any confirmed sale date from day-after-tomorrow through
  // 14 days out. It must be confirmed from the sale detail page as exactly "Estate Sale".
  // This intentionally allows multi-day sales when one of their shown dates is
  // in the Upcoming window, but it still blocks sales that only show Today or
  // Tomorrow dates. Today/Tomorrow behavior above is untouched.
  if (normalizedRequestedDay === 'upcoming') {
    const todayKey = getChicagoDateKey(new Date());
    const dayAfterTomorrowKey = addDaysToDateKey(todayKey, 2);
    const maxUpcomingDateKey = addDaysToDateKey(todayKey, UPCOMING_MAX_DAYS_OUT);

    if (sale.detailFetched !== true) return false;
    if (sale.detailSaleBadgeConfirmed !== true) return false;
    if (!isExactEstateSaleBadge(sale.detailSaleBadge)) return false;

    const textDateKeys = collectSaleDateKeysFromText(
      [
        sale.dateText,
        sale.dateLabel,
        sale.dayLabel,
        sale.timeLabel,
        sale.rawSnippet,
        sale.descriptionPreview,
        sale.bodyPreview,
        sale.title,
      ]
        .filter(Boolean)
        .join(' '),
      getChicagoDateParts(new Date()).year,
    );

    const allDateKeys = Array.from(
      new Set([...uniqueDateKeyCandidates, ...textDateKeys].filter(Boolean)),
    )
      .filter((key) => /^20\d{2}-\d{2}-\d{2}$/.test(key))
      .sort();

    if (!allDateKeys.length) return false;

    return allDateKeys.some(
      (dateKey) => dateKey >= dayAfterTomorrowKey && dateKey <= maxUpcomingDateKey,
    );
  }

  if (hasExactTodayDate) return true;

  return saleMatchesRequestedDay(sale, requestedDay);
}

function getChicagoMonthDayLabel(date = new Date()) {
  const parts = getChicagoDateParts(date);
  if (!parts.month || !parts.day) return '';
  const monthLabels = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${monthLabels[parts.month] || ''} ${parts.day}`.trim();
}

function buildChicagoIsoDateTime(dateKey = '', timeLabel = '') {
  const cleanDateKey = String(dateKey || '').slice(0, 10);
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(cleanDateKey)) return '';

  const timeMatch = String(timeLabel || '').match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!timeMatch) return cleanDateKey;

  let hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2] || '0');
  const meridiem = String(timeMatch[3]).toLowerCase();
  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;

  return `${cleanDateKey}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
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
    title: detail.title || sale.title || '',
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
    isOnlineOnly: detail.isOnlineOnly === true || sale.isOnlineOnly === true,
    detailFetched: detail.detailFetched === true || sale.detailFetched === true,
    saleFormat: detail.saleFormat || sale.saleFormat || '',
    searchHasFullAddress:
      sale.searchHasFullAddress === true || streetHasHouseNumber(street),
    saleType: detail.saleType || sale.saleType || 'estate-sale',
    saleBadge: detail.saleBadge || sale.saleBadge || 'Estate Sale',
    detailSaleBadge: detail.detailSaleBadge || sale.detailSaleBadge || '',
    detailSaleBadgeConfirmed:
      detail.detailSaleBadgeConfirmed || sale.detailSaleBadgeConfirmed || false,
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
    detailDateKeys: Array.isArray(detail.detailDateKeys)
      ? detail.detailDateKeys
      : Array.isArray(sale.detailDateKeys)
        ? sale.detailDateKeys
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
    const detailTitle = extractDetailTitle(html);
    const detailSaleBadge = extractDetailSaleBadge(html);
    const isOnlineOnly = isOnlineOnlyEstateSaleText(html);

    const coords = extractCoordinatesFromHtml(html);
    const address =
      extractAddressFromJsonLd(html) ||
      extractAddressFromMeta(html) ||
      extractAddressFromInlineJson(html, fallbackLocation) ||
      extractStreetAddressFromVisibleText(html, fallbackLocation) ||
      {};
    const schedule =
      extractScheduleFromJsonLd(html) || extractDetailSchedule(html) || {};

    // Second verification: when a listing has a full address, the detail-page
    // schedule must include the requested date. Do NOT use the wide search-card
    // snippet for this proof because EstateSales.net can bleed nearby listing
    // dates into that snippet. Prefer the parsed detail schedule entries first;
    // only fall back to raw detail-card date extraction when the schedule parser
    // found no structured entries.
    const scheduleDateKeys = Array.isArray(schedule.scheduleEntries)
      ? Array.from(
          new Set(
            schedule.scheduleEntries
              .map((entry) => String(entry?.startDate || entry?.startDateTime || '').slice(0, 10))
              .filter((key) => /^20\d{2}-\d{2}-\d{2}$/.test(key)),
          ),
        ).sort()
      : [];
    const detailDateKeys = scheduleDateKeys.length
      ? scheduleDateKeys
      : extractDetailScheduleDateKeys(
          html,
          getChicagoDateParts(new Date()).year,
        );

    const detail = {
      title: detailTitle || '',
      detailFetched: true,
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
      isOnlineOnly,
      saleFormat: isOnlineOnly ? 'online-only-auction' : 'in-person-estate-sale',
      saleType: 'estate-sale',
      saleBadge: detailSaleBadge || 'Estate Sale',
      detailSaleBadge: detailSaleBadge || '',
      detailSaleBadgeConfirmed: isExactEstateSaleBadge(detailSaleBadge),
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
      detailDateKeys,
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

function extractEstateSaleLinksFromHtml(html = '') {
  const source = String(html || '');
  const links = [];
  const seen = new Set();

  const addLink = (rawHref = '', index = -1) => {
    if (!rawHref) return;

    let href = htmlDecode(String(rawHref || '').trim())
      .replace(/\\u002f/gi, '/')
      .replace(/\\\//g, '/')
      .replace(/^https?:\/\/www\.estatesales\.net/i, '')
      .replace(/^https?:\/\/estatesales\.net/i, '');

    const pathMatch = href.match(/\/(?:IL|IN)\/[^\s"'<>?#]+\/\d{5}\/\d+/i);
    if (!pathMatch?.[0]) return;

    href = decodeUrlPath(pathMatch[0]);
    const absoluteUrl = `https://www.estatesales.net${href}`;
    if (seen.has(absoluteUrl)) return;
    seen.add(absoluteUrl);
    links.push({ href, absoluteUrl, index });
  };

  const patterns = [
    /href=["']([^"']*\/(?:IL|IN)\/[^"'?#]+\/\d{5}\/\d+)(?:[?#][^"']*)?["']/gi,
    /["'](https?:\\?\/\\?\/www\.estatesales\.net\/(?:IL|IN)\/[^"'?#]+\/\d{5}\/\d+)(?:[?#][^"']*)?["']/gi,
    /["'](\/(?:IL|IN)\/[^"'?#]+\/\d{5}\/\d+)(?:[?#][^"']*)?["']/gi,
    /((?:https?:)?\\?\/\\?\/www\.estatesales\.net\\?\/IL\\?\/[^\s"'<>?#]+\\?\/\d{5}\\?\/\d+)/gi,
    /(\\?\/IL\\?\/[^\s"'<>?#]+\\?\/\d{5}\\?\/\d+)/gi,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      addLink(match[1] || match[0], match.index ?? -1);
    }
  }

  return links;
}


function extractSearchResultFullAddress(snippet = '', fallbackLocation = {}) {
  const text = stripHtml(snippet);
  if (!text) return null;

  const streetTypes =
    '(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Court|Ct|Circle|Cir|Boulevard|Blvd|Place|Pl|Way|Terrace|Ter|Parkway|Pkwy|Highway|Hwy|Trail|Trl|Cove|Cv|Loop|Square|Sq|Bell)';

  const fullAddressPatterns = [
    new RegExp(
      `\\b(\\d{2,6}[A-Za-z0-9-]*\\s+[A-Za-z0-9.'#&\\-\\s]{2,80}\\s+${streetTypes}\\.?)\\s*,\\s*([A-Za-z][A-Za-z.'\\-\\s]{2,40})\\s*,?\\s*(IL|Illinois|IN|Indiana)?\\s*(\\d{5})?\\b`,
      'i',
    ),
    new RegExp(
      `\\b(\\d{2,6}[A-Za-z0-9-]*\\s+[A-Za-z0-9.'#&\\-\\s]{2,80}\\s+${streetTypes}\\.?)\\s+([A-Za-z][A-Za-z.'\\-\\s]{2,40})\\s+(IL|Illinois|IN|Indiana)\\s*(\\d{5})?\\b`,
      'i',
    ),
  ];

  for (const pattern of fullAddressPatterns) {
    const match = text.match(pattern);
    if (!match) continue;

    const street = normalizeAddressLine(match[1] || '');
    const city = normalizeAddressLine(match[2] || fallbackLocation.city || '');
    const state = normalizeAddressLine(match[3] || fallbackLocation.state || 'IL');
    const zip = normalizeAddressLine(match[4] || fallbackLocation.zip || '');

    if (!streetHasHouseNumber(street) || !city) continue;

    const addressLabel = buildAddressLabel({ street, city, state, zip });
    if (!addressLabel) continue;

    return {
      street,
      city,
      state,
      zip,
      addressLabel,
      searchHasFullAddress: true,
    };
  }

  const visibleAddress = extractStreetAddressFromVisibleText(snippet, fallbackLocation);
  if (visibleAddress?.street && streetHasHouseNumber(visibleAddress.street)) {
    return {
      ...visibleAddress,
      searchHasFullAddress: true,
    };
  }

  return null;
}

function parseEstateSalesFromHtml(html, requestedZip, requestedDay = '') {
  const results = [];
  const seenUrls = new Set();

  // EstateSales.net puts a separate section lower on the page for sales that
  // did NOT match the active filters, for example "not happening today".
  // Do not parse those links into the app's Today list.
  const lowerHtml = String(html || '').toLowerCase();
  const normalizedRequestedDay = normalizeRequestedDay(requestedDay);

  const cutoffCandidates = [];

  // Important: only cut off EstateSales.net's lower "didn't match" sections for
  // Today. For Upcoming, those lower sections often contain legitimate future
  // rows inside the 14-day window, such as May 14-16 Aurora/Tinley Park sales.
  // If we trim the HTML before parsing links, those rows are never discovered
  // and the backend filter never gets a chance to approve them.
  if (normalizedRequestedDay === 'today') {
    cutoffCandidates.push(
      lowerHtml.indexOf("below are the sales that didn't quite match"),
      lowerHtml.indexOf('below are the sales that didn&#39;t quite match'),
      lowerHtml.indexOf('sales more than 50 miles away'),
      lowerHtml.indexOf('sales that are not happening today'),
    );
  }

  const validCutoffs = cutoffCandidates.filter((index) => index > 0);
  const cutoffIndex = validCutoffs.length ? Math.min(...validCutoffs) : -1;
  const searchableHtml = cutoffIndex > 0 ? html.slice(0, cutoffIndex) : html;

  const estateSaleLinks = extractEstateSaleLinksFromHtml(searchableHtml);

  for (const link of estateSaleLinks) {
    const href = link.href;
    if (!href) continue;

    const absoluteUrl = link.absoluteUrl;

    if (seenUrls.has(absoluteUrl)) continue;
    seenUrls.add(absoluteUrl);

    const index = Number.isFinite(link.index) ? link.index : searchableHtml.indexOf(href);
    if (index === -1) continue;

    // The live city/ZIP listing page puts a lot of useful data around the href:
    // title, company, pictures, street/city/ZIP, miles away, dates, times, status.
    // A wider window prevents the parser from dropping real listings when the
    // markup changes spacing/classes.
    const snippet = searchableHtml.slice(Math.max(0, index - 2600), index + 3200);

    if (!isCurrentOrUpcoming(snippet)) continue;
    // Do not exclude online-only sales from the wide listing-page snippet here.
    // The snippet window can include text from neighboring listings, which was
    // causing real in-person sales to be dropped when
    // an adjacent online auction appears nearby in the HTML. Fetch the detail
    // page first, then filter using detail-page evidence in shouldExcludeOnlineOnlySale().

    const location = extractLocationFromUrl(absoluteUrl);
    const searchAddress = extractSearchResultFullAddress(snippet, {
      city: location.city || '',
      state: location.state || 'IL',
      zip: location.zip || requestedZip || '',
    });
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
      saleBadge: 'Estate Sale',
      isOnlineOnly: false,
      saleFormat: '',
      detailSaleBadge: '',
      detailSaleBadgeConfirmed: false,
      detailFetched: false,
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
      street: searchAddress?.street || '',
      searchHasFullAddress: searchAddress?.searchHasFullAddress === true,
      mapAddress:
        searchAddress?.addressLabel ||
        [
          searchAddress?.city || location.city,
          searchAddress?.state || location.state || 'IL',
          searchAddress?.zip || location.zip || requestedZip || '',
        ]
          .filter(Boolean)
          .join(', '),
      mapsQuery:
        searchAddress?.addressLabel ||
        [
          searchAddress?.city || location.city,
          searchAddress?.state || location.state || 'IL',
          searchAddress?.zip || location.zip || requestedZip || '',
        ]
          .filter(Boolean)
          .join(', '),
      addressLabel:
        searchAddress?.addressLabel ||
        [
          searchAddress?.city || location.city,
          searchAddress?.state || location.state || 'IL',
          searchAddress?.zip || location.zip || requestedZip || '',
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


const ESTATE_SALES_CITY_ZIP_SEEDS = [
  // 50-mile Source Assist sweep around Naperville.
  // Each target is a real EstateSales.net city/ZIP page. The route fetches all
  // targets within the requested radius + a small buffer, then still applies the
  // final GPS radius filter after detail-page coordinates are known. This fixes
  // missed sales like Bolingbrook 60490 that do not always surface from only the
  // Naperville origin page.
  { city: 'Naperville', zip: '60565', latitude: 41.7508, longitude: -88.1535 },
  { city: 'Naperville', zip: '60563', latitude: 41.7990, longitude: -88.1450 },
  { city: 'Naperville', zip: '60540', latitude: 41.7670, longitude: -88.1487 },
  { city: 'Aurora', zip: '60504', latitude: 41.7456, longitude: -88.2152 },
  { city: 'Aurora', zip: '60506', latitude: 41.7706, longitude: -88.3431 },
  { city: 'Aurora', zip: '60502', latitude: 41.7865, longitude: -88.2556 },
  { city: 'North Aurora', zip: '60542', latitude: 41.8061, longitude: -88.3273 },
  { city: 'Plainfield', zip: '60544', latitude: 41.6160, longitude: -88.2039 },
  { city: 'Plainfield', zip: '60585', latitude: 41.7000, longitude: -88.2400 },
  { city: 'Oswego', zip: '60543', latitude: 41.6832, longitude: -88.3388 },
  { city: 'Montgomery', zip: '60538', latitude: 41.7306, longitude: -88.3459 },
  { city: 'Yorkville', zip: '60560', latitude: 41.6411, longitude: -88.4473 },
  { city: 'Sugar Grove', zip: '60554', latitude: 41.7614, longitude: -88.4437 },
  { city: 'Bolingbrook', zip: '60440', latitude: 41.7003, longitude: -88.0718 },
  { city: 'Bolingbrook', zip: '60490', latitude: 41.7050, longitude: -88.1250 },
  { city: 'Romeoville', zip: '60446', latitude: 41.6475, longitude: -88.0895 },
  { city: 'Lockport', zip: '60441', latitude: 41.5895, longitude: -88.0578 },
  { city: 'Crest Hill', zip: '60403', latitude: 41.5548, longitude: -88.0987 },
  { city: 'Joliet', zip: '60435', latitude: 41.5445, longitude: -88.1286 },
  { city: 'Joliet', zip: '60431', latitude: 41.5341, longitude: -88.1998 },
  { city: 'Joliet', zip: '60432', latitude: 41.5250, longitude: -88.0817 },
  { city: 'Shorewood', zip: '60404', latitude: 41.5200, longitude: -88.2017 },
  { city: 'Minooka', zip: '60447', latitude: 41.4553, longitude: -88.2617 },
  { city: 'Channahon', zip: '60410', latitude: 41.4295, longitude: -88.2287 },
  { city: 'Woodridge', zip: '60517', latitude: 41.7469, longitude: -88.0503 },
  { city: 'Darien', zip: '60561', latitude: 41.7519, longitude: -87.9739 },
  { city: 'Downers Grove', zip: '60515', latitude: 41.8089, longitude: -88.0112 },
  { city: 'Downers Grove', zip: '60516', latitude: 41.7675, longitude: -88.0140 },
  { city: 'Lisle', zip: '60532', latitude: 41.8011, longitude: -88.0748 },
  { city: 'Warrenville', zip: '60555', latitude: 41.8178, longitude: -88.1734 },
  { city: 'Winfield', zip: '60190', latitude: 41.8703, longitude: -88.1609 },
  { city: 'Wheaton', zip: '60187', latitude: 41.8661, longitude: -88.1070 },
  { city: 'Wheaton', zip: '60189', latitude: 41.8358, longitude: -88.1012 },
  { city: 'Glen Ellyn', zip: '60137', latitude: 41.8775, longitude: -88.0670 },
  { city: 'Lombard', zip: '60148', latitude: 41.8800, longitude: -88.0078 },
  { city: 'Villa Park', zip: '60181', latitude: 41.8898, longitude: -87.9789 },
  { city: 'Batavia', zip: '60510', latitude: 41.8500, longitude: -88.3126 },
  { city: 'Geneva', zip: '60134', latitude: 41.8875, longitude: -88.3054 },
  { city: 'St Charles', zip: '60174', latitude: 41.9137, longitude: -88.3110 },
  { city: 'South Elgin', zip: '60177', latitude: 41.9942, longitude: -88.2923 },
  { city: 'Elgin', zip: '60120', latitude: 42.0354, longitude: -88.2826 },
  { city: 'New Lenox', zip: '60451', latitude: 41.5119, longitude: -87.9656 },
  { city: 'Mokena', zip: '60448', latitude: 41.5261, longitude: -87.8892 },
  { city: 'Frankfort', zip: '60423', latitude: 41.4959, longitude: -87.8487 },
  { city: 'Lemont', zip: '60439', latitude: 41.6736, longitude: -87.9876 },
  { city: 'Homer Glen', zip: '60491', latitude: 41.6000, longitude: -87.9381 },
  { city: 'Orland Park', zip: '60462', latitude: 41.6303, longitude: -87.8539 },
  { city: 'Tinley Park', zip: '60477', latitude: 41.5734, longitude: -87.7845 },
  { city: 'Tinley Park', zip: '60487', latitude: 41.5652, longitude: -87.8308 },
  { city: 'Palos Heights', zip: '60463', latitude: 41.6681, longitude: -87.7964 },
  { city: 'Oak Forest', zip: '60452', latitude: 41.6028, longitude: -87.7439 },
  { city: 'Alsip', zip: '60803', latitude: 41.6689, longitude: -87.7387 },
  { city: 'Willowbrook', zip: '60527', latitude: 41.7698, longitude: -87.9359 },
  { city: 'Burr Ridge', zip: '60527', latitude: 41.7489, longitude: -87.9184 },
  { city: 'Hinsdale', zip: '60521', latitude: 41.8009, longitude: -87.9370 },
  { city: 'Oak Brook', zip: '60523', latitude: 41.8398, longitude: -87.9536 },
  { city: 'Elmhurst', zip: '60126', latitude: 41.8995, longitude: -87.9403 },
  { city: 'Addison', zip: '60101', latitude: 41.9317, longitude: -87.9889 },
  { city: 'Carol Stream', zip: '60188', latitude: 41.9125, longitude: -88.1348 },
  { city: 'Bartlett', zip: '60103', latitude: 41.9950, longitude: -88.1856 },
  { city: 'Streamwood', zip: '60107', latitude: 42.0256, longitude: -88.1784 },
  { city: 'Roselle', zip: '60172', latitude: 41.9847, longitude: -88.0798 },
  { city: 'Schaumburg', zip: '60193', latitude: 42.0216, longitude: -88.0798 },
  { city: 'La Grange', zip: '60525', latitude: 41.8050, longitude: -87.8692 },
  { city: 'Western Springs', zip: '60558', latitude: 41.8098, longitude: -87.9006 },
  { city: 'Brookfield', zip: '60513', latitude: 41.8239, longitude: -87.8517 },
  { city: 'Berwyn', zip: '60402', latitude: 41.8506, longitude: -87.7937 },
  { city: 'Oak Park', zip: '60302', latitude: 41.8917, longitude: -87.7897 },
  { city: 'Riverside', zip: '60546', latitude: 41.8350, longitude: -87.8228 },
  { city: 'Forest Park', zip: '60130', latitude: 41.8795, longitude: -87.8137 },
  { city: 'Chicago', zip: '60655', latitude: 41.6947, longitude: -87.7037 },
  { city: 'Chicago', zip: '60643', latitude: 41.7002, longitude: -87.6628 },
  { city: 'Chicago', zip: '60652', latitude: 41.7460, longitude: -87.7140 },
  { city: 'Chicago', zip: '60638', latitude: 41.7870, longitude: -87.7710 },
  { city: 'Chicago', zip: '60629', latitude: 41.7759, longitude: -87.7115 },
  { city: 'Chicago', zip: '60641', latitude: 41.9460, longitude: -87.7460 },
  { city: 'Chicago', zip: '60618', latitude: 41.9465, longitude: -87.7024 },
  { city: 'Chicago', zip: '60624', latitude: 41.8810, longitude: -87.7220 },
  { city: 'Chicago', zip: '60660', latitude: 41.9910, longitude: -87.6660 },
  { city: 'Chicago', zip: '60626', latitude: 42.0090, longitude: -87.6690 },
  { city: 'Chicago', zip: '60622', latitude: 41.9020, longitude: -87.6810 },
  { city: 'Evanston', zip: '60201', latitude: 42.0641, longitude: -87.7322 },
  { city: 'Skokie', zip: '60076', latitude: 42.0347, longitude: -87.7571 },
  { city: 'Des Plaines', zip: '60016', latitude: 42.0451, longitude: -87.8869 },
  { city: 'Arlington Heights', zip: '60004', latitude: 42.1139, longitude: -87.9806 },
  { city: 'Wheeling', zip: '60090', latitude: 42.1396, longitude: -87.9455 },
  { city: 'Gary', zip: '46410', state: 'IN', latitude: 41.4839, longitude: -87.3328 },
  { city: 'Dyer', zip: '46311', state: 'IN', latitude: 41.4942, longitude: -87.5217 },
  { city: 'St John', zip: '46373', state: 'IN', latitude: 41.4500, longitude: -87.4700 },
  { city: 'Saint John', zip: '46373', state: 'IN', latitude: 41.4500, longitude: -87.4700 },
  { city: 'Schererville', zip: '46375', state: 'IN', latitude: 41.4789, longitude: -87.4548 },
  { city: 'Merrillville', zip: '46410', state: 'IN', latitude: 41.4828, longitude: -87.3328 },
];

function normalizeCitySlug(city = '') {
  return String(city || 'Naperville')
    .split(',')[0]
    .trim()
    .replace(/\s+/g, '-');
}

function getEstateSalesSearchTargets(
  requestedZip = '60565',
  requestedCity = 'Naperville',
  _requestedRadiusMiles = 50,
  requestedOrigin = {},
) {
  const targets = [];
  const seen = new Set();

  const addTarget = (city, zip, state = 'IL', latitude = null, longitude = null, distanceFromOrigin = null) => {
    const cleanCity = String(city || '').split(',')[0].trim();
    const cleanZip = String(zip || '').trim().replace(/[^0-9]/g, '');
    if (!cleanCity || !cleanZip) return;
    const key = `${cleanCity.toLowerCase()}|${cleanZip}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({
      city: cleanCity,
      zip: cleanZip,
      state: String(state || 'IL').toUpperCase(),
      latitude,
      longitude,
      distanceFromOrigin,
    });
  };

  const radius = Number(_requestedRadiusMiles) || 50;
  const originLatitude = Number(requestedOrigin?.latitude);
  const originLongitude = Number(requestedOrigin?.longitude);
  const hasOriginCoordinates = Number.isFinite(originLatitude) && Number.isFinite(originLongitude);
  const radiusBufferMiles = radius >= 50 ? 8 : 4;

  // Always fetch the user's selected origin page first.
  addTarget(requestedCity || 'Naperville', requestedZip || '60565');

  const seedCandidates = ESTATE_SALES_CITY_ZIP_SEEDS
    .map((seed) => {
      const seedLatitude = Number(seed.latitude);
      const seedLongitude = Number(seed.longitude);
      const distanceFromOrigin = hasOriginCoordinates && Number.isFinite(seedLatitude) && Number.isFinite(seedLongitude)
        ? calculateDistanceMiles(originLatitude, originLongitude, seedLatitude, seedLongitude)
        : null;

      return {
        ...seed,
        distanceFromOrigin,
      };
    })
    .filter((seed) => {
      // If GPS coordinates are available, use them to make this a real radius
      // sweep instead of a hard-coded handful of city pages. The small buffer
      // keeps edge-of-radius sales discoverable before the final detail-page
      // radius filter runs.
      if (hasOriginCoordinates && Number.isFinite(seed.distanceFromOrigin)) {
        return seed.distanceFromOrigin <= radius + radiusBufferMiles;
      }

      // Without GPS, keep the curated list broad for 50 miles and narrower for
      // smaller radius requests.
      return radius >= 50 || String(seed.zip || '') === String(requestedZip || '');
    })
    .sort((a, b) => {
      const aDistance = Number.isFinite(a.distanceFromOrigin) ? a.distanceFromOrigin : Number.MAX_SAFE_INTEGER;
      const bDistance = Number.isFinite(b.distanceFromOrigin) ? b.distanceFromOrigin : Number.MAX_SAFE_INTEGER;
      return aDistance - bDistance;
    });

  seedCandidates.forEach((seed) => {
    addTarget(seed.city, seed.zip, seed.state || 'IL', seed.latitude, seed.longitude, seed.distanceFromOrigin);
  });

  return targets;
}


function makeAbsoluteEstateSalesUrl(href = '', baseUrl = 'https://www.estatesales.net/') {
  const raw = String(href || '').trim();
  if (!raw) return '';

  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return '';
  }
}

function isEstateSalesListingDetailUrl(url = '') {
  return /\/((?:IL|IN))\/[^/]+\/\d{5}\/\d+(?:[/?#]|$)/i.test(String(url || ''));
}

function extractPaginationUrlsFromHtml(html = '', currentUrl = '') {
  const pageUrls = [];
  const seen = new Set();
  const source = String(html || '');

  const pushUrl = (href = '') => {
    const absoluteUrl = makeAbsoluteEstateSalesUrl(href, currentUrl);
    if (!absoluteUrl) return;
    if (!/^https:\/\/www\.estatesales\.net\//i.test(absoluteUrl)) return;
    if (isEstateSalesListingDetailUrl(absoluteUrl)) return;
    if (absoluteUrl.split('#')[0] === String(currentUrl || '').split('#')[0]) return;
    if (seen.has(absoluteUrl)) return;
    seen.add(absoluteUrl);
    pageUrls.push(absoluteUrl);
  };

  // Prefer explicit pagination/next links from the live page.
  for (const match of source.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const tag = match[0] || '';
    const href = htmlDecode(match[1] || '');
    const label = stripHtml(match[2] || '').toLowerCase();
    const tagText = stripHtml(tag).toLowerCase();
    const searchable = `${tag.toLowerCase()} ${label} ${tagText} ${href.toLowerCase()}`;

    if (
      /\bnext\b/.test(searchable) ||
      /aria-label=["']next/i.test(tag) ||
      /rel=["']next/i.test(tag) ||
      /(?:[?&](?:page|p|pg|pageNumber|currentPage)=\d+)/i.test(href)
    ) {
      pushUrl(href);
    }
  }

  return pageUrls;
}

function addQueryParamToUrl(url = '', key = '', value = '') {
  if (!url || !key) return '';
  try {
    const parsed = new URL(url);
    parsed.searchParams.set(key, String(value));
    return parsed.toString();
  } catch {
    return '';
  }
}

function getSpeculativePaginationUrls(baseUrl = '', pageNumber = 2) {
  const keys = ['page', 'p', 'pg', 'pageNumber', 'currentPage'];
  return keys
    .map((key) => addQueryParamToUrl(baseUrl, key, pageNumber))
    .filter(Boolean);
}

async function fetchEstateSalesListingPage(url = '', target = {}, requestedDay = '') {
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
  const parsed = parseEstateSalesFromHtml(html, target?.zip || '60565', requestedDay);
  return { html, parsed };
}

async function fetchEstateSalesListingPages(baseUrl = '', target = {}, requestedDay = '') {
  const normalizedRequestedDay = normalizeRequestedDay(requestedDay);
  const maxPages = normalizedRequestedDay === 'upcoming'
    ? ESTATE_SALES_UPCOMING_PAGE_LIMIT
    : ESTATE_SALES_DEFAULT_PAGE_LIMIT;
  const allParsed = [];
  const visitedUrls = new Set();
  const queuedUrls = [baseUrl];

  for (let pageIndex = 0; pageIndex < queuedUrls.length && pageIndex < maxPages; pageIndex += 1) {
    const pageUrl = queuedUrls[pageIndex];
    if (!pageUrl || visitedUrls.has(pageUrl)) continue;
    visitedUrls.add(pageUrl);

    const { html, parsed } = await fetchEstateSalesListingPage(pageUrl, target, requestedDay);
    allParsed.push(...parsed);

    console.log(
      `[estate-sales-route] ${ESTATE_ROUTE_VERSION} PAGE_FETCH zip=${target?.zip} city=${target?.city} page=${pageIndex + 1}/${maxPages} parsed=${parsed.length} url=${pageUrl}`,
    );

    if (maxPages <= 1) continue;

    const nextUrls = extractPaginationUrlsFromHtml(html, pageUrl);
    for (const nextUrl of nextUrls) {
      if (!visitedUrls.has(nextUrl) && !queuedUrls.includes(nextUrl)) {
        queuedUrls.push(nextUrl);
      }
    }

    // Some EstateSales.net builds do not expose ordinary <a> next links in the
    // server-rendered HTML. For Upcoming only, try a small set of common page
    // query names. Duplicate/unsupported pages collapse harmlessly during URL
    // de-dupe, but this gives the scraper a chance to reach May 14-16 style rows.
    if (normalizedRequestedDay === 'upcoming' && pageIndex === 0 && queuedUrls.length < maxPages) {
      for (let pageNumber = 2; pageNumber <= maxPages; pageNumber += 1) {
        for (const speculativeUrl of getSpeculativePaginationUrls(baseUrl, pageNumber)) {
          if (!visitedUrls.has(speculativeUrl) && !queuedUrls.includes(speculativeUrl)) {
            queuedUrls.push(speculativeUrl);
          }
        }
      }
    }
  }

  return dedupeSales(allParsed);
}

async function fetchEstateSalesForTarget(target, radiusMiles = 50, requestedDay = '') {
  const rawZip = String(target?.zip || '60565').trim();
  const safeZip = encodeURIComponent(rawZip);
  const safeRadius = encodeURIComponent(String(radiusMiles || 50));
  const citySlug = encodeURIComponent(normalizeCitySlug(target?.city || 'Naperville'));

  // v37 fix: do not put a regex-looking string in the live URL.
  // v36 was requesting /(?:IL|IN)/City/ZIP, which EstateSales.net does not serve,
  // so every target parsed as zero. Build a real state path instead.
  const inferredState = String(target?.state || (rawZip === '46373' ? 'IN' : 'IL')).toUpperCase();
  const safeState = inferredState === 'IN' ? 'IN' : 'IL';

  const urlsToTry = [
    // Real live listing page format. This is the page that currently shows the
    // actual EstateSales.net rows for the user's selected origin.
    `https://www.estatesales.net/${safeState}/${citySlug}/${safeZip}?radius=${safeRadius}`,
    `https://www.estatesales.net/${safeState}/${citySlug}/${safeZip}`,
    // Last-resort same-origin fallback.
    `https://www.estatesales.net/sales/advancedSearch?zip=${safeZip}&radius=${safeRadius}`,
  ];

  let lastError = null;

  for (const url of urlsToTry) {
    try {
      console.log('EstateSales URL:', url);

      const parsed = await fetchEstateSalesListingPages(url, target, requestedDay);

      console.log(
        `[estate-sales-route] ${ESTATE_ROUTE_VERSION} CITY_TARGET zip=${target?.zip} city=${citySlug} radius=${safeRadius} parsed=${parsed.length} url=${url}`,
      );

      // If a URL succeeds but produces no listings, try the next shape. If it
      // produces listings, stop here so the same target does not multiply dupes.
      if (parsed.length > 0) return parsed;
    } catch (error) {
      lastError = error;
      console.warn(
        `[estate-sales-route] ${ESTATE_ROUTE_VERSION} target fetch failed zip=${target?.zip} city=${citySlug} radius=${safeRadius} url=${url}: ${error.message}`,
      );
    }
  }

  if (lastError) {
    console.warn(
      `[estate-sales-route] ${ESTATE_ROUTE_VERSION} all target URLs failed zip=${target?.zip} city=${target?.city}: ${lastError.message}`,
    );
  }

  return [];
}

async function fetchEstateSalesForTargets(
  targets = [],
  radiusMiles = 50,
  requestedDay = '',
) {
  const targetResults = await mapWithConcurrency(
    targets,
    ZIP_FETCH_CONCURRENCY,
    async (target) => fetchEstateSalesForTarget(target, radiusMiles, requestedDay),
  );

  return targetResults.flat().filter(Boolean);
}

async function fetchEstateSalesForZip(zip, radiusMiles = 50, city = 'Naperville', requestedDay = '') {
  return fetchEstateSalesForTarget({ zip, city }, radiusMiles, requestedDay);
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

function normalizeSaleUrlForDedupe(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return raw.split(/[?#]/)[0].replace(/\/$/, '').toLowerCase();
  }
}

function getSaleDedupeKey(sale = {}) {
  const sourceListingId = String(sale.sourceListingId || '').trim();
  if (sourceListingId) return `source-id:${sourceListingId}`;

  const normalizedUrl =
    normalizeSaleUrlForDedupe(sale.url) ||
    normalizeSaleUrlForDedupe(sale.externalUrl) ||
    normalizeSaleUrlForDedupe(sale.website) ||
    normalizeSaleUrlForDedupe(sale.craigslistUrl);
  if (normalizedUrl) return `url:${normalizedUrl}`;

  return `fallback:${[sale.title, sale.city, sale.state, sale.zip, sale.dateText]
    .map((part) => String(part || '').trim().toLowerCase())
    .filter(Boolean)
    .join('|')}`;
}

function getSaleQualityScore(sale = {}) {
  return (
    (sale.detailFetched === true ? 80 : 0) +
    (sale.detailSaleBadgeConfirmed === true ? 60 : 0) +
    (isExactEstateSaleBadge(sale.detailSaleBadge) ? 50 : 0) +
    (sale.saleFormat === 'in-person-estate-sale' ? 35 : 0) +
    (sale.coordinateSource === 'detail-page' ? 25 : 0) +
    (sale.street ? 25 : 0) +
    (sale.addressLabel ? 15 : 0) +
    (sale.dateText ? 10 : 0) +
    (Array.isArray(sale.scheduleEntries) ? sale.scheduleEntries.length * 8 : 0) +
    (Array.isArray(sale.detailDateKeys) ? sale.detailDateKeys.length * 6 : 0) +
    (sale.statusText ? 5 : 0) +
    (sale.imageCount || 0)
  );
}

function dedupeSales(sales = []) {
  const map = new Map();

  for (const sale of sales) {
    const key = getSaleDedupeKey(sale);

    if (!map.has(key)) {
      map.set(key, sale);
      continue;
    }

    const existing = map.get(key);
    if (getSaleQualityScore(sale) > getSaleQualityScore(existing)) {
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
    if (Number.isFinite(effectiveDistance)) {
      return effectiveDistance <= requestedRadiusMiles;
    }

    // Do not drop a Today sale just because EstateSales.net did not expose
    // coordinates. A full address is the stronger day-of signal, and the
    // frontend can still route/map it by address.
    return Boolean(
      sale.searchHasFullAddress === true ||
        streetHasHouseNumber(sale.street || '') ||
        streetHasHouseNumber(sale.addressLabel || '') ||
        streetHasHouseNumber(sale.mapAddress || ''),
    );
  });
}

function normalizeRequestedDay(value = '') {
  const normalized = String(value).trim().toLowerCase().replace(/\./g, '');

  if (normalized === 'today') return 'today';
  if (normalized === 'tomorrow') return 'tomorrow';
  if (['upcoming', 'future', 'later'].includes(normalized)) return 'upcoming';
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

  return normalizeRequestedDay(getChicagoDateParts(parsed).weekday || '');
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
    const requestedDateKey = getDateKeyForRequestedDay(normalizedRequestedDay);
    const dateKeyCandidates = [];

    const pushDateKey = (value) => {
      const raw = String(value || '').trim();
      const direct = raw.slice(0, 10);
      if (/^20\d{2}-\d{2}-\d{2}$/.test(direct)) {
        dateKeyCandidates.push(direct);
        return;
      }

      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) {
        dateKeyCandidates.push(getChicagoDateKey(parsed));
      }
    };

    pushDateKey(sale.startDate);
    pushDateKey(sale.startDateTime);
    pushDateKey(sale.saleDate);
    pushDateKey(sale.saleDateTime);
    pushDateKey(sale.date);

    if (Array.isArray(sale.scheduleEntries)) {
      for (const entry of sale.scheduleEntries) {
        pushDateKey(entry?.startDate);
        pushDateKey(entry?.startDateTime);
        pushDateKey(entry?.saleDate);
        pushDateKey(entry?.saleDateTime);
        pushDateKey(entry?.date);
      }
    }

    const uniqueDateKeys = Array.from(new Set(dateKeyCandidates.filter(Boolean)));
    if (uniqueDateKeys.length) return uniqueDateKeys.includes(requestedDateKey);

    const comparableDates = getSaleDatesForComparison(sale);
    if (!comparableDates.length) return false;

    return comparableDates.some((comparableDate) => getChicagoDateKey(comparableDate) === requestedDateKey);
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

  // Upcoming needs special handling because EstateSales.net often exposes the
  // first day of a multi-day sale in structured detail data, while the visible
  // sale card shows the full run like "May 6, 7, 8". For Upcoming, the backend
  // response should be projected to the first date that is two days out or later,
  // capped at 14 days out, so the app never renders it as a Today/Tomorrow
  // result or floods with far-future listings.
  if (normalizedRequestedDay === 'upcoming') {
    const todayKey = getChicagoDateKey(new Date());
    const dayAfterTomorrowKey = addDaysToDateKey(todayKey, 2);
    const maxUpcomingDateKey = addDaysToDateKey(todayKey, UPCOMING_MAX_DAYS_OUT);
    const dateKeys = [];
    const seenDateKeys = new Set();
    const pushDateKey = (value) => {
      const raw = String(value || '').trim();
      if (!raw) return;

      const direct = raw.slice(0, 10);
      if (/^20\d{2}-\d{2}-\d{2}$/.test(direct)) {
        if (!seenDateKeys.has(direct)) {
          seenDateKeys.add(direct);
          dateKeys.push(direct);
        }
        return;
      }

      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) {
        const key = getChicagoDateKey(parsed);
        if (!seenDateKeys.has(key)) {
          seenDateKeys.add(key);
          dateKeys.push(key);
        }
      }
    };

    if (Array.isArray(sale.detailDateKeys)) sale.detailDateKeys.forEach(pushDateKey);
    if (Array.isArray(sale.saleDateKeys)) sale.saleDateKeys.forEach(pushDateKey);
    entries.forEach((entry) => {
      pushDateKey(entry?.startDate);
      pushDateKey(entry?.startDateTime);
      pushDateKey(entry?.saleDate);
      pushDateKey(entry?.saleDateTime);
      pushDateKey(entry?.date);
    });
    pushDateKey(sale.startDate);
    pushDateKey(sale.startDateTime);
    pushDateKey(sale.saleDate);
    pushDateKey(sale.saleDateTime);
    pushDateKey(sale.date);

    collectSaleDateKeysFromText(
      [
        sale.dateText,
        sale.dateLabel,
        sale.dayLabel,
        sale.timeLabel,
        sale.rawSnippet,
        sale.descriptionPreview,
        sale.bodyPreview,
        sale.title,
      ]
        .filter(Boolean)
        .join(' '),
      getChicagoDateParts(new Date()).year,
    ).forEach(pushDateKey);

    const futureDateKeys = dateKeys
      .filter(
        (key) =>
          /^20\d{2}-\d{2}-\d{2}$/.test(key) &&
          key >= dayAfterTomorrowKey &&
          key <= maxUpcomingDateKey,
      )
      .sort();

    if (!futureDateKeys.length) return sale;

    const futureEntries = entries
      .map((entry) => {
        const entryKey = String(
          entry?.startDate || entry?.saleDate || entry?.date || entry?.startDateTime || entry?.saleDateTime || '',
        ).slice(0, 10);
        return /^20\d{2}-\d{2}-\d{2}$/.test(entryKey) &&
          entryKey >= dayAfterTomorrowKey &&
          entryKey <= maxUpcomingDateKey
          ? { ...entry, startDate: entryKey }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));

    const firstFutureKey = futureDateKeys[0];
    const matchedEntry =
      futureEntries.find((entry) => String(entry.startDate).slice(0, 10) === firstFutureKey) ||
      {
        dayLabel: weekdayLabelFromDateKey(firstFutureKey),
        dateLabel: monthDayLabelFromDateKey(firstFutureKey),
        timeLabel: stripLeadingWeekdayFromTime(sale.timeLabel || sale.openingHours || ''),
        startTime: sale.startTime || '',
        endTime: sale.endTime || '',
        startDate: firstFutureKey,
        startDateTime: buildChicagoIsoDateTime(
          firstFutureKey,
          sale.startTime || sale.timeLabel || sale.openingHours || '',
        ),
        sortTimestamp: parseDateKeyToLocalDate(firstFutureKey)?.getTime() || 0,
      };

    const projectedScheduleEntries = futureDateKeys.map((key) => {
      const existingEntry = futureEntries.find(
        (entry) => String(entry.startDate || '').slice(0, 10) === key,
      );
      if (existingEntry) {
        return {
          ...existingEntry,
          dayLabel: existingEntry.dayLabel || weekdayLabelFromDateKey(key),
          dateLabel: existingEntry.dateLabel || monthDayLabelFromDateKey(key),
          startDate: key,
          startDateTime:
            existingEntry.startDateTime ||
            buildChicagoIsoDateTime(key, existingEntry.startTime || existingEntry.timeLabel || sale.timeLabel || ''),
        };
      }

      return {
        dayLabel: weekdayLabelFromDateKey(key),
        dateLabel: monthDayLabelFromDateKey(key),
        timeLabel: stripLeadingWeekdayFromTime(sale.timeLabel || sale.openingHours || ''),
        startTime: sale.startTime || '',
        endTime: sale.endTime || '',
        startDate: key,
        startDateTime: buildChicagoIsoDateTime(key, sale.startTime || sale.timeLabel || sale.openingHours || ''),
        sortTimestamp: parseDateKeyToLocalDate(key)?.getTime() || 0,
      };
    });

    return {
      ...sale,
      dayLabel: matchedEntry.dayLabel || weekdayLabelFromDateKey(firstFutureKey) || '',
      dateLabel: matchedEntry.dateLabel || monthDayLabelFromDateKey(firstFutureKey) || '',
      timeLabel: stripLeadingWeekdayFromTime(matchedEntry.timeLabel || sale.timeLabel || ''),
      startTime: matchedEntry.startTime || sale.startTime || '',
      endTime: matchedEntry.endTime || sale.endTime || '',
      startDate: firstFutureKey,
      startDateTime: matchedEntry.startDateTime || buildChicagoIsoDateTime(firstFutureKey, matchedEntry.startTime || matchedEntry.timeLabel || ''),
      saleDate: firstFutureKey,
      saleDateTime: matchedEntry.startDateTime || buildChicagoIsoDateTime(firstFutureKey, matchedEntry.startTime || matchedEntry.timeLabel || ''),
      date: firstFutureKey,
      detailDateKeys: futureDateKeys,
      saleDateKeys: futureDateKeys,
      scheduleEntries: projectedScheduleEntries,
    };
  }

  const matchingEntries = entries.filter((entry) => {
    if (requestedWindow) {
      const requestedDateKey = getDateKeyForRequestedDay(normalizedRequestedDay);
      const directKey = String(entry?.startDate || entry?.saleDate || entry?.date || '').slice(0, 10);
      if (/^20\d{2}-\d{2}-\d{2}$/.test(directKey)) return directKey === requestedDateKey;

      const entryDates = getSaleDatesForComparison(entry || {});
      return entryDates.some((entryDate) => getChicagoDateKey(entryDate) === requestedDateKey);
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

  // Keep the date that was projected for the selected day at the front.
  // The mobile UI may compute the visible weekday from saleDate/saleDateKeys,
  // so a multi-day sale running May 2-May 5 must output May 3 when Today is
  // May 3, not the first day of the sale range.
  const projectedDateKey = String(
    sale.startDate ||
      sale.saleDate ||
      sale.date ||
      sale.startDateTime ||
      sale.saleDateTime ||
      '',
  )
    .trim()
    .slice(0, 10);

  const rawSaleDateKeys = Array.from(
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

  const saleDateKeys = /^20\d{2}-\d{2}-\d{2}$/.test(projectedDateKey)
    ? [
        projectedDateKey,
        ...rawSaleDateKeys.filter((key) => key !== projectedDateKey),
      ]
    : rawSaleDateKeys;

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
  const saleDate =
    (/^20\d{2}-\d{2}-\d{2}$/.test(projectedDateKey)
      ? projectedDateKey
      : '') ||
    saleDateKeys[0] ||
    sale.startDate ||
    sale.saleDate ||
    '';
  const matchingScheduleEntry = scheduleEntries.find(
    (entry) => String(entry?.startDate || '').slice(0, 10) === saleDate,
  );
  const saleDateTime =
    sale.startDateTime ||
    matchingScheduleEntry?.startDateTime ||
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
    dayLabel: sale.dayLabel || weekdayLabelFromDateKey(saleDate) || '',
    dateLabel: sale.dateLabel || monthDayLabelFromDateKey(saleDate) || '',
    timeLabel: sale.timeLabel || matchingScheduleEntry?.timeLabel || '',
    openingHours:
      sale.timeLabel || matchingScheduleEntry?.timeLabel || sale.openingHours || '',
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



function getLocalDateKeyFromDate(date = new Date()) {
  return getChicagoDateKey(date);
}

function getDateKeyForRequestedDay(requestedDay = '') {
  const normalizedRequestedDay = normalizeRequestedDay(requestedDay);
  const date = new Date();
  date.setHours(12, 0, 0, 0);

  if (normalizedRequestedDay === 'tomorrow') {
    date.setDate(date.getDate() + 1);
  }

  if (normalizedRequestedDay === 'today' || normalizedRequestedDay === 'tomorrow') {
    return getLocalDateKeyFromDate(date);
  }

  return '';
}

function parseDateKeyToLocalDate(dateKey = '') {
  const match = String(dateKey || '').match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function weekdayLabelFromDateKey(dateKey = '') {
  const date = parseDateKeyToLocalDate(dateKey);
  if (!date) return '';
  return normalizeWeekdayLabel(date.toLocaleDateString('en-US', { weekday: 'long' }));
}

function monthDayLabelFromDateKey(dateKey = '') {
  const date = parseDateKeyToLocalDate(dateKey);
  if (!date) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function buildNoonDateKey(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!y || !m || !d) return '';
  const date = new Date(y, m - 1, d, 12, 0, 0, 0);
  if (Number.isNaN(date.getTime())) return '';
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return '';
  return getLocalDateKeyFromDate(date);
}

function inferYearForVisibleEstateSalesDate(monthNumber, dayNumber, explicitYear = null) {
  if (explicitYear) return explicitYear;

  const now = new Date();
  const currentYear = now.getFullYear();
  const candidate = new Date(currentYear, Number(monthNumber) - 1, Number(dayNumber), 12, 0, 0, 0);
  const today = new Date(currentYear, now.getMonth(), now.getDate(), 12, 0, 0, 0);

  // EstateSales.net listing pages often omit the year. Treat dates within the
  // normal live-listing window as the current year, and only roll forward for
  // dates that are clearly many months behind us.
  if (candidate.getTime() < today.getTime() - 1000 * 60 * 60 * 24 * 120) {
    return currentYear + 1;
  }

  return currentYear;
}

function dateKeyFromVisibleMonthDay(monthName = '', day = '', explicitYear = null) {
  const monthNumber = monthNameToNumber(monthName);
  const dayNumber = Number(String(day || '').replace(/\D+/g, ''));
  if (!monthNumber || !dayNumber) return '';
  const year = inferYearForVisibleEstateSalesDate(monthNumber, dayNumber, explicitYear);
  return buildNoonDateKey(year, monthNumber, dayNumber);
}

function expandDateKeyRange(startKey = '', endKey = '') {
  const start = parseDateKeyToLocalDate(startKey);
  const end = parseDateKeyToLocalDate(endKey || startKey);
  if (!start || !end) return [];
  if (end.getTime() < start.getTime()) return [startKey];

  const keys = [];
  const cursor = new Date(start);
  let guard = 0;

  while (cursor.getTime() <= end.getTime() && guard < 21) {
    keys.push(getLocalDateKeyFromDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }

  return keys;
}

function extractVisibleEstateSalesDateKeys(text = '') {
  const clean = stripHtml(text);
  const keys = [];
  const seen = new Set();

  const pushKey = (key) => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    keys.push(key);
  };

  const monthWord = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?';

  // Handles true ranges: "May 2 to May 5", "Apr 30 to May 5", "May 2 - 5".
  const rangePattern = new RegExp(
    `\\b${monthWord}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,\\s*(20\\d{2}))?\\s*(?:-|–|to|through|thru)\\s*(?:${monthWord}\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:,\\s*(20\\d{2}))?`,
    'gi',
  );

  for (const match of clean.matchAll(rangePattern)) {
    const startMonth = match[1];
    const startDay = match[2];
    const startYear = match[3] ? Number(match[3]) : null;
    const endMonth = match[4] || startMonth;
    const endDay = match[5];
    const endYear = match[6] ? Number(match[6]) : startYear;
    const startKey = dateKeyFromVisibleMonthDay(startMonth, startDay, startYear);
    const endKey = dateKeyFromVisibleMonthDay(endMonth, endDay, endYear);
    for (const key of expandDateKeyRange(startKey, endKey)) pushKey(key);
  }

  // Handles EstateSales.net list format: "May 1, 2, 3, 4".
  // This was the missing piece: the old parser only captured "May 1", so
  // a sale running May 1-4 was dropped from the May 3 Today list.
  const listPattern = new RegExp(
    `\\b${monthWord}\\s+(\\d{1,2}(?:st|nd|rd|th)?(?:\\s*,\\s*\\d{1,2}(?:st|nd|rd|th)?){1,12})(?:,?\\s*(20\\d{2}))?`,
    'gi',
  );

  for (const match of clean.matchAll(listPattern)) {
    const monthName = match[1];
    const year = match[3] ? Number(match[3]) : null;
    const dayNumbers = String(match[2] || '')
      .split(/\s*,\s*/)
      .map((part) => Number(String(part).replace(/\D+/g, '')))
      .filter((day) => Number.isFinite(day) && day >= 1 && day <= 31);

    for (const day of dayNumbers) {
      pushKey(dateKeyFromVisibleMonthDay(monthName, String(day), year));
    }
  }

  // Handles individual dates after range/list parsing.
  const singlePattern = new RegExp(
    `\\b${monthWord}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,\\s*(20\\d{2}))?`,
    'gi',
  );
  for (const match of clean.matchAll(singlePattern)) {
    pushKey(dateKeyFromVisibleMonthDay(match[1], match[2], match[3] ? Number(match[3]) : null));
  }

  return keys.sort();
}

function normalizeScheduleEntryDate(entry = {}, fallbackTimeLabel = '') {
  const startDate = String(entry.startDate || entry.startDateTime || '').slice(0, 10);
  const dateKey = /^20\d{2}-\d{2}-\d{2}$/.test(startDate) ? startDate : '';
  if (!dateKey) return { ...entry };

  return {
    ...entry,
    dayLabel: weekdayLabelFromDateKey(dateKey) || entry.dayLabel || '',
    dateLabel: monthDayLabelFromDateKey(dateKey) || entry.dateLabel || '',
    timeLabel: stripLeadingWeekdayFromTime(entry.timeLabel || fallbackTimeLabel || ''),
    startDate: dateKey,
    startDateTime: entry.startDateTime || buildIsoDateTime(
      Number(dateKey.slice(0, 4)),
      Number(dateKey.slice(5, 7)),
      Number(dateKey.slice(8, 10)),
      entry.startTime || fallbackTimeLabel || '',
    ),
  };
}

function normalizeEstateSaleCalendarData(sale = {}, requestedDay = '') {
  const existingEntries = Array.isArray(sale.scheduleEntries)
    ? sale.scheduleEntries.map((entry) => normalizeScheduleEntryDate(entry, sale.timeLabel || sale.openingHours || ''))
    : [];

  const detailDateKeys = Array.isArray(sale.detailDateKeys)
    ? sale.detailDateKeys.map((key) => String(key || '').slice(0, 10)).filter((key) => /^20\d{2}-\d{2}-\d{2}$/.test(key))
    : [];

  const visibleDateKeys = detailDateKeys.length
    ? []
    : extractVisibleEstateSalesDateKeys(
        [sale.dateText, sale.rawSnippet, sale.descriptionPreview, sale.dateLabel]
          .filter(Boolean)
          .join(' '),
      );

  const existingDateKeys = existingEntries
    .map((entry) => String(entry.startDate || '').slice(0, 10))
    .filter((key) => /^20\d{2}-\d{2}-\d{2}$/.test(key));

  const allDateKeys = detailDateKeys.length
    ? Array.from(new Set(detailDateKeys)).sort()
    : Array.from(new Set([...visibleDateKeys, ...existingDateKeys])).sort();
  const timeLabel = stripLeadingWeekdayFromTime(
    sale.timeLabel || sale.openingHours || existingEntries.find((entry) => entry.timeLabel)?.timeLabel || '',
  );

  const entriesByDate = new Map();
  for (const entry of existingEntries) {
    const key = String(entry.startDate || '').slice(0, 10);
    if (/^20\d{2}-\d{2}-\d{2}$/.test(key) && (!detailDateKeys.length || detailDateKeys.includes(key))) {
      entriesByDate.set(key, normalizeScheduleEntryDate(entry, timeLabel));
    }
  }

  for (const key of allDateKeys) {
    if (entriesByDate.has(key)) continue;
    entriesByDate.set(key, {
      dayLabel: weekdayLabelFromDateKey(key),
      dateLabel: monthDayLabelFromDateKey(key),
      timeLabel,
      startTime: sale.startTime || '',
      endTime: sale.endTime || '',
      startDate: key,
      startDateTime: buildIsoDateTime(
        Number(key.slice(0, 4)),
        Number(key.slice(5, 7)),
        Number(key.slice(8, 10)),
        sale.startTime || timeLabel || '',
      ),
      sortTimestamp: parseDateKeyToLocalDate(key)?.getTime() || 0,
    });
  }

  const scheduleEntries = Array.from(entriesByDate.values()).sort((a, b) => {
    const aTime = parseDateKeyToLocalDate(a.startDate)?.getTime() || Number.MAX_SAFE_INTEGER;
    const bTime = parseDateKeyToLocalDate(b.startDate)?.getTime() || Number.MAX_SAFE_INTEGER;
    return aTime - bTime;
  });

  const requestedDateKey = getDateKeyForRequestedDay(requestedDay);
  const preferredEntry =
    scheduleEntries.find((entry) => entry.startDate === requestedDateKey) ||
    scheduleEntries[0] ||
    null;

  if (!preferredEntry) {
    return {
      ...sale,
      scheduleEntries,
    };
  }

  return {
    ...sale,
    dayLabel: preferredEntry.dayLabel || sale.dayLabel || '',
    dateLabel: preferredEntry.dateLabel || sale.dateLabel || '',
    timeLabel: stripLeadingWeekdayFromTime(preferredEntry.timeLabel || sale.timeLabel || ''),
    startTime: preferredEntry.startTime || sale.startTime || '',
    endTime: preferredEntry.endTime || sale.endTime || '',
    startDate: preferredEntry.startDate || sale.startDate || '',
    startDateTime: preferredEntry.startDateTime || sale.startDateTime || '',
    scheduleEntries,
  };
}


function isConfirmedTodayPhysicalEstateSale(sale = {}) {
  // Final Today rule:
  // 1) Full physical address required. City/state alone is not enough.
  // 2) Sale must show it is Today.
  // 3) Online-only language always loses.
  // No badge requirement here. If full address + Today is true, it gets through.
  const hasFullAddress = Boolean(
    sale.searchHasFullAddress === true ||
      streetHasHouseNumber(sale.street || '') ||
      streetHasHouseNumber(sale.addressLabel || '') ||
      streetHasHouseNumber(sale.mapAddress || '')
  );

  return (
    hasFullAddress &&
    saleMatchesRequestedDetailDate(sale, 'today') &&
    shouldExcludeOnlineOnlySale(sale) === false
  );
}



function getUpcomingWindowDateKeys() {
  const todayKey = getChicagoDateKey(new Date());
  return {
    startKey: addDaysToDateKey(todayKey, 2),
    endKey: addDaysToDateKey(todayKey, UPCOMING_MAX_DAYS_OUT),
  };
}

function saleHasUpcomingWindowDateEvidence(sale = {}) {
  const { startKey, endKey } = getUpcomingWindowDateKeys();
  if (!startKey || !endKey) return false;

  const candidateKeys = collectSaleDateKeysFromText(
    [
      sale.dateText,
      sale.dateLabel,
      sale.dayLabel,
      sale.timeLabel,
      sale.rawSnippet,
      sale.descriptionPreview,
      sale.bodyPreview,
      sale.title,
    ]
      .filter(Boolean)
      .join(' '),
    getChicagoDateParts(new Date()).year,
  );

  return candidateKeys.some((key) => key >= startKey && key <= endKey);
}

function sortSalesForDetailEnrichment(sales = [], requestedDay = '') {
  const normalizedRequestedDay = normalizeRequestedDay(requestedDay);
  if (normalizedRequestedDay !== 'upcoming') return sortSales(sales);

  return [...sales].sort((a, b) => {
    const aUpcoming = saleHasUpcomingWindowDateEvidence(a) ? 1 : 0;
    const bUpcoming = saleHasUpcomingWindowDateEvidence(b) ? 1 : 0;
    if (aUpcoming !== bUpcoming) return bUpcoming - aUpcoming;

    const aDistance = Number.isFinite(Number(a.distanceMiles)) ? Number(a.distanceMiles) : Number.MAX_SAFE_INTEGER;
    const bDistance = Number.isFinite(Number(b.distanceMiles)) ? Number(b.distanceMiles) : Number.MAX_SAFE_INTEGER;
    if (aDistance !== bDistance) return aDistance - bDistance;

    const imageDiff = (b.imageCount || 0) - (a.imageCount || 0);
    if (imageDiff !== 0) return imageDiff;

    return (a.title || '').localeCompare(b.title || '');
  });
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

  const searchZip = getSearchZipsForRequest(
    requestedRadiusMiles,
    requestedOrigin,
  )[0] || '60565';

  const city = requestedOrigin?.city || 'Naperville';
  const searchTargets = getEstateSalesSearchTargets(
    searchZip,
    city,
    requestedRadiusMiles || 50,
    requestedOrigin,
  );
  const cacheKeyZips = searchTargets.map((target) => target.zip);
  const cachedDayFiltered = getCachedEstateSalesPool(
    requestedDay,
    cacheKeyZips,
    requestedRadiusMiles,
    requestedOrigin,
  );
  let dayFiltered = null;
  let cacheHit = false;

  if (cachedDayFiltered) {
    dayFiltered = cachedDayFiltered;
    cacheHit = true;
  } else {
    console.log(
      `[estate-sales-route] ${ESTATE_ROUTE_VERSION} RADIUS_SWEEP_DEEP_DISCOVERY_START zip=${searchZip} city=${city} radius=${requestedRadiusMiles ?? 'default'} day=${normalizedRequestedDay || 'all'}`,
    );

    const rawResults = await fetchEstateSalesForTargets(
      searchTargets,
      requestedRadiusMiles || 50,
      requestedDay,
    );

    const deduped = dedupeSales(rawResults);

    // Important: do NOT pre-filter the pooled city-page results by the distance
    // shown on the search page. That distance is relative to the EstateSales.net
    // page being scraped, not always the user's actual GPS origin. Enrich first,
    // get real detail-page coordinates, then apply the true requested radius.
    const prioritizedSales = sortSalesForDetailEnrichment(deduped, requestedDay);

    const enrichmentTargetCount = Math.min(
      prioritizedSales.length,
      Math.max(MAX_DETAIL_FETCHES, DETAIL_ENRICH_TARGET_COUNT),
    );

    const enriched = await enrichSalesWithDetailPages(
      prioritizedSales.slice(0, enrichmentTargetCount),
    );

    const preliminaryRadiusFiltered = filterSalesByRadius(
      enriched,
      requestedRadiusMiles,
      requestedOrigin,
    );

    const combinedSales = dedupeSales([
      ...enriched,
      ...prioritizedSales.slice(enrichmentTargetCount),
    ]);

    const addressFiltered = combinedSales.filter((sale) =>
      shouldKeepSale(sale),
    );

    const inPersonSales = addressFiltered.filter(
      (sale) => !shouldExcludeOnlineOnlySale(sale),
    );

    const physicalConfirmedSales =
      normalizedRequestedDay === 'today'
        ? inPersonSales.filter((sale) => isConfirmedTodayPhysicalEstateSale(sale))
        : inPersonSales;

    const calendarNormalized = physicalConfirmedSales.map((sale) =>
      normalizeEstateSaleCalendarData(sale, requestedDay),
    );

    if (normalizedRequestedDay) {
      const strictDayMatches = calendarNormalized
        .map((sale) => projectSaleToRequestedDay(sale, requestedDay))
        .map((sale) => normalizeEstateSaleCalendarData(sale, requestedDay))
        .filter((sale) => saleMatchesRequestedDetailDate(sale, requestedDay));

      // Do not fall back to all days when the user selected Today/Tomorrow.
      // That fallback is what made Saturday/Friday cards appear under Today.
      dayFiltered =
        normalizedRequestedDay === 'upcoming'
          ? dedupeSales(strictDayMatches)
          : strictDayMatches;
    } else {
      dayFiltered = calendarNormalized;
    }

    setCachedEstateSalesPool(
      requestedDay,
      cacheKeyZips,
      dayFiltered,
      requestedRadiusMiles,
      requestedOrigin,
    );

    console.log(
      `[estate-sales-route] ${ESTATE_ROUTE_VERSION} counts ` +
        JSON.stringify({
          raw: rawResults.length,
          deduped: deduped.length,
          preliminaryRadiusFiltered: preliminaryRadiusFiltered.length,
          enriched: enriched.length,
          addressFiltered: addressFiltered.length,
          onlineOnlyFiltered: addressFiltered.length - inPersonSales.length,
          physicalConfirmed: physicalConfirmedSales.length,
          dayFiltered: dayFiltered.length,
          cacheHit: false,
          requestedDay: normalizedRequestedDay || null,
          requestedRadiusMiles: requestedRadiusMiles ?? null,
          searchedZip: searchZip,
          searchedZipCount: searchTargets.length,
        }),
    );
  }

  const radiusFiltered = filterSalesByRadius(
    dayFiltered,
    requestedRadiusMiles,
    requestedOrigin,
  );
  const sorted = sortSales(dedupeSales(radiusFiltered));

  console.log(
    `[estate-sales-route] ${ESTATE_ROUTE_VERSION} response ` +
      JSON.stringify({
        cacheHit,
        dayFiltered: dayFiltered.length,
        radiusFiltered: radiusFiltered.length,
        requestedDay: normalizedRequestedDay || null,
        requestedRadiusMiles: requestedRadiusMiles ?? null,
        requestedLatitude: requestedOrigin?.latitude ?? null,
        requestedLongitude: requestedOrigin?.longitude ?? null,
        searchedZip: searchZip,
        searchedZipCount: searchTargets.length,
      }),
  );

  return sorted.slice(0, MAX_RESULTS);
}

router.get('/', async (req, res) => {
  setNoCacheHeaders(res);
  console.log(`[estate-sales-route] ${ESTATE_ROUTE_VERSION} RADIUS_SWEEP route start`);
  const requestStartedAt = Date.now();
  // The mobile Source Assist screen labels this view as Today, but current
  // frontend builds have been calling this route without a day parameter:
  // { mode: 'estate', radiusMiles, latitude, longitude }.
  // If we leave requestedDay blank, the backend returns any upcoming sale and
  // the app shows Friday/Saturday cards under the Today header. Default the
  // estate-sales route to today unless the client explicitly sends a day/date.
  const requestedDay = normalizeRequestedDay(
    req.query?.day || req.query?.targetDay || req.query?.date || 'today',
  );
  const requestedRadiusMiles = normalizeRequestedRadiusMiles(
    req.query?.radiusMiles,
  );
  const requestedOrigin = {
    latitude: normalizeRequestedOriginCoordinate(req.query?.latitude),
    longitude: normalizeRequestedOriginCoordinate(req.query?.longitude),
    zip: req.query?.zip || req.query?.postalCode || req.query?.postal || '',
    postalCode: req.query?.postalCode || req.query?.zip || req.query?.postal || '',
    postal: req.query?.postal || req.query?.zip || req.query?.postalCode || '',
    city: req.query?.city || req.query?.location || 'Naperville',
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
      searchMode: 'multi-city-radius-sweep',
      fetchedAt: new Date().toISOString(),
      elapsedMs: Date.now() - requestStartedAt,
      sales: sourceAssistSales,
      estateSales: sourceAssistSales,
    });
  } catch (error) {
    console.error('EstateSales route error:', error?.stack || error?.message || error);

    // Never let a backend fetch/parser error leave the mobile app showing old
    // estate-sale results. Return a successful empty payload so the frontend
    // clears the list instead of keeping stale cached cards
    return res.json({
      success: true,
      warning: 'ESTATE_SALES_FETCH_FAILED_EMPTY_RESULTS_RETURNED',
      message: error?.message || 'EstateSales.net fetch failed',
      routeVersion: ESTATE_ROUTE_VERSION,
      source: 'estatesales-net',
      requestedDay,
      requestedRadiusMiles,
      count: 0,
      searchMode: 'multi-city-radius-sweep',
      fetchedAt: new Date().toISOString(),
      elapsedMs: Date.now() - requestStartedAt,
      sales: [],
      estateSales: [],
    });
  }
});

module.exports = router;
