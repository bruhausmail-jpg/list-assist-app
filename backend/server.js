require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');

// Safe fetch helper for Render/Node versions that may not expose global fetch.
const fetch = (...args) => {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch(...args);
  }
  return import('node-fetch').then(({ default: nodeFetch }) =>
    nodeFetch(...args),
  );
};

const { thriftStoresHandler } = require('./thrift-stores-route');
const estateSalesRoute = require('./estate-sales-route');
const garageSalesRoute = require('./garage-sales-route');

const app = express();

app.use(cors());
app.use(express.json({ limit: '15mb' }));

app.get('/api/thrift-stores', thriftStoresHandler);
app.use('/api/estate-sales', estateSalesRoute);
app.use(garageSalesRoute);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
  },
});

const PORT = process.env.PORT || 3001;

const EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID;
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
const EBAY_ENVIRONMENT = process.env.EBAY_ENVIRONMENT || 'production'; // production or sandbox

if (!EBAY_CLIENT_ID || !EBAY_CLIENT_SECRET) {
  console.error('Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET in .env');
}

const EBAY_TOKEN_URL =
  EBAY_ENVIRONMENT === 'sandbox'
    ? 'https://api.sandbox.ebay.com/identity/v1/oauth2/token'
    : 'https://api.ebay.com/identity/v1/oauth2/token';

const EBAY_BROWSE_SEARCH_URL =
  EBAY_ENVIRONMENT === 'sandbox'
    ? 'https://api.sandbox.ebay.com/buy/browse/v1/item_summary/search'
    : 'https://api.ebay.com/buy/browse/v1/item_summary/search';

const EBAY_BROWSE_IMAGE_SEARCH_URL =
  EBAY_ENVIRONMENT === 'sandbox'
    ? 'https://api.sandbox.ebay.com/buy/browse/v1/item_summary/search_by_image'
    : 'https://api.ebay.com/buy/browse/v1/item_summary/search_by_image';

const EBAY_TAXONOMY_BASE_URL =
  EBAY_ENVIRONMENT === 'sandbox'
    ? 'https://api.sandbox.ebay.com/commerce/taxonomy/v1'
    : 'https://api.ebay.com/commerce/taxonomy/v1';
const EBAY_MARKETPLACE_ID = 'EBAY_US';

// Cache token in memory
let tokenCache = {
  accessToken: null,
  expiresAt: 0,
};

async function getEbayAccessToken() {
  const now = Date.now();

  if (tokenCache.accessToken && now < tokenCache.expiresAt - 60000) {
    return tokenCache.accessToken;
  }

  const basicAuth = Buffer.from(
    `${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`,
  ).toString('base64');

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'https://api.ebay.com/oauth/api_scope',
  });

  const response = await fetch(EBAY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to get eBay token: ${response.status} ${errorText}`,
    );
  }

  const data = await response.json();

  if (!data.access_token || !data.expires_in) {
    throw new Error('eBay token response missing access_token or expires_in');
  }

  tokenCache.accessToken = data.access_token;
  tokenCache.expiresAt = Date.now() + data.expires_in * 1000;

  console.log('Fetched new eBay access token');
  return tokenCache.accessToken;
}

function cleanHint(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function buildHardenedEbaySearchQuery(value) {
  let query = cleanHint(value);

  if (/mac\s*book|macbook/i.test(query)) {
    query = query
      .replace(/mac\s*book/gi, 'MacBook')
      .replace(/\bmacbook air\b/gi, 'MacBook Air')
      .replace(/\bmacbook pro\b/gi, 'MacBook Pro')
      .replace(/\b13\s+in\b/gi, '13 inch')
      .replace(/\b14\s+in\b/gi, '14 inch')
      .replace(/\b15\s+in\b/gi, '15 inch')
      .replace(/\b16\s+in\b/gi, '16 inch')
      .replace(/\b4\s+05\s*ghz\b/gi, '')
      .replace(/\b(128|256|512)\s*gb\b/gi, '$1GB SSD')
      .replace(/\b(1|2|4|8)\s*tb\b/gi, '$1TB SSD')
      .replace(/\b(m1|m2|m3|m4)\b/gi, (match) => match.toUpperCase())
      .replace(/\s+/g, ' ')
      .trim();

    if (!/\blaptop\b/i.test(query)) query = `${query} Laptop`;
  }

  return query;
}

function buildLooseItemHintQuery(hint) {
  const cleaned = cleanHint(hint);
  if (!cleaned) return '';
  return cleaned;
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeSearchText(value) {
  const stopWords = new Set([
    'the',
    'and',
    'for',
    'with',
    'from',
    'new',
    'used',
    'open',
    'box',
    'lot',
    'pack',
    'set',
    'item',
    'items',
    'sale',
    'free',
    'shipping',
    'rare',
    'nice',
    'look',
    'see',
    'photo',
    'photos',
    'picture',
    'pictured',
    'excellent',
    'condition',
  ]);

  return normalizeSearchText(value)
    .split(' ')
    .map((word) => word.trim())
    .filter((word) => word.length > 2)
    .filter((word) => !stopWords.has(word));
}

let categoryTreeCache = {
  marketplaceId: '',
  treeId: '',
  expiresAt: 0,
};

const ebayCategorySuggestionCache = new Map();

function getCategorySuggestionCacheKey(query) {
  return normalizeSearchText(query).slice(0, 120);
}

async function getEbayCategoryTreeId(accessToken) {
  const now = Date.now();
  if (
    categoryTreeCache.treeId &&
    categoryTreeCache.marketplaceId === EBAY_MARKETPLACE_ID &&
    now < categoryTreeCache.expiresAt
  ) {
    return categoryTreeCache.treeId;
  }

  const url = new URL(`${EBAY_TAXONOMY_BASE_URL}/get_default_category_tree_id`);
  url.searchParams.set('marketplace_id', EBAY_MARKETPLACE_ID);

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `eBay taxonomy tree lookup failed: ${response.status} ${text}`,
    );
  }

  const data = await response.json();
  const treeId = String(data?.categoryTreeId || '').trim();
  if (!treeId) throw new Error('eBay taxonomy response missing categoryTreeId');

  categoryTreeCache = {
    marketplaceId: EBAY_MARKETPLACE_ID,
    treeId,
    expiresAt: now + 24 * 60 * 60 * 1000,
  };

  return treeId;
}

function buildCategoryPathFromTaxonomySuggestion(suggestion) {
  const names = [];
  const ancestors = Array.isArray(suggestion?.categoryTreeNodeAncestors)
    ? suggestion.categoryTreeNodeAncestors
    : [];

  ancestors
    .slice()
    .sort(
      (a, b) =>
        Number(a?.categoryTreeNodeLevel || 0) -
        Number(b?.categoryTreeNodeLevel || 0),
    )
    .forEach((ancestor) => {
      const name = String(
        ancestor?.categoryName || ancestor?.category?.categoryName || '',
      ).trim();
      if (name) names.push(name);
    });

  const leafName = String(suggestion?.category?.categoryName || '').trim();
  if (leafName) names.push(leafName);

  return normalizeCategoryPath(names.join(' > '));
}

async function getEbayTaxonomyCategorySuggestions(query, accessToken) {
  const cleaned = cleanHint(query);
  const cacheKey = getCategorySuggestionCacheKey(cleaned);
  if (!cacheKey) return [];

  const cached = ebayCategorySuggestionCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.suggestions;

  const treeId = await getEbayCategoryTreeId(accessToken);
  const url = new URL(
    `${EBAY_TAXONOMY_BASE_URL}/category_tree/${encodeURIComponent(treeId)}/get_category_suggestions`,
  );
  url.searchParams.set('q', cleaned.slice(0, 350));

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    console.warn(
      'eBay taxonomy category suggestions failed:',
      response.status,
      text,
    );
    return [];
  }

  const data = await response.json();
  const suggestions = Array.isArray(data?.categorySuggestions)
    ? data.categorySuggestions
        .map((suggestion) => {
          const categoryPath =
            buildCategoryPathFromTaxonomySuggestion(suggestion);
          const categoryId = String(
            suggestion?.category?.categoryId || '',
          ).trim();
          return {
            categoryPath,
            categoryId,
          };
        })
        .filter(
          (suggestion) =>
            suggestion.categoryPath &&
            !isWeakCategoryPath(suggestion.categoryPath),
        )
    : [];

  ebayCategorySuggestionCache.set(cacheKey, {
    suggestions,
    expiresAt: Date.now() + 12 * 60 * 60 * 1000,
  });

  return suggestions;
}

function hasAppleLaptopSignal(value) {
  const normalized = normalizeSearchText(value);
  return (
    /\b(macbook|mac book|macbook air|macbook pro|apple laptop|apple notebook)\b/.test(
      normalized,
    ) ||
    (/\bapple\b/.test(normalized) &&
      /\b(laptop|notebook|m1|m2|m3|m4|ssd|retina|macos)\b/.test(normalized))
  );
}

function hasComputerLaptopSignal(value) {
  const normalized = normalizeSearchText(value);
  return (
    hasAppleLaptopSignal(value) ||
    /\b(laptop|notebook|ultrabook|chromebook|thinkpad|latitude|elitebook|surface pro|surface laptop|ipad|tablet|computer|ssd|ram|intel|ryzen|core i[3579]|m1|m2|m3|m4)\b/.test(
      normalized,
    )
  );
}

function hasComputerPeripheralSignal(value) {
  const normalized = normalizeSearchText(value);

  return (
    /\b(mouse|mice|trackball|trackballs|keyboard|keyboards|logitech|usb|bluetooth|wireless mouse|gaming mouse|ergonomic mouse|computer mouse|pc mouse|mac mouse|pointer|pointers|input device|input devices)\b/.test(
      normalized,
    ) || hasComputerLaptopSignal(value)
  );
}

function hasMouseOrTrackballSignal(value) {
  const normalized = normalizeSearchText(value);

  return /\b(mouse|mice|trackball|trackballs|logitech|m575|ergo m575|wireless mouse|ergonomic mouse|computer mouse|pc mouse|mac mouse)\b/.test(
    normalized,
  );
}

function getForcedCategoryForEvidence(value) {
  if (hasAppleLaptopSignal(value)) {
    return {
      categoryPath:
        'Computers/Tablets & Networking > Laptops & Netbooks > Apple Laptops',
      categoryId: '',
      categoryConfidence: 'high',
      categorySource: 'hard-rule-apple-laptop-safety',
    };
  }

  if (hasMouseOrTrackballSignal(value)) {
    return {
      categoryPath:
        'Computers/Tablets & Networking > Keyboards, Mice & Pointers > Mice, Trackballs & Touchpads',
      categoryId: '',
      categoryConfidence: 'high',
      categorySource: 'hard-rule-computer-peripheral-safety',
    };
  }

  return null;
}

function isWrongVerticalForEvidence(categoryPath, evidenceText) {
  const category = normalizeSearchText(categoryPath);
  const evidence = normalizeSearchText(evidenceText);
  if (!category) return true;

  if (hasComputerPeripheralSignal(evidence)) {
    if (
      /\b(books magazines|books|magazines|crafts|pottery|dolls|stamps|coins paper money|art|collectibles)\b/.test(
        category,
      )
    ) {
      return true;
    }

    const isKnownGoodComputerRoot =
      /\b(computers tablets networking|consumer electronics|keyboards mice pointers)\b/.test(
        category,
      );
    const isSpecificLaptopPath =
      /\b(laptops netbooks|apple laptops|pc laptops netbooks|macbook|notebook|trackballs|mice|keyboards|input devices|mice trackballs touchpads)\b/.test(
        category,
      );

    if (!isKnownGoodComputerRoot && !isSpecificLaptopPath) {
      return true;
    }
  }

  return false;
}

function isTrustedDirectCategoryPath(item, path) {
  const categorySource = normalizeSearchText(
    item?.categoryPathSource ||
      item?.categorySource ||
      item?.categorySuggestionSource ||
      '',
  );

  if (/taxonomy|inferred|local|fallback/.test(categorySource)) return false;
  if (!path || isWeakCategoryPath(path)) return false;

  return Boolean(
    item?.categoryPath ||
    item?.ebayCategoryPath ||
    item?.primaryCategory?.categoryPath ||
    item?.itemCategory?.categoryPath ||
    (Array.isArray(item?.categories) && item.categories.length),
  );
}

function getDirectEbayCategoryPath(item) {
  if (!item) return '';

  const directCandidates = [
    item.categoryPath,
    item.ebayCategoryPath,
    item.primaryCategory?.categoryPath,
    item.itemCategory?.categoryPath,
  ];

  for (const candidate of directCandidates) {
    const cleaned = normalizeCategoryPath(candidate);
    if (cleaned && isTrustedDirectCategoryPath(item, cleaned)) {
      return cleaned;
    }
  }

  if (Array.isArray(item.categories) && item.categories.length) {
    const names = item.categories
      .map((category) => category?.categoryName || category?.name || '')
      .map((name) => String(name).trim())
      .filter(Boolean);

    if (names.length) {
      // eBay Browse commonly returns category arrays leaf -> parent -> root.
      // If only one category is returned, use that eBay-returned leaf category.
      // If multiple are returned, display them root -> parent -> leaf.
      const pathParts = names.length > 1 ? names.slice().reverse() : names;
      const path = normalizeCategoryPath(pathParts.join(' > '));
      if (path && isTrustedDirectCategoryPath(item, path)) return path;
    }
  }

  const leafCandidates = [
    item.categoryName,
    item.primaryCategoryName,
    item.leafCategoryName,
    item.category,
    item.primaryCategory?.categoryName,
    item.itemCategory?.categoryName,
  ];

  for (const candidate of leafCandidates) {
    const cleaned = normalizeCategoryPath(candidate);
    if (cleaned && !isWeakCategoryPath(cleaned)) return cleaned;
  }

  return '';
}

function getEvidenceTextForCategoryDecision(query, item) {
  const parts = [
    query,
    item?.title,
    item?.categoryName,
    item?.primaryCategoryName,
    item?.leafCategoryName,
    item?.condition,
  ];

  if (Array.isArray(item?.localizedAspects)) {
    item.localizedAspects.forEach((aspect) => {
      parts.push(aspect?.name);
      if (Array.isArray(aspect?.values)) parts.push(...aspect.values);
      else parts.push(aspect?.value);
    });
  }

  [item?.aspects, item?.itemSpecifics].forEach((source) => {
    if (!source) return;
    Object.entries(source).forEach(([key, value]) => {
      parts.push(key);
      if (Array.isArray(value)) parts.push(...value);
      else parts.push(value);
    });
  });

  return parts.filter(Boolean).join(' ');
}

function getDirectCategoryInheritanceCandidate(params = {}) {
  const groups = [
    {
      source: 'sold',
      items: Array.isArray(params.soldItems) ? params.soldItems : [],
    },
    {
      source: 'image',
      items: Array.isArray(params.imageItems) ? params.imageItems : [],
    },
    {
      source: 'text',
      items: Array.isArray(params.textItems) ? params.textItems : [],
    },
    {
      source: 'active',
      items: Array.isArray(params.activeItems) ? params.activeItems : [],
    },
  ];

  const scores = new Map();

  groups.forEach(({ source, items }) => {
    items.forEach((item) => {
      const directPath = normalizeCategoryPath(getDirectEbayCategoryPath(item));
      if (!directPath || isWeakCategoryPath(directPath)) return;

      const categoryId = getEbayCategoryId(item);
      const current = scores.get(directPath) || {
        categoryPath: directPath,
        categoryId: categoryId || '',
        votes: 0,
        sources: { sold: 0, image: 0, text: 0, active: 0 },
        exampleTitles: [],
      };

      current.votes += 1;
      current.sources[source] = (current.sources[source] || 0) + 1;

      if (!current.categoryId && categoryId) current.categoryId = categoryId;
      if (item?.title && current.exampleTitles.length < 5) {
        current.exampleTitles.push(item.title);
      }

      scores.set(directPath, current);
    });
  });

  const sortedVotes = Array.from(scores.values()).sort((a, b) => {
    const voteDelta = b.votes - a.votes;
    if (voteDelta) return voteDelta;

    // Tie-breakers only. The main rule is the most common category among
    // matched eBay-returned items.
    const soldDelta = (b.sources.sold || 0) - (a.sources.sold || 0);
    if (soldDelta) return soldDelta;

    const imageDelta = (b.sources.image || 0) - (a.sources.image || 0);
    if (imageDelta) return imageDelta;

    const textDelta = (b.sources.text || 0) - (a.sources.text || 0);
    if (textDelta) return textDelta;

    const depthDelta =
      getCategoryDepth(b.categoryPath) - getCategoryDepth(a.categoryPath);
    if (depthDelta) return depthDelta;

    return a.categoryPath.localeCompare(b.categoryPath);
  });

  const best = sortedVotes[0];
  if (!best) return null;

  return {
    bestCategoryPath: best.categoryPath,
    bestCategoryId: best.categoryId || '',
    categoryConfidence: best.votes >= 2 ? 'high' : 'medium',
    categorySource:
      best.votes >= 2
        ? 'ebay-most-common-category'
        : 'ebay-only-returned-category',
    categoryVotes: sortedVotes.slice(0, 10).map((entry) => ({
      categoryPath: entry.categoryPath,
      categoryId: entry.categoryId || '',
      votes: entry.votes,
      sources: entry.sources,
      exampleTitles: entry.exampleTitles,
    })),
  };
}

async function enrichEbayItemsWithCategorySuggestions(
  items,
  accessToken,
  query = '',
) {
  if (!Array.isArray(items) || !items.length) return [];

  // Category source of truth: eBay Browse result categories. Do not inject
  // taxonomy, hard-coded categories, or local title-based fallbacks here.
  // If Browse search returns a lightweight item without category data, fetch
  // the item detail by itemHref so we can still use eBay's own category.
  return hydrateMissingEbayCategories(items, accessToken);
}

function hasDirectEbayCategoryData(item) {
  if (!item) return false;
  if (Array.isArray(item.categories) && item.categories.length) return true;
  return Boolean(
    item.categoryPath ||
    item.ebayCategoryPath ||
    item.primaryCategory?.categoryPath ||
    item.itemCategory?.categoryPath ||
    item.categoryName ||
    item.primaryCategoryName ||
    item.leafCategoryName,
  );
}

async function hydrateMissingEbayCategories(items, accessToken) {
  const list = Array.isArray(items) ? items : [];
  const hydrated = [];

  for (const item of list) {
    if (hasDirectEbayCategoryData(item) || !item?.itemHref) {
      hydrated.push(item);
      continue;
    }

    try {
      const response = await fetch(item.itemHref, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'X-EBAY-C-MARKETPLACE-ID': EBAY_MARKETPLACE_ID,
        },
      });

      if (!response.ok) {
        hydrated.push(item);
        continue;
      }

      const detail = await response.json();
      hydrated.push({
        ...item,
        categoryPath: item.categoryPath || detail?.categoryPath,
        ebayCategoryPath: item.ebayCategoryPath || detail?.categoryPath,
        categoryId:
          item.categoryId ||
          detail?.categoryId ||
          detail?.leafCategoryIds?.[0] ||
          detail?.categories?.[0]?.categoryId,
        categoryName:
          item.categoryName ||
          detail?.categoryName ||
          detail?.categories?.[0]?.categoryName,
        categories:
          Array.isArray(item.categories) && item.categories.length
            ? item.categories
            : Array.isArray(detail?.categories)
              ? detail.categories
              : item.categories,
        primaryCategory: item.primaryCategory || detail?.primaryCategory,
        leafCategoryIds:
          Array.isArray(item.leafCategoryIds) && item.leafCategoryIds.length
            ? item.leafCategoryIds
            : Array.isArray(detail?.leafCategoryIds)
              ? detail.leafCategoryIds
              : item.leafCategoryIds,
      });
    } catch (error) {
      console.warn(
        'Could not hydrate eBay item category:',
        item?.itemId || item?.title || '',
        error?.message || error,
      );
      hydrated.push(item);
    }
  }

  return hydrated;
}

function getEbayCategoryPath(item) {
  if (!item) return '';

  const directCandidates = [
    item.categoryPath,
    item.ebayCategoryPath,
    item.inferredCategoryPath,
    item.ebaySuggestedCategoryPath,
    item.primaryCategory?.categoryPath,
    item.itemCategory?.categoryPath,
  ];

  for (const candidate of directCandidates) {
    const cleaned = normalizeCategoryPath(candidate);
    if (cleaned && cleaned.includes(' > ')) return cleaned;
  }

  if (Array.isArray(item.categories) && item.categories.length) {
    const names = item.categories
      .map((category) => category?.categoryName || category?.name || '')
      .map((name) => String(name).trim())
      .filter(Boolean);

    if (names.length) {
      return normalizeCategoryPath(names.slice().reverse().join(' > '));
    }
  }

  const leafCandidates = [
    item.categoryName,
    item.primaryCategoryName,
    item.leafCategoryName,
    item.category,
    item.primaryCategory?.categoryName,
    item.itemCategory?.categoryName,
  ];

  const leaf = leafCandidates
    .map((candidate) => String(candidate || '').trim())
    .find(Boolean);

  return leaf ? mapLeafCategoryToPath(leaf) : '';
}

function getEbayCategoryId(item) {
  if (!item) return '';

  return String(
    item.leafCategoryIds?.[0] ||
      item.categoryId ||
      item.categoryIds?.[0] ||
      item.primaryCategory?.categoryId ||
      item.itemCategory?.categoryId ||
      item.categories?.[0]?.categoryId ||
      '',
  ).trim();
}

function normalizeCategoryPath(value) {
  const cleaned = String(value || '')
    .replace(/\s*>\s*/g, ' > ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return '';
  if (/everything else/i.test(cleaned)) return '';
  if (/specialty category based on item type/i.test(cleaned)) return '';
  if (/^other\b| > other\b/i.test(cleaned)) return '';
  return cleaned;
}

function mapLeafCategoryToPath(value) {
  const normalized = normalizeSearchText(value);

  if (/(^art$|paintings|painting|watercolor|original art)/.test(normalized)) {
    return 'Art > Paintings';
  }

  if (
    /(cable testers|wiremapper|network tester|testers calibrators|test measurement)/.test(
      normalized,
    )
  ) {
    return 'Business & Industrial > Test, Measurement & Inspection > Testers & Calibrators > Cable Testers & Trackers';
  }

  if (/(stockpot|stockpots|saucepans|cookware)/.test(normalized)) {
    return 'Home & Garden > Kitchen, Dining & Bar > Cookware > Saucepans & Stockpots';
  }

  if (/(coca cola|coca-cola|coke|advertising|soda|glasses)/.test(normalized)) {
    return 'Collectibles > Advertising > Soda > Coca-Cola > Glasses';
  }

  if (/(hot sauce|bbq|condiments|sauces|hot honey)/.test(normalized)) {
    return 'Home & Garden > Food & Beverages > Pantry > Condiments & Sauces > BBQ & Hot Sauces';
  }

  if (
    /(cleaning products|household cleaning|disinfectant|disinfecting|cleaner)/.test(
      normalized,
    )
  ) {
    return 'Home & Garden > Household Supplies & Cleaning > Cleaning Products';
  }

  if (
    /(deodorant|deodorants|antiperspirant|antiperspirants)/.test(normalized)
  ) {
    return 'Health & Beauty > Bath & Body > Deodorants & Antiperspirants';
  }

  if (/(lip balm|lip treatments|chapstick)/.test(normalized)) {
    return 'Health & Beauty > Skin Care > Lip Balm & Treatments';
  }

  if (/(vitamin|vitamins|minerals|supplements)/.test(normalized)) {
    return 'Health & Beauty > Vitamins & Lifestyle Supplements > Vitamins & Minerals';
  }

  if (/dry shampoo/.test(normalized)) {
    return 'Health & Beauty > Hair Care & Styling > Dry Shampoos';
  }

  return String(value || '').trim();
}

function inferCategoryPathFromItemEvidence(item) {
  const evidenceParts = [
    item?.title,
    item?.categoryName,
    item?.primaryCategoryName,
    item?.leafCategoryName,
    item?.condition,
  ];

  if (Array.isArray(item?.localizedAspects)) {
    item.localizedAspects.forEach((aspect) => {
      evidenceParts.push(aspect?.name);
      if (Array.isArray(aspect?.values)) {
        evidenceParts.push(...aspect.values);
      } else {
        evidenceParts.push(aspect?.value);
      }
    });
  }

  [item?.aspects, item?.itemSpecifics].forEach((source) => {
    if (!source) return;
    Object.entries(source).forEach(([key, value]) => {
      evidenceParts.push(key);
      if (Array.isArray(value)) {
        evidenceParts.push(...value);
      } else {
        evidenceParts.push(value);
      }
    });
  });

  const normalized = normalizeSearchText(
    evidenceParts.filter(Boolean).join(' '),
  );

  if (
    /(artist|painting|watercolor|production technique|original licensed reproduction|illustration art|framed matted|framing framed|subject humor|laurie beth)/.test(
      normalized,
    ) &&
    /(painting|watercolor|artist|laurie beth|original by)/.test(normalized)
  ) {
    return 'Art > Paintings';
  }

  if (
    /(cable tester|wiremapper|wire mapper|linkmaster|rj45|cat5|cat5e|cat6|ethernet tester|network tester|toner|tone generator|62 200|62-200)/.test(
      normalized,
    )
  ) {
    return 'Business & Industrial > Test, Measurement & Inspection > Testers & Calibrators > Cable Testers & Trackers';
  }

  if (
    /(le creuset|stockpot|stock pot|saucepan|cookware|enamel on steel|enameled steel|8 qt|8qt|marseille)/.test(
      normalized,
    )
  ) {
    return 'Home & Garden > Kitchen, Dining & Bar > Cookware > Saucepans & Stockpots';
  }

  if (
    /(coca cola|coca-cola|coke).*(glass|glasses|ceramic|advertising|soda)|type of advertising|theme soda/.test(
      normalized,
    )
  ) {
    return 'Collectibles > Advertising > Soda > Coca-Cola > Glasses';
  }

  if (
    /(hot honey|mike s hot honey|mikes hot honey|honey infused|chili peppers|hot sauce|bbq sauce)/.test(
      normalized,
    )
  ) {
    return 'Home & Garden > Food & Beverages > Pantry > Condiments & Sauces > BBQ & Hot Sauces';
  }

  if (
    /(lysol|clorox|disinfecting|disinfectant|sanitizing|all purpose cleaner|cleaning spray|household cleaner)/.test(
      normalized,
    )
  ) {
    return 'Home & Garden > Household Supplies & Cleaning > Cleaning Products';
  }

  if (
    /(deodorant|antiperspirant|old spice|invisible solid|solid stick|odor protection)/.test(
      normalized,
    )
  ) {
    return 'Health & Beauty > Bath & Body > Deodorants & Antiperspirants';
  }

  if (
    /(lip balm|chapstick|lip treatment|dry lips|shea butter|coconut oil|vitamin e)/.test(
      normalized,
    )
  ) {
    return 'Health & Beauty > Skin Care > Lip Balm & Treatments';
  }

  if (
    /(vitamin|mineral|supplement|superbeets|beet|gummy|gummies|capsule|tablet|softgel|heart health)/.test(
      normalized,
    )
  ) {
    return 'Health & Beauty > Vitamins & Lifestyle Supplements > Vitamins & Minerals';
  }

  if (
    /(dry shampoo|hair care|hair styling|beach texture|texturizing)/.test(
      normalized,
    )
  ) {
    return 'Health & Beauty > Hair Care & Styling > Dry Shampoos';
  }

  return '';
}

function getItemTitleRelevanceScore(query, item) {
  const queryTokens = new Set(tokenizeSearchText(query));
  const titleTokens = tokenizeSearchText(item?.title || '');

  if (!queryTokens.size || !titleTokens.length) return 0;

  let score = 0;
  titleTokens.forEach((token) => {
    if (queryTokens.has(token)) score += 7;
  });

  const normalizedQuery = normalizeSearchText(query);
  const normalizedTitle = normalizeSearchText(item?.title || '');

  if (normalizedQuery && normalizedTitle.includes(normalizedQuery)) score += 28;
  if (normalizedTitle && normalizedQuery.includes(normalizedTitle)) score += 28;

  Array.from(queryTokens)
    .filter((token) => token.length >= 5)
    .forEach((token) => {
      if (normalizedTitle.includes(token)) score += 4;
    });

  return score;
}

function isWeakCategoryPath(path) {
  const normalized = normalizeSearchText(path);
  return (
    !normalized ||
    /everything else|\bother\b|misc|unknown|not specified|specialty category based on item type|verify exact ebay category/.test(
      normalized,
    )
  );
}

function getCategoryRoot(path) {
  return normalizeCategoryPath(path).split(' > ')[0] || '';
}

function getCategoryDepth(path) {
  return normalizeCategoryPath(path).split(' > ').filter(Boolean).length;
}

function buildCategorySuggestion(params = {}) {
  const activeItems = Array.isArray(params.activeItems)
    ? params.activeItems
    : [];
  const soldItems = Array.isArray(params.soldItems) ? params.soldItems : [];
  const imageItems = Array.isArray(params.imageItems) ? params.imageItems : [];
  const textItems = Array.isArray(params.textItems) ? params.textItems : [];

  const directCandidate = getDirectCategoryInheritanceCandidate({
    activeItems,
    soldItems,
    imageItems,
    textItems,
  });

  if (directCandidate) return directCandidate;

  // No fallback. If eBay returned no direct category on matched items, leave it
  // blank so the frontend can tell the user there was no eBay category returned.
  return {
    bestCategoryPath: '',
    bestCategoryId: '',
    categoryConfidence: 'none',
    categorySource: 'no-ebay-result-category',
    categoryVotes: [],
  };
}

function normalizeEbayItem(item) {
  if (!item) return null;

  const priceValue = item.price?.value ?? null;
  const shippingValue = item.shippingOptions?.[0]?.shippingCost?.value ?? null;
  // Use eBay-returned category data only. Do not infer or locally guess here.
  const categoryPath = normalizeCategoryPath(getEbayCategoryPath(item));
  const categoryId = getEbayCategoryId(item);

  return {
    id: item.itemId || '',
    itemId: item.itemId || '',
    title: item.title || '',
    price: priceValue,
    priceCurrency: item.price?.currency || 'USD',
    displayPrice: priceValue ? `$${priceValue}` : '',
    shipping: shippingValue,
    displayShipping: shippingValue ? `$${shippingValue}` : '',
    condition: item.condition || '',
    image: item.image?.imageUrl || '',
    link: item.itemWebUrl || '',
    itemWebUrl: item.itemWebUrl || '',
    seller: item.seller?.username || '',
    marketplace: item.itemLocation?.country || 'US',
    categoryId,
    categoryPath,
    categoryName:
      item.categoryName ||
      item.leafCategoryName ||
      item.primaryCategoryName ||
      '',
    categories: Array.isArray(item.categories) ? item.categories : [],
    primaryCategory: item.primaryCategory || null,
    leafCategoryIds: Array.isArray(item.leafCategoryIds)
      ? item.leafCategoryIds
      : categoryId
        ? [categoryId]
        : [],
  };
}

function attachCategorySuggestionToItems(items, categorySuggestion) {
  const bestCategoryPath = normalizeCategoryPath(
    categorySuggestion?.bestCategoryPath || '',
  );
  const bestCategoryId = String(
    categorySuggestion?.bestCategoryId || '',
  ).trim();

  if (!Array.isArray(items) || !items.length || !bestCategoryPath) {
    return Array.isArray(items) ? items : [];
  }

  return items.map((item) => {
    const directPath = normalizeCategoryPath(getDirectEbayCategoryPath(item));
    const categoryPath = directPath || bestCategoryPath;
    const categoryId = getEbayCategoryId(item) || bestCategoryId;

    return {
      ...item,
      categoryPath,
      ebayCategoryPath: categoryPath,
      categoryId: categoryId || item.categoryId,
      leafCategoryIds:
        Array.isArray(item.leafCategoryIds) && item.leafCategoryIds.length
          ? item.leafCategoryIds
          : categoryId
            ? [categoryId]
            : item.leafCategoryIds,
    };
  });
}

function normalizeEbayItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map(normalizeEbayItem).filter(Boolean);
}

app.get('/', (req, res) => {
  res.send('API is working');
});

app.get('/api/ebay-search', async (req, res) => {
  try {
    const query = String(req.query.q || '').trim();
    const limit = Math.max(1, Math.min(Number(req.query.limit || 10), 50));

    if (!query) {
      return res
        .status(400)
        .json({ error: 'Missing search query parameter "q"' });
    }

    const accessToken = await getEbayAccessToken();
    const ebayQuery = buildHardenedEbaySearchQuery(query);

    const url = new URL(EBAY_BROWSE_SEARCH_URL);
    url.searchParams.set('q', ebayQuery);
    url.searchParams.set('limit', String(limit));

    const ebayResponse = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': EBAY_MARKETPLACE_ID,
      },
    });

    const responseText = await ebayResponse.text();

    if (!ebayResponse.ok) {
      return res.status(ebayResponse.status).json({
        error: 'eBay live search failed',
        message: responseText,
      });
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      return res.status(500).json({
        error: 'Could not parse eBay response',
        message: responseText,
      });
    }

    const rawItemSummaries = Array.isArray(data?.itemSummaries)
      ? data.itemSummaries
      : [];
    const itemSummaries = await enrichEbayItemsWithCategorySuggestions(
      rawItemSummaries,
      accessToken,
      ebayQuery,
    );

    const categorySuggestion = buildCategorySuggestion({
      query: ebayQuery,
      activeItems: itemSummaries,
    });
    const categoryReadyItems = attachCategorySuggestionToItems(
      itemSummaries,
      categorySuggestion,
    );

    res.json({
      ...data,
      itemSummaries: categoryReadyItems,
      items: normalizeEbayItems(categoryReadyItems),
      ...categorySuggestion,
    });
  } catch (error) {
    console.error('Server error:', error.message);
    res.status(500).json({
      error: 'Server error',
      message: error.message,
    });
  }
});

app.get('/api/ebay-sold', async (req, res) => {
  try {
    const query = String(req.query.q || '').trim();
    const limit = Math.max(1, Math.min(Number(req.query.limit || 10), 50));

    if (!query) {
      return res
        .status(400)
        .json({ error: 'Missing search query parameter "q"' });
    }

    const accessToken = await getEbayAccessToken();
    const ebayQuery = buildHardenedEbaySearchQuery(query);

    const url = new URL(EBAY_BROWSE_SEARCH_URL);
    url.searchParams.set('q', ebayQuery);
    url.searchParams.set('limit', String(limit));
    url.searchParams.append('filter', 'buyingOptions:{FIXED_PRICE}');
    url.searchParams.append('filter', 'soldItemsOnly:true');

    const ebayResponse = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': EBAY_MARKETPLACE_ID,
      },
    });

    const responseText = await ebayResponse.text();

    if (!ebayResponse.ok) {
      return res.status(ebayResponse.status).json({
        error: 'eBay sold search failed',
        message: responseText,
      });
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      return res.status(500).json({
        error: 'Could not parse eBay sold response',
        message: responseText,
      });
    }

    const rawItemSummaries = Array.isArray(data?.itemSummaries)
      ? data.itemSummaries
      : [];
    const itemSummaries = await enrichEbayItemsWithCategorySuggestions(
      rawItemSummaries,
      accessToken,
      ebayQuery,
    );

    const categorySuggestion = buildCategorySuggestion({
      query: ebayQuery,
      soldItems: itemSummaries,
    });
    const categoryReadyItems = attachCategorySuggestionToItems(
      itemSummaries,
      categorySuggestion,
    );

    res.json({
      ...data,
      itemSummaries: categoryReadyItems,
      items: normalizeEbayItems(categoryReadyItems),
      searchType: 'sold',
      exactQuery: ebayQuery,
      ...categorySuggestion,
    });
  } catch (error) {
    console.error('Sold search server error:', error.message);
    res.status(500).json({
      error: 'Server error',
      message: error.message,
    });
  }
});
app.post(
  '/api/ebay/search-by-image',
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'files', maxCount: 3 },
  ]),
  async (req, res) => {
    try {
      const hint = cleanHint(req.body?.hint);
      const limit = Math.max(1, Math.min(Number(req.body?.limit || 12), 50));

      const uploadedFiles = [
        ...(Array.isArray(req.files?.file) ? req.files.file : []),
        ...(Array.isArray(req.files?.files) ? req.files.files : []),
      ]
        .filter((file) => file && file.buffer)
        .slice(0, 3);

      if (!uploadedFiles.length) {
        return res.status(400).json({
          error: 'Missing image upload',
          message:
            'Expected one or more multipart image fields named "file" or "files".',
        });
      }

      const accessToken = await getEbayAccessToken();

      const runImageSearch = async (file, index) => {
        try {
          const imageBase64 = file.buffer.toString('base64');
          const url = new URL(EBAY_BROWSE_IMAGE_SEARCH_URL);
          url.searchParams.set('limit', String(limit));

          const ebayResponse = await fetch(url.toString(), {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'X-EBAY-C-MARKETPLACE-ID': EBAY_MARKETPLACE_ID,
            },
            body: JSON.stringify({
              image: imageBase64,
            }),
          });

          const responseText = await ebayResponse.text();

          if (!ebayResponse.ok) {
            console.warn(
              `eBay image search failed for photo ${index + 1}:`,
              responseText,
            );
            return [];
          }

          try {
            const imageData = JSON.parse(responseText);
            return Array.isArray(imageData?.itemSummaries)
              ? imageData.itemSummaries
              : [];
          } catch (parseError) {
            console.warn(
              `Could not parse eBay image-search response for photo ${index + 1}:`,
              responseText,
            );
            return [];
          }
        } catch (imageSearchError) {
          console.warn(
            `eBay image search request failed for photo ${index + 1}:`,
            imageSearchError?.message || imageSearchError,
          );
          return [];
        }
      };

      // Run angle searches one at a time instead of in parallel. This is slower by a
      // second or two, but it is much more reliable on mobile uploads and avoids one
      // extra-angle failure taking down the whole lookup.
      const imageSearchGroups = [];
      for (let index = 0; index < uploadedFiles.length; index += 1) {
        const group = await runImageSearch(uploadedFiles[index], index);
        imageSearchGroups.push(group);
      }
      const imageMatches = imageSearchGroups.flat();

      // Optional second pass: if we got helper words, blend in a text search too.
      let textMatches = [];
      let exactQuery = '';
      if (hint) {
        exactQuery = buildLooseItemHintQuery(hint);

        if (exactQuery) {
          const textUrl = new URL(EBAY_BROWSE_SEARCH_URL);
          textUrl.searchParams.set('q', exactQuery);
          textUrl.searchParams.set('limit', String(limit));

          const textResponse = await fetch(textUrl.toString(), {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'X-EBAY-C-MARKETPLACE-ID': EBAY_MARKETPLACE_ID,
            },
          });

          if (textResponse.ok) {
            const textData = await textResponse.json();
            textMatches = Array.isArray(textData?.itemSummaries)
              ? textData.itemSummaries
              : [];
          }
        }
      }

      // Score duplicates slightly higher when multiple angles return the same item.
      const scoreMap = new Map();
      [...imageMatches, ...textMatches].forEach((item, index) => {
        const key = item?.itemId || item?.title;
        if (!key) return;

        const current = scoreMap.get(key) || { item, score: 0 };
        const isTextMatch = index >= imageMatches.length;
        current.score += isTextMatch ? 1 : 2;
        current.item = current.item || item;
        scoreMap.set(key, current);
      });

      const merged = Array.from(scoreMap.values())
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.item);

      const categoryQuery = exactQuery || hint;
      const limitedMerged = await enrichEbayItemsWithCategorySuggestions(
        merged.slice(0, limit),
        accessToken,
        categoryQuery,
      );
      const limitedImageMatches = await enrichEbayItemsWithCategorySuggestions(
        imageMatches.slice(0, limit),
        accessToken,
        categoryQuery,
      );
      const limitedTextMatches = await enrichEbayItemsWithCategorySuggestions(
        textMatches.slice(0, limit),
        accessToken,
        categoryQuery,
      );
      const photoCount = uploadedFiles.length;

      const categorySuggestion = buildCategorySuggestion({
        query: categoryQuery,
        activeItems: limitedMerged,
        imageItems: limitedImageMatches,
        textItems: limitedTextMatches,
      });
      const categoryReadyMerged = attachCategorySuggestionToItems(
        limitedMerged,
        categorySuggestion,
      );
      const categoryReadyImageMatches = attachCategorySuggestionToItems(
        limitedImageMatches,
        categorySuggestion,
      );
      const categoryReadyTextMatches = attachCategorySuggestionToItems(
        limitedTextMatches,
        categorySuggestion,
      );

      return res.json({
        note: hint
          ? `Image search used ${photoCount} photo${photoCount === 1 ? '' : 's'}, then helper words "${hint}" were blended in.`
          : `Image search used ${photoCount} photo${photoCount === 1 ? '' : 's'}.`,
        itemSummaries: categoryReadyMerged,
        imageItemSummaries: categoryReadyImageMatches,
        textItemSummaries: categoryReadyTextMatches,
        items: normalizeEbayItems(categoryReadyMerged),
        imageItems: normalizeEbayItems(categoryReadyImageMatches),
        textItems: normalizeEbayItems(categoryReadyTextMatches),
        exactQuery: exactQuery || '',
        photoCount,
        ...categorySuggestion,
      });
    } catch (error) {
      console.error('Image search server error:', error.message);
      res.status(500).json({
        error: 'Server error',
        message: error.message,
      });
    }
  },
);

// Fallback Craigslist route. If estate-sales-route handles this request first,
// Express will use that route. This remains here as a backup.
app.get('/api/estate-sales', async (req, res) => {
  try {
    const cheerioModule = await import('cheerio');
    const load = cheerioModule.load || cheerioModule.default?.load;

    if (!load) {
      throw new Error('Cheerio load function is unavailable');
    }

    const url =
      'https://chicago.craigslist.org/search/gms?postal=60540&search_distance=25';

    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`Craigslist responded with status ${response.status}`);
    }

    const html = await response.text();
    const $ = load(html);

    const sales = [];
    const seenLinks = new Set();

    $('a[href]').each((i, el) => {
      if (sales.length >= 10) return false;

      const rawLink = $(el).attr('href') || '';
      const title = $(el).text().trim().replace(/\s+/g, ' ');

      if (!rawLink || !title) return;
      if (title.toLowerCase() === 'craigslist') return;
      if (title.toLowerCase() === 'see also') return;

      const looksLikeListing =
        rawLink.includes('/') &&
        !rawLink.includes('/search/') &&
        !rawLink.startsWith('#');

      if (!looksLikeListing) return;

      const fullLink = rawLink.startsWith('http')
        ? rawLink
        : `https://chicago.craigslist.org${rawLink}`;

      if (seenLinks.has(fullLink)) return;
      seenLinks.add(fullLink);

      const lower = title.toLowerCase();
      const type = lower.includes('estate') ? 'estate' : 'garage';

      const baseLat = 41.785;
      const baseLng = -88.147;
      const offsetLat = (Math.random() - 0.5) * 0.05;
      const offsetLng = (Math.random() - 0.5) * 0.05;

      sales.push({
        id: `cl-${sales.length}`,
        title,
        latitude: baseLat + offsetLat,
        longitude: baseLng + offsetLng,
        address: 'Naperville Area',
        type,
        date: '',
        link: fullLink,
      });
    });

    res.json({ sales });
  } catch (err) {
    console.error('Craigslist fetch error:', err);
    res.status(500).json({
      error: 'Failed to fetch Craigslist sales',
      detail: String(err?.message || err),
    });
  }
});

const BUG_REPORT_TO_EMAIL = process.env.BUG_REPORT_TO_EMAIL || '';
const BUG_REPORT_FROM_EMAIL =
  process.env.BUG_REPORT_FROM_EMAIL || 'List Assist <onboarding@resend.dev>';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';

function cleanBugReportText(value, maxLength = 4000) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[\u0000-\u001F\u007F]/g, (char) =>
      char === '\n' || char === '\t' ? char : ' ',
    )
    .trim()
    .slice(0, maxLength);
}

function isValidEmail(value) {
  return /^\S+@\S+\.\S+$/.test(String(value || '').trim());
}

async function sendBugReportEmail(report) {
  if (!RESEND_API_KEY || !BUG_REPORT_TO_EMAIL) {
    return {
      sent: false,
      reason: 'RESEND_API_KEY or BUG_REPORT_TO_EMAIL is not configured.',
    };
  }

  const subjectPrefix =
    report.type === 'suggestion' ? 'Suggestion' : 'Bug Report';
  const subject = `List Assist ${subjectPrefix}`;
  const lines = [
    `Type: ${report.type}`,
    `User email: ${report.email || 'Not provided'}`,
    `App: ${report.appName || 'List Assist'}`,
    `Version: ${report.appVersion || 'Unknown'}`,
    `Screen: ${report.screen || 'Unknown'}`,
    `Home mode: ${report.homeMode || 'Unknown'}`,
    `Scan mode: ${report.homeScanMode || 'Unknown'}`,
    `Finder mode: ${report.finderMode || 'Unknown'}`,
    `Radius miles: ${report.radiusMiles || 'Unknown'}`,
    `Created at: ${report.createdAt || new Date().toISOString()}`,
    '',
    'Message:',
    report.message,
  ];

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: BUG_REPORT_FROM_EMAIL,
      to: [BUG_REPORT_TO_EMAIL],
      reply_to: report.email || undefined,
      subject,
      text: lines.join('\n'),
    }),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Resend email failed: ${response.status} ${responseText}`);
  }

  return { sent: true };
}

app.post('/api/bug-report', async (req, res) => {
  try {
    const report = {
      type:
        String(req.body?.type || '')
          .trim()
          .toLowerCase() === 'suggestion'
          ? 'suggestion'
          : 'bug',
      message: cleanBugReportText(req.body?.message),
      email: cleanBugReportText(req.body?.email, 250),
      appName: cleanBugReportText(req.body?.appName, 120),
      appVersion: cleanBugReportText(req.body?.appVersion, 80),
      screen: cleanBugReportText(req.body?.screen, 120),
      homeMode: cleanBugReportText(req.body?.homeMode, 80),
      homeScanMode: cleanBugReportText(req.body?.homeScanMode, 80),
      finderMode: cleanBugReportText(req.body?.finderMode, 80),
      radiusMiles: cleanBugReportText(req.body?.radiusMiles, 20),
      createdAt: cleanBugReportText(req.body?.createdAt, 80),
    };

    if (report.message.length < 5) {
      return res.status(400).json({
        error: 'Please include a few details before sending.',
      });
    }

    if (report.email && !isValidEmail(report.email)) {
      return res.status(400).json({
        error: 'Email address is not valid.',
      });
    }

    console.log('List Assist bug report received:', report);

    let emailStatus = { sent: false, reason: 'Email not attempted.' };
    try {
      emailStatus = await sendBugReportEmail(report);
    } catch (emailError) {
      console.error('Bug report email error:', emailError.message);
      emailStatus = { sent: false, reason: emailError.message };
    }

    return res.json({
      success: true,
      emailed: Boolean(emailStatus.sent),
      message: emailStatus.sent
        ? 'Report sent.'
        : 'Report saved to server logs. Email forwarding is not configured.',
    });
  } catch (error) {
    console.error('Bug report server error:', error.message);
    return res.status(500).json({
      error: 'Server error',
      message: error.message,
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
