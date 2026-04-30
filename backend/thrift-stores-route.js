// DEBUG VERSION — single Google Places call only

const GOOGLE_URL = 'https://places.googleapis.com/v1/places:searchText';

const fetch = (...args) => {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch(...args);
  return import('node-fetch').then(({ default: fetch }) => fetch(...args));
};

async function thriftStoresHandler(req, res) {
  try {
    const lat = Number(req.query.lat || req.query.latitude);
    const lng = Number(req.query.lng || req.query.longitude);

    if (!lat || !lng) {
      return res.status(400).json({
        error: 'Missing lat/lng',
      });
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
      return res.json({
        error: 'Missing GOOGLE_MAPS_API_KEY',
      });
    }

    console.log('👉 Making Google request...');

    const response = await fetch(GOOGLE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask':
          'places.displayName,places.formattedAddress,places.location',
      },
      body: JSON.stringify({
        textQuery: 'thrift store',
        locationBias: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: 5000,
          },
        },
      }),
    });

    const text = await response.text();

    console.log('👉 Google raw response:', text.slice(0, 500));

    if (!response.ok) {
      return res.json({
        error: 'Google API error',
        status: response.status,
        body: text,
      });
    }

    const data = JSON.parse(text);

    return res.json({
      success: true,
      places: data.places || [],
    });
  } catch (err) {
    console.error('🔥 ERROR:', err);
    return res.json({
      error: err.message,
      stack: err.stack,
    });
  }
}

module.exports = { thriftStoresHandler };
