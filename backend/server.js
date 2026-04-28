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

function normalizeEbayItem(item) {
  if (!item) return null;

  const priceValue = item.price?.value ?? null;
  const shippingValue = item.shippingOptions?.[0]?.shippingCost?.value ?? null;

  return {
    id: item.itemId || '',
    title: item.title || '',
    price: priceValue,
    priceCurrency: item.price?.currency || 'USD',
    displayPrice: priceValue ? `$${priceValue}` : '',
    shipping: shippingValue,
    displayShipping: shippingValue ? `$${shippingValue}` : '',
    condition: item.condition || '',
    image: item.image?.imageUrl || '',
    link: item.itemWebUrl || '',
    seller: item.seller?.username || '',
    marketplace: item.itemLocation?.country || 'US',
  };
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

    const itemSummaries = Array.isArray(data?.itemSummaries)
      ? data.itemSummaries
      : [];

    res.json({
      ...data,
      items: normalizeEbayItems(itemSummaries),
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

    const url = new URL(EBAY_BROWSE_SEARCH_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('limit', String(limit));
    url.searchParams.append('filter', 'buyingOptions:{FIXED_PRICE}');
    url.searchParams.append('filter', 'soldItemsOnly:true');

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

    const itemSummaries = Array.isArray(data?.itemSummaries)
      ? data.itemSummaries
      : [];

    res.json({
      ...data,
      itemSummaries,
      items: normalizeEbayItems(itemSummaries),
      searchType: 'sold',
      exactQuery: query,
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

      const imageMatches = Array.isArray(imageData?.itemSummaries)
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

      // Merge image matches first, then text matches, deduped by itemId/title.
      const seen = new Set();
      const merged = [...imageMatches, ...textMatches].filter((item) => {
        const key = item?.itemId || item?.title;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const limitedMerged = merged.slice(0, limit);
      const limitedImageMatches = imageMatches.slice(0, limit);
      const limitedTextMatches = textMatches.slice(0, limit);

      return res.json({
        note: hint
          ? `Image search ran first, then helper words "${hint}" were blended in.`
          : 'Image search ran successfully.',
        itemSummaries: limitedMerged,
        imageItemSummaries: limitedImageMatches,
        textItemSummaries: limitedTextMatches,
        items: normalizeEbayItems(limitedMerged),
        imageItems: normalizeEbayItems(limitedImageMatches),
        textItems: normalizeEbayItems(limitedTextMatches),
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
