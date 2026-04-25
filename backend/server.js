require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
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

function buildLooseItemHintQuery(hint) {
  const cleaned = cleanHint(hint);
  if (!cleaned) return '';
  return cleaned;
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

    const url = new URL(EBAY_BROWSE_SEARCH_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('limit', String(limit));

    const ebayResponse = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
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

    res.json(data);
  } catch (error) {
    console.error('Server error:', error.message);
    res.status(500).json({
      error: 'Server error',
      message: error.message,
    });
  }
});

app.post(
  '/api/ebay/search-by-image',
  upload.single('file'),
  async (req, res) => {
    try {
      const hint = cleanHint(req.body?.hint);
      const limit = Math.max(1, Math.min(Number(req.body?.limit || 12), 50));

      if (!req.file || !req.file.buffer) {
        return res.status(400).json({
          error: 'Missing image upload',
          message: 'Expected a multipart file field named "file".',
        });
      }

      const accessToken = await getEbayAccessToken();
      const imageBase64 = req.file.buffer.toString('base64');

      const url = new URL(EBAY_BROWSE_IMAGE_SEARCH_URL);
      url.searchParams.set('limit', String(limit));

      const ebayResponse = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        },
        body: JSON.stringify({
          image: imageBase64,
        }),
      });

      const responseText = await ebayResponse.text();

      if (!ebayResponse.ok) {
        return res.status(ebayResponse.status).json({
          error: 'eBay image search failed',
          message: responseText,
        });
      }

      let imageData;
      try {
        imageData = JSON.parse(responseText);
      } catch (parseError) {
        return res.status(500).json({
          error: 'Could not parse eBay image-search response',
          message: responseText,
        });
      }

      let imageMatches = Array.isArray(imageData?.itemSummaries)
        ? imageData.itemSummaries
        : [];

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
              'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
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

      // Merge image matches first, then text matches, deduped by itemId
      const seen = new Set();
      const merged = [...imageMatches, ...textMatches].filter((item) => {
        const key = item?.itemId || item?.title;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      return res.json({
        note: hint
          ? `Image search ran first, then helper words "${hint}" were blended in.`
          : 'Image search ran successfully.',
        itemSummaries: merged.slice(0, limit),
        imageItemSummaries: imageMatches.slice(0, limit),
        textItemSummaries: textMatches.slice(0, limit),
        exactQuery: exactQuery || '',
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

app.get('/api/estate-sales', async (req, res) => {
  try {
    const fetchModule = await import('node-fetch');
    const fetch = fetchModule.default;

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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
