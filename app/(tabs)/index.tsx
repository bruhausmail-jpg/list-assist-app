// FULL MERGED index.tsx (with your updates applied)
// Includes your full logic + improved adjust layout

import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Callout, Marker } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

type ReferenceType = 'quarter' | 'sodaCanTop' | 'dollarBill' | 'businessCard';
type DetectedShape = 'circle' | 'rectangle';
type PhotoKey = 'photo1' | 'photo2';
type MeasurementKey = 'length' | 'width' | 'depth';

type AppStep =
  | 'referencePicker'
  | 'sellerTools'
  | 'garageSaleLanding'
  | 'estateSaleLanding'
  | 'garageSales'
  | 'garageSalesMap'
  | 'routeSummary'
  | 'barcodeScanner'
  | 'barcodeFailure'
  | 'referenceObjectPicker'
  | 'packageFrontCamera'
  | 'packageFrontPreview'
  | 'packageFrontConfirm'
  | 'looseItemCamera'
  | 'looseItemPreview'
  | 'looseItemConfirm'
  | 'cameraPhoto1'
  | 'photo1Preview'
  | 'photo1ReferenceTap'
  | 'photo1ReferenceAdjust'
  | 'measurePhoto1'
  | 'cameraPhoto2'
  | 'photo2Preview'
  | 'photo2ReferenceTap'
  | 'photo2ReferenceAdjust'
  | 'measurePhoto2'
  | 'results'
  | 'compCheck'
  | 'listingBuilder'
  | 'priceCheckerChooser'
  | 'priceCheckerResult';

type ReferenceConfig = {
  key: ReferenceType;
  label: string;
  realWidthInches: number;
  shape: DetectedShape;
  helperText: string;
  measurementLabel: string;
};

type DetectionBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  shape: DetectedShape;
  estimatedPixels: number;
};

type Point = {
  x: number;
  y: number;
};

type PhotoState = {
  uri: string | null;
  referenceDetection: DetectionBox | null;
  pixelsPerInch: number | null;
  measurementPoints: Point[];
};

type Measurements = {
  length: number | null;
  width: number | null;
  depth: number | null;
};

type UnitSystem = 'us' | 'metric';
// ===== GARAGE SALE PHASE 1: MODE SWITCH START =====
type HomeMode = 'boxFinder' | 'dealFinder';
type HomeScanMode = 'list' | 'source';
type FinderMode = 'garage' | 'sales' | 'thrift';
type GarageSaleRadiusMiles = 5 | 10 | 25 | 50;
type GarageSaleDayFilter = 'today' | 'tomorrow';
// ===== GARAGE SALE PHASE 1: MODE SWITCH END =====

type Box = {
  id: string;
  name: string;
  length: number;
  width: number;
  height: number;
  amazonSearchUrl?: string;
};

type Orientation = {
  length: number;
  width: number;
  height: number;
};

type FitResult = {
  box: Box;
  boxVolume: number;
  chosenOrientation: Orientation;
  fitScore: number;
  fitLabel: string;
  volumeUsagePercent: number;
  totalSlack: number;
  maxSlack: number;
  slackLength: number;
  slackWidth: number;
  slackHeight: number;
};

type NearestMissResult = {
  box: Box;
  chosenOrientation: Orientation;
  overLength: number;
  overWidth: number;
  overHeight: number;
  totalOverage: number;
  maxOverage: number;
  overDimensions: string[];
};

type FitMode = {
  key: string;
  label: string;
  padding: number;
};

type ResizeMethod = 'score-fold' | 'cut-trim';

type ResizeGuide = {
  possible: boolean;
  reason?: string;
  difficulty?: string;
  removeDepth?: number;
  targetDepth?: number;
  method?: ResizeMethod;
  methodLabel?: string;
  steps?: string[];
};

type BarcodeProduct = {
  barcode: string;
  title: string;
  length: number;
  width: number;
  height: number;
  weightOz?: number;
  source: string;
  confidence?: 'high' | 'medium' | 'low';
};

type BarcodeLookupResult = {
  product: BarcodeProduct | null;
  source: 'local' | 'online' | 'rate_limited' | 'none';
  message?: string;
  retryAfterMs?: number;
};

type ListingPlatform = 'ebay' | 'facebook' | 'amazon' | 'generic';
type ListingCondition = 'Used' | 'New' | 'Open Box' | 'For Parts';

type ListingDraft = {
  titleOptions: string[];
  shortDescription: string;
  fullDescription: string;
  keywords: string;
  priceSuggestion?: string;
};

type SavedListingDraft = {
  id: string;
  savedAt: number;
  platform: ListingPlatform;
  condition: ListingCondition;
  productTitle: string;
  draft: ListingDraft;
};

type GarageSaleFavorite = {
  id: string;
  title: string;
  subtitle: string;
  query: string;
  savedAt: number;
  latitude?: number;
  longitude?: number;
  mapsQuery?: string;
  addressLabel?: string;
  saleType?: 'garage' | 'estate' | 'thrift';
  craigslistUrl?: string;
  dayLabel?: string;
  timeLabel?: string;
  notes?: string;
  distanceLabel?: string;
  phone?: string;
  website?: string;
  source?: string;
  openingHours?: string;
};

type GarageSaleMapPin = {
  saleType: 'garage' | 'estate' | 'thrift';
  id: string;
  title: string;
  subtitle: string;
  query: string;
  mapsQuery?: string;
  latitude: number;
  longitude: number;
  addressLabel: string;
  mapAddress?: string;
  street?: string;
  crossStreet?: string;
  city?: string;
  state?: string;
  zip?: string;
  displayAddress?: string;
  timeLabel: string;
  notes: string;
  pinColor: string;
  craigslistUrl?: string;
  dayLabel?: string;
  distanceLabel?: string;
  distanceMiles?: number | null;
  probableSale?: boolean;
  saleSortTimestamp?: number;
  hasExactCoordinates?: boolean;
  isApproximateLocation?: boolean;
  isCluster?: boolean;
  clusterCount?: number;
  memberPins?: GarageSaleMapPin[];
  phone?: string;
  website?: string;
  source?: string;
  openingHours?: string;
};

type SellerToolProduct = {
  id: string;
  category: string;
  name: string;
  description: string;
  amazonUrl: string;
  note?: string;
};

const AMAZON_AFFILIATE_TAG = 'passrese-20';
const UPCITEMDB_TRIAL_LOOKUP_URL =
  'https://api.upcitemdb.com/prod/trial/lookup';
const OCR_SPACE_API_URL = 'https://api.ocr.space/parse/image';
const OCR_SPACE_DEMO_API_KEY = 'helloworld';

const BARCODE_SCAN_COOLDOWN_MS = 2000;
const BARCODE_DUPLICATE_WINDOW_MS = 2500;
const BARCODE_RATE_LIMIT_COOLDOWN_MS = 60000;
const PACKAGE_FRONT_LOOKUP_TIMEOUT_MS = 20000;
const LIST_ASSIST_LISTING_DRAFTS_STORAGE_KEY = 'listassist_listing_drafts_v1';
const GARAGE_SALE_FAVORITES_STORAGE_KEY = 'listassist_garage_sale_favorites_v1';
const LOCAL_BACKEND_BASE_URL = 'http://10.0.0.108:3001';
const THRIFT_STORES_API_URL = `${LOCAL_BACKEND_BASE_URL}/api/thrift-stores`;
const GARAGE_SALES_API_URL = `${LOCAL_BACKEND_BASE_URL}/api/garage-sales`;
const LIVE_EBAY_SEARCH_API_URL = `${LOCAL_BACKEND_BASE_URL}/api/ebay-search`;
const LOOSE_ITEM_IMAGE_SEARCH_URL = `${LOCAL_BACKEND_BASE_URL}/api/ebay/search-by-image`;

const APP_THRIFT_FALLBACK_STORES = [
  {
    id: 'fallback-goodwill-fort-hill-naperville',
    title: 'Goodwill',
    subtitle: 'Thrift Store',
    latitude: 41.7648028,
    longitude: -88.1970536,
    addressLabel: '539 Fort Hill Drive, Naperville, IL 60540',
    mapAddress: '539 Fort Hill Drive, Naperville, IL 60540',
    openingHours: '',
    phone: '',
    website: 'https://www.amazinggoodwill.com/',
    source: 'Starter thrift store list',
  },
  {
    id: 'fallback-restore-route-59-naperville',
    title: 'Habitat for Humanity ReStore',
    subtitle: 'Thrift Store',
    latitude: 41.7552481,
    longitude: -88.2019689,
    addressLabel: '868 South Illinois Route 59, Naperville, IL 60540',
    mapAddress: '868 South Illinois Route 59, Naperville, IL 60540',
    openingHours: '',
    phone: '+1 630 297 9189',
    website: 'https://gohabitatrestore.com/shop-naperville/',
    source: 'Starter thrift store list',
  },
  {
    id: 'fallback-serendipity-aurora',
    title: 'Serendipity',
    subtitle: 'Second-hand Store',
    latitude: 41.7495525,
    longitude: -88.208617,
    addressLabel: '461 South Route 59, Aurora, IL 60504',
    mapAddress: '461 South Route 59, Aurora, IL 60504',
    openingHours: '',
    phone: '',
    website: '',
    source: 'Starter thrift store list',
  },
  {
    id: 'fallback-savers-ogden-naperville',
    title: 'Savers',
    subtitle: 'Thrift Store',
    latitude: 41.7937025,
    longitude: -88.1275684,
    addressLabel: '1125 East Ogden Avenue, Naperville, IL 60563',
    mapAddress: '1125 East Ogden Avenue, Naperville, IL 60563',
    openingHours: '',
    phone: '',
    website:
      'https://stores.savers.com/il/naperville/savers-thrift-store-1250.html',
    source: 'Starter thrift store list',
  },
  {
    id: 'fallback-family-shelter-resale-naperville',
    title: 'Family Shelter Resale Shop',
    subtitle: 'Resale Shop',
    latitude: 41.7980161,
    longitude: -88.1177492,
    addressLabel: '1512 Naper Boulevard, Unit 172, Naperville, IL 60563',
    mapAddress: '1512 Naper Boulevard, Unit 172, Naperville, IL 60563',
    openingHours: 'Mo, We, Fr, Sa 10:00-12:00, 13:00-16:00',
    phone: '',
    website:
      'https://www.metrofamily.org/the-family-shelter-service-resale-shop-in-naperville-is-re-opening-as-of-monday-august-10/',
    source: 'Starter thrift store list',
  },
  {
    id: 'fallback-goodwill-woodridge',
    title: 'Goodwill',
    subtitle: 'Thrift Store',
    latitude: 41.7297054,
    longitude: -88.0275685,
    addressLabel: '8615 Woodward Avenue, Woodridge, IL 60517',
    mapAddress: '8615 Woodward Avenue, Woodridge, IL 60517',
    openingHours: '',
    phone: '+1 630 9100387',
    website: 'https://www.goodwill.org/',
    source: 'Starter thrift store list',
  },
  {
    id: 'fallback-salvation-army-darien',
    title: 'The Salvation Army',
    subtitle: 'Thrift Store',
    latitude: 41.735774,
    longitude: -88.0117045,
    addressLabel: '7511 Lemont Road, Darien, IL 60561',
    mapAddress: '7511 Lemont Road, Darien, IL 60561',
    openingHours: 'Mo-Sa 09:00-21:00',
    phone: '',
    website: '',
    source: 'Starter thrift store list',
  },
  {
    id: 'fallback-goodwill-montgomery',
    title: 'Goodwill',
    subtitle: 'Thrift Store',
    latitude: 41.7210155,
    longitude: -88.2842689,
    addressLabel: '1901 Hill Avenue, Montgomery, IL 60538',
    mapAddress: '1901 Hill Avenue, Montgomery, IL 60538',
    openingHours: '',
    phone: '',
    website: '',
    source: 'Starter thrift store list',
  },
];

function buildLocalThriftFallbackPins(params: {
  originLatitude?: number | null;
  originLongitude?: number | null;
  radiusMiles: number;
}): GarageSaleMapPin[] {
  const originLatitude = Number(params.originLatitude);
  const originLongitude = Number(params.originLongitude);
  const hasOrigin = hasValidCoordinates(originLatitude, originLongitude);

  return APP_THRIFT_FALLBACK_STORES.map((store, index) => {
    const distanceMiles = hasOrigin
      ? calculatePointDistanceMiles(
          originLatitude,
          originLongitude,
          store.latitude,
          store.longitude,
        )
      : null;

    const numericDistance = Number(distanceMiles);
    const distanceLabel =
      Number.isFinite(numericDistance) && numericDistance >= 0
        ? `${round2(numericDistance)} mi`
        : 'Distance unavailable';

    const openingHours = String(store.openingHours || '').trim();
    const mapsQuery = String(
      store.mapAddress ||
        store.addressLabel ||
        `${store.title} ${store.latitude},${store.longitude}`,
    ).trim();

    return {
      id: store.id || `fallback-thrift-${index + 1}`,
      title: store.title,
      subtitle: `${store.subtitle} • ${distanceLabel}`,
      query: `${store.title} ${mapsQuery}`.trim(),
      mapsQuery,
      latitude: store.latitude,
      longitude: store.longitude,
      addressLabel: store.addressLabel,
      mapAddress: store.mapAddress,
      displayAddress: store.addressLabel,
      timeLabel: openingHours || 'Hours not listed',
      openingHours,
      notes: `${store.subtitle}. Tap Map for directions${store.website ? ' or View for store details' : ''}.`,
      saleType: 'thrift',
      pinColor: getGarageSaleMarkerColor('thrift'),
      craigslistUrl: undefined,
      dayLabel: undefined,
      distanceLabel,
      distanceMiles: Number.isFinite(numericDistance)
        ? Number(round2(numericDistance))
        : null,
      phone: store.phone,
      website: store.website,
      source: store.source,
    } satisfies GarageSaleMapPin;
  })
    .filter((pin) => {
      const numericDistance = Number(pin.distanceMiles);
      if (!Number.isFinite(numericDistance)) return true;
      return numericDistance <= Math.max(params.radiusMiles, 10);
    })
    .sort((a, b) => {
      const aDistance = Number.isFinite(a.distanceMiles as number)
        ? Number(a.distanceMiles)
        : 9999;
      const bDistance = Number.isFinite(b.distanceMiles as number)
        ? Number(b.distanceMiles)
        : 9999;
      return aDistance - bDistance || a.title.localeCompare(b.title);
    });
}

const SELLER_TOOLS_PRODUCTS: SellerToolProduct[] = [
  {
    id: 'label-printer-rollo',
    category: 'Label Printers',
    name: 'Rollo Wireless Label Printer',
    description:
      'Fast 4×6 shipping labels for eBay, Amazon, Etsy, and Shopify.',
    amazonUrl:
      'https://www.amazon.com/s?k=Rollo+Wireless+Label+Printer&tag=passrese-20',
    note: 'Good all-around thermal printer pick.',
  },
  {
    id: 'dymo-4xl',
    category: 'Label Printers',
    name: 'DYMO LabelWriter 4XL',
    description: 'Popular 4×6 thermal label printer for shipping labels.',
    amazonUrl:
      'https://www.amazon.com/s?k=DYMO+LabelWriter+4XL&tag=passrese-20',
  },
  {
    id: 'thermal-labels',
    category: 'Labels',
    name: '4×6 Thermal Shipping Labels',
    description:
      'Fan-fold labels for thermal printers. Easy replenishment item.',
    amazonUrl:
      'https://www.amazon.com/s?k=4x6+thermal+shipping+labels&tag=passrese-20',
  },
  {
    id: 'shipping-boxes',
    category: 'Boxes',
    name: 'Corrugated Shipping Boxes Assortment',
    description: 'Mixed box sizes for everyday resale shipments.',
    amazonUrl:
      'https://www.amazon.com/s?k=shipping+boxes+assorted+sizes&tag=passrese-20',
  },
  {
    id: 'poly-mailers',
    category: 'Mailers',
    name: 'Poly Mailers',
    description: 'Lightweight mailers for soft goods and lower-cost shipments.',
    amazonUrl: 'https://www.amazon.com/s?k=poly+mailers&tag=passrese-20',
  },
  {
    id: 'box-resizer',
    category: 'Box Tools',
    name: 'Box Resizer Tool',
    description:
      'Scores boxes cleanly so you can resize them and save on shipping.',
    amazonUrl: 'https://www.amazon.com/s?k=box+resizer+tool&tag=passrese-20',
  },
  {
    id: 'packing-paper',
    category: 'Packing Supplies',
    name: 'Packing Paper',
    description: 'Simple void fill and wrapping paper for fragile items.',
    amazonUrl:
      'https://www.amazon.com/s?k=packing+paper+for+shipping&tag=passrese-20',
  },
  {
    id: 'thermal-printer-paper',
    category: 'Office Supplies',
    name: 'Thermal Printer Labels and Paper',
    description:
      'Extra consumables for label printers and receipt-style thermal devices.',
    amazonUrl:
      'https://www.amazon.com/s?k=thermal+printer+paper+labels&tag=passrese-20',
  },
];

const SELLER_TOOLS_EDIT_NOTE =
  'To add, remove, or reorder recommendations, edit the SELLER_TOOLS_PRODUCTS list in index.tsx. Each item is one product card.';

const FIT_MODES_US: FitMode[] = [
  { key: 'closest', label: 'Closest Match', padding: 0 },
  { key: 'pad1', label: '+1" Padding', padding: 1 },
  { key: 'pad2', label: '+2" Padding', padding: 2 },
  { key: 'pad3', label: '+3" Padding', padding: 3 },
];

const FIT_MODES_METRIC: FitMode[] = [
  { key: 'closest', label: 'Closest Match', padding: 0 },
  { key: 'pad1', label: '+2 cm Padding', padding: 2 },
  { key: 'pad2', label: '+5 cm Padding', padding: 5 },
  { key: 'pad3', label: '+8 cm Padding', padding: 8 },
];

function buildAmazonSearchUrl(
  length: number,
  width: number,
  height: number,
  unitSystem: UnitSystem,
  affiliateTag?: string,
) {
  const dims = [length, width, height].sort((a, b) => a - b);

  if (unitSystem === 'us') {
    const query = `${dims[0]}x${dims[1]}x${dims[2]} shipping box`;
    return `https://www.amazon.com/s?k=${encodeURIComponent(query)}${
      affiliateTag ? `&tag=${affiliateTag}` : ''
    }`;
  }

  const query = `${dims[0]} x ${dims[1]} x ${dims[2]} cm cardboard box`;
  return `https://www.amazon.co.uk/s?k=${encodeURIComponent(query)}`;
}

function getAmazonButtonText(
  unitSystem: UnitSystem,
  isTopResult: boolean,
): string {
  if (unitSystem === 'metric') {
    return 'Find Box on Amazon UK';
  }

  return 'Find Box on Amazon';
}

function getNearestMissButtonText(unitSystem: UnitSystem): string {
  return unitSystem === 'metric'
    ? 'Find Box on Amazon UK'
    : 'Find Box on Amazon';
}

async function openAmazonLink(url?: string) {
  try {
    if (!url) {
      Alert.alert('Error', 'No Amazon link is available.');
      return;
    }

    const supported = await Linking.canOpenURL(url);

    if (!supported) {
      Alert.alert('Cannot Open', 'Amazon link failed on this device.');
      return;
    }

    await Linking.openURL(url);
  } catch (error) {
    console.log('Amazon link error:', error);
    Alert.alert('Error', 'Could not open Amazon.');
  }
}

async function openExternalLink(url?: string) {
  try {
    if (!url) {
      Alert.alert('Error', 'No link available.');
      return;
    }

    const supported = await Linking.canOpenURL(url);

    if (!supported) {
      Alert.alert('Cannot Open', 'This link cannot be opened on your device.');
      return;
    }

    await Linking.openURL(url);
  } catch (error) {
    console.log('Link open error:', error);
    Alert.alert('Error', 'Something went wrong opening the link.');
  }
}

async function openPhoneNumber(phone?: string) {
  try {
    const cleaned = String(phone || '').replace(/[^+\d]/g, '');

    if (!cleaned) {
      Alert.alert('Phone', 'No phone number is available.');
      return;
    }

    const url = `tel:${cleaned}`;
    const supported = await Linking.canOpenURL(url);

    if (!supported) {
      Alert.alert(
        'Cannot Call',
        'This phone number cannot be opened on your device.',
      );
      return;
    }

    await Linking.openURL(url);
  } catch (error) {
    console.log('Phone link error:', error);
    Alert.alert('Error', 'Could not open the phone dialer.');
  }
}

function getCraigslistAreaFromPlace(
  place?: Location.LocationGeocodedAddress | null,
) {
  const city = String(place?.city || '')
    .trim()
    .toLowerCase();
  const region = String(place?.region || '')
    .trim()
    .toLowerCase();
  const subregion = String(place?.subregion || '')
    .trim()
    .toLowerCase();

  const lookupValues = [city, subregion, region].filter(Boolean).join(' ');

  const craigslistAreaMatchers: Array<{
    area: string;
    terms: string[];
  }> = [
    {
      area: 'chicago',
      terms: [
        'chicago',
        'cook',
        'dupage',
        'naperville',
        'aurora',
        'joliet',
        'illinois',
      ],
    },
    {
      area: 'losangeles',
      terms: [
        'los angeles',
        'la county',
        'hollywood',
        'burbank',
        'glendale',
        'pasadena',
        'santa monica',
        'beverly hills',
      ],
    },
    {
      area: 'miami',
      terms: [
        'miami',
        'miami dade',
        'dade',
        'fort lauderdale',
        'broward',
        'west palm beach',
        'palm beach',
      ],
    },
    {
      area: 'newyork',
      terms: [
        'new york',
        'manhattan',
        'brooklyn',
        'queens',
        'bronx',
        'staten island',
        'long island',
      ],
    },
    {
      area: 'sfbay',
      terms: [
        'san francisco',
        'oakland',
        'berkeley',
        'san jose',
        'palo alto',
        'bay area',
      ],
    },
    {
      area: 'sandiego',
      terms: ['san diego'],
    },
    {
      area: 'phoenix',
      terms: ['phoenix', 'scottsdale', 'mesa', 'tempe', 'glendale arizona'],
    },
    {
      area: 'seattle',
      terms: ['seattle', 'bellevue', 'redmond', 'tacoma', 'everett'],
    },
    {
      area: 'portland',
      terms: ['portland', 'beaverton', 'gresham', 'hillsboro', 'oregon'],
    },
    {
      area: 'denver',
      terms: ['denver', 'aurora colorado', 'lakewood', 'boulder', 'colorado'],
    },
    {
      area: 'dallas',
      terms: ['dallas', 'fort worth', 'arlington', 'plano', 'frisco', 'dfw'],
    },
    {
      area: 'houston',
      terms: ['houston', 'sugar land', 'pasadena texas', 'the woodlands'],
    },
    {
      area: 'austin',
      terms: ['austin', 'round rock', 'cedar park'],
    },
    {
      area: 'atlanta',
      terms: ['atlanta', 'marietta', 'sandy springs', 'alpharetta', 'georgia'],
    },
    {
      area: 'boston',
      terms: ['boston', 'cambridge', 'somerville', 'massachusetts'],
    },
    {
      area: 'philadelphia',
      terms: ['philadelphia', 'philly', 'king of prussia', 'pennsylvania'],
    },
    {
      area: 'washingtondc',
      terms: [
        'washington',
        'district of columbia',
        'arlington',
        'alexandria',
        'bethesda',
      ],
    },
    {
      area: 'detroit',
      terms: ['detroit', 'ann arbor', 'dearborn', 'michigan'],
    },
    {
      area: 'minneapolis',
      terms: ['minneapolis', 'saint paul', 'st paul', 'minnesota'],
    },
    {
      area: 'milwaukee',
      terms: ['milwaukee', 'wisconsin'],
    },
    {
      area: 'madison',
      terms: ['madison', 'dane county'],
    },
    {
      area: 'indianapolis',
      terms: ['indianapolis', 'indiana'],
    },
  ];

  const matchedArea = craigslistAreaMatchers.find(({ terms }) =>
    terms.some((term) => lookupValues.includes(term)),
  );

  return matchedArea?.area || 'chicago';
}

function getEstateSalesNetAreaFromPlace(
  place?: Location.LocationGeocodedAddress | null,
) {
  const city = String(place?.city || '')
    .trim()
    .toLowerCase();
  const region = String(place?.region || '')
    .trim()
    .toLowerCase();
  const subregion = String(place?.subregion || '')
    .trim()
    .toLowerCase();

  const lookupValues = [city, subregion, region].filter(Boolean).join(' ');

  const estateSalesMatchers: Array<{
    path: string;
    terms: string[];
  }> = [
    {
      path: 'IL/Chicago',
      terms: [
        'chicago',
        'cook',
        'dupage',
        'naperville',
        'aurora',
        'joliet',
        'illinois',
      ],
    },
    {
      path: 'CA/Los-Angeles',
      terms: [
        'los angeles',
        'la county',
        'hollywood',
        'burbank',
        'glendale',
        'pasadena',
        'santa monica',
        'beverly hills',
      ],
    },
    {
      path: 'FL/Miami',
      terms: [
        'miami',
        'miami dade',
        'dade',
        'fort lauderdale',
        'broward',
        'west palm beach',
        'palm beach',
      ],
    },
    {
      path: 'NY/New-York',
      terms: [
        'new york',
        'manhattan',
        'brooklyn',
        'queens',
        'bronx',
        'staten island',
        'long island',
      ],
    },
    {
      path: 'CA/San-Francisco-Bay-Area',
      terms: [
        'san francisco',
        'oakland',
        'berkeley',
        'san jose',
        'palo alto',
        'bay area',
      ],
    },
    {
      path: 'CA/San-Diego',
      terms: ['san diego'],
    },
    {
      path: 'AZ/Phoenix',
      terms: ['phoenix', 'scottsdale', 'mesa', 'tempe', 'glendale arizona'],
    },
    {
      path: 'WA/Seattle',
      terms: ['seattle', 'bellevue', 'redmond', 'tacoma', 'everett'],
    },
    {
      path: 'OR/Portland',
      terms: ['portland', 'beaverton', 'gresham', 'hillsboro', 'oregon'],
    },
    {
      path: 'CO/Denver',
      terms: ['denver', 'aurora colorado', 'lakewood', 'boulder', 'colorado'],
    },
    {
      path: 'TX/Dallas',
      terms: ['dallas', 'fort worth', 'arlington', 'plano', 'frisco', 'dfw'],
    },
    {
      path: 'TX/Houston',
      terms: ['houston', 'sugar land', 'pasadena texas', 'the woodlands'],
    },
    {
      path: 'TX/Austin',
      terms: ['austin', 'round rock', 'cedar park'],
    },
    {
      path: 'GA/Atlanta',
      terms: ['atlanta', 'marietta', 'sandy springs', 'alpharetta', 'georgia'],
    },
    {
      path: 'MA/Boston',
      terms: ['boston', 'cambridge', 'somerville', 'massachusetts'],
    },
    {
      path: 'PA/Philadelphia',
      terms: ['philadelphia', 'philly', 'king of prussia', 'pennsylvania'],
    },
    {
      path: 'DC/Washington-DC',
      terms: [
        'washington',
        'district of columbia',
        'arlington',
        'alexandria',
        'bethesda',
      ],
    },
    {
      path: 'MI/Detroit',
      terms: ['detroit', 'ann arbor', 'dearborn', 'michigan'],
    },
    {
      path: 'MN/Minneapolis',
      terms: ['minneapolis', 'saint paul', 'st paul', 'minnesota'],
    },
    {
      path: 'WI/Milwaukee',
      terms: ['milwaukee', 'wisconsin'],
    },
    {
      path: 'WI/Madison',
      terms: ['madison', 'dane county'],
    },
    {
      path: 'IN/Indianapolis',
      terms: ['indianapolis', 'indiana'],
    },
  ];

  const matchedArea = estateSalesMatchers.find(({ terms }) =>
    terms.some((term) => lookupValues.includes(term)),
  );

  return matchedArea?.path || 'IL/Chicago';
}

async function openEstateSalesNetLink() {
  try {
    const permissionResult = await Location.requestForegroundPermissionsAsync();

    if (permissionResult.status !== 'granted') {
      await openExternalLink('https://www.estatesales.net/IL/Chicago');
      return;
    }

    const position = await Location.getCurrentPositionAsync({});
    const reverse = await Location.reverseGeocodeAsync({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    });
    const place = reverse?.[0];
    const estateSalesPath = getEstateSalesNetAreaFromPlace(place);
    const url = `https://www.estatesales.net/${estateSalesPath}`;

    await openExternalLink(url);
  } catch (error) {
    console.log('EstateSales.net link error:', error);
    await openExternalLink('https://www.estatesales.net/IL/Chicago');
  }
}

async function openCraigslistGarageSalesLink() {
  try {
    const permissionResult = await Location.requestForegroundPermissionsAsync();

    if (permissionResult.status !== 'granted') {
      await openExternalLink('https://chicago.craigslist.org/search/gms');
      return;
    }

    const position = await Location.getCurrentPositionAsync({});
    const reverse = await Location.reverseGeocodeAsync({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    });
    const place = reverse?.[0];
    const craigslistArea = getCraigslistAreaFromPlace(place);
    const url = `https://${craigslistArea}.craigslist.org/search/gms`;

    await openExternalLink(url);
  } catch (error) {
    console.log('Craigslist garage sale link error:', error);
    await openExternalLink('https://chicago.craigslist.org/search/gms');
  }
}

function getDealSearchTerms(params: {
  product: BarcodeProduct | null;
  packageFrontSearchText?: string;
  packageFrontDetectedText?: string;
}): string {
  const { product, packageFrontSearchText, packageFrontDetectedText } = params;
  const parts = [
    product?.title,
    product?.barcode,
    packageFrontSearchText,
    packageFrontDetectedText,
  ]
    .filter(Boolean)
    .map((value) => String(value).trim());

  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const part of parts) {
    const normalized = normalizeSearchText(part);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    cleaned.push(part);
  }

  return cleaned.slice(0, 3).join(' ').trim();
}

function buildEbayDealSearchUrl(query: string, barcode?: string) {
  const search = [query, barcode].filter(Boolean).join(' ').trim();
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(search)}`;
}

function buildEbaySoldSearchUrl(query: string, barcode?: string) {
  const search = [query, barcode].filter(Boolean).join(' ').trim();
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(search)}&LH_Sold=1&LH_Complete=1`;
}

function openResolvedEbaySearch(options: {
  sold?: boolean;
  query?: string | null;
  barcode?: string | null;
}) {
  const query = String(options.query || '').trim();
  const barcode = String(options.barcode || '').trim();

  if (!query && !barcode) {
    Alert.alert('eBay Search', 'No item search is ready yet.');
    return;
  }

  const url = options.sold
    ? buildEbaySoldSearchUrl(query, barcode)
    : buildEbayDealSearchUrl(query, barcode);

  openExternalLink(url);
}

type DealScore = {
  label: 'Buy' | 'Maybe' | 'Pass';
  score: number;
  reason: string;
};

function getDealScore(
  product: BarcodeProduct | null,
  searchTerms: string,
): DealScore {
  if (!product) {
    return {
      label: 'Pass',
      score: 25,
      reason: 'No solid product match yet, so sourcing results may be noisy.',
    };
  }

  let score = 35;
  const normalizedTitle = normalizeSearchText(product.title);
  const termTokens = tokenizeSearchText(searchTerms);

  if (product.barcode) score += 22;
  if (product.length > 0 && product.width > 0 && product.height > 0) score += 8;
  if (product.weightOz && product.weightOz > 0) score += 5;
  if (normalizedTitle && !normalizedTitle.startsWith('upc ')) score += 8;
  if (termTokens.length >= 4) score += 8;

  switch (product.confidence) {
    case 'high':
      score += 20;
      break;
    case 'medium':
      score += 12;
      break;
    case 'low':
      score += 4;
      break;
    default:
      score += 6;
      break;
  }

  score = Math.max(0, Math.min(98, score));

  if (score >= 75) {
    return {
      label: 'Buy',
      score,
      reason:
        'Strong match. Good odds the search results and sold comps will be useful fast.',
    };
  }

  if (score >= 55) {
    return {
      label: 'Maybe',
      score,
      reason:
        'Pretty workable, but check the title match and sold comps before trusting it.',
    };
  }

  return {
    label: 'Pass',
    score,
    reason:
      'Weak match. Results may drift, so tighten the product wording before sourcing hard.',
  };
}

function buildAmazonDealSearchUrl(query: string, barcode?: string) {
  const search = [query, barcode].filter(Boolean).join(' ').trim();
  return `https://www.amazon.com/s?k=${encodeURIComponent(search)}`;
}

function buildGoogleShoppingDealSearchUrl(query: string, barcode?: string) {
  const search = [query, barcode].filter(Boolean).join(' ').trim();
  return `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(search)}`;
}

function buildThriftStoreWebsiteSearchUrl(store: Partial<GarageSaleMapPin>) {
  const search = [
    store.title,
    store.mapAddress || store.addressLabel || store.displayAddress,
    'hours official website',
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/Tap for directions/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!search) return '';
  return `https://www.google.com/search?q=${encodeURIComponent(search)}`;
}

function buildWalmartDealSearchUrl(query: string, barcode?: string) {
  const search = [query, barcode].filter(Boolean).join(' ').trim();
  return `https://www.walmart.com/search?q=${encodeURIComponent(search)}`;
}

function stripHtmlTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x2F;/g, '/')
    .replace(/&#47;/g, '/');
}

type EbaySearchItem = {
  itemId: string;
  title: string;
  itemWebUrl: string;
  condition?: string;
  image?: { imageUrl: string };
  price?: { value: string; currency: string };
};

type EbaySearchResponse = {
  itemSummaries: EbaySearchItem[];
  exactItemSummaries?: EbaySearchItem[];
  similarItemSummaries?: EbaySearchItem[];
  exactQuery?: string;
  broaderQuery?: string;
};

function buildLiveEbayQuery(
  productTitle?: string | null,
  barcode?: string | null,
) {
  let query = String(productTitle || '');

  query = query.replace(/\b\d{10,14}\b/g, ' ');
  query = query.replace(/\([^)]*\)/g, ' ');
  query = query.replace(/men's large/gi, ' ');
  query = query.replace(/enhanced wellness/gi, ' ');
  query = query.replace(/neuro-point activation/gi, ' ');
  query = query.replace(/bliss soles/gi, 'bliss insoles');
  query = query.replace(/[-]/g, ' ');
  query = query.replace(/\s+/g, ' ').trim();

  if (/voxx ?bliss|voxxlife/i.test(query) && /insole|sole/i.test(query)) {
    return 'VOXXBLISS Insoles';
  }

  if (barcode) {
    query = query
      .replace(new RegExp(barcode.replace(/\D/g, ''), 'g'), ' ')
      .trim();
  }

  return query;
}

async function searchEbay(
  query: string,
  limit = 10,
): Promise<EbaySearchResponse> {
  const safeLimit = Math.max(1, Math.min(limit, 50));
  const cleanedQuery = buildLiveEbayQuery(query);
  const backendUrl = `${LIVE_EBAY_SEARCH_API_URL}?q=${encodeURIComponent(cleanedQuery)}&limit=${safeLimit}`;

  const backendResponse = await fetch(backendUrl, {
    headers: {
      Accept: 'application/json',
    },
  });

  let backendPayload: any = null;
  try {
    backendPayload = await backendResponse.json();
  } catch (error) {
    console.log('Backend eBay search did not return JSON.', error);
  }

  if (!backendResponse.ok) {
    const backendMessage =
      backendPayload?.message ||
      backendPayload?.error ||
      `Backend eBay search failed with status ${backendResponse.status}`;
    throw new Error(backendMessage);
  }

  const backendItems = Array.isArray(backendPayload?.itemSummaries)
    ? backendPayload.itemSummaries
    : [];

  return {
    itemSummaries: backendItems,
    exactItemSummaries: Array.isArray(backendPayload?.exactItemSummaries)
      ? backendPayload.exactItemSummaries
      : backendItems,
    similarItemSummaries: Array.isArray(backendPayload?.similarItemSummaries)
      ? backendPayload.similarItemSummaries
      : [],
    exactQuery: backendPayload?.exactQuery,
    broaderQuery: backendPayload?.broaderQuery,
  };
}

type EbaySearchSummary = {
  count: number;
  lowestPrice: number | null;
  averagePrice: number | null;
  highestPrice: number | null;
};

type LooseItemLookupApiResponse = {
  itemSummaries?: EbaySearchItem[];
  note?: string;
  error?: string;
  message?: string;
};

async function lookupLooseItemFromPhoto(
  uri: string,
  manualHint?: string,
): Promise<LooseItemLookupApiResponse> {
  const form = new FormData();
  form.append('file', {
    uri,
    name: 'loose-item.jpg',
    type: 'image/jpeg',
  } as any);

  const trimmedHint = (manualHint ?? '').trim();
  if (trimmedHint) {
    form.append('hint', trimmedHint);
  }

  const response = await fetch(LOOSE_ITEM_IMAGE_SEARCH_URL, {
    method: 'POST',
    body: form,
  });

  let payload: LooseItemLookupApiResponse = {};
  try {
    payload = (await response.json()) as LooseItemLookupApiResponse;
  } catch (error) {
    console.log('Loose item lookup response was not JSON', error);
  }

  if (!response.ok) {
    const detail =
      payload?.message || payload?.error || `status ${response.status}`;
    throw new Error(`Loose item image lookup failed: ${detail}`);
  }

  return payload;
}

function getEbayItemPriceValue(item: EbaySearchItem): number | null {
  const value = item?.price?.value;
  if (!value) return null;

  const parsed = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function buildEbaySearchSummary(items: EbaySearchItem[]): EbaySearchSummary {
  const prices = items
    .map((item) => getEbayItemPriceValue(item))
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);

  if (!prices.length) {
    return {
      count: items.length,
      lowestPrice: null,
      averagePrice: null,
      highestPrice: null,
    };
  }

  const total = prices.reduce((sum, value) => sum + value, 0);

  return {
    count: items.length,
    lowestPrice: round2(prices[0]),
    averagePrice: round2(total / prices.length),
    highestPrice: round2(prices[prices.length - 1]),
  };
}

function buildLooseItemMockMatches(photoHint?: string): EbaySearchItem[] {
  const normalizedHint = (photoHint ?? '').trim();
  const hintLabel = normalizedHint || 'Loose Item';
  const encodedHint = encodeURIComponent(hintLabel);

  return [
    {
      itemId: `mock-${encodedHint}-1`,
      title: `${hintLabel} - likely eBay match`,
      itemWebUrl: buildEbayDealSearchUrl(hintLabel),
      condition: 'Pre-owned',
      price: { value: '24.99', currency: 'USD' },
    },
    {
      itemId: `mock-${encodedHint}-2`,
      title: `Vintage ${hintLabel}`,
      itemWebUrl: buildEbayDealSearchUrl(`vintage ${hintLabel}`),
      condition: 'Used',
      price: { value: '19.95', currency: 'USD' },
    },
    {
      itemId: `mock-${encodedHint}-3`,
      title: `${hintLabel} collectible decor piece`,
      itemWebUrl: buildEbayDealSearchUrl(`${hintLabel} collectible`),
      condition: 'Used',
      price: { value: '29.50', currency: 'USD' },
    },
    {
      itemId: `mock-${encodedHint}-4`,
      title: `${hintLabel} replacement part / accessory`,
      itemWebUrl: buildEbayDealSearchUrl(`${hintLabel} accessory`),
      condition: 'Open box',
      price: { value: '14.99', currency: 'USD' },
    },
  ];
}

const RAW_BOXES_US: Omit<Box, 'amazonSearchUrl'>[] = [
  { id: 'us_1', name: '4x4x4', length: 4, width: 4, height: 4 },
  { id: 'us_2', name: '6x4x4', length: 6, width: 4, height: 4 },
  { id: 'us_3', name: '6x6x6', length: 6, width: 6, height: 6 },
  { id: 'us_4', name: '8x6x4', length: 8, width: 6, height: 4 },
  { id: 'us_5', name: '8x8x8', length: 8, width: 8, height: 8 },
  { id: 'us_6', name: '9x9x5', length: 9, width: 9, height: 5 },

  { id: 'us_7', name: '10x8x6', length: 10, width: 8, height: 6 },
  { id: 'us_8', name: '12x9x6', length: 12, width: 9, height: 6 },
  { id: 'us_9', name: '12x12x6', length: 12, width: 12, height: 6 },
  { id: 'us_10', name: '12x12x12', length: 12, width: 12, height: 12 },
  { id: 'us_11', name: '13x9x9', length: 13, width: 9, height: 9 },
  { id: 'us_12', name: '14x10x10', length: 14, width: 10, height: 10 },
  { id: 'us_13', name: '14x12x12', length: 14, width: 12, height: 12 },
  { id: 'us_14', name: '16x12x8', length: 16, width: 12, height: 8 },
  { id: 'us_15', name: '16x14x12', length: 16, width: 14, height: 12 },

  { id: 'us_16', name: '18x12x12', length: 18, width: 12, height: 12 },
  { id: 'us_17', name: '18x14x10', length: 18, width: 14, height: 10 },
  { id: 'us_18', name: '18x18x12', length: 18, width: 18, height: 12 },
  { id: 'us_19', name: '20x16x12', length: 20, width: 16, height: 12 },
  { id: 'us_20', name: '20x20x12', length: 20, width: 20, height: 12 },

  { id: 'us_21', name: '22x18x12', length: 22, width: 18, height: 12 },
  { id: 'us_22', name: '24x18x12', length: 24, width: 18, height: 12 },
  { id: 'us_23', name: '24x20x12', length: 24, width: 20, height: 12 },
  { id: 'us_24', name: '24x24x24', length: 24, width: 24, height: 24 },

  { id: 'us_25', name: '12x12x4', length: 12, width: 12, height: 4 },
  { id: 'us_26', name: '16x12x4', length: 16, width: 12, height: 4 },
  { id: 'us_27', name: '18x12x6', length: 18, width: 12, height: 6 },
  { id: 'us_28', name: '24x12x5', length: 24, width: 12, height: 5 },

  { id: 'us_29', name: '10x10x10', length: 10, width: 10, height: 10 },
  { id: 'us_30', name: '12x10x8', length: 12, width: 10, height: 8 },
  { id: 'us_31', name: '14x12x10', length: 14, width: 12, height: 10 },
  { id: 'us_32', name: '16x12x10', length: 16, width: 12, height: 10 },
  { id: 'us_33', name: '18x12x10', length: 18, width: 12, height: 10 },
  { id: 'us_34', name: '20x14x12', length: 20, width: 14, height: 12 },
  { id: 'us_35', name: '22x14x12', length: 22, width: 14, height: 12 },
  { id: 'us_36', name: '24x16x14', length: 24, width: 16, height: 14 },

  { id: 'us_37', name: '24x12x12', length: 24, width: 12, height: 12 },
  { id: 'us_38', name: '30x8x8', length: 30, width: 8, height: 8 },
  { id: 'us_39', name: '30x12x12', length: 30, width: 12, height: 12 },
  { id: 'us_40', name: '36x12x12', length: 36, width: 12, height: 12 },

  { id: 'us_41', name: '12x12x18', length: 12, width: 12, height: 18 },
  { id: 'us_42', name: '14x14x20', length: 14, width: 14, height: 20 },
  { id: 'us_43', name: '16x16x24', length: 16, width: 16, height: 24 },

  { id: 'us_44', name: '28x20x6', length: 28, width: 20, height: 6 },
  { id: 'us_45', name: '28x20x12', length: 28, width: 20, height: 12 },
  { id: 'us_46', name: '28x20x20', length: 28, width: 20, height: 20 },
  { id: 'us_47', name: '30x20x8', length: 30, width: 20, height: 8 },
  { id: 'us_48', name: '30x18x18', length: 30, width: 18, height: 18 },
];

const RAW_BOXES_METRIC: Omit<Box, 'amazonSearchUrl'>[] = [
  { id: 'cm_1', name: '20 × 15 × 10 cm', length: 20, width: 15, height: 10 },
  { id: 'cm_2', name: '20 × 15 × 15 cm', length: 20, width: 15, height: 15 },
  { id: 'cm_3', name: '25 × 15 × 10 cm', length: 25, width: 15, height: 10 },
  { id: 'cm_4', name: '30 × 20 × 10 cm', length: 30, width: 20, height: 10 },
  { id: 'cm_5', name: '30 × 20 × 15 cm', length: 30, width: 20, height: 15 },
  { id: 'cm_6', name: '35 × 25 × 15 cm', length: 35, width: 25, height: 15 },
  { id: 'cm_7', name: '35 × 35 × 25 cm', length: 35, width: 35, height: 25 },
  { id: 'cm_8', name: '40 × 30 × 20 cm', length: 40, width: 30, height: 20 },
  { id: 'cm_9', name: '40 × 30 × 30 cm', length: 40, width: 30, height: 30 },
  {
    id: 'cm_10',
    name: '47 × 31.5 × 25 cm',
    length: 47,
    width: 31.5,
    height: 25,
  },
  { id: 'cm_11', name: '50 × 30 × 30 cm', length: 50, width: 30, height: 30 },
  { id: 'cm_12', name: '55 × 35 × 30 cm', length: 55, width: 35, height: 30 },
  { id: 'cm_13', name: '60 × 40 × 30 cm', length: 60, width: 40, height: 30 },
  { id: 'cm_14', name: '60 × 40 × 40 cm', length: 60, width: 40, height: 40 },
];

const BOXES_US: Box[] = RAW_BOXES_US.map((box) => ({
  ...box,
  amazonSearchUrl: buildAmazonSearchUrl(
    box.length,
    box.width,
    box.height,
    'us',
    AMAZON_AFFILIATE_TAG,
  ),
}));

const BOXES_METRIC: Box[] = RAW_BOXES_METRIC.map((box) => ({
  ...box,
  amazonSearchUrl: buildAmazonSearchUrl(
    box.length,
    box.width,
    box.height,
    'metric',
  ),
}));

const MOCK_BARCODE_PRODUCTS: BarcodeProduct[] = [
  {
    barcode: '610731283698',
    title: "VOXXBLISS Enhanced Wellness Insoles - Men's Large (7-13)",
    length: 14,
    width: 5,
    height: 2,
    weightOz: 12,
    source: 'Mock barcode catalog',
  },
  {
    barcode: '012345678905',
    title: 'Pocket notebook gift set',
    length: 8,
    width: 5.5,
    height: 0.75,
    weightOz: 7,
    source: 'Mock barcode catalog',
  },
  {
    barcode: '036000291452',
    title: 'Wireless earbuds retail box',
    length: 4.5,
    width: 3.5,
    height: 1.5,
    weightOz: 4,
    source: 'Mock barcode catalog',
  },
  {
    barcode: '768533123787',
    title: 'Verilux HappyLight Compact Energy Lamp',
    length: 9.5,
    width: 7,
    height: 4,
    weightOz: 24,
    source: 'Mock barcode catalog',
  },
  {
    barcode: '999000000001',
    title: 'Pledge Everyday Clean Multisurface Cleaner Rainshower 14.2 oz',
    length: 11,
    width: 2.6,
    height: 2.6,
    weightOz: 22,
    source: 'Starter package catalog',
  },
];

function normalizeBarcode(value: string) {
  return value.replace(/\D/g, '');
}

function normalizeSearchText(value?: string | null): string {
  if (!value) return '';

  return value
    .toLowerCase()
    .replace(/[&]/g, ' and ')
    .replace(/[+]/g, ' plus ')
    .replace(/[\/|_]+/g, ' ')
    .replace(/[-]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeSearchText(value?: string | null): string[] {
  return normalizeSearchText(value).split(' ').filter(Boolean);
}

const LISTING_JUNK_WORDS = new Set([
  'free',
  'vec',
  'smart',
  'matching',
  'package',
  'details',
  'detail',
  'scan',
  'scanning',
  'scanned',
  'memory',
  'local',
  'catalog',
  'helper',
  'draft',
  'pre',
  'filled',
]);

function normalizeDisplaySpaces(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function cleanListingText(value?: string | null) {
  return normalizeDisplaySpaces(
    String(value || '')
      .replace(/[|/_]+/g, ' ')
      .replace(/[\[\](){}]+/g, ' ')
      .replace(/verilux/gi, 'Verilux')
      .replace(/happylight/gi, 'HappyLight')
      .replace(/uv free/gi, 'UV-Free')
      .replace(/10 000/g, '10,000')
      .replace(/[^\w\s,+.-]/g, ' '),
  );
}

function dedupeWordsKeepOrder(words: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  words.forEach((word) => {
    const cleaned = normalizeDisplaySpaces(word);
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) return;
    seen.add(key);
    result.push(cleaned);
  });

  return result;
}

function inferListingCategory(productTitle: string) {
  const value = normalizeSearchText(productTitle);

  if (
    /(shirt|jacket|jeans|pants|hoodie|dress|shoe|sneaker|boot|hat|cap)/.test(
      value,
    )
  ) {
    return 'clothing';
  }

  if (
    /(lamp|radio|speaker|camera|remote|keyboard|mouse|phone|light|dvd|vcr|tv|monitor|player)/.test(
      value,
    )
  ) {
    return 'electronics';
  }

  if (
    /(toy|lego|figure|doll|plush|game|puzzle|train|hot wheels|car)/.test(value)
  ) {
    return 'toys';
  }

  return 'general';
}

function extractBrandFromTitle(productTitle: string) {
  const cleaned = cleanListingText(productTitle);
  const tokens = cleaned.split(' ').filter(Boolean);
  if (!tokens.length) return '';

  const knownBrands = [
    'Verilux',
    'Sony',
    'Panasonic',
    'Samsung',
    'Apple',
    'Nintendo',
    'LEGO',
  ];

  const foundBrand = knownBrands.find((brand) =>
    tokens.some((token) => token.toLowerCase() === brand.toLowerCase()),
  );

  return foundBrand || tokens[0];
}

function enforceTitleLength(title: string, max = 80) {
  const normalized = normalizeDisplaySpaces(title);
  if (normalized.length <= max) return normalized;

  const trimmed = normalized.slice(0, max);
  const lastSpace = trimmed.lastIndexOf(' ');
  return normalizeDisplaySpaces(
    lastSpace > 40 ? trimmed.slice(0, lastSpace) : trimmed,
  );
}

function buildSEOKeywordParts(product: BarcodeProduct | null) {
  const rawTitle = cleanListingText(product?.title || '');
  const category = inferListingCategory(rawTitle);
  const brand = extractBrandFromTitle(rawTitle);

  const partsByCategory: Record<string, string[]> = {
    electronics: [
      brand,
      'HappyLight',
      'Compact',
      'Lamp',
      '10,000 Lux',
      'UV-Free',
      'Light Therapy',
    ],
    clothing: [brand, 'Size', 'Color', 'Style', 'Used'],
    toys: [brand, 'Toy', 'Collectible', 'Vintage'],
    general: [brand],
  };

  const base = partsByCategory[category] || partsByCategory.general;
  const titleWords = rawTitle
    .split(' ')
    .filter(Boolean)
    .filter((word) => !LISTING_JUNK_WORDS.has(word.toLowerCase()));

  return dedupeWordsKeepOrder([...base, ...titleWords]);
}

function buildBestListingTitle(
  product: BarcodeProduct | null,
  condition: ListingCondition,
) {
  if (!product) return '';

  const category = inferListingCategory(product.title || '');
  const seoParts = buildSEOKeywordParts(product);
  let title = '';

  if (category === 'electronics') {
    const preferred = seoParts.filter((part) =>
      [
        'Verilux',
        'HappyLight',
        'Compact',
        'Lamp',
        '10,000 Lux',
        'UV-Free',
        'Light Therapy',
      ].includes(part),
    );
    title = preferred.join(' ');
  } else if (category === 'clothing') {
    title = seoParts.slice(0, 8).join(' ');
  } else if (category === 'toys') {
    title = seoParts.slice(0, 8).join(' ');
  } else {
    title = seoParts.slice(0, 10).join(' ');
  }

  title = title
    .replace(/Verilux Verilux/g, 'Verilux')
    .replace(/Compact Compact/g, 'Compact');

  if (condition === 'For Parts' && !/parts|repair/i.test(title)) {
    title += ' Parts Repair';
  } else if (condition === 'Open Box' && !/open box/i.test(title)) {
    title += ' Open Box';
  }

  return enforceTitleLength(title, 80);
}

function buildBestListingDescription(
  product: BarcodeProduct | null,
  condition: ListingCondition,
) {
  if (!product) return '';

  const cleanTitle =
    buildBestListingTitle(product, condition) ||
    cleanListingText(product.title || 'Item');
  const category = inferListingCategory(product.title || '');

  const lines = [
    `${cleanTitle} in ${String(condition).toLowerCase()} condition.`.replace(
      'for parts condition',
      'for parts or repair condition.',
    ),
  ];

  if (category === 'electronics') {
    if (/happylight|light therapy|lamp/i.test(product.title || '')) {
      lines.push(
        '',
        '- Provides up to 10,000 lux of UV-free light',
        '- Compact design, ideal for desk or tabletop use',
        '- Good choice for focus, energy, and seasonal light therapy',
      );
    } else {
      lines.push(
        '',
        '- Tested for basic function when possible',
        '- Normal cosmetic wear from prior use',
        '- Please review photos for exact condition and included items',
      );
    }
  } else if (category === 'clothing') {
    lines.push(
      '',
      '- Please review photos for size, color, and overall condition',
      '- Normal wear may be present from prior use',
      '- See pictures for exact item details',
    );
  } else if (category === 'toys') {
    lines.push(
      '',
      '- Shows normal wear from prior use or storage',
      '- Great for display, collecting, or play',
      '- Review photos for exact condition and completeness',
    );
  } else {
    lines.push(
      '',
      '- Please review photos for exact condition and included contents',
      '- Normal signs of prior use may be present',
    );
  }

  lines.push(
    '',
    `Condition: ${condition}`,
    'Includes: Item shown in photos',
    '',
    'Please review all photos for exact condition before purchase.',
  );

  return lines.join('\n');
}

type SuggestedPriceRange = {
  low: number | null;
  high: number | null;
  target: number | null;
  label: string;
  helperText: string;
  source: 'market' | 'category' | 'none';
};

function roundPriceTo99(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;

  const rounded = Math.max(0.99, Math.round(value) - 0.01);
  return round2(rounded);
}

function formatPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '';
  return `$${value.toFixed(2)}`;
}

function getMedianPrice(values: number[]): number | null {
  const prices = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  if (!prices.length) return null;

  const middle = Math.floor(prices.length / 2);
  if (prices.length % 2) return prices[middle];

  return (prices[middle - 1] + prices[middle]) / 2;
}

function getSuggestedPriceRange(
  product: BarcodeProduct | null,
  condition: ListingCondition = 'Used',
  marketItems: EbaySearchItem[] = [],
): SuggestedPriceRange {
  const marketPrices = marketItems
    .map((item) => getEbayItemPriceValue(item))
    .filter((value): value is number => value !== null)
    .filter((value) => value >= 3 && value <= 500)
    .sort((a, b) => a - b);

  if (marketPrices.length >= 3) {
    const trimmedPrices =
      marketPrices.length >= 6
        ? marketPrices.slice(1, marketPrices.length - 1)
        : marketPrices;
    const median = getMedianPrice(trimmedPrices) ?? marketPrices[0];
    const target = roundPriceTo99(median);
    const low = roundPriceTo99(median * 0.85);
    const high = roundPriceTo99(median * 1.12);

    return {
      low,
      high,
      target,
      label: `Median comp price: ${formatPrice(target)}\nRange: ${formatPrice(low)}-${formatPrice(high)}`,
      helperText:
        'Price data only. Check Sold listings to confirm before listing.',
      source: 'market',
    };
  }

  if (!product) {
    return {
      low: null,
      high: null,
      target: null,
      label: 'Price data not ready yet.',
      helperText:
        'Scan an item, then review market comps before choosing your list price. Check sold listings to confirm before listing.',
      source: 'none',
    };
  }

  const title = normalizeSearchText(product.title || '');
  let low = 14.99;
  let high = 29.99;
  let reason = 'Fallback range based on a broad general-item category.';

  if (/tape dispenser|packaging tape|shipping tape|scotch/.test(title)) {
    low = 6.99;
    high = 14.99;
    reason = 'Small packaging supplies usually need a tighter starter range.';
  } else if (/cleaner|spray|aerosol|pledge|household/.test(title)) {
    low = 5.99;
    high = 12.99;
    reason = 'Household consumables usually sell in a lower starter range.';
  } else if (/happylight|verilux|therapy light/.test(title)) {
    low = 24.99;
    high = 39.99;
    reason = 'Light-therapy lamps commonly support a stronger used-item range.';
  } else if (
    /wireless|earbuds|speaker|camera|lamp|radio|dvd|vcr|player/.test(title)
  ) {
    low = 19.99;
    high = 49.99;
    reason =
      'Electronics vary widely, so this stays intentionally conservative.';
  } else if (/lego|toy|figure|doll|game|puzzle|hot wheels/.test(title)) {
    low = 14.99;
    high = 34.99;
    reason =
      'Toy and collectible value depends heavily on condition and completeness.';
  } else if (
    /shirt|jacket|jeans|pants|hoodie|dress|shoe|sneaker|boot|hat|cap/.test(
      title,
    )
  ) {
    low = 9.99;
    high = 24.99;
    reason =
      'Clothing needs a practical starter range unless the brand is premium.';
  }

  if (condition === 'New') {
    low *= 1.2;
    high *= 1.35;
  } else if (condition === 'Open Box') {
    low *= 1.1;
    high *= 1.2;
  } else if (condition === 'For Parts') {
    low *= 0.35;
    high *= 0.55;
  }

  low = roundPriceTo99(low);
  high = Math.max(low, roundPriceTo99(high));
  const target = roundPriceTo99((low + high) / 2);

  return {
    low,
    high,
    target,
    label: `Category estimate: ${formatPrice(target)}\nRange: ${formatPrice(low)}-${formatPrice(high)}`,
    helperText: `${reason} Check sold listings to confirm before listing.`,
    source: 'category',
  };
}

function titleAlreadyContains(baseTitle: string, candidate: string): boolean {
  const normalizedBase = normalizeSearchText(baseTitle);
  const normalizedCandidate = normalizeSearchText(candidate);

  if (!normalizedBase || !normalizedCandidate) return false;
  if (normalizedBase === normalizedCandidate) return true;
  if (normalizedBase.includes(normalizedCandidate)) return true;

  const baseTokens = new Set(tokenizeSearchText(baseTitle));
  const candidateTokens = tokenizeSearchText(candidate).filter(Boolean);

  if (!candidateTokens.length) return false;

  return candidateTokens.every((token) => baseTokens.has(token));
}

function extractBarcodeFromText(value?: string | null): string | null {
  const normalized = normalizeBarcode(value ?? '');
  if (!normalized) return null;

  const candidates = [...(normalized.match(/\d{12,14}/g) ?? [])];

  if (!candidates.length) {
    return null;
  }

  const preferred =
    candidates.find((candidate) => candidate.length === 12) ?? candidates[0];
  return preferred ?? null;
}

function findBarcodeProduct(barcode: string): BarcodeProduct | null {
  const normalized = normalizeBarcode(barcode);
  return (
    MOCK_BARCODE_PRODUCTS.find(
      (product) => normalizeBarcode(product.barcode) === normalized,
    ) ?? null
  );
}

const BARCODE_CACHE_STORAGE_KEY = 'listassist_barcode_cache_v1';
const PACKAGE_FRONT_MEMORY_STORAGE_KEY = 'listassist_package_front_memory_v1';

type BarcodeCacheMap = Record<string, BarcodeProduct>;

type PackageFrontMemoryEntry = {
  barcode: string;
  product: BarcodeProduct;
  sampleTexts: string[];
  updatedAt: number;
};

async function getBarcodeCacheMap(): Promise<BarcodeCacheMap> {
  try {
    const raw = await AsyncStorage.getItem(BARCODE_CACHE_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.log('Failed to read barcode cache', error);
    return {};
  }
}

async function getCachedBarcodeProduct(
  barcode: string,
): Promise<BarcodeProduct | null> {
  try {
    const normalized = normalizeBarcode(barcode);
    if (!normalized) return null;

    const cache = await getBarcodeCacheMap();
    return cache[normalized] ?? null;
  } catch (error) {
    console.log('Failed to get cached barcode product', error);
    return null;
  }
}

async function cacheBarcodeProduct(product: BarcodeProduct): Promise<void> {
  try {
    const normalized = normalizeBarcode(product.barcode);
    if (!normalized) return;

    const cache = await getBarcodeCacheMap();
    cache[normalized] = {
      ...product,
      barcode: normalized,
    };

    await AsyncStorage.setItem(
      BARCODE_CACHE_STORAGE_KEY,
      JSON.stringify(cache),
    );
  } catch (error) {
    console.log('Failed to cache barcode product', error);
  }
}

async function getPackageFrontMemoryEntries(): Promise<
  PackageFrontMemoryEntry[]
> {
  try {
    const raw = await AsyncStorage.getItem(PACKAGE_FRONT_MEMORY_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.log('Failed to read package front memory', error);
    return [];
  }
}

function buildPackageFrontLearningTexts(
  values: Array<string | null | undefined>,
): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  values.forEach((value) => {
    const trimmed = (value ?? '').trim();
    if (!trimmed) return;

    const normalized = normalizeSearchText(trimmed);
    if (!normalized || normalized.length < 4) return;

    if (!seen.has(normalized)) {
      seen.add(normalized);
      results.push(trimmed);
    }
  });

  return results.slice(0, 8);
}

async function savePackageFrontMemoryEntry(
  product: BarcodeProduct,
  texts: Array<string | null | undefined>,
): Promise<void> {
  try {
    const normalizedBarcode = normalizeBarcode(product.barcode);
    if (!normalizedBarcode) return;

    const sampleTexts = buildPackageFrontLearningTexts([
      product.title,
      ...texts,
    ]);
    if (!sampleTexts.length) return;

    const entries = await getPackageFrontMemoryEntries();
    const existingIndex = entries.findIndex(
      (entry) => normalizeBarcode(entry.barcode) === normalizedBarcode,
    );

    const existing = existingIndex >= 0 ? entries[existingIndex] : null;
    const mergedTexts = buildPackageFrontLearningTexts([
      ...(existing?.sampleTexts ?? []),
      ...sampleTexts,
    ]);

    const nextEntry: PackageFrontMemoryEntry = {
      barcode: normalizedBarcode,
      product: {
        ...(existing?.product ?? product),
        ...product,
        barcode: normalizedBarcode,
        source: product.source,
      },
      sampleTexts: mergedTexts,
      updatedAt: Date.now(),
    };

    if (existingIndex >= 0) {
      entries[existingIndex] = nextEntry;
    } else {
      entries.unshift(nextEntry);
    }

    await AsyncStorage.setItem(
      PACKAGE_FRONT_MEMORY_STORAGE_KEY,
      JSON.stringify(entries.slice(0, 150)),
    );
  } catch (error) {
    console.log('Failed to save package front memory', error);
  }
}

const MOCK_PACKAGE_KEYWORDS: Record<string, string[]> = {
  '610731283698': [
    'voxx',
    'voxxlife',
    'voxx life',
    'voxxbliss',
    'voxx bliss',
    'insole',
    'insoles',
    'wellness',
    'enhanced',
    'orthotic',
    'shoe',
    'foot',
    'feet',
    'comfort',
    'mens',
    'men s',
    'large',
  ],
  '012345678905': [
    'notebook',
    'gift',
    'journal',
    'pocket',
    'memo',
    'notes',
    'paper',
    'set',
  ],
  '036000291452': [
    'wireless',
    'earbuds',
    'earbud',
    'ear buds',
    'bluetooth',
    'charging',
    'case',
    'retail',
    'box',
  ],
  '768533123787': [
    'verilux',
    'veri lux',
    'happylight',
    'happy light',
    'compact',
    'energy',
    'lamp',
    'light',
    'therapy',
    'uv',
    'lux',
    '10000',
    '10 000',
  ],
  '999000000001': [
    'pledge',
    'everyday',
    'everyday clean',
    'multisurface',
    'multi surface',
    'cleaner',
    'ph balanced',
    'rainshower',
    'sc johnson',
    'aerosol',
    'spray',
  ],
};

const PACKAGE_FRONT_TEXT_ALIASES: Record<string, string[]> = {
  happylignt: ['happylight'],
  happyiight: ['happylight'],
  happylite: ['happylight'],
  veriiux: ['verilux'],
  veriux: ['verilux'],
  voxxbiiss: ['voxxbliss'],
  voxxlife: ['voxxbliss', 'voxx life'],
  muitisurface: ['multisurface'],
  muiti: ['multi'],
  rainshower: ['rain shower'],
  insoies: ['insoles'],
  insoie: ['insole'],
  'ear buds': ['earbuds'],
};

const PACKAGE_FRONT_STOP_WORDS = new Set([
  'the',
  'and',
  'with',
  'for',
  'from',
  'your',
  'this',
  'that',
  'box',
  'retail',
  'pack',
  'package',
  'new',
  'item',
  'brand',
  'model',
  'set',
  'size',
  'large',
  'small',
  'medium',
  'mens',
  'womens',
  'men',
  'women',
]);

function singularizeToken(token: string): string {
  if (token.endsWith('ies') && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }

  if (token.endsWith('ses') && token.length > 4) {
    return token.slice(0, -2);
  }

  if (token.endsWith('s') && !token.endsWith('ss') && token.length > 3) {
    return token.slice(0, -1);
  }

  return token;
}

function compactSearchText(value?: string | null): string {
  return normalizeSearchText(value).replace(/\s+/g, '');
}

function getMeaningfulTokens(value?: string | null): string[] {
  return tokenizeSearchText(value)
    .map((token) => singularizeToken(token))
    .filter((token) => token.length >= 2)
    .filter((token) => !PACKAGE_FRONT_STOP_WORDS.has(token));
}

function getAdjacentPhrases(tokens: string[]): string[] {
  const phrases: string[] = [];

  for (let i = 0; i < tokens.length - 1; i += 1) {
    phrases.push(`${tokens[i]} ${tokens[i + 1]}`);
  }

  for (let i = 0; i < tokens.length - 2; i += 1) {
    phrases.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  }

  return phrases;
}

function getCharacterBigrams(value: string): Set<string> {
  const compact = compactSearchText(value);
  const result = new Set<string>();

  for (let i = 0; i < compact.length - 1; i += 1) {
    result.add(compact.slice(i, i + 2));
  }

  return result;
}

function getDiceCoefficient(a: string, b: string): number {
  const aa = compactSearchText(a);
  const bb = compactSearchText(b);
  if (!aa || !bb) return 0;
  if (aa === bb) return 1;
  if (aa.length < 2 || bb.length < 2) return aa === bb ? 1 : 0;

  const bigramsA = getCharacterBigrams(aa);
  const bigramsB = getCharacterBigrams(bb);
  let overlap = 0;

  bigramsA.forEach((pair) => {
    if (bigramsB.has(pair)) overlap += 1;
  });

  return (2 * overlap) / (bigramsA.size + bigramsB.size || 1);
}

function scoreLocalPackageMemoryText(
  inputValue: string,
  memoryValue: string,
): number {
  const normalizedInput = normalizeSearchText(inputValue);
  const normalizedMemory = normalizeSearchText(memoryValue);
  if (!normalizedInput || !normalizedMemory) return 0;

  const compactInput = compactSearchText(normalizedInput);
  const compactMemory = compactSearchText(normalizedMemory);
  const inputTokens = new Set(getMeaningfulTokens(inputValue));
  const memoryTokens = new Set(getMeaningfulTokens(memoryValue));

  let score = 0;

  if (normalizedInput === normalizedMemory) score += 90;
  if (compactInput && compactMemory && compactInput === compactMemory)
    score += 90;

  if (compactInput && compactMemory) {
    if (
      compactInput.includes(compactMemory) ||
      compactMemory.includes(compactInput)
    ) {
      score += 45;
    }
  }

  let tokenOverlap = 0;
  inputTokens.forEach((token) => {
    if (memoryTokens.has(token)) tokenOverlap += 1;
  });

  if (tokenOverlap > 0) {
    score += tokenOverlap * 14;
  }

  const dice = getDiceCoefficient(normalizedInput, normalizedMemory);
  if (dice >= 0.94) score += 40;
  else if (dice >= 0.88) score += 28;
  else if (dice >= 0.8) score += 18;
  else if (dice >= 0.72) score += 10;

  return score;
}

async function findLearnedPackageFrontProduct(
  candidateTexts: string[],
): Promise<BarcodeProduct | null> {
  const entries = await getPackageFrontMemoryEntries();
  if (!entries.length || !candidateTexts.length) return null;

  let bestMatch: { entry: PackageFrontMemoryEntry; score: number } | null =
    null;

  entries.forEach((entry) => {
    let entryBestScore = 0;

    candidateTexts.forEach((candidateText) => {
      entryBestScore = Math.max(
        entryBestScore,
        scoreLocalPackageMemoryText(candidateText, entry.product.title),
      );

      entry.sampleTexts.forEach((sampleText) => {
        entryBestScore = Math.max(
          entryBestScore,
          scoreLocalPackageMemoryText(candidateText, sampleText),
        );
      });
    });

    if (!bestMatch || entryBestScore > bestMatch.score) {
      bestMatch = { entry, score: entryBestScore };
    }
  });

  if (!bestMatch || bestMatch.score < 42) {
    return null;
  }

  return {
    ...bestMatch.entry.product,
    barcode: normalizeBarcode(bestMatch.entry.barcode),
    source: 'Local package memory',
    confidence: bestMatch.score >= 70 ? 'high' : 'medium',
  };
}

type PackageSearchProfile = {
  tokens: Set<string>;
  phrases: Set<string>;
  compactTerms: Set<string>;
  titleCompact: string;
};

function buildProductSearchProfile(
  product: BarcodeProduct,
): PackageSearchProfile {
  const titleTokens = getMeaningfulTokens(product.title);
  const keywordTokens = (MOCK_PACKAGE_KEYWORDS[product.barcode] ?? []).flatMap(
    (keyword) => getMeaningfulTokens(keyword),
  );
  const allTokens = Array.from(new Set([...titleTokens, ...keywordTokens]));
  const phrases = new Set<string>(
    [
      ...getAdjacentPhrases(titleTokens),
      ...getAdjacentPhrases(keywordTokens),
      normalizeSearchText(product.title),
      ...(MOCK_PACKAGE_KEYWORDS[product.barcode] ?? []).map((keyword) =>
        normalizeSearchText(keyword),
      ),
    ].filter(Boolean),
  );

  const compactTerms = new Set<string>(
    [
      compactSearchText(product.title),
      ...Array.from(phrases).map((phrase) => compactSearchText(phrase)),
      ...allTokens.map((token) => compactSearchText(token)),
    ].filter(Boolean),
  );

  return {
    tokens: new Set(allTokens),
    phrases,
    compactTerms,
    titleCompact: compactSearchText(product.title),
  };
}

function expandPackageTokens(value: string): Set<string> {
  const baseTokens = tokenizeSearchText(value);
  const meaningfulTokens = getMeaningfulTokens(value);
  const expanded = new Set<string>([...baseTokens, ...meaningfulTokens]);
  const normalized = normalizeSearchText(value);
  const compact = compactSearchText(value);

  baseTokens.forEach((token) => {
    const aliases = PACKAGE_FRONT_TEXT_ALIASES[token] ?? [];
    aliases.forEach((alias) => {
      expanded.add(alias);
      expanded.add(singularizeToken(alias));
      tokenizeSearchText(alias).forEach((part) => expanded.add(part));
    });

    const singular = singularizeToken(token);
    expanded.add(singular);
    if (singular.length >= 3) {
      expanded.add(`${singular}s`);
    }
  });

  Object.entries(PACKAGE_FRONT_TEXT_ALIASES).forEach(([badToken, aliases]) => {
    if (
      normalized.includes(badToken) ||
      compact.includes(compactSearchText(badToken))
    ) {
      aliases.forEach((alias) => {
        expanded.add(alias);
        expanded.add(singularizeToken(alias));
        tokenizeSearchText(alias).forEach((part) => expanded.add(part));
      });
    }
  });

  getAdjacentPhrases(baseTokens).forEach((phrase) => {
    expanded.add(phrase);
    expanded.add(compactSearchText(phrase));
  });

  return expanded;
}

function scorePackageTextAgainstProduct(
  value: string,
  product: BarcodeProduct,
): number {
  const normalizedValue = normalizeSearchText(value);
  if (!normalizedValue) return 0;

  const compactValue = compactSearchText(normalizedValue);
  const tokens = expandPackageTokens(value);
  const meaningfulTokens = new Set(getMeaningfulTokens(value));
  const inputPhrases = new Set(
    getAdjacentPhrases(Array.from(meaningfulTokens)),
  );
  const profile = buildProductSearchProfile(product);

  let score = 0;

  profile.tokens.forEach((token) => {
    if (tokens.has(token) || meaningfulTokens.has(token)) {
      score += token.length >= 5 ? 4 : 2;
      return;
    }

    for (const inputToken of meaningfulTokens) {
      if (inputToken.length >= 4 && token.length >= 4) {
        const dice = getDiceCoefficient(inputToken, token);
        if (dice >= 0.84) {
          score += 2;
          break;
        }
      }
    }
  });

  profile.phrases.forEach((phrase) => {
    if (!phrase) return;

    if (normalizedValue.includes(phrase)) {
      score += phrase.includes(' ') ? 8 : 3;
      return;
    }

    const compactPhrase = compactSearchText(phrase);
    if (compactPhrase && compactValue.includes(compactPhrase)) {
      score += compactPhrase.length >= 8 ? 7 : 2;
      return;
    }

    if (inputPhrases.has(phrase)) {
      score += 6;
    }
  });

  profile.compactTerms.forEach((compactTerm) => {
    if (!compactTerm) return;
    if (compactValue.includes(compactTerm)) {
      score += compactTerm.length >= 8 ? 5 : 2;
    } else {
      const dice = getDiceCoefficient(compactValue, compactTerm);
      if (compactTerm.length >= 8 && dice >= 0.74) {
        score += 4;
      }
    }
  });

  const titlePhrase = normalizeSearchText(product.title);
  if (titlePhrase && normalizedValue.includes(titlePhrase)) {
    score += 14;
  }

  if (profile.titleCompact && compactValue.includes(profile.titleCompact)) {
    score += 10;
  }

  if (
    product.barcode === '768533123787' &&
    (tokens.has('verilux') || normalizedValue.includes('verilux')) &&
    (tokens.has('happylight') ||
      tokens.has('happy light') ||
      compactValue.includes('happylight'))
  ) {
    score += 18;
  }

  if (
    product.barcode === '610731283698' &&
    (tokens.has('voxxbliss') || compactValue.includes('voxxbliss')) &&
    (tokens.has('insoles') || tokens.has('insole'))
  ) {
    score += 16;
  }

  if (
    product.barcode === '036000291452' &&
    (tokens.has('wireless') || normalizedValue.includes('wireless')) &&
    (tokens.has('earbuds') ||
      tokens.has('earbud') ||
      compactValue.includes('earbuds'))
  ) {
    score += 14;
  }

  if (
    product.barcode === '999000000001' &&
    (tokens.has('pledge') || normalizedValue.includes('pledge')) &&
    (tokens.has('multisurface') ||
      tokens.has('multi surface') ||
      compactValue.includes('multisurface') ||
      normalizedValue.includes('everyday clean'))
  ) {
    score += 18;
  }

  return score;
}

function findBarcodeProductByPackageText(value: string): BarcodeProduct | null {
  const normalizedValue = normalizeSearchText(value);
  if (!normalizedValue) return null;

  let bestMatch: { product: BarcodeProduct; score: number } | null = null;
  let runnerUp: { product: BarcodeProduct; score: number } | null = null;

  for (const product of MOCK_BARCODE_PRODUCTS) {
    const score = scorePackageTextAgainstProduct(value, product);
    const candidate = { product, score };

    if (!bestMatch || score > bestMatch.score) {
      runnerUp = bestMatch;
      bestMatch = candidate;
    } else if (!runnerUp || score > runnerUp.score) {
      runnerUp = candidate;
    }
  }

  if (!bestMatch || bestMatch.score < 2) {
    return null;
  }

  const scoreGap = bestMatch.score - (runnerUp?.score ?? 0);
  if (bestMatch.score < 4 && scoreGap < 1) {
    return null;
  }

  return {
    ...bestMatch.product,
    source: 'Front package photo (smart keyword match)',
    confidence:
      bestMatch.score >= 16 ? 'high' : bestMatch.score >= 5 ? 'medium' : 'low',
  };
}

function toInches(value: number, unit: string) {
  switch (unit) {
    case 'cm':
    case 'centimeter':
    case 'centimeters':
      return value / 2.54;
    case 'mm':
    case 'millimeter':
    case 'millimeters':
      return value / 25.4;
    case 'm':
    case 'meter':
    case 'meters':
      return (value * 100) / 2.54;
    default:
      return value;
  }
}

function toOunces(value: number, unit: string) {
  switch (unit) {
    case 'lb':
    case 'lbs':
    case 'pound':
    case 'pounds':
      return value * 16;
    case 'g':
    case 'gram':
    case 'grams':
      return value / 28.349523125;
    case 'kg':
    case 'kilogram':
    case 'kilograms':
      return (value * 1000) / 28.349523125;
    default:
      return value;
  }
}

function parseDimensionString(value?: string | null) {
  if (!value) return null;

  const lower = value.toLowerCase();
  let unit = 'in';

  if (/\b(cm|centimeter|centimeters)\b/.test(lower)) unit = 'cm';
  else if (/\b(mm|millimeter|millimeters)\b/.test(lower)) unit = 'mm';
  else if (/\b(m|meter|meters)\b/.test(lower)) unit = 'm';

  const numberMatches = lower.match(/\d+(?:\.\d+)?/g);
  if (!numberMatches || numberMatches.length < 3) return null;

  const numbers = numberMatches.slice(0, 3).map((part) => Number(part));
  const converted = numbers.map((num) => round2(toInches(num, unit)));

  return {
    length: converted[0],
    width: converted[1],
    height: converted[2],
  };
}

function parseWeightString(value?: string | null) {
  if (!value) return null;

  const lower = value.toLowerCase();
  const numberMatch = lower.match(/\d+(?:\.\d+)?/);
  if (!numberMatch) return null;

  let unit = 'oz';
  if (/\b(lb|lbs|pound|pounds)\b/.test(lower)) unit = 'lb';
  else if (/\b(kg|kilogram|kilograms)\b/.test(lower)) unit = 'kg';
  else if (/\b(g|gram|grams)\b/.test(lower)) unit = 'g';

  return round2(toOunces(Number(numberMatch[0]), unit));
}

type UpcItemDbItem = {
  title?: string;
  brand?: string;
  model?: string;
  upc?: string;
  ean?: string;
  gtin?: string;
  dimension?: string;
  weight?: string;
};

async function lookupBarcodeProduct(
  barcode: string,
): Promise<BarcodeLookupResult> {
  const normalized = normalizeBarcode(barcode);

  const cached = await getCachedBarcodeProduct(normalized);
  if (cached) {
    return {
      product: cached,
      source: 'local',
      message: 'Loaded from saved cache',
    };
  }

  const mockMatch = findBarcodeProduct(normalized);
  if (mockMatch) {
    await cacheBarcodeProduct(mockMatch);

    return {
      product: {
        ...mockMatch,
        confidence: 'high',
      },
      source: 'local',
      message: 'Loaded from built-in catalog',
    };
  }

  try {
    const response = await fetch(
      `${UPCITEMDB_TRIAL_LOOKUP_URL}?upc=${encodeURIComponent(normalized)}`,
      {
        headers: {
          Accept: 'application/json',
        },
      },
    );

    if (response.status === 429) {
      return {
        product: null,
        source: 'rate_limited',
        message:
          'The online UPC service is rate-limiting requests right now. List Assist will keep using the local barcode catalog for the moment.',
        retryAfterMs: BARCODE_RATE_LIMIT_COOLDOWN_MS,
      };
    }

    if (!response.ok) {
      throw new Error(`Lookup failed with status ${response.status}`);
    }

    const payload = await response.json();
    const item: UpcItemDbItem | undefined = payload?.items?.[0];

    if (!item) {
      return {
        product: null,
        source: 'none',
      };
    }

    const parsedDimensions = parseDimensionString(item.dimension);

    const product: BarcodeProduct = {
      barcode: normalized,
      title: item.title || item.brand || item.model || `UPC ${normalized}`,
      length: parsedDimensions?.length ?? 0,
      width: parsedDimensions?.width ?? 0,
      height: parsedDimensions?.height ?? 0,
      weightOz: parseWeightString(item.weight) ?? undefined,
      source: 'UPCitemDB trial lookup',
      confidence: parsedDimensions ? (item.weight ? 'high' : 'medium') : 'low',
    };

    await cacheBarcodeProduct(product);

    return {
      product,
      source: 'online',
      message: 'Loaded from online lookup and saved to cache.',
    };
  } catch (error) {
    console.log('UPC lookup failed', error);
    return {
      product: null,
      source: 'none',
    };
  }
}

async function runOcrSpaceAttempt(
  uri: string,
  options: {
    engine: '1' | '2';
    scale: 'true' | 'false';
  },
): Promise<string> {
  const form = new FormData();
  form.append('apikey', OCR_SPACE_DEMO_API_KEY);
  form.append('language', 'eng');
  form.append('isOverlayRequired', 'false');
  form.append('scale', options.scale);
  form.append('OCREngine', options.engine);
  form.append('detectOrientation', 'true');
  form.append('file', {
    uri,
    name: 'package-front.jpg',
    type: 'image/jpeg',
  } as any);

  const response = await fetch(OCR_SPACE_API_URL, {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    throw new Error(`OCR failed with status ${response.status}`);
  }

  const payload = await response.json();
  return (payload?.ParsedResults ?? [])
    .map((result: any) => result?.ParsedText ?? '')
    .join('')
    .trim();
}

function mergeDistinctPackageTexts(texts: string[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];

  texts.forEach((text) => {
    String(text || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const normalized = normalizeSearchText(line);
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        lines.push(line);
      });
  });

  return lines.join('\n').trim();
}

async function extractTextFromPackageFront(uri: string): Promise<string> {
  const attempts: { engine: '1' | '2'; scale: 'true' | 'false' }[] = [
    { engine: '2', scale: 'true' },
    { engine: '1', scale: 'true' },
    { engine: '2', scale: 'false' },
    { engine: '1', scale: 'false' },
  ];

  const successfulTexts: string[] = [];
  let bestText = '';

  for (const attempt of attempts) {
    try {
      const parsedText = await runOcrSpaceAttempt(uri, attempt);
      if (!parsedText) continue;

      successfulTexts.push(parsedText);
      if (parsedText.length > bestText.length) {
        bestText = parsedText;
      }

      const mergedText = mergeDistinctPackageTexts(
        successfulTexts
          .slice()
          .sort((a, b) => b.length - a.length)
          .slice(0, 2),
      );

      const earlyMatch = findBarcodeProductByPackageText(
        mergedText || parsedText,
      );
      if (earlyMatch && mergedText) {
        return mergedText;
      }
    } catch (error) {
      console.log('Package OCR attempt failed', attempt, error);
    }
  }

  if (!successfulTexts.length) {
    return bestText;
  }

  return (
    mergeDistinctPackageTexts(
      successfulTexts
        .slice()
        .sort((a, b) => b.length - a.length)
        .slice(0, 2),
    ) || bestText
  );
}

async function lookupProductFromPackageFront(
  uri: string,
  manualHint?: string,
): Promise<{
  product: BarcodeProduct | null;
  detectedText: string;
  note: string;
}> {
  let detectedText = '';

  try {
    detectedText = await extractTextFromPackageFront(uri);
  } catch (error) {
    console.log('Package front OCR extraction failed', error);
  }

  const trimmedManualHint = (manualHint ?? '').trim();
  const combinedText = [detectedText, trimmedManualHint]
    .filter(Boolean)
    .join('\n');

  const candidateTexts = Array.from(
    new Set(
      [
        combinedText,
        detectedText,
        trimmedManualHint,
        ...detectedText
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length >= 3),
        normalizeSearchText(combinedText),
        normalizeSearchText(detectedText),
        normalizeSearchText(trimmedManualHint),
      ].filter(Boolean),
    ),
  );

  const learnedProduct = await findLearnedPackageFrontProduct(candidateTexts);
  if (learnedProduct) {
    return {
      product: learnedProduct,
      detectedText,
      note: 'Matched from List Assist local package memory.',
    };
  }

  for (const candidateText of candidateTexts) {
    const detectedBarcode = extractBarcodeFromText(candidateText);
    if (detectedBarcode) {
      const barcodeLookup = await lookupBarcodeProduct(detectedBarcode);
      const barcodeProduct = barcodeLookup.product;
      if (barcodeProduct) {
        return {
          product: {
            ...barcodeProduct,
            source: `${barcodeProduct.source} • front package OCR`,
            confidence: barcodeProduct.confidence ?? 'medium',
          },
          detectedText,
          note: 'Matched from package text and barcode-like digits found on the package image.',
        };
      }
    }
  }

  let bestKeywordMatch: BarcodeProduct | null = null;
  for (const candidateText of candidateTexts) {
    const keywordMatch = findBarcodeProductByPackageText(candidateText);
    if (
      keywordMatch &&
      (!bestKeywordMatch ||
        (keywordMatch.confidence === 'high' &&
          bestKeywordMatch.confidence !== 'high') ||
        (keywordMatch.confidence === 'medium' &&
          bestKeywordMatch.confidence === 'low'))
    ) {
      bestKeywordMatch = keywordMatch;
    }
  }

  if (bestKeywordMatch) {
    const usedManualHint = Boolean(trimmedManualHint);
    return {
      product: bestKeywordMatch,
      detectedText,
      note: usedManualHint
        ? 'Matched from package-front text plus your helper words. Smart fuzzy matching is now enabled.'
        : 'Matched from package front text using smart fuzzy keyword matching.',
    };
  }

  if (!detectedText && !trimmedManualHint) {
    return {
      product: null,
      detectedText: '',
      note: 'No useful text was detected. Try a brighter front-of-package photo, back up a little, or enter 2 or 3 clear words from the package below.',
    };
  }

  if (!detectedText && trimmedManualHint) {
    return {
      product: null,
      detectedText: '',
      note: 'The photo text came back weak, but your helper words were used. Try 2 or 3 exact brand or product words, or retake the front shot with the box filling more of the frame.',
    };
  }

  return {
    product: null,
    detectedText,
    note: 'List Assist could not confidently identify the product from the package front yet. Try adding 2 or 3 exact words from the package, then run the match again.',
  };
}

function getPermutations(a: number, b: number, c: number): Orientation[] {
  return [
    { length: a, width: b, height: c },
    { length: a, width: c, height: b },
    { length: b, width: a, height: c },
    { length: b, width: c, height: a },
    { length: c, width: a, height: b },
    { length: c, width: b, height: a },
  ];
}

function dedupeOrientations(orientations: Orientation[]): Orientation[] {
  const seen = new Set<string>();

  return orientations.filter((o) => {
    const key = `${o.length}-${o.width}-${o.height}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function getGarageSaleMarkerColor(saleType: 'garage' | 'estate' | 'thrift') {
  if (saleType === 'estate') return '#7C3AED';
  if (saleType === 'thrift') return '#0f766e';
  return '#2563eb';
}

function getGarageSaleTypeLabel(saleType: 'garage' | 'estate' | 'thrift') {
  if (saleType === 'estate') return 'Estate Sale';
  if (saleType === 'thrift') return 'Thrift Store';
  return 'Garage Sale';
}

function getFinderTitle(mode: FinderMode) {
  if (mode === 'thrift') return 'Thrift Stores Near You';
  if (mode === 'garage') return 'Garage Sales Near You';
  return 'Estate Sales Near You';
}

function getFinderButtonLabel(mode: FinderMode) {
  if (mode === 'thrift') return 'Thrift Store Finder';
  if (mode === 'garage') return 'Garage Sale Finder';
  return 'Estate Sale Finder';
}

function getFinderMapButtonLabel(
  mode: FinderMode,
  _dayFilter: GarageSaleDayFilter,
) {
  if (mode === 'thrift') return 'Open Thrift Store Map View';
  if (mode === 'garage') {
    return 'Open Garage Sale Map View';
  }
  return 'Open Estate Sale Map View';
}

function getFinderSavedItemLabel(mode: FinderMode) {
  return mode === 'thrift' ? 'Store' : 'Sale';
}

function getFinderResultIntro(mode: FinderMode, locationLabel: string) {
  if (mode === 'thrift') {
    return `Find nearby thrift stores, resale shops, and second-hand spots around ${locationLabel}.`;
  }

  if (mode === 'garage') {
    return `Browse nearby garage sales around ${locationLabel}, then save the ones you want to revisit.`;
  }

  return `Browse nearby estate sales around ${locationLabel}, then save the ones you want to revisit.`;
}

function calculatePointDistanceMiles(
  startLatitude?: number | null,
  startLongitude?: number | null,
  endLatitude?: number | null,
  endLongitude?: number | null,
) {
  if (
    !hasValidCoordinates(startLatitude, startLongitude) ||
    !hasValidCoordinates(endLatitude, endLongitude)
  ) {
    return null;
  }

  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const dLat = toRadians(Number(endLatitude) - Number(startLatitude));
  const dLng = toRadians(Number(endLongitude) - Number(startLongitude));
  const lat1 = toRadians(Number(startLatitude));
  const lat2 = toRadians(Number(endLatitude));
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return round2(earthRadiusMiles * c);
}

function getGarageSaleDayFilterLabel(dayFilter: GarageSaleDayFilter) {
  switch (dayFilter) {
    case 'today':
      return 'Today';
    case 'tomorrow':
      return 'Tomorrow';
    default:
      return '';
  }
}

function getGarageSaleDayFilterShortLabel(dayFilter: GarageSaleDayFilter) {
  switch (dayFilter) {
    case 'today':
      return 'Today';
    case 'tomorrow':
      return 'Tomorrow';
    default:
      return '';
  }
}

function getTodayDayFilter(): GarageSaleDayFilter {
  return 'today';
}

function normalizeGarageSaleText(value: unknown, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function getGarageSaleDistanceMiles(sale: any): number | null {
  const rawDistance = sale?.distanceMiles ?? sale?.distance ?? sale?.milesAway;
  const numericDistance = Number(rawDistance);

  if (Number.isFinite(numericDistance) && numericDistance >= 0) {
    return round2(numericDistance);
  }

  const stringDistance = normalizeGarageSaleText(rawDistance);
  const extractedDistance = Number(
    String(stringDistance).match(/\d+(?:\.\d+)?/)?.[0],
  );

  return Number.isFinite(extractedDistance) && extractedDistance >= 0
    ? round2(extractedDistance)
    : null;
}

function getGarageSaleDistanceLabel(sale: any): string {
  const numericDistance = getGarageSaleDistanceMiles(sale);

  if (numericDistance !== null) {
    return `${numericDistance} mi away`;
  }

  if (sale?.probableSale) {
    return 'Use map for area';
  }

  const rawDistance = sale?.distanceMiles ?? sale?.distance ?? sale?.milesAway;
  const stringDistance = normalizeGarageSaleText(rawDistance);
  return stringDistance || 'Distance unavailable';
}

function getGarageSaleDayLabel(
  sale: any,
  fallbackDayFilter: GarageSaleDayFilter,
) {
  const directLabel = normalizeGarageSaleText(
    sale?.dayLabel || sale?.dateLabel || sale?.date || sale?.day,
  );

  if (directLabel) return directLabel;
  return getGarageSaleDayFilterLabel(fallbackDayFilter);
}

function getGarageSaleTimeLabelFromSale(
  sale: any,
  fallbackDayFilter: GarageSaleDayFilter,
) {
  const dayLabel = getGarageSaleDayLabel(sale, fallbackDayFilter);
  const rawTime = normalizeGarageSaleText(
    sale?.timeLabel || sale?.time || sale?.hours || sale?.startTime,
  );

  if (dayLabel && rawTime) return `${dayLabel} • ${rawTime}`;
  if (rawTime) return rawTime;
  return `${dayLabel} • Time not listed`;
}

function stripGarageSaleTimePrefix(rawValue: unknown) {
  let text = normalizeGarageSaleText(rawValue);
  if (!text) return '';

  if (text.includes('•')) {
    text = text.split('•').slice(1).join('•').trim();
  }

  text = text.replace(
    /^(?:sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday|rsdays|rsday)?|fri(?:day)?|sat(?:urday)?)[,\s-:]*/i,
    '',
  );

  text = text.replace(/^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}[,\s-:]*/i, '');

  return text.trim();
}

function getGarageSaleDateLabel(
  sale: any,
  _fallbackDayFilter: GarageSaleDayFilter,
) {
  const comparable = getGarageSaleComparableDate(sale);

  if (comparable) {
    return comparable.value.toLocaleDateString('en-US');
  }

  const directDate = normalizeGarageSaleText(
    sale?.saleDate ||
      sale?.sale_date ||
      sale?.dateLabel ||
      sale?.date ||
      sale?.dayLabel ||
      sale?.day,
  );

  return directDate || 'Date unavailable';
}

function getGarageSaleDisplayTimeLabel(
  sale: any,
  fallbackDayFilter: GarageSaleDayFilter,
) {
  const comparable = getGarageSaleComparableDate(sale);
  const weekday = comparable
    ? comparable.value.toLocaleDateString('en-US', { weekday: 'long' })
    : getGarageSaleDayLabel(sale, fallbackDayFilter);

  const rawTime = normalizeGarageSaleText(
    sale?.timeLabel || sale?.time || sale?.hours || sale?.startTime,
  );
  const cleanedTime = stripGarageSaleTimePrefix(rawTime);

  if (cleanedTime && weekday) {
    return `${weekday} • ${cleanedTime}`;
  }

  if (cleanedTime) {
    return cleanedTime;
  }

  return weekday ? `${weekday} • Time not listed` : 'Time not listed';
}

function formatOpeningHourTimeToken(hourText: string, minuteText = '00') {
  const hour24 = Number(hourText);
  const minute = Number(minuteText || '0');

  if (!Number.isFinite(hour24) || !Number.isFinite(minute)) {
    return `${hourText}:${minuteText}`;
  }

  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  const minuteLabel = minute === 0 ? '' : `:${String(minute).padStart(2, '0')}`;

  return `${hour12}${minuteLabel} ${suffix}`;
}

function formatOpeningHoursForDisplay(value?: string | null) {
  const rawHours = normalizeGarageSaleText(value || '');

  if (!rawHours) return '';

  return rawHours
    .replace(/\s*\|\|\s*/g, '; ')
    .replace(/\s+open\s+"([^"]+)"/gi, ' ($1)')
    .replace(
      /\b([01]?\d|2[0-3]):([0-5]\d)\s*[–-]\s*([01]?\d|2[0-3]):([0-5]\d)\b/g,
      (_match, startHour, startMinute, endHour, endMinute) =>
        `${formatOpeningHourTimeToken(startHour, startMinute)}–${formatOpeningHourTimeToken(
          endHour,
          endMinute,
        )}`,
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function getThriftStoreHoursLabel(sale: Partial<GarageSaleMapPin>) {
  const rawHours = normalizeGarageSaleText(
    sale.openingHours || sale.timeLabel || '',
  );

  if (
    !rawHours ||
    /hours\s*vary|hours\s*not\s*listed|time\s*not\s*listed/i.test(rawHours)
  ) {
    return 'Not listed — Tap View for hours';
  }

  return formatOpeningHoursForDisplay(rawHours) || rawHours;
}

function getThriftStoreOpenStatusLabel(sale: Partial<GarageSaleMapPin>) {
  const rawHours = normalizeGarageSaleText(
    sale.openingHours || sale.timeLabel || '',
  );

  if (
    !rawHours ||
    /hours\s*vary|hours\s*not\s*listed|time\s*not\s*listed|not\s*listed/i.test(
      rawHours,
    )
  ) {
    return '';
  }

  if (/24\/7|24 hours|open 24/i.test(rawHours)) {
    return 'Open now';
  }

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const rangeMatch = rawHours.match(
    /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*[–-]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i,
  );

  if (!rangeMatch) return '';

  const toMinutes = (
    hourText: string,
    minuteText = '0',
    meridiem = '',
    assume24Hour = false,
  ) => {
    let hour = Number(hourText);
    const minute = Number(minuteText || '0');
    const upper = meridiem.toUpperCase();

    if (upper === 'PM' && hour < 12) hour += 12;
    if (upper === 'AM' && hour === 12) hour = 0;

    if (!upper && assume24Hour && hour === 24) hour = 0;

    return hour * 60 + minute;
  };

  const startHourNumber = Number(rangeMatch[1]);
  const endHourNumber = Number(rangeMatch[4]);
  const hasExplicitMeridiem = Boolean(rangeMatch[3] || rangeMatch[6]);
  const assume24Hour =
    !hasExplicitMeridiem &&
    (startHourNumber > 12 ||
      endHourNumber > 12 ||
      String(rangeMatch[2] || '').length === 2 ||
      String(rangeMatch[5] || '').length === 2);

  const startMeridiem = rangeMatch[3] || rangeMatch[6] || '';
  const endMeridiem = rangeMatch[6] || startMeridiem;
  const start = toMinutes(
    rangeMatch[1],
    rangeMatch[2] || '0',
    startMeridiem,
    assume24Hour,
  );
  let end = toMinutes(
    rangeMatch[4],
    rangeMatch[5] || '0',
    endMeridiem,
    assume24Hour,
  );

  if (end <= start) {
    end += 24 * 60;
  }

  const adjustedNow =
    currentMinutes < start && end > 24 * 60
      ? currentMinutes + 24 * 60
      : currentMinutes;

  return adjustedNow >= start && adjustedNow < end ? 'Open now' : 'Closed now';
}

function doesPinMatchSelectedGarageSaleDay(
  pin: GarageSaleMapPin,
  selectedDay: GarageSaleDayFilter,
) {
  if (pin.saleType === 'thrift') return true;
  if (pin.probableSale) return false;

  const normalizedSelectedDay = String(selectedDay || '').trim();
  const comparableValue =
    String(pin.timeLabel || '').trim() || String(pin.dayLabel || '').trim();

  if (!normalizedSelectedDay || !comparableValue) return false;

  const parsed = parseGarageSaleDateCandidate(comparableValue);
  if (!parsed) return false;

  const saleDate = new Date(parsed.value);
  saleDate.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  switch (normalizedSelectedDay) {
    case 'today':
      return saleDate.getTime() === today.getTime();
    case 'tomorrow':
      return saleDate.getTime() === tomorrow.getTime();
    default:
      return false;
  }
}

function parseGarageSaleDateCandidate(
  rawValue: unknown,
): { value: Date; hasExplicitTime: boolean } | null {
  const text = normalizeGarageSaleText(rawValue);
  if (!text) return null;

  const normalized = text.replace(/\s+/g, ' ').trim();
  const nativeParsed = new Date(normalized);

  if (!Number.isNaN(nativeParsed.getTime())) {
    return {
      value: nativeParsed,
      hasExplicitTime:
        /\b\d{1,2}:\d{2}\b/.test(normalized) || /\b(am|pm)\b/i.test(normalized),
    };
  }

  const dateMatch = normalized.match(
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[^\d]+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i,
  );

  if (!dateMatch) {
    return null;
  }

  const month = Number(dateMatch[1]);
  const day = Number(dateMatch[2]);
  const yearPart = Number(dateMatch[3]);
  const year = yearPart < 100 ? 2000 + yearPart : yearPart;
  let hours = Number(dateMatch[4] ?? 0);
  const minutes = Number(dateMatch[5] ?? 0);
  const meridiem = String(dateMatch[6] ?? '').toLowerCase();
  const hasExplicitTime = Boolean(dateMatch[4]);

  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;

  const parsed = new Date(year, month - 1, day, hours, minutes, 0, 0);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return { value: parsed, hasExplicitTime };
}

function getGarageSaleComparableDate(
  sale: any,
): { value: Date; hasExplicitTime: boolean } | null {
  const timestampCandidates = [
    sale?.saleSortTimestamp,
    sale?.timestamp,
    sale?.startTimestamp,
  ];

  for (const candidate of timestampCandidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric > 0) {
      const parsed = new Date(numeric);
      if (!Number.isNaN(parsed.getTime())) {
        return {
          value: parsed,
          hasExplicitTime: true,
        };
      }
    }
  }

  const candidates = [
    sale?.startDateTime,
    sale?.start_date_time,
    sale?.saleDateTime,
    sale?.sale_date_time,
    sale?.datetime,
    sale?.startDate,
    sale?.start_date,
    sale?.saleDate,
    sale?.sale_date,
    sale?.date,
    sale?.dateLabel,
    sale?.time,
    sale?.timeLabel,
    sale?.startTime,
  ];

  for (const candidate of candidates) {
    const parsed = parseGarageSaleDateCandidate(candidate);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function getGarageSaleTimingStatus(sale: any): {
  status: 'confirmed' | 'probable' | 'expired';
  sortTimestamp: number;
} {
  const parsed = getGarageSaleComparableDate(sale);

  if (!parsed) {
    return {
      status: 'probable',
      sortTimestamp: Number.MAX_SAFE_INTEGER,
    };
  }

  const now = new Date();
  const saleStart = new Date(parsed.value);
  let saleEnd = parsed.hasExplicitTime ? new Date(parsed.value) : null;

  const rawEndTime = normalizeGarageSaleText(
    sale?.endTime || sale?.end_time || sale?.closingTime || sale?.closeTime,
  );

  if (rawEndTime) {
    const endMatch = rawEndTime.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);

    if (endMatch) {
      let hours = Number(endMatch[1]);
      const minutes = Number(endMatch[2] ?? 0);
      const meridiem = String(endMatch[3] ?? '').toLowerCase();

      if (meridiem === 'pm' && hours < 12) hours += 12;
      if (meridiem === 'am' && hours === 12) hours = 0;

      saleEnd = new Date(saleStart);
      saleEnd.setHours(hours, minutes, 59, 999);

      if (saleEnd.getTime() < saleStart.getTime()) {
        saleEnd = new Date(saleStart);
        saleEnd.setDate(saleEnd.getDate() + 1);
        saleEnd.setHours(hours, minutes, 59, 999);
      }
    }
  }

  if (saleEnd) {
    return {
      status: saleEnd.getTime() >= now.getTime() ? 'confirmed' : 'expired',
      sortTimestamp: saleStart.getTime(),
    };
  }

  const endOfSaleDay = new Date(saleStart);
  endOfSaleDay.setHours(23, 59, 59, 999);

  return {
    status: endOfSaleDay.getTime() >= now.getTime() ? 'confirmed' : 'expired',
    sortTimestamp: saleStart.getTime(),
  };
}

function isCurrentOrUpcomingGarageSale(sale: any): boolean {
  return getGarageSaleTimingStatus(sale).status !== 'expired';
}

function getGarageSaleNotesFromSale(sale: any) {
  return normalizeGarageSaleText(
    sale?.notes || sale?.description || sale?.summary,
    'Open the original post for more details.',
  );
}

function getGarageSaleCraigslistUrl(sale: any): string | undefined {
  const candidate = normalizeGarageSaleText(
    sale?.craigslistUrl ||
      sale?.url ||
      sale?.postUrl ||
      sale?.listingUrl ||
      sale?.link,
  );

  return candidate.startsWith('http') ? candidate : undefined;
}

function buildGarageSaleFallbackViewUrl(sale: {
  title?: string;
  addressLabel?: string;
  query?: string;
}) {
  const fallbackSearch = [sale.title, sale.addressLabel, sale.query]
    .filter(Boolean)
    .map((value) => String(value).trim())
    .join(' ')
    .trim();

  if (!fallbackSearch) {
    return undefined;
  }

  return `https://chicago.craigslist.org/search/gms?query=${encodeURIComponent(
    fallbackSearch,
  )}`;
}

function buildGarageSaleDisplayAddress(parts: {
  street?: string | null;
  crossStreet?: string | null;
  addressLabel?: string | null;
  mapAddress?: string | null;
  mapsQuery?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}) {
  const street = String(parts.street || '').trim();
  const crossStreet = String(parts.crossStreet || '').trim();
  const addressLabel = String(parts.addressLabel || '').trim();
  const mapAddress = String(parts.mapAddress || '').trim();
  const mapsQuery = String(parts.mapsQuery || '').trim();
  const cityLine = [parts.city, parts.state, parts.zip]
    .filter(Boolean)
    .map((value) => String(value).trim())
    .filter(Boolean)
    .join(', ');

  if (street) {
    return crossStreet ? `${street} near ${crossStreet}` : street;
  }

  const addressLooksCityOnly =
    addressLabel &&
    !/\bnear\b/i.test(addressLabel) &&
    !/\d/.test(addressLabel) &&
    mapAddress;

  return (
    (addressLooksCityOnly ? mapAddress : '') ||
    addressLabel ||
    mapAddress ||
    mapsQuery ||
    cityLine ||
    'Location available'
  );
}

function shouldShowGarageSaleProbableBadge(pin: GarageSaleMapPin) {
  return Boolean(pin.probableSale);
}

function getGarageSaleCompactMeta(pin: GarageSaleMapPin) {
  return [
    pin.saleType === 'estate' ? 'Estate Sale' : 'Garage Sale',
    pin.distanceLabel,
  ]
    .filter(Boolean)
    .join(' • ');
}

function getStartRouteButtonLabel(stopCount: number) {
  if (stopCount <= 0) return 'Start Route';
  if (stopCount === 1) return 'Start Route to 1 Stop';
  return `Start Route to ${stopCount} Stops`;
}

const GARAGE_SALE_MAP_STYLE = [
  {
    elementType: 'geometry',
    stylers: [{ saturation: -12 }, { lightness: -6 }],
  },
  {
    elementType: 'labels.text.fill',
    stylers: [{ color: '#64748b' }],
  },
  {
    elementType: 'labels.text.stroke',
    stylers: [{ color: '#f8fafc' }],
  },
  {
    featureType: 'poi',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'transit',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'road.local',
    elementType: 'geometry',
    stylers: [{ lightness: 8 }],
  },
  {
    featureType: 'administrative.land_parcel',
    stylers: [{ visibility: 'off' }],
  },
];

function clusterGarageSalePins(
  pins: GarageSaleMapPin[],
  latitudeDelta: number,
) {
  if (latitudeDelta < 0.045) {
    return pins.map((pin) => ({
      ...pin,
      isCluster: false,
      clusterCount: 1,
      memberPins: [pin],
    }));
  }

  const gridSize = Math.max(latitudeDelta / 2.8, 0.012);
  const buckets = new Map<string, GarageSaleMapPin[]>();

  pins.forEach((pin) => {
    const latKey = Math.round(pin.latitude / gridSize);
    const lngKey = Math.round(pin.longitude / gridSize);
    const key = `${latKey}:${lngKey}`;

    if (!buckets.has(key)) {
      buckets.set(key, []);
    }

    buckets.get(key)!.push(pin);
  });

  return Array.from(buckets.values()).map((bucket, index) => {
    if (bucket.length === 1) {
      const pin = bucket[0];
      return {
        ...pin,
        isCluster: false,
        clusterCount: 1,
        memberPins: [pin],
      };
    }

    const latitude =
      bucket.reduce((sum, pin) => sum + pin.latitude, 0) / bucket.length;
    const longitude =
      bucket.reduce((sum, pin) => sum + pin.longitude, 0) / bucket.length;
    const estateCount = bucket.filter(
      (pin) => pin.saleType === 'estate',
    ).length;

    return {
      id: `cluster-${index}-${bucket.map((pin) => pin.id).join('-')}`,
      title: `${bucket.length} nearby sales`,
      subtitle:
        estateCount > 0
          ? `${bucket.length} pins, including estate sales`
          : `${bucket.length} garage / yard sale pins`,
      query: bucket[0].query,
      latitude,
      longitude,
      addressLabel: 'Cluster area',
      timeLabel: 'Zoom in for individual pins',
      notes: 'This cluster combines nearby sale targets.',
      pinColor: estateCount === bucket.length ? '#7C3AED' : '#2563eb',
      saleType: estateCount === bucket.length ? 'estate' : 'garage',
      isCluster: true,
      clusterCount: bucket.length,
      memberPins: bucket,
    };
  });
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(round2(value));
}

function formatDimension(value: number, unitLabel: string): string {
  return `${formatNumber(value)}${unitLabel}`;
}

function getVolumeUnit(unitSystem: UnitSystem): string {
  return unitSystem === 'us' ? 'in³' : 'cm³';
}

function getMaxTotalSlack(unitSystem: UnitSystem): number {
  return unitSystem === 'us' ? 8 : 20;
}

function calculateFitScore(
  box: Box,
  orientation: Orientation,
  unitSystem: UnitSystem,
): {
  fitScore: number;
  fitLabel: string;
  volumeUsagePercent: number;
  totalSlack: number;
  maxSlack: number;
  slackLength: number;
  slackWidth: number;
  slackHeight: number;
} {
  const boxVolume = box.length * box.width * box.height;
  const itemVolume =
    orientation.length * orientation.width * orientation.height;

  const slackLength = box.length - orientation.length;
  const slackWidth = box.width - orientation.width;
  const slackHeight = box.height - orientation.height;

  const totalSlack = slackLength + slackWidth + slackHeight;
  const maxSlack = Math.max(slackLength, slackWidth, slackHeight);
  const volumeUsage = itemVolume / boxVolume;
  const volumeUsagePercent = round2(volumeUsage * 100);

  const slackPenaltyMultiplier = unitSystem === 'us' ? 2 : 0.8;
  const maxSlackPenaltyMultiplier = unitSystem === 'us' ? 3 : 1.2;

  const fitScore = round2(
    volumeUsage * 100 -
      totalSlack * slackPenaltyMultiplier -
      maxSlack * maxSlackPenaltyMultiplier,
  );

  let fitLabel = 'Loose Fit';

  if (volumeUsagePercent >= 80) {
    fitLabel = 'Snug Fit';
  } else if (volumeUsagePercent >= 60) {
    fitLabel = 'Good Fit';
  } else if (volumeUsagePercent >= 40) {
    fitLabel = 'Okay Fit';
  }

  return {
    fitScore,
    fitLabel,
    volumeUsagePercent,
    totalSlack: round2(totalSlack),
    maxSlack: round2(maxSlack),
    slackLength: round2(slackLength),
    slackWidth: round2(slackWidth),
    slackHeight: round2(slackHeight),
  };
}

function isGoodResizeCandidate(result: FitResult): boolean {
  return (
    round2(result.slackLength) === 0 &&
    round2(result.slackWidth) === 0 &&
    round2(result.slackHeight) > 0 &&
    round2(result.slackHeight) <= 4
  );
}

function calculateFits(
  itemLength: number,
  itemWidth: number,
  itemHeight: number,
  boxes: Box[],
  padding: number,
  unitSystem: UnitSystem,
): FitResult[] {
  const paddedLength = itemLength + padding;
  const paddedWidth = itemWidth + padding;
  const paddedHeight = itemHeight + padding;

  const orientations = dedupeOrientations(
    getPermutations(paddedLength, paddedWidth, paddedHeight),
  );

  const MAX_TOTAL_SLACK = getMaxTotalSlack(unitSystem);

  return boxes
    .map((box) => {
      let bestFit: FitResult | null = null;

      orientations.forEach((orientation) => {
        const fits =
          orientation.length <= box.length &&
          orientation.width <= box.width &&
          orientation.height <= box.height;

        if (!fits) return;

        const slackLength = box.length - orientation.length;
        const slackWidth = box.width - orientation.width;
        const slackHeight = box.height - orientation.height;
        const totalSlack = slackLength + slackWidth + slackHeight;

        if (totalSlack > MAX_TOTAL_SLACK) return;

        const scored = calculateFitScore(box, orientation, unitSystem);

        const candidate: FitResult = {
          box,
          boxVolume: box.length * box.width * box.height,
          chosenOrientation: orientation,
          fitScore: scored.fitScore,
          fitLabel: scored.fitLabel,
          volumeUsagePercent: scored.volumeUsagePercent,
          totalSlack: scored.totalSlack,
          maxSlack: scored.maxSlack,
          slackLength: scored.slackLength,
          slackWidth: scored.slackWidth,
          slackHeight: scored.slackHeight,
        };

        if (!bestFit || candidate.fitScore > bestFit.fitScore) {
          bestFit = candidate;
        }
      });

      return bestFit;
    })
    .filter((result): result is FitResult => result !== null)
    .filter((result) => result.volumeUsagePercent >= 25)
    .sort((a, b) => {
      // 1. Highest volume usage first (tightest fit)
      if (b.volumeUsagePercent !== a.volumeUsagePercent) {
        return b.volumeUsagePercent - a.volumeUsagePercent;
      }

      // 2. Then lowest total slack
      if (a.totalSlack !== b.totalSlack) {
        return a.totalSlack - b.totalSlack;
      }

      // 3. Then smallest box volume
      return a.boxVolume - b.boxVolume;
    });
}

function calculateNearestMiss(
  itemLength: number,
  itemWidth: number,
  itemHeight: number,
  boxes: Box[],
  padding: number,
): NearestMissResult | null {
  const paddedLength = itemLength + padding;
  const paddedWidth = itemWidth + padding;
  const paddedHeight = itemHeight + padding;

  const orientations = dedupeOrientations(
    getPermutations(paddedLength, paddedWidth, paddedHeight),
  );

  let bestMiss: NearestMissResult | null = null;

  boxes.forEach((box) => {
    orientations.forEach((orientation) => {
      const overLength = round2(Math.max(0, orientation.length - box.length));
      const overWidth = round2(Math.max(0, orientation.width - box.width));
      const overHeight = round2(Math.max(0, orientation.height - box.height));

      const totalOverage = round2(overLength + overWidth + overHeight);
      const maxOverage = round2(Math.max(overLength, overWidth, overHeight));

      if (totalOverage === 0) return;

      const overDimensions: string[] = [];
      if (overLength > 0) overDimensions.push('Length');
      if (overWidth > 0) overDimensions.push('Width');
      if (overHeight > 0) overDimensions.push('Height');

      const candidate: NearestMissResult = {
        box,
        chosenOrientation: orientation,
        overLength,
        overWidth,
        overHeight,
        totalOverage,
        maxOverage,
        overDimensions,
      };

      if (!bestMiss) {
        bestMiss = candidate;
        return;
      }

      if (candidate.totalOverage < bestMiss.totalOverage) {
        bestMiss = candidate;
        return;
      }

      if (
        candidate.totalOverage === bestMiss.totalOverage &&
        candidate.maxOverage < bestMiss.maxOverage
      ) {
        bestMiss = candidate;
        return;
      }

      const candidateVolume =
        candidate.box.length * candidate.box.width * candidate.box.height;
      const bestMissVolume =
        bestMiss.box.length * bestMiss.box.width * bestMiss.box.height;

      if (
        candidate.totalOverage === bestMiss.totalOverage &&
        candidate.maxOverage === bestMiss.maxOverage &&
        candidateVolume < bestMissVolume
      ) {
        bestMiss = candidate;
      }
    });
  });

  return bestMiss;
}

function getFitConfidence(result: FitResult): {
  label: 'Excellent' | 'High' | 'Good' | 'Fair';
  score: number;
} {
  const usageScore = Math.min(100, Math.round(result.volumeUsagePercent));
  const slackPenalty = Math.round(result.totalSlack * 6 + result.maxSlack * 4);
  const rawScore = Math.max(52, Math.min(98, usageScore + 18 - slackPenalty));

  if (rawScore >= 90) return { label: 'Excellent', score: rawScore };
  if (rawScore >= 80) return { label: 'High', score: rawScore };
  if (rawScore >= 70) return { label: 'Good', score: rawScore };
  return { label: 'Fair', score: rawScore };
}

function getConfidenceStyle(label: 'Excellent' | 'High' | 'Good' | 'Fair') {
  switch (label) {
    case 'Excellent':
      return {
        backgroundColor: '#dcfce7',
        borderColor: '#86efac',
        textColor: '#166534',
      };
    case 'High':
      return {
        backgroundColor: '#dbeafe',
        borderColor: '#93c5fd',
        textColor: '#1d4ed8',
      };
    case 'Good':
      return {
        backgroundColor: '#fef3c7',
        borderColor: '#fcd34d',
        textColor: '#92400e',
      };
    default:
      return {
        backgroundColor: '#f3f4f6',
        borderColor: '#d1d5db',
        textColor: '#374151',
      };
  }
}

function getFitSummary(result: FitResult) {
  if (result.volumeUsagePercent >= 85 && result.totalSlack <= 2) {
    return 'Tight, efficient fit with very little wasted space.';
  }
  if (result.volumeUsagePercent >= 70) {
    return 'Strong overall fit with enough room to pack safely.';
  }
  if (result.volumeUsagePercent >= 55) {
    return 'Solid fit with some extra space for padding.';
  }
  return 'Usable fit, but expect a little more empty space.';
}

function getBadgeStyle(label: string) {
  switch (label) {
    case 'Best Fit':
      return {
        backgroundColor: '#dcfce7',
        borderColor: '#86efac',
        textColor: '#166534',
      };
    case 'Good Fit':
      return {
        backgroundColor: '#dbeafe',
        borderColor: '#93c5fd',
        textColor: '#1d4ed8',
      };
    case 'Loose Fit':
      return {
        backgroundColor: '#fef3c7',
        borderColor: '#fcd34d',
        textColor: '#92400e',
      };
    default:
      return {
        backgroundColor: '#fee2e2',
        borderColor: '#fca5a5',
        textColor: '#991b1b',
      };
  }
}

function formatOverDimensions(
  result: NearestMissResult,
  unitLabel: string,
): string {
  const parts: string[] = [];

  if (result.overLength > 0) {
    parts.push(`L by ${formatDimension(result.overLength, unitLabel)}`);
  }
  if (result.overWidth > 0) {
    parts.push(`W by ${formatDimension(result.overWidth, unitLabel)}`);
  }
  if (result.overHeight > 0) {
    parts.push(`H by ${formatDimension(result.overHeight, unitLabel)}`);
  }

  return parts.join(' | ');
}

function getResizeGuide(
  result: FitResult,
  unitSystem: UnitSystem,
): ResizeGuide {
  const removeDepth = round2(result.slackHeight);
  const targetDepth = round2(result.chosenOrientation.height);

  const lengthFitsCleanly = round2(result.slackLength) === 0;
  const widthFitsCleanly = round2(result.slackWidth) === 0;

  if (!lengthFitsCleanly || !widthFitsCleanly) {
    return {
      possible: false,
      reason: 'Not suitable for resizing',
    };
  }

  if (removeDepth <= 0.5) {
    return {
      possible: false,
      reason: 'No resize really needed',
    };
  }

  const scoreFoldLimit = unitSystem === 'us' ? 1.5 : 4;
  const easyLimit = unitSystem === 'us' ? 3 : 8;
  const maxRecommended = unitSystem === 'us' ? 5 : 13;

  if (removeDepth > maxRecommended) {
    return {
      possible: false,
      reason: 'Too much depth to remove',
    };
  }

  let difficulty = 'Easy';
  if (removeDepth > easyLimit) difficulty = 'Moderate';

  const unitWord = unitSystem === 'us' ? 'inches' : 'cm';
  const method: ResizeMethod =
    removeDepth <= scoreFoldLimit ? 'score-fold' : 'cut-trim';

  const methodLabel = method === 'score-fold' ? 'Score & Fold' : 'Cut & Trim';

  const steps =
    method === 'score-fold'
      ? [
          `Measure ${formatNumber(targetDepth)} ${unitWord} up from the bottom on all 4 side panels.`,
          'Draw a straight level line around the box.',
          'Lightly score the cardboard on that line without cutting all the way through.',
          'Cut only the corner seams down to the scored line.',
          'Fold the side panels inward along the scored line.',
          'Fold the flaps down, tape securely, and test fit the item.',
        ]
      : [
          `Set the box upright and measure ${formatNumber(targetDepth)} ${unitWord} up from the bottom on all 4 side panels.`,
          'Draw a straight level line around the box at that mark.',
          'Cut straight down each corner from the top edge to the line.',
          'Trim away the extra cardboard above the line if needed.',
          'Fold the flaps inward at the new depth.',
          'Tape the box securely and test fit the item before sealing.',
        ];

  return {
    possible: true,
    difficulty,
    removeDepth,
    targetDepth,
    method,
    methodLabel,
    steps,
  };
}

function cleanListingTitle(title: string, maxLength = 80): string {
  return title
    .replace(/\s+/g, ' ')
    .replace(/\s+-\s+/g, ' - ')
    .trim()
    .slice(0, maxLength)
    .trim();
}

function buildDimensionsText(
  measurements: Measurements,
  isCylinder: boolean,
): string {
  const l = measurements.length ? formatNumber(measurements.length) : null;
  const w = measurements.width ? formatNumber(measurements.width) : null;
  const h = measurements.depth ? formatNumber(measurements.depth) : null;

  if (isCylinder) {
    return [
      l ? `Length ${l} in` : null,
      w ? `Diameter ${w} in` : null,
      h ? `Height ${h} in` : null,
    ]
      .filter(Boolean)
      .join(', ');
  }

  return [
    l ? `Length ${l} in` : null,
    w ? `Width ${w} in` : null,
    h ? `Height ${h} in` : null,
  ]
    .filter(Boolean)
    .join(', ');
}

function buildDimensionKeyword(
  measurements: Measurements,
  isCylinder: boolean,
): string {
  const l = measurements.length ? formatNumber(measurements.length) : null;
  const w = measurements.width ? formatNumber(measurements.width) : null;
  const h = measurements.depth ? formatNumber(measurements.depth) : null;

  if (isCylinder) {
    return [l ? `${l}in` : null, w ? `${w}in dia` : null, h ? `${h}in` : null]
      .filter(Boolean)
      .join(' ');
  }

  const parts = [l, w, h].filter(Boolean);
  return parts.length ? `${parts.join('x')} in` : '';
}

function parsePriceInput(value: string): number | null {
  const cleaned = value.replace(/[^0-9.]/g, '').trim();
  if (!cleaned) return null;

  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return round2(parsed);
}

function getConditionPriceMultiplier(condition: ListingCondition): number {
  switch (condition) {
    case 'New':
      return 1;
    case 'Open Box':
      return 0.93;
    case 'For Parts':
      return 0.42;
    case 'Used':
    default:
      return 0.82;
  }
}

function getPlatformFeeRate(platform: ListingPlatform): number {
  switch (platform) {
    case 'ebay':
      return 0.13;
    case 'amazon':
      return 0.15;
    case 'facebook':
      return 0.05;
    case 'generic':
    default:
      return 0.1;
  }
}

type PriceSuggestion = {
  quickSale: number;
  marketPrice: number;
  maxValue: number;
  estimatedNetQuick: number;
  estimatedNetMarket: number;
  estimatedNetMax: number;
  conditionMultiplier: number;
  feeRate: number;
  sourceLabel: string;
};

type QuickCompAnalysis = {
  sellPrice: number;
  buyCost: number | null;
  estimatedFeeRate: number;
  estimatedNet: number;
  estimatedProfit: number | null;
  roiPercent: number | null;
  verdict: 'Strong Buy' | 'Decent' | 'Pass';
  verdictReason: string;
};

function buildQuickCompAnalysis(params: {
  sellPrice: number | null;
  buyCost: number | null;
  platform?: ListingPlatform;
}): QuickCompAnalysis | null {
  const { sellPrice, buyCost, platform = 'ebay' } = params;

  if (typeof sellPrice !== 'number' || sellPrice <= 0) return null;

  const estimatedFeeRate = getPlatformFeeRate(platform);
  const estimatedNet = round2(sellPrice * (1 - estimatedFeeRate));
  const estimatedProfit =
    typeof buyCost === 'number' && buyCost > 0
      ? round2(estimatedNet - buyCost)
      : null;
  const roiPercent =
    typeof buyCost === 'number' && buyCost > 0 && estimatedProfit !== null
      ? round2((estimatedProfit / buyCost) * 100)
      : null;

  let verdict: QuickCompAnalysis['verdict'] = 'Decent';
  let verdictReason =
    'Good quick read. Compare condition and shipping before locking in the buy.';

  if (estimatedProfit !== null) {
    if (estimatedProfit >= 15 && (roiPercent ?? 0) >= 60) {
      verdict = 'Strong Buy';
      verdictReason = 'Healthy profit room after estimated marketplace fees.';
    } else if (estimatedProfit <= 5 || (roiPercent ?? 0) < 25) {
      verdict = 'Pass';
      verdictReason =
        'Margin looks thin once fees are backed out. Double-check before buying.';
    } else {
      verdict = 'Decent';
      verdictReason =
        'There may be money here, but condition and shipping could swing it.';
    }
  }

  return {
    sellPrice,
    buyCost,
    estimatedFeeRate,
    estimatedNet,
    estimatedProfit,
    roiPercent,
    verdict,
    verdictReason,
  };
}

function buildPriceSuggestion(params: {
  lowPrice: number | null;
  highPrice: number | null;
  platform: ListingPlatform;
  condition: ListingCondition;
}): PriceSuggestion | null {
  const { lowPrice, highPrice, platform, condition } = params;
  const values = [lowPrice, highPrice].filter(
    (value): value is number => typeof value === 'number' && value > 0,
  );

  if (!values.length) return null;

  const low = values.length === 2 ? Math.min(...values) : values[0];
  const high = values.length === 2 ? Math.max(...values) : values[0];
  const midpoint = round2((low + high) / 2);
  const conditionMultiplier = getConditionPriceMultiplier(condition);
  const feeRate = getPlatformFeeRate(platform);

  const adjustedLow = round2(low * conditionMultiplier);
  const adjustedHigh = round2(high * conditionMultiplier);
  const adjustedMid = round2(midpoint * conditionMultiplier);

  const quickSale = round2(Math.max(1, adjustedLow * 0.97));
  const marketPrice = round2(
    Math.max(
      quickSale,
      values.length === 1 ? adjustedMid : (adjustedLow + adjustedHigh) / 2,
    ),
  );
  const maxValue = round2(Math.max(marketPrice, adjustedHigh * 1.02));

  const net = (price: number) => round2(price * (1 - feeRate));

  return {
    quickSale,
    marketPrice,
    maxValue,
    estimatedNetQuick: net(quickSale),
    estimatedNetMarket: net(marketPrice),
    estimatedNetMax: net(maxValue),
    conditionMultiplier,
    feeRate,
    sourceLabel:
      values.length === 2
        ? `Based on observed range ${formatPrice(low)}–${formatPrice(high)}`
        : `Based on observed price ${formatPrice(low)}`,
  };
}

type BestTitleParams = {
  platform: ListingPlatform;
  condition: ListingCondition;
  product: BarcodeProduct | null;
  measurements: Measurements;
  isCylinder: boolean;
};

function scoreTitleOption(title: string, params: BestTitleParams): number {
  const { platform, condition, product } = params;
  const normalizedTitle = normalizeSearchText(title);
  const titleTokens = new Set(getMeaningfulTokens(title));
  const productTokens = getMeaningfulTokens(product?.title ?? '');

  let score = 0;
  const length = title.trim().length;

  const targetRanges: Record<
    ListingPlatform,
    { min: number; max: number; ideal: number }
  > = {
    ebay: { min: 55, max: 80, ideal: 72 },
    facebook: { min: 24, max: 65, ideal: 44 },
    amazon: { min: 65, max: 120, ideal: 96 },
    generic: { min: 30, max: 80, ideal: 58 },
  };

  const range = targetRanges[platform];
  if (length >= range.min && length <= range.max) {
    score += 18;
  } else if (length > range.max) {
    score -= Math.min(20, length - range.max);
  } else {
    score -= Math.min(10, range.min - length);
  }

  score += Math.max(0, 12 - Math.abs(length - range.ideal) / 2);

  for (const token of productTokens) {
    if (titleTokens.has(token)) score += token.length >= 5 ? 5 : 3;
  }

  const normalizedCondition = normalizeSearchText(condition);
  if (normalizedCondition && normalizedTitle.includes(normalizedCondition)) {
    score += 5;
  }

  const strongKeywordPhrases = [
    'light therapy',
    '10000 lux',
    'uv free',
    'arch support',
    'orthotic',
    'charging case',
    'multisurface',
    'rainshower',
    'bundle',
    'kit',
    'nvme',
    'ssd',
    'pcie',
    'metal case',
    'cooling fan',
  ];

  strongKeywordPhrases.forEach((phrase) => {
    if (normalizedTitle.includes(phrase)) score += 4;
  });

  const weakKeywordPhrases = [
    'ready to build',
    'ready to list',
    'see details',
    'product details',
    'available now',
  ];

  weakKeywordPhrases.forEach((phrase) => {
    if (normalizedTitle.includes(phrase)) score -= 5;
  });

  const spammyWords = [
    'must see',
    'wow',
    'look',
    'nice shape',
    'priced to sell',
  ];
  for (const word of spammyWords) {
    if (normalizedTitle.includes(word)) score -= 4;
  }

  if (platform === 'ebay') {
    if (normalizedTitle.includes('fast shipping')) score -= 2;
    if (normalizedTitle.includes('local pickup')) score -= 2;
  } else if (platform === 'facebook') {
    if (normalizedTitle.includes('local pickup')) score += 4;
    if (normalizedTitle.includes('available now')) score += 1;
  } else if (platform === 'amazon') {
    if (normalizedTitle.includes('product listing')) score -= 3;
    if (normalizedTitle.includes('catalog style')) score -= 2;
  }

  return score;
}

function getBestTitleIndex(
  titleOptions: string[],
  params: BestTitleParams,
): number {
  if (!titleOptions.length) return 0;

  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  titleOptions.forEach((title, index) => {
    const score = scoreTitleOption(title, params);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function getBestTitleHelperText(platform: ListingPlatform): string {
  switch (platform) {
    case 'amazon':
      return 'Recommended as the strongest all-around title.';
    case 'ebay':
      return 'SEO-focused with stronger search keywords.';
    case 'facebook':
      return 'Cleaner, more natural wording.';
    default:
      return 'Shorter title for quick readability.';
  }
}

function isGenericListingTitle(value?: string | null): boolean {
  const normalized = normalizeSearchText(value);
  if (!normalized) return true;

  return [
    'item',
    'item listing',
    'package front item',
    'front item',
    'front item used',
    'used front item',
    'used item',
  ].includes(normalized);
}

function dedupeWordsPreserveOrder(parts: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  parts.forEach((part) => {
    const cleaned = part.trim();
    if (!cleaned) return;

    const normalized = normalizeSearchText(cleaned);
    if (!normalized || seen.has(normalized)) return;

    seen.add(normalized);
    result.push(cleaned);
  });

  return result;
}

function dedupeTitleOptions(
  options: string[],
  excludeTitle?: string | null,
): string[] {
  const seen = new Set<string>();
  const excluded = normalizeSearchText(excludeTitle ?? '');
  const result: string[] = [];

  options.forEach((option) => {
    const cleaned = cleanListingTitle(String(option || '').trim(), 80);
    const normalized = normalizeSearchText(cleaned);

    if (!cleaned || !normalized) return;
    if (excluded && normalized === excluded) return;
    if (seen.has(normalized)) return;

    seen.add(normalized);
    result.push(cleaned);
  });

  return result;
}

function normalizeTitleCase(value: string): string {
  return value
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/\bGliss\b/gi, 'GLISS')
    .replace(/\bUpc\b/g, 'UPC');
}

function cleanDetectedTextForListing(value?: string | null): string {
  if (!value) return '';

  const lines = value
    .split(/[\n\r]+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const badTokens = new Set(['dar', 'ha', 'car', 'pkg', 'lbl', 'ocr', 'usa']);

  const cleanedLines = lines
    .map((line) =>
      line
        .split(/\s+/)
        .map((token) => token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ''))
        .filter(Boolean)
        .filter((token) => {
          const normalized = token.toLowerCase();
          if (badTokens.has(normalized)) return false;
          if (/^\d{4,}$/.test(normalized) && normalized.length !== 12)
            return false;
          if (normalized.length <= 2 && !/^\d+$/.test(normalized)) return false;
          return true;
        })
        .join(' ')
        .trim(),
    )
    .filter(Boolean)
    .filter((line) => /[a-z]/i.test(line));

  return dedupeWordsPreserveOrder(cleanedLines).slice(0, 4).join(' · ');
}

function buildListingHighlights(value?: string | null): string[] {
  const cleaned = cleanDetectedTextForListing(value);
  if (!cleaned) return [];

  return dedupeWordsPreserveOrder(
    cleaned
      .split(/ · |,/)
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((part) => !/^\d{4,}$/.test(part)),
  ).slice(0, 4);
}

function finalizePremiumTitle(
  value: string,
  condition?: ListingCondition,
): string {
  const cleaned = cleanListingTitle(value, 80) || 'Item Listing';
  const words = cleaned
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);

  const dedupedWords: string[] = [];
  const seenWords = new Set<string>();

  words.forEach((word) => {
    const normalized = normalizeSearchText(word);
    if (!normalized) return;
    if (seenWords.has(normalized)) return;
    seenWords.add(normalized);
    dedupedWords.push(word);
  });

  let titled = normalizeTitleCase(dedupedWords.join(' '));
  titled = titled
    .replace(/\bRepair Repair\b/gi, 'Repair')
    .replace(/\bConditioner Conditioner\b/gi, 'Conditioner')
    .replace(/\bUsed\b\s*/i, '')
    .replace(/\bNew\b\s*/i, '')
    .replace(/\bOpen Box\b\s*/i, '')
    .replace(/\bFor Parts\b\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (condition === 'New' && titled && !/\bnew\b/i.test(titled)) {
    return cleanListingTitle(`${titled} New`, 80) || titled;
  }

  return titled || 'Item Listing';
}

function buildPremiumFallbackTitle(params: {
  productTitle?: string | null;
  detectedText?: string | null;
  manualHint?: string | null;
  condition?: ListingCondition;
}): string {
  const { productTitle, detectedText, manualHint, condition } = params;

  if (productTitle && !isGenericListingTitle(productTitle)) {
    return finalizePremiumTitle(productTitle, condition);
  }

  const source = `${detectedText ?? ''} ${manualHint ?? ''}`
    .replace(/\s+/g, ' ')
    .trim();

  const preferredPhrases = [
    /schwarzkopf/gi,
    /gliss/gi,
    /ultimate repair/gi,
    /express repair conditioner/gi,
    /repair conditioner/gi,
    /heat protection/gi,
  ];

  const picked: string[] = [];
  preferredPhrases.forEach((pattern) => {
    const match = source.match(pattern);
    if (match?.[0]) picked.push(match[0]);
  });

  const badWords = new Set([
    'the',
    'and',
    'with',
    'for',
    'from',
    'this',
    'that',
    'item',
    'package',
    'packaging',
    'front',
    'used',
    'new',
    'box',
    'dar',
    'ha',
    'car',
    'deep',
    'care',
    'easy',
    'easier',
    'stronger',
    'hair',
    'photo',
    'scan',
  ]);

  const words = source
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9+&-]/gi, ''))
    .filter(Boolean)
    .filter((word) => word.length > 2)
    .filter((word) => !badWords.has(word.toLowerCase()))
    .filter((word) => !/^\d{4,}$/.test(word))
    .slice(0, 10);

  const combined = dedupeWordsPreserveOrder([...picked, ...words]).join(' ');
  return finalizePremiumTitle(combined, condition);
}

function getListingConfidence(product?: BarcodeProduct | null): {
  label: string;
  tone: string;
} {
  switch (product?.confidence) {
    case 'high':
      return { label: 'Strong Match', tone: 'high' };
    case 'medium':
      return { label: 'Likely Match', tone: 'medium' };
    default:
      return { label: 'Possible Match', tone: 'neutral' };
  }
}

function buildPremiumShortDescription(params: {
  title: string;
  condition: ListingCondition;
}): string {
  const { title, condition } = params;
  return `${title}. Pre-filled with List Assist so you can review, tweak, and post faster. Condition: ${condition}.`;
}

function buildPremiumFullDescription(params: {
  title: string;
  condition: ListingCondition;
  detectedText?: string | null;
  manualHint?: string | null;
  source?: string | null;
}): string {
  const { title, condition, detectedText, manualHint } = params;
  const highlights = buildListingHighlights(detectedText);
  const possibleUpc = extractBarcodeFromText(detectedText || manualHint || '');

  const detailLines = [
    `Condition: ${condition}`,
    manualHint ? `Helper words used: ${manualHint}` : '',
    possibleUpc ? `UPC: ${possibleUpc}` : '',
    ...highlights.map((line) => `Package details: ${line}`),
  ].filter(Boolean);

  return [
    `${title}.`,
    '',
    'This listing draft was pre-filled using package-front scanning and smart matching to save time.',
    'Please review title, specifics, included contents, and item condition before posting.',
    '',
    detailLines.join('\n'),
  ]
    .filter(Boolean)
    .join('\n');
}

function enhanceListingDraftForDisplay(params: {
  draft: ListingDraft;
  product: BarcodeProduct | null;
  condition: ListingCondition;
  detectedText?: string | null;
  manualHint?: string | null;
}): ListingDraft {
  const { draft, product, condition } = params;

  const bestTitle = buildBestListingTitle(product, condition);
  const fullDescription = buildBestListingDescription(product, condition);
  const priceSuggestion = getSuggestedPriceRange(product).label;

  return {
    ...draft,
    titleOptions: bestTitle ? [bestTitle] : (draft.titleOptions ?? []),
    shortDescription: '',
    fullDescription,
    keywords: '',
    priceSuggestion,
  };
}

function buildListingDraft(params: {
  platform: ListingPlatform;
  condition: ListingCondition;
  product: BarcodeProduct | null;
  measurements: Measurements;
  isCylinder: boolean;
  packageFrontSearchText: string;
  titleVariantSeed?: number;
}): ListingDraft {
  const {
    platform,
    condition,
    product,
    measurements,
    isCylinder,
    packageFrontSearchText,
    titleVariantSeed = 0,
  } = params;

  const rawBaseName = (product?.title || packageFrontSearchText || 'Item')
    .replace(/\s+/g, ' ')
    .trim();

  const baseName = rawBaseName
    .replace(/\b(retail box|package|packaging)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = tokenizeSearchText(baseName).filter(
    (token) => token.length > 2,
  );
  const keywordTokens = Array.from(new Set(tokens)).slice(0, 12);

  const shortName = baseName
    .replace(/\b(brand new|new|used|open box|for parts)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const safeShortName = shortName || 'Item';
  const conditionText =
    condition === 'For Parts' ? 'for parts or repair' : condition.toLowerCase();
  const dimensionText = buildDimensionsText(measurements, isCylinder);

  const rotateTemplates = <T,>(templates: T[]): T => {
    const safeTemplates = templates.filter(Boolean);
    if (!safeTemplates.length) {
      return templates[0];
    }
    return safeTemplates[Math.abs(titleVariantSeed) % safeTemplates.length];
  };

  const bulletify = (items: string[]) =>
    items
      .filter(Boolean)
      .map((item) => `• ${item}`)
      .join('\n');

  const titleFeatureTokens = keywordTokens
    .filter((token) => !['the', 'and', 'with', 'for'].includes(token))
    .slice(0, 4);

  const pushUniqueTitle = (
    list: string[],
    value: string,
    maxLength: number,
  ) => {
    const cleaned = cleanListingTitle(value, maxLength);
    if (!cleaned) return;

    const normalized = normalizeSearchText(cleaned);
    if (!normalized) return;

    if (!list.some((item) => normalizeSearchText(item) === normalized)) {
      list.push(cleaned);
    }
  };

  const capitalizeWords = (value: string) =>
    value.replace(/\b\w/g, (char) => char.toUpperCase());

  const compactRepeatedSpaces = (value: string) =>
    value
      .replace(/\s+,/g, ',')
      .replace(/,\s*,/g, ', ')
      .replace(/\s+/g, ' ')
      .trim();

  const sanitizeBaseTitle = (value: string) =>
    compactRepeatedSpaces(
      value
        .replace(/\b(used|new|open box|for parts|for repair)\b/gi, '')
        .replace(/\b(retail box|package|packaging)\b/gi, '')
        .trim(),
    );
  const appendTagIfMissing = (list: string[], tag: string, base: string) => {
    const cleanedTag = compactRepeatedSpaces(tag);
    if (!cleanedTag) return;

    if (titleAlreadyContains(base, cleanedTag)) return;

    const normalizedTag = normalizeSearchText(cleanedTag);
    if (!normalizedTag) return;

    if (!list.some((item) => normalizeSearchText(item) === normalizedTag)) {
      list.push(cleanedTag);
    }
  };

  const detectTitleAttributes = () => {
    const sourceText = `${rawBaseName} ${packageFrontSearchText}`;
    const tags: string[] = [];

    const add = (condition: boolean, label: string) => {
      if (condition) appendTagIfMissing(tags, label, safeShortName);
    };

    const gbMatches = sourceText.match(/\b\d+\s?GB\b/gi) ?? [];
    gbMatches.forEach((match) =>
      add(true, match.toUpperCase().replace(/\s+/g, '')),
    );

    add(/\bnvme\b/i.test(sourceText), 'NVMe');
    add(/\bssd\b/i.test(sourceText), 'SSD');
    add(/\bpcie\b/i.test(sourceText), 'PCIe');
    add(/\bhat\+?\b/i.test(sourceText), 'HAT+');
    add(/\bkit\b/i.test(sourceText), 'Kit');
    add(/\bbundle\b/i.test(sourceText), 'Bundle');
    add(/\bmetal case\b/i.test(sourceText), 'Metal Case');
    add(/\bcooling\b|\bfan\b/i.test(sourceText), 'Cooling Fan');
    add(/\bpower supply\b/i.test(sourceText), 'Power Supply');
    add(/\bkeyboard\b/i.test(sourceText), 'Keyboard');
    add(/\bhdmi\b/i.test(sourceText), 'HDMI');
    add(/\bbluetooth\b/i.test(sourceText), 'Bluetooth');
    add(/\bmicro\s?sd\b/i.test(sourceText), 'microSD');

    if (/verilux|happy\s?light|lamp|light therapy/i.test(sourceText)) {
      add(true, 'Light Therapy');
      add(/compact/i.test(sourceText), 'Compact');
      add(/10\s?000|10000|lux/i.test(sourceText), '10000 Lux');
      add(
        /uv\s?-?free/i.test(sourceText) ||
          /verilux|happy\s?light/i.test(sourceText),
        'UV-Free',
      );
    }

    if (/insole|insoles|orthotic/i.test(sourceText)) {
      add(true, 'Orthotic');
      add(true, 'Arch Support');
      const sizeMatch = sourceText.match(/men'?s\s+large|large\s*\(7-13\)/i);
      add(Boolean(sizeMatch), "Men's Large");
    }

    if (/earbud|earbuds|bluetooth/i.test(sourceText)) {
      add(true, 'Bluetooth');
      add(/charging/i.test(sourceText), 'Charging Case');
      add(/wireless/i.test(sourceText), 'Wireless');
    }

    if (/pledge|multisurface|cleaner/i.test(sourceText)) {
      add(/multisurface|multi\s?surface/i.test(sourceText), 'Multisurface');
      add(/rainshower/i.test(sourceText), 'Rainshower');
      add(
        /sc\s?johnson/i.test(sourceText) || /pledge/i.test(sourceText),
        'SC Johnson',
      );
      const ozMatch = sourceText.match(/\b\d+(?:\.\d+)?\s?oz\b/i);
      add(
        Boolean(ozMatch),
        (ozMatch?.[0] ?? '').replace(/\s+/g, ' ').toUpperCase(),
      );
    }

    const modelLikeMatches =
      sourceText.match(/\b[A-Z]{2,}\d+[A-Z0-9-]*\b/g) ?? [];
    modelLikeMatches.slice(0, 2).forEach((match) => add(true, match));

    return tags.slice(0, 10);
  };

  const detectedTitleTags = detectTitleAttributes();

  const buildTitleFromParts = (
    base: string,
    options: {
      leadTags?: string[];
      midTags?: string[];
      endTags?: string[];
      maxLength: number;
    },
  ) => {
    const { leadTags = [], midTags = [], endTags = [], maxLength } = options;
    const parts = [
      sanitizeBaseTitle(base),
      ...leadTags.filter(Boolean),
      ...midTags.filter(Boolean),
      ...endTags.filter(Boolean),
    ]
      .map((part) => compactRepeatedSpaces(part))
      .filter(Boolean);

    return cleanListingTitle(parts.join(' '), maxLength);
  };

  const buildSmartTitleOptions = (
    currentPlatform: ListingPlatform,
    maxLength: number,
  ) => {
    const options: string[] = [];
    const base = sanitizeBaseTitle(safeShortName || 'Item');
    const baseWords = base.split(' ').filter(Boolean);
    const compactBase =
      baseWords.length > 5 ? baseWords.slice(0, 5).join(' ') : base;

    const featureTags = detectedTitleTags.filter(
      (tag) => !titleAlreadyContains(base, tag),
    );
    const seoTags = featureTags.slice(0, 3);
    const supportTags = featureTags.slice(3, 6);

    const fallbackWords = titleFeatureTokens
      .map((token) =>
        token.toUpperCase() === token
          ? token
          : token.replace(/^./, (m) => m.toUpperCase()),
      )
      .filter((token) => !titleAlreadyContains(base, token));

    const shortCondition =
      condition === 'Open Box'
        ? 'Open Box'
        : condition === 'For Parts'
          ? 'For Parts'
          : condition === 'New'
            ? 'New'
            : 'Used';

    const pushVariant = (
      titleBase: string,
      leadTags: string[],
      midTags: string[],
      endTags: string[],
    ) => {
      pushUniqueTitle(
        options,
        buildTitleFromParts(titleBase, {
          leadTags,
          midTags,
          endTags,
          maxLength,
        }),
        maxLength,
      );
    };

    if (currentPlatform === 'amazon') {
      pushVariant(base, seoTags, supportTags.slice(0, 1), [shortCondition]);
      pushVariant(base, seoTags.slice(0, 2), [], [shortCondition]);
      pushVariant(compactBase, seoTags.slice(0, 2), [], [shortCondition]);
      pushVariant(base, fallbackWords.slice(0, 2), seoTags.slice(0, 1), [
        shortCondition,
      ]);
    } else if (currentPlatform === 'ebay') {
      pushVariant(base, seoTags, supportTags.slice(0, 2), [shortCondition]);
      pushVariant(base, seoTags, [], []);
      pushVariant(compactBase, seoTags, [], [shortCondition]);
      pushVariant(base, fallbackWords.slice(0, 3), seoTags.slice(0, 1), [
        shortCondition,
      ]);
    } else if (currentPlatform === 'facebook') {
      pushVariant(compactBase, seoTags.slice(0, 1), [], [shortCondition]);
      pushVariant(base, seoTags.slice(0, 1), [], []);
      pushVariant(compactBase, supportTags.slice(0, 1), [], [shortCondition]);
      pushVariant(base, [], [], [shortCondition]);
    } else {
      pushVariant(compactBase, seoTags.slice(0, 1), [], [shortCondition]);
      pushVariant(compactBase, supportTags.slice(0, 1), [], [shortCondition]);
      pushVariant(base, [], [], [shortCondition]);
      pushVariant(compactBase, fallbackWords.slice(0, 1), [], [shortCondition]);
    }

    pushUniqueTitle(options, `${base} ${shortCondition}`, maxLength);
    pushUniqueTitle(options, base, maxLength);

    return options.slice(0, 4);
  };

  const conditionBullets =
    condition === 'New'
      ? [
          'New item condition unless otherwise noted.',
          'Please review all photos for exact packaging and presentation details.',
        ]
      : condition === 'Open Box'
        ? [
            'Open-box condition.',
            'Packaging may show light shelf wear or handling.',
            'Please review photos for exact contents and cosmetic details.',
          ]
        : condition === 'For Parts'
          ? [
              'Sold for parts or repair.',
              'Functionality may be limited, incomplete, or untested.',
              'Please review photos and item details carefully before purchase.',
            ]
          : [
              'Pre-owned condition with normal signs of handling or use possible.',
              'Please review photos for exact cosmetic condition and included contents.',
            ];

  const buildSection = (heading: string, items: string[]) => {
    const body = bulletify(items);
    if (!body) return '';
    return [heading, body].join('\n');
  };

  const introLine = (() => {
    switch (platform) {
      case 'ebay':
        return `${safeShortName} in ${conditionText} condition. Please review photos for exact condition details and everything included.`;
      case 'facebook':
        return `${safeShortName} in ${conditionText} condition. Please review the photos for the exact item and included contents.`;
      case 'amazon':
        return `${safeShortName} in ${conditionText} condition. Please review photos for exact condition, contents, and presentation.`;
      default:
        return `${safeShortName} in ${conditionText} condition. Please review photos for exact condition details and included contents.`;
    }
  })();

  const whatsIncluded = [
    'Item shown in the photos.',
    'Original box or packaging only if pictured.',
    'Only the contents shown are included unless otherwise stated.',
  ];

  const importantNotes = [
    'Please review all photos carefully for exact condition, contents, and overall presentation.',
    'Any visible wear, storage marks, sticker residue, or box wear should be judged from the photos.',
    platform === 'facebook'
      ? 'Message with any questions or to arrange pickup.'
      : 'Packed carefully and shipped securely.',
  ];

  const whatYouNeed = [
    condition === 'For Parts'
      ? 'Additional testing, parts, repair, or troubleshooting may be needed before regular use.'
      : '',
  ];

  let titleOptions: string[] = [];
  let shortDescription = '';
  let fullDescription = '';

  if (platform === 'ebay') {
    titleOptions = buildSmartTitleOptions('ebay', 80);

    shortDescription = rotateTemplates<string>([
      `${condition} ${safeShortName} with stronger eBay-style wording, useful bullets, and buyer-friendly condition details.`,
      `${safeShortName} in ${conditionText} condition with a more complete eBay-ready description.`,
      `${condition} ${safeShortName} listing copy with richer bullet points and more helpful selling details.`,
      `${safeShortName} in ${conditionText} condition with polished eBay-style listing text ready to refine.`,
    ])
      .replace(/\s+/g, ' ')
      .trim();

    fullDescription = [
      introLine,
      '',
      '⸻',
      '',
      buildSection('What’s Included:', whatsIncluded),
      '',
      '⸻',
      '',
      buildSection('Condition:', conditionBullets),
      '',
      '⸻',
      '',
      buildSection('Important Notes:', importantNotes),
      ...(whatYouNeed.filter(Boolean).length
        ? ['', '⸻', '', buildSection('What You Need:', whatYouNeed)]
        : []),
    ]
      .filter(Boolean)
      .join('\n')
      .trim();
  } else if (platform === 'facebook') {
    titleOptions = buildSmartTitleOptions('facebook', 65);

    shortDescription = rotateTemplates<string>([
      `${safeShortName} in ${conditionText} condition with cleaner local-sale wording and better details.`,
      `${safeShortName} for local sale with a stronger, easier-to-scan Marketplace description.`,
      `${condition} ${safeShortName} with more useful local listing copy ready to post.`,
      `${safeShortName} available now with fuller Facebook Marketplace wording.`,
    ])
      .replace(/\s+/g, ' ')
      .trim();

    fullDescription = [
      introLine,
      '',
      '⸻',
      '',
      buildSection('What’s Included:', whatsIncluded),
      '',
      '⸻',
      '',
      buildSection('Condition:', conditionBullets),
      '',
      '⸻',
      '',
      buildSection('Important Notes:', importantNotes),
    ]
      .filter(Boolean)
      .join('\n')
      .trim();
  } else if (platform === 'amazon') {
    titleOptions = buildSmartTitleOptions('amazon', 120);

    shortDescription = rotateTemplates<string>([
      `${safeShortName}. More complete product-style listing text with stronger structure.`,
      `${safeShortName}. Catalog-style copy with clearer feature and condition details.`,
      `${safeShortName}. More useful product-style short copy.`,
      `${safeShortName}. Better structured marketplace listing text for a product page.`,
    ])
      .replace(/\s+/g, ' ')
      .trim();

    fullDescription = [
      introLine,
      '',
      '⸻',
      '',
      buildSection('What’s Included:', whatsIncluded),
      '',
      '⸻',
      '',
      buildSection('Condition:', conditionBullets),
      '',
      '⸻',
      '',
      buildSection('Important Notes:', importantNotes),
    ]
      .filter(Boolean)
      .join('\n')
      .trim();
  } else {
    titleOptions = buildSmartTitleOptions('generic', 80);

    shortDescription = rotateTemplates<string>([
      `${condition} ${safeShortName} with a more complete all-purpose description and better bullet points.`,
      `${safeShortName} in ${conditionText} condition with stronger general listing copy ready to edit.`,
      `${condition} ${safeShortName} with more useful marketplace wording.`,
      `${safeShortName} listing draft with better structure for general marketplaces.`,
    ])
      .replace(/\s+/g, ' ')
      .trim();

    fullDescription = [
      introLine,
      '',
      '⸻',
      '',
      buildSection('What’s Included:', whatsIncluded),
      '',
      '⸻',
      '',
      buildSection('Condition:', conditionBullets),
      '',
      '⸻',
      '',
      buildSection('Important Notes:', importantNotes),
      ...(whatYouNeed.filter(Boolean).length
        ? ['', '⸻', '', buildSection('What You Need:', whatYouNeed)]
        : []),
    ]
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  const keywords = Array.from(
    new Set(
      [
        safeShortName,
        ...keywordTokens,
        condition,
        product?.barcode || '',
        dimensionText || '',
        platform === 'ebay' ? 'fast shipping' : '',
        platform === 'facebook' ? 'local pickup' : '',
        platform === 'amazon' ? 'product listing' : '',
      ]
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ).join(', ');

  return {
    titleOptions: Array.from(new Set(titleOptions.filter(Boolean))),
    shortDescription,
    fullDescription,
    keywords,
  };
}

const REFERENCE_OPTIONS: ReferenceConfig[] = [
  {
    key: 'quarter',
    label: 'Quarter',
    realWidthInches: 0.955,
    shape: 'circle',
    helperText: 'Tap roughly on the quarter in the image.',
    measurementLabel: 'diameter',
  },
  {
    key: 'sodaCanTop',
    label: 'Soda Can Top',
    realWidthInches: 2.6,
    shape: 'circle',
    helperText: 'Tap roughly on the soda can top in the image.',
    measurementLabel: 'diameter',
  },
  {
    key: 'dollarBill',
    label: 'Dollar Bill',
    realWidthInches: 6.14,
    shape: 'rectangle',
    helperText: 'Tap roughly on the long edge area of the bill.',
    measurementLabel: 'width',
  },
  {
    key: 'businessCard',
    label: 'Business Card',
    realWidthInches: 3.5,
    shape: 'rectangle',
    helperText: 'Tap roughly on the long edge area of the business card.',
    measurementLabel: 'width',
  },
];

const EMPTY_PHOTO_STATE: PhotoState = {
  uri: null,
  referenceDetection: null,
  pixelsPerInch: null,
  measurementPoints: [],
};

const EMPTY_MEASUREMENTS: Measurements = {
  length: null,
  width: null,
  depth: null,
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PREVIEW_WIDTH = SCREEN_WIDTH - 32;
const PREVIEW_HEIGHT = PREVIEW_WIDTH * 1.2;

// ===== GARAGE SALE PHASE 1: WEATHER TYPES + HELPERS START =====
type SourcingWeather = {
  locationLabel: string;
  latitude: number;
  longitude: number;
  currentTempF: number;
  conditionLabel: string;
  highTempF: number;
  lowTempF: number;
  rainChance: number;
  windMph: number;
  sourcingNote: string;
};

function getWeatherConditionLabel(code: number): string {
  if (code === 0) return 'Clear';
  if ([1, 2].includes(code)) return 'Partly Cloudy';
  if (code === 3) return 'Cloudy';
  if ([45, 48].includes(code)) return 'Fog';
  if ([51, 53, 55, 56, 57].includes(code)) return 'Drizzle';
  if ([61, 63, 65, 66, 67].includes(code)) return 'Rain';
  if ([71, 73, 75, 77].includes(code)) return 'Snow';
  if ([80, 81, 82].includes(code)) return 'Rain Showers';
  if ([85, 86].includes(code)) return 'Snow Showers';
  if ([95, 96, 99].includes(code)) return 'Thunderstorms';
  return 'Today';
}

function getSourcingWeatherNote(params: {
  rainChance: number;
  windMph: number;
  conditionLabel: string;
  highTempF: number;
  lowTempF: number;
}): string {
  const { rainChance, windMph, conditionLabel, highTempF, lowTempF } = params;

  if (/thunder/i.test(conditionLabel))
    return 'Storm risk today. Indoor stops may be the better play.';
  if (rainChance >= 70)
    return 'Strong chance of rain. Bring an umbrella and protect finds.';
  if (rainChance >= 40)
    return 'Rain may pop up. A jacket or umbrella is a good idea.';
  if (windMph >= 20)
    return 'Windy day. Lightweight signs and tables may be a mess.';
  if (highTempF >= 88)
    return 'Hot sourcing day. Water and quick stops will matter.';
  if (lowTempF <= 40) return 'Chilly start. Bring a jacket for early sales.';
  if (/clear|partly cloudy/i.test(conditionLabel))
    return 'Great sourcing weather.';
  return 'Solid day to get out and source.';
}

function getWeatherIcon(condition?: string | null) {
  const c = String(condition || '').toLowerCase();

  if (c.includes('thunder') || c.includes('storm')) return '⛈️';
  if (c.includes('snow') || c.includes('sleet') || c.includes('ice'))
    return '❄️';
  if (c.includes('rain') || c.includes('drizzle') || c.includes('shower'))
    return '🌧️';
  if (
    c.includes('cloud') ||
    c.includes('overcast') ||
    c.includes('fog') ||
    c.includes('mist')
  )
    return '🌥️';
  if (c.includes('clear') || c.includes('sun')) return '☀️';

  return '🌤️';
}

function formatWeatherLocationLabel(
  city?: string | null,
  region?: string | null,
) {
  const parts = [city, region].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Local Weather';
}

function buildMapsSearchUrl(query: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    query,
  )}`;
}

function hasValidCoordinates(
  latitude?: number | null,
  longitude?: number | null,
) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return false;
  }

  return !(
    Math.abs(Number(latitude)) < 0.000001 &&
    Math.abs(Number(longitude)) < 0.000001
  );
}

function parseGarageSaleCoordinate(value: any): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildMapsPinUrl(pin: {
  latitude: number;
  longitude: number;
  title?: string;
  addressLabel?: string;
  mapsQuery?: string;
}) {
  const preferredDestination =
    pin.mapsQuery || pin.addressLabel || pin.title || null;

  if (preferredDestination) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
      preferredDestination,
    )}&travelmode=driving`;
  }

  if (hasValidCoordinates(pin.latitude, pin.longitude)) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
      `${pin.latitude},${pin.longitude}`,
    )}&travelmode=driving`;
  }

  return buildMapsSearchUrl('garage sale');
}

function getMapsStopValue(stop: {
  latitude?: number | null;
  longitude?: number | null;
  query?: string;
  mapsQuery?: string;
  addressLabel?: string;
  title?: string;
}) {
  const preferredLabel =
    stop.mapsQuery || stop.addressLabel || stop.query || stop.title;

  if (preferredLabel) {
    return preferredLabel;
  }

  if (hasValidCoordinates(stop.latitude, stop.longitude)) {
    return `${stop.latitude},${stop.longitude}`;
  }

  return null;
}

function getRouteStopKey(stop: {
  latitude?: number | null;
  longitude?: number | null;
  query?: string;
  mapsQuery?: string;
  addressLabel?: string;
  title?: string;
}) {
  const label = normalizeSearchText(
    stop.mapsQuery || stop.addressLabel || stop.query || stop.title || '',
  );

  if (hasValidCoordinates(stop.latitude, stop.longitude)) {
    return `${Number(stop.latitude).toFixed(4)}:${Number(stop.longitude).toFixed(4)}:${label}`;
  }

  return label;
}

function dedupeRouteStops(
  stops: Array<{
    latitude?: number | null;
    longitude?: number | null;
    query?: string;
    mapsQuery?: string;
    addressLabel?: string;
    title?: string;
  }>,
) {
  const seen = new Set<string>();

  return stops.filter((stop) => {
    const key = getRouteStopKey(stop);
    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function getCoordinateDistance(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
) {
  const latMiles = (aLat - bLat) * 69;
  const lngMiles =
    (aLng - bLng) * Math.cos(((aLat + bLat) / 2) * (Math.PI / 180)) * 69;

  return Math.sqrt(latMiles * latMiles + lngMiles * lngMiles);
}

function sortRouteStopsByNearest(
  stops: Array<{
    latitude?: number | null;
    longitude?: number | null;
    query?: string;
    mapsQuery?: string;
    addressLabel?: string;
    title?: string;
  }>,
  userLatitude?: number | null,
  userLongitude?: number | null,
) {
  const sortable = [...stops].filter((stop) =>
    hasValidCoordinates(stop.latitude, stop.longitude),
  );

  if (sortable.length < 2) {
    return sortable;
  }

  const sorted: typeof sortable = [];
  let currentLat = hasValidCoordinates(userLatitude, userLongitude)
    ? Number(userLatitude)
    : Number(sortable[0].latitude);
  let currentLng = hasValidCoordinates(userLatitude, userLongitude)
    ? Number(userLongitude)
    : Number(sortable[0].longitude);

  while (sortable.length) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    sortable.forEach((stop, index) => {
      const distance = getCoordinateDistance(
        currentLat,
        currentLng,
        Number(stop.latitude),
        Number(stop.longitude),
      );

      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });

    const [nextStop] = sortable.splice(bestIndex, 1);
    sorted.push(nextStop);
    currentLat = Number(nextStop.latitude);
    currentLng = Number(nextStop.longitude);
  }

  return sorted;
}

function buildMultiStopMapsUrl(
  stops: Array<{
    latitude?: number | null;
    longitude?: number | null;
    query?: string;
    mapsQuery?: string;
    addressLabel?: string;
    title?: string;
  }>,
  userLatitude?: number | null,
  userLongitude?: number | null,
) {
  const uniqueStops = dedupeRouteStops(stops);
  const validStops = sortRouteStopsByNearest(
    uniqueStops,
    userLatitude,
    userLongitude,
  );

  if (!validStops.length) {
    const fallback = uniqueStops[0] || stops[0];
    if (!fallback) return null;

    return buildMapsSearchUrl(
      fallback.mapsQuery ||
        fallback.addressLabel ||
        fallback.query ||
        fallback.title ||
        'garage sale',
    );
  }

  if (validStops.length === 1) {
    return buildMapsPinUrl(
      validStops[0] as {
        latitude: number;
        longitude: number;
        title?: string;
        addressLabel?: string;
        mapsQuery?: string;
      },
    );
  }

  const origin = hasValidCoordinates(userLatitude, userLongitude)
    ? `${userLatitude},${userLongitude}`
    : `${validStops[0].latitude},${validStops[0].longitude}`;

  const routeStops = hasValidCoordinates(userLatitude, userLongitude)
    ? validStops
    : validStops.slice(1);

  const destination = routeStops.length
    ? routeStops[routeStops.length - 1]
    : validStops[validStops.length - 1];

  if (
    !destination ||
    !hasValidCoordinates(destination.latitude, destination.longitude)
  ) {
    return null;
  }

  const destinationValue = `${destination.latitude},${destination.longitude}`;

  const waypoints = routeStops
    .slice(0, -1)
    .filter((stop) => hasValidCoordinates(stop.latitude, stop.longitude))
    .map((stop) => `${stop.latitude},${stop.longitude}`)
    .join('|');

  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(
    origin,
  )}&destination=${encodeURIComponent(destinationValue)}&travelmode=driving${
    waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : ''
  }`;
}

function buildGarageSaleMapsUrl(params: {
  selectedPin?: GarageSaleMapPin | null;
  routeStops?: Array<{
    latitude?: number | null;
    longitude?: number | null;
    query?: string;
    mapsQuery?: string;
    addressLabel?: string;
    title?: string;
  }>;
  userLatitude?: number | null;
  userLongitude?: number | null;
}) {
  const { selectedPin, routeStops = [], userLatitude, userLongitude } = params;

  if (selectedPin) {
    return buildMapsPinUrl(selectedPin);
  }

  return buildMultiStopMapsUrl(routeStops, userLatitude, userLongitude);
}

function calculateRouteDistanceMiles(
  stops: Array<{ latitude?: number | null; longitude?: number | null }>,
  userLatitude?: number | null,
  userLongitude?: number | null,
) {
  const points: Array<{ latitude: number; longitude: number }> = [];

  if (hasValidCoordinates(userLatitude, userLongitude)) {
    points.push({
      latitude: Number(userLatitude),
      longitude: Number(userLongitude),
    });
  }

  stops.forEach((stop) => {
    if (hasValidCoordinates(stop.latitude, stop.longitude)) {
      points.push({
        latitude: Number(stop.latitude),
        longitude: Number(stop.longitude),
      });
    }
  });

  if (points.length < 2) return 0;

  const toRadians = (value: number) => (value * Math.PI) / 180;
  let totalMiles = 0;

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const earthRadiusMiles = 3958.8;
    const dLat = toRadians(end.latitude - start.latitude);
    const dLng = toRadians(end.longitude - start.longitude);
    const lat1 = toRadians(start.latitude);
    const lat2 = toRadians(end.latitude);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    totalMiles += earthRadiusMiles * c;
  }

  return round2(totalMiles);
}

function estimateRouteDriveMinutes(distanceMiles: number) {
  if (!distanceMiles || distanceMiles <= 0) return 0;
  return Math.max(1, Math.round((distanceMiles / 22) * 60));
}

function formatRouteStopTitle(stop: {
  title?: string;
  addressLabel?: string;
  mapsQuery?: string;
  query?: string;
}) {
  return (
    stop.title ||
    stop.addressLabel ||
    stop.mapsQuery ||
    stop.query ||
    'Route stop'
  );
}

function buildGarageSaleMapPins(
  locationLabel: string,
  latitude?: number | null,
  longitude?: number | null,
  savedStops: GarageSaleFavorite[] = [],
): GarageSaleMapPin[] {
  const savedPins: GarageSaleMapPin[] = savedStops
    .slice()
    .sort((a, b) => b.savedAt - a.savedAt)
    .filter(
      (stop) =>
        Number.isFinite(stop.latitude as number) &&
        Number.isFinite(stop.longitude as number),
    )
    .slice(0, 6)
    .map((stop) => ({
      id: `saved-${stop.id}`,
      title: stop.title,
      subtitle: stop.subtitle,
      query: stop.query,
      mapsQuery: stop.mapsQuery,
      latitude: Number(stop.latitude),
      longitude: Number(stop.longitude),
      addressLabel: stop.addressLabel || stop.mapsQuery || stop.title,
      timeLabel: stop.timeLabel || 'Saved target',
      notes:
        stop.notes ||
        'One of your saved garage-sale targets. Tap Add to Route to reopen it fast.',
      saleType: stop.saleType || 'garage',
      pinColor: '#2DBE60',
      craigslistUrl: stop.craigslistUrl,
      dayLabel: stop.dayLabel,
      distanceLabel: stop.distanceLabel,
    }));

  return savedPins;
}
// ===== GARAGE SALE PHASE 1: WEATHER TYPES + HELPERS END =====

export default function HomeScreen() {
  const { homeReset } = useLocalSearchParams<{ homeReset?: string }>();

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const activeScrollRef = useRef<ScrollView | null>(null);
  const garageSaleCardLayoutsRef = useRef<Record<string, number>>({});
  const garageSalesMapRef = useRef<MapView | null>(null);
  const barcodeUnlockTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const packageFrontLookupTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const packageFrontLookupRequestIdRef = useRef(0);
  useEffect(() => {
    activeScrollRef.current?.scrollTo?.({ y: 0, animated: false });
    requestAnimationFrame(() => {
      activeScrollRef.current?.scrollTo?.({ y: 0, animated: false });
      setTimeout(() => {
        activeScrollRef.current?.scrollTo?.({ y: 0, animated: false });
      }, 0);
    });
  }, [step]);

  const lastBarcodeLookupAtRef = useRef(0);
  const lastBarcodeValueRef = useRef<string | null>(null);
  const barcode429UntilRef = useRef(0);
  const scaleAnimBarcode = useRef(new Animated.Value(1)).current;
  const scaleAnimBox = useRef(new Animated.Value(1)).current;
  const scaleAnimItem = useRef(new Animated.Value(1)).current;
  const scrollToTop = () => {
    requestAnimationFrame(() => {
      activeScrollRef.current?.scrollTo({ y: 0, animated: true });
    });
  };

  const scrollGarageSaleCardToTop = (
    saleId: string,
    attempt = 0,
    animated = true,
  ) => {
    const layoutY = garageSaleCardLayoutsRef.current[saleId];

    if (Number.isFinite(layoutY)) {
      requestAnimationFrame(() => {
        activeScrollRef.current?.scrollTo({
          y: Math.max(Number(layoutY) - 12, 0),
          animated,
        });
      });
      return;
    }

    if (attempt >= 12) return;

    setTimeout(() => {
      scrollGarageSaleCardToTop(saleId, attempt + 1, animated);
    }, 80);
  };

  const [facing, setFacing] = useState<CameraType>('back');
  const [step, setStep] = useState<AppStep>('referencePicker');
  const [homeMode, setHomeMode] = useState<HomeMode>('boxFinder');
  const [homeScanMode, setHomeScanMode] = useState<HomeScanMode>('list');
  const [weatherData, setWeatherData] = useState<SourcingWeather | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [sourcingLocationLabel, setSourcingLocationLabel] =
    useState('your area');

  const [selectedReference, setSelectedReference] =
    useState<ReferenceConfig | null>(null);
  const [isCylinder, setIsCylinder] = useState(false);

  const [photo1, setPhoto1] = useState<PhotoState>(EMPTY_PHOTO_STATE);
  const [photo2, setPhoto2] = useState<PhotoState>(EMPTY_PHOTO_STATE);

  const [activePhotoKey, setActivePhotoKey] = useState<PhotoKey>('photo1');
  const [activeMeasurementKey, setActiveMeasurementKey] =
    useState<MeasurementKey>('length');

  const [measurements, setMeasurements] =
    useState<Measurements>(EMPTY_MEASUREMENTS);
  const [selectedFitModeKey, setSelectedFitModeKey] = useState('closest');
  const [titleVariantSeed, setTitleVariantSeed] = useState(0);
  const [barcodeProduct, setBarcodeProduct] = useState<BarcodeProduct | null>(
    null,
  );
  const [pendingBarcodeLinkProduct, setPendingBarcodeLinkProduct] =
    useState<BarcodeProduct | null>(null);
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);
  const [isBarcodeLookupLoading, setIsBarcodeLookupLoading] = useState(false);
  const [barcodeScanEnabled, setBarcodeScanEnabled] = useState(true);
  const [packageFrontPhotoUri, setPackageFrontPhotoUri] = useState<
    string | null
  >(null);
  const [packageFrontSearchText, setPackageFrontSearchText] = useState('');
  const [packageFrontDetectedText, setPackageFrontDetectedText] = useState('');
  const [packageFrontLookupNote, setPackageFrontLookupNote] = useState<
    string | null
  >(null);
  const [packageFrontCandidateProduct, setPackageFrontCandidateProduct] =
    useState<BarcodeProduct | null>(null);
  const [isPackageFrontLookupLoading, setIsPackageFrontLookupLoading] =
    useState(false);
  const [looseItemPhotoUri, setLooseItemPhotoUri] = useState<string | null>(
    null,
  );
  const [looseItemSearchText, setLooseItemSearchText] = useState('');
  const [looseItemLookupNote, setLooseItemLookupNote] = useState<string | null>(
    null,
  );
  const [looseItemMatches, setLooseItemMatches] = useState<EbaySearchItem[]>(
    [],
  );
  const [looseItemSelectedMatch, setLooseItemSelectedMatch] =
    useState<EbaySearchItem | null>(null);
  const [isLooseItemLookupLoading, setIsLooseItemLookupLoading] =
    useState(false);
  const [barcodeFailureState, setBarcodeFailureState] = useState<{
    title: string;
    message: string;
  } | null>(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState('');
  const [userError, setUserError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [visualFeedback, setVisualFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  const [listingPlatform, setListingPlatform] =
    useState<ListingPlatform>('ebay');
  const [listingCondition, setListingCondition] =
    useState<ListingCondition>('Used');
  const [listingDraft, setListingDraft] = useState<ListingDraft | null>(null);
  const [priceCheckerReturnStep, setPriceCheckerReturnStep] =
    useState<AppStep>('referencePicker');
  const [isPriceCheckerSession, setIsPriceCheckerSession] = useState(false);
  const [savedListingDrafts, setSavedListingDrafts] = useState<
    SavedListingDraft[]
  >([]);
  const [savedGarageSales, setSavedGarageSales] = useState<
    GarageSaleFavorite[]
  >([]);
  const [selectedGarageSalePinId, setSelectedGarageSalePinId] = useState<
    string | null
  >(null);
  const [garageSalesMapLatitudeDelta, setGarageSalesMapLatitudeDelta] =
    useState(0.2);
  const [hasAutoFittedGarageSalesMap, setHasAutoFittedGarageSalesMap] =
    useState(false);
  const [isGarageSalesMapReady, setIsGarageSalesMapReady] = useState(false);
  const [garageSalePins, setGarageSalePins] = useState<GarageSaleMapPin[]>([]);
  const estateSalesRadiusCacheRef = useRef<{
    cacheKey: string;
    fetchedRadiusMiles: number;
    timestamp: number;
    pins: GarageSaleMapPin[];
  } | null>(null);
  const garageSalesFetchRunRef = useRef(0);
  const [garageSalesRefreshTick, setGarageSalesRefreshTick] = useState(0);
  const [garageSalesLoading, setGarageSalesLoading] = useState(false);
  const [garageSalesShowingPreview, setGarageSalesShowingPreview] =
    useState(false);
  const [garageSalesLoadingMessage, setGarageSalesLoadingMessage] = useState(
    'Pulling the latest nearby results.',
  );
  const [garageSalesShowSlowPulse, setGarageSalesShowSlowPulse] =
    useState(false);
  const garageSalesLoadingPulseAnim = useRef(new Animated.Value(1)).current;
  const [garageSalesError, setGarageSalesError] = useState<string | null>(null);
  const [garageFinderMode, setGarageFinderMode] = useState<FinderMode>('sales');
  const [garageSaleRadiusMiles, setGarageSaleRadiusMiles] =
    useState<GarageSaleRadiusMiles>(5);
  const [garageSaleDayFilter, setGarageSaleDayFilter] =
    useState<GarageSaleDayFilter>(getTodayDayFilter());
  const [visibleGarageSalesCount, setVisibleGarageSalesCount] = useState(10);
  const [showGarageMapLegendInfo, setShowGarageMapLegendInfo] = useState(false);
  const [isGarageSalesMapHidden, setIsGarageSalesMapHidden] = useState(false);
  const [pricingLowInput, setPricingLowInput] = useState('');
  const [pricingHighInput, setPricingHighInput] = useState('');
  const [sellingPriceInput, setSellingPriceInput] = useState('');
  const [buyCostInput, setBuyCostInput] = useState('');
  const [ebayResults, setEbayResults] = useState<EbaySearchItem[]>([]);
  const [ebayExactResults, setEbayExactResults] = useState<EbaySearchItem[]>(
    [],
  );
  const [ebaySimilarResults, setEbaySimilarResults] = useState<
    EbaySearchItem[]
  >([]);
  const [ebayLoading, setEbayLoading] = useState(false);
  const [ebayError, setEbayError] = useState<string | null>(null);
  const [ebayQueryLabel, setEbayQueryLabel] = useState('');
  const [ebayBroaderQueryLabel, setEbayBroaderQueryLabel] = useState('');

  const lastHandledHomeResetRef = useRef<string | undefined>(undefined);

  const resetToMainHome = async (withHaptic = false) => {
    if (withHaptic) {
      await triggerTickHaptic();
    }

    setHomeMode('boxFinder');
    setGarageFinderMode('sales');
    setGarageSaleRadiusMiles(5);
    setGarageSaleDayFilter(getTodayDayFilter());
    setSelectedGarageSalePinId(null);
    setVisibleGarageSalesCount(10);
    setShowGarageMapLegendInfo(false);
    setIsGarageSalesMapHidden(false);
    setGarageSalesError(null);
    setGarageSalesShowingPreview(false);
    setGarageSalesRefreshTick((current) => current + 1);
    setSelectedReference(null);
    setIsCylinder(false);
    setPhoto1(EMPTY_PHOTO_STATE);
    setPhoto2(EMPTY_PHOTO_STATE);
    setMeasurements(EMPTY_MEASUREMENTS);
    setSelectedFitModeKey('closest');
    setBarcodeProduct(null);
    setPendingBarcodeLinkProduct(null);
    resetBarcodeScannerState();
    setUserError('');
    resetPackageFrontLookup();
    resetLooseItemLookup();
    setActivePhotoKey('photo1');
    setActiveMeasurementKey('length');
    setIsPriceCheckerSession(false);
    setStep('referencePicker');

    requestAnimationFrame(() => {
      activeScrollRef.current?.scrollTo({ y: 0, animated: false });
    });
  };

  useEffect(() => {
    if (!homeReset || lastHandledHomeResetRef.current === homeReset) {
      return;
    }

    lastHandledHomeResetRef.current = homeReset;
    void resetToMainHome(false);
  }, [homeReset]);

  const getPostLookupStep = () => {
    if (isPriceCheckerSession) {
      return 'priceCheckerResult';
    }

    return homeMode === 'dealFinder' ? 'compCheck' : 'listingBuilder';
  };

  useEffect(() => {
    if (!garageSalesLoading) {
      setGarageSalesLoadingMessage(
        garageFinderMode === 'thrift'
          ? 'Finding nearby thrift stores.'
          : 'Pulling the latest nearby results.',
      );
      return;
    }

    const loadingMessages =
      garageFinderMode === 'thrift'
        ? [
            'Finding nearby thrift stores.',
            'Checking the current area and sorting the closest stores first.',
            'Still working. Nearby stores will pop in as soon as the refresh finishes.',
          ]
        : garageSalesShowingPreview
          ? [
              'Showing saved pins while live estate sale results refresh in the background.',
              'Refreshing the latest estate sale pages and sorting the nearest matches first.',
              'Still working. Fresh results are taking a few more seconds than usual.',
            ]
          : [
              'Pulling the latest estate sale pins from your local backend feed.',
              'Checking radius, day, and distance so the closest live matches show first.',
              'Still working. This can take several seconds when the live sale feed is busy.',
            ];

    let messageIndex = 0;
    setGarageSalesLoadingMessage(loadingMessages[0]);

    const interval = setInterval(() => {
      messageIndex = Math.min(messageIndex + 1, loadingMessages.length - 1);
      setGarageSalesLoadingMessage(loadingMessages[messageIndex]);
    }, 2500);

    return () => clearInterval(interval);
  }, [
    garageFinderMode,
    garageSalesLoading,
    garageSalesShowingPreview,
    garageSaleRadiusMiles,
    garageSaleDayFilter,
  ]);

  useEffect(() => {
    if (!garageSalesLoading) {
      setGarageSalesShowSlowPulse(false);
      return;
    }

    setGarageSalesShowSlowPulse(false);
    const timeout = setTimeout(() => {
      setGarageSalesShowSlowPulse(true);
    }, 3000);

    return () => clearTimeout(timeout);
  }, [garageSalesLoading]);

  useEffect(() => {
    garageSalesLoadingPulseAnim.stopAnimation();
    garageSalesLoadingPulseAnim.setValue(1);

    if (!garageSalesLoading || !garageSalesShowSlowPulse) {
      return;
    }

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(garageSalesLoadingPulseAnim, {
          toValue: 0.82,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(garageSalesLoadingPulseAnim, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
      ]),
    );

    pulseLoop.start();

    return () => {
      pulseLoop.stop();
      garageSalesLoadingPulseAnim.stopAnimation();
      garageSalesLoadingPulseAnim.setValue(1);
    };
  }, [
    garageSalesLoading,
    garageSalesShowSlowPulse,
    garageSalesLoadingPulseAnim,
  ]);

  // ===== GARAGE SALE PHASE 1: WEATHER FETCH START =====
  const fetchSourcingLocationLabel = async () => {
    try {
      const permissionResult =
        await Location.requestForegroundPermissionsAsync();
      if (permissionResult.status !== 'granted') {
        setSourcingLocationLabel('your area');
        return;
      }

      const position = await Location.getCurrentPositionAsync({});
      const reverse = await Location.reverseGeocodeAsync({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      const place = reverse?.[0];
      const nextLocationLabel =
        formatWeatherLocationLabel(place?.city, place?.region) || 'your area';

      setSourcingLocationLabel(nextLocationLabel);
    } catch (error) {
      console.log('Failed to fetch sourcing location label', error);
      setSourcingLocationLabel('your area');
    }
  };

  const fetchSourcingWeather = async () => {
    try {
      setWeatherLoading(true);
      setWeatherError(null);

      const permissionResult =
        await Location.requestForegroundPermissionsAsync();
      if (permissionResult.status !== 'granted') {
        setWeatherData(null);
        setWeatherError('Location permission is needed to show local weather.');
        return;
      }

      const position = await Location.getCurrentPositionAsync({});
      const reverse = await Location.reverseGeocodeAsync({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      const place = reverse?.[0];
      const locationLabel = formatWeatherLocationLabel(
        place?.city,
        place?.region,
      );
      setSourcingLocationLabel(locationLabel || 'your area');

      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${position.coords.latitude}&longitude=${position.coords.longitude}&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto`;
      const response = await fetch(weatherUrl, {
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(
          `Weather request failed with status ${response.status}`,
        );
      }

      const payload = await response.json();
      const current = payload?.current;
      const daily = payload?.daily;

      const conditionLabel = getWeatherConditionLabel(
        Number(current?.weather_code ?? 0),
      );
      const highTempF = Math.round(
        Number(daily?.temperature_2m_max?.[0] ?? current?.temperature_2m ?? 0),
      );
      const lowTempF = Math.round(
        Number(daily?.temperature_2m_min?.[0] ?? current?.temperature_2m ?? 0),
      );
      const rainChance = Math.round(
        Number(daily?.precipitation_probability_max?.[0] ?? 0),
      );
      const windMph = Math.round(Number(current?.wind_speed_10m ?? 0));

      setWeatherData({
        locationLabel,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        currentTempF: Math.round(Number(current?.temperature_2m ?? 0)),
        conditionLabel,
        highTempF,
        lowTempF,
        rainChance,
        windMph,
        sourcingNote: getSourcingWeatherNote({
          rainChance,
          windMph,
          conditionLabel,
          highTempF,
          lowTempF,
        }),
      });
    } catch (error) {
      console.error('Weather load failed:', error);
      setWeatherData(null);
      setWeatherError('Could not load weather right now.');
    } finally {
      setWeatherLoading(false);
    }
  };

  // ===== GARAGE SALE PHASE 1: WEATHER FETCH END =====

  useEffect(() => {
    if (
      [
        'referencePicker',
        'garageSaleLanding',
        'estateSaleLanding',
        'garageSales',
        'garageSalesMap',
        'routeSummary',
      ].includes(step)
    ) {
      if (sourcingLocationLabel === 'your area') {
        void fetchSourcingLocationLabel();
      }

      if (!weatherData && !weatherLoading) {
        void fetchSourcingWeather();
      }
    }
  }, [step, weatherData, weatherLoading, sourcingLocationLabel]);

  useEffect(() => {
    if (!permission) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  useEffect(() => {
    const loadSavedGarageSales = async () => {
      try {
        const raw = await AsyncStorage.getItem(
          GARAGE_SALE_FAVORITES_STORAGE_KEY,
        );
        if (!raw) return;

        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setSavedGarageSales(parsed);
        }
      } catch (error) {
        console.log('Failed to load saved garage sale favorites', error);
      }
    };

    void loadSavedGarageSales();
  }, []);

  const toggleSavedGarageSale = async (card: {
    id: string;
    title: string;
    subtitle: string;
    query: string;
    latitude?: number;
    longitude?: number;
    mapsQuery?: string;
    addressLabel?: string;
    saleType?: 'garage' | 'estate' | 'thrift';
    craigslistUrl?: string;
    dayLabel?: string;
    timeLabel?: string;
    notes?: string;
    distanceLabel?: string;
    phone?: string;
    website?: string;
    source?: string;
    openingHours?: string;
  }) => {
    try {
      const exists = savedGarageSales.some((item) => item.id === card.id);
      const next = exists
        ? savedGarageSales.filter((item) => item.id !== card.id)
        : [
            {
              id: card.id,
              title: card.title,
              subtitle: card.subtitle,
              query: card.query,
              savedAt: Date.now(),
              latitude: card.latitude,
              longitude: card.longitude,
              mapsQuery: card.mapsQuery,
              addressLabel: card.addressLabel,
              saleType: card.saleType,
              craigslistUrl: card.craigslistUrl,
              dayLabel: card.dayLabel,
              timeLabel: card.timeLabel,
              notes: card.notes,
              distanceLabel: card.distanceLabel,
              phone: card.phone,
              website: card.website,
              source: card.source,
              openingHours: card.openingHours,
            },
            ...savedGarageSales,
          ].slice(0, 20);

      setSavedGarageSales(next);
      await AsyncStorage.setItem(
        GARAGE_SALE_FAVORITES_STORAGE_KEY,
        JSON.stringify(next),
      );

      showVisualFeedback(
        'success',
        exists
          ? `${getFinderSavedItemLabel(garageFinderMode)} is showing again`
          : `${getFinderSavedItemLabel(garageFinderMode)} hidden from this list`,
        1400,
      );
    } catch (error) {
      console.log('Failed to toggle garage sale favorite', error);
      showVisualFeedback(
        'error',
        `Could not hide that ${getFinderSavedItemLabel(garageFinderMode).toLowerCase()} right now`,
        1400,
      );
    }
  };

  const clearAllRouteStops = () => {
    Alert.alert(
      'Start fresh?',
      garageFinderMode === 'thrift'
        ? 'This will bring back every hidden thrift store and reload the current radius results.'
        : 'This will bring back every hidden sale and reload the current radius results.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start Fresh',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                garageSalesFetchRunRef.current += 1;
                setGarageSalesLoading(true);
                setGarageSalesShowingPreview(false);
                setGarageSalesError(null);
                setGarageSalesLoadingMessage(
                  garageFinderMode === 'thrift'
                    ? `Refreshing thrift stores within ${garageSaleRadiusMiles} miles...`
                    : `Refreshing ${getGarageSaleDayFilterLabel(
                        garageSaleDayFilter,
                      )} sales within ${garageSaleRadiusMiles} miles...`,
                );
                setSavedGarageSales([]);
                setSelectedGarageSalePinId(null);
                setGarageSalePins([]);
                setVisibleGarageSalesCount(0);
                estateSalesRadiusCacheRef.current = null;
                await AsyncStorage.setItem(
                  GARAGE_SALE_FAVORITES_STORAGE_KEY,
                  JSON.stringify([]),
                );
                setGarageSalesRefreshTick((current) => current + 1);
                await fetchGarageSales({ forceRefresh: true });
                showVisualFeedback(
                  'success',
                  garageFinderMode === 'thrift'
                    ? 'Hidden thrift stores cleared. Fresh matches loaded.'
                    : 'Hidden sales cleared. Fresh matches loaded.',
                  1600,
                );
              } catch (error) {
                console.log('Failed to clear hidden garage sales', error);
                showVisualFeedback(
                  'error',
                  'Could not refresh sales right now',
                  1400,
                );
              }
            })();
          },
        },
      ],
    );
  };

  const fetchGarageSales = async (options?: { forceRefresh?: boolean }) => {
    const forceRefresh = Boolean(options?.forceRefresh);
    const fetchRunId = ++garageSalesFetchRunRef.current;

    const commitGarageSalePins = (pins: GarageSaleMapPin[]) => {
      if (garageSalesFetchRunRef.current !== fetchRunId) return;

      setGarageSalePins(pins);
      setVisibleGarageSalesCount(pins.length ? Math.max(10, pins.length) : 0);

      if (pins.length) {
        setSelectedGarageSalePinId((current) =>
          current && pins.some((pin) => pin.id === current)
            ? current
            : pins[0].id,
        );
      } else {
        setSelectedGarageSalePinId(null);
      }
    };

    const applyGarageSalePins = (
      pins: GarageSaleMapPin[],
      options?: { progressive?: boolean },
    ) => {
      const progressive =
        Boolean(options?.progressive) &&
        garageFinderMode !== 'thrift' &&
        pins.length > 3;

      if (!progressive) {
        commitGarageSalePins(pins);
        return;
      }

      const revealCounts = [Math.min(3, pins.length)];
      if (pins.length > 3) revealCounts.push(Math.min(6, pins.length));
      if (pins.length > 6) revealCounts.push(Math.min(10, pins.length));
      if (pins.length > 10) revealCounts.push(pins.length);

      commitGarageSalePins(pins.slice(0, revealCounts[0]));

      revealCounts.slice(1).forEach((count, index) => {
        setTimeout(
          () => {
            if (garageSalesFetchRunRef.current !== fetchRunId) return;
            commitGarageSalePins(pins.slice(0, count));
          },
          (index + 1) * 180,
        );
      });
    };

    const sortGarageSalePinsNearestFirst = (pins: GarageSaleMapPin[]) => {
      return [...pins].sort((a, b) => {
        if (
          Number(Boolean(a.probableSale)) !== Number(Boolean(b.probableSale))
        ) {
          return (
            Number(Boolean(a.probableSale)) - Number(Boolean(b.probableSale))
          );
        }

        const distanceA = a.distanceMiles ?? Number.MAX_SAFE_INTEGER;
        const distanceB = b.distanceMiles ?? Number.MAX_SAFE_INTEGER;

        if (distanceA !== distanceB) {
          return distanceA - distanceB;
        }

        if (
          (a.saleSortTimestamp ?? Number.MAX_SAFE_INTEGER) !==
          (b.saleSortTimestamp ?? Number.MAX_SAFE_INTEGER)
        ) {
          return (
            (a.saleSortTimestamp ?? Number.MAX_SAFE_INTEGER) -
            (b.saleSortTimestamp ?? Number.MAX_SAFE_INTEGER)
          );
        }

        return a.title.localeCompare(b.title);
      });
    };

    const filterGarageSalePinsByRadius = (
      pins: GarageSaleMapPin[],
      radiusMiles: number,
    ) => {
      const filteredPins = pins.filter((pin) => {
        const numericDistance = Number(pin.distanceMiles);

        if (Number.isFinite(numericDistance)) {
          return numericDistance <= radiusMiles;
        }

        if (pin.saleType === 'garage') {
          return true;
        }

        return false;
      });

      return sortGarageSalePinsNearestFirst(filteredPins);
    };

    try {
      setHasAutoFittedGarageSalesMap(false);
      setGarageSalesLoading(true);
      setGarageSalesShowingPreview(false);
      setGarageSalesError(null);

      if (garageFinderMode === 'thrift') {
        if (
          !Number.isFinite(weatherData?.latitude as number) ||
          !Number.isFinite(weatherData?.longitude as number)
        ) {
          setGarageSalePins([]);
          setGarageSalesError(
            'Your current location is needed before thrift stores can load.',
          );
          return;
        }

        const thriftCacheTtlMs = 6 * 60 * 60 * 1000;
        const cacheLatitude = Number(weatherData?.latitude).toFixed(3);
        const cacheLongitude = Number(weatherData?.longitude).toFixed(3);
        const thriftCacheKey = `listassist_thrift_cache_${cacheLatitude}_${cacheLongitude}_${garageSaleRadiusMiles}`;

        if (forceRefresh) {
          await AsyncStorage.removeItem(thriftCacheKey);
        }

        const cachedRaw = forceRefresh
          ? null
          : await AsyncStorage.getItem(thriftCacheKey);
        let cachedPins: GarageSaleMapPin[] = [];
        let cachedTimestamp = 0;

        if (cachedRaw) {
          try {
            const cachedPayload = JSON.parse(cachedRaw);
            cachedPins = Array.isArray(cachedPayload?.pins)
              ? cachedPayload.pins
              : [];
            cachedTimestamp = Number(cachedPayload?.timestamp || 0);
          } catch (error) {
            console.log('Could not read thrift cache', error);
          }
        }

        if (
          cachedPins.length &&
          Date.now() - cachedTimestamp < thriftCacheTtlMs
        ) {
          applyGarageSalePins(cachedPins);
          setGarageSalesError(null);
          return;
        }

        const params = new URLSearchParams({
          latitude: String(weatherData?.latitude),
          longitude: String(weatherData?.longitude),
          radiusMiles: String(garageSaleRadiusMiles),
        });

        const response = await fetch(
          `${THRIFT_STORES_API_URL}?${params.toString()}`,
          {
            headers: {
              Accept: 'application/json',
            },
          },
        );

        let payload: any = null;
        try {
          payload = await response.json();
        } catch (error) {
          console.log('Thrift stores backend did not return JSON', error);
        }

        if (!response.ok) {
          const backendMessage =
            payload?.error ||
            payload?.message ||
            `Thrift stores fetch failed with status ${response.status}`;

          if (cachedPins.length) {
            applyGarageSalePins(cachedPins);
            setGarageSalesError(null);
            return;
          }

          const fallbackPins = buildLocalThriftFallbackPins({
            originLatitude: weatherData?.latitude,
            originLongitude: weatherData?.longitude,
            radiusMiles: garageSaleRadiusMiles,
          });

          if (fallbackPins.length) {
            applyGarageSalePins(fallbackPins);
            setGarageSalesError(null);
            return;
          }

          throw new Error(backendMessage);
        }

        const stores = Array.isArray(payload?.stores)
          ? payload.stores
          : Array.isArray(payload?.pins)
            ? payload.pins
            : Array.isArray(payload)
              ? payload
              : [];

        const thriftPins: GarageSaleMapPin[] = stores
          .map((store: any, index: number) => {
            const latitude = Number(store?.latitude ?? store?.lat);
            const longitude = Number(store?.longitude ?? store?.lon);

            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
              return null;
            }

            const title = String(
              store?.title || store?.name || `Thrift Store ${index + 1}`,
            ).trim();

            const addressLabel = String(
              store?.addressLabel ||
                store?.address ||
                store?.displayAddress ||
                'Address not provided',
            ).trim();

            const openingHours = String(
              store?.openingHours || store?.timeLabel || store?.hours || '',
            ).trim();

            const phone = String(store?.phone || '').trim();
            const website = String(store?.website || '').trim();
            const source = String(store?.source || '').trim();
            const storeKind = String(
              store?.subtitle ||
                store?.storeKind ||
                getGarageSaleTypeLabel('thrift'),
            ).trim();

            const notes = String(
              store?.notes ||
                `${storeKind}. Tap Map for directions${website ? ' or Website for store details' : ''}.`,
            ).trim();

            const rawDistance =
              store?.distanceMiles ??
              store?.distance ??
              calculatePointDistanceMiles(
                weatherData?.latitude,
                weatherData?.longitude,
                latitude,
                longitude,
              );

            const numericDistance = Number(rawDistance);
            const distanceLabel =
              String(store?.distanceLabel || '').trim() ||
              (Number.isFinite(numericDistance) && numericDistance >= 0
                ? `${round2(numericDistance)} mi`
                : 'Distance unavailable');

            const mapAddress = String(store?.mapAddress || '').trim();
            const displayAddress =
              addressLabel && addressLabel !== 'Address not provided'
                ? addressLabel
                : mapAddress || 'Tap Map for directions';

            const mapsQuery = String(
              store?.mapsQuery ||
                mapAddress ||
                (addressLabel !== 'Address not provided'
                  ? `${title} ${addressLabel}`
                  : `${title} ${latitude},${longitude}`),
            ).trim();

            return {
              id: String(store?.id || `thrift-backend-${index + 1}`),
              title,
              subtitle: `${storeKind} • ${distanceLabel}`,
              query: `${title} ${mapsQuery}`.trim(),
              mapsQuery,
              latitude,
              longitude,
              addressLabel,
              mapAddress,
              displayAddress,
              timeLabel: openingHours || 'Hours not listed',
              openingHours,
              notes,
              saleType: 'thrift',
              pinColor: getGarageSaleMarkerColor('thrift'),
              craigslistUrl: undefined,
              dayLabel: undefined,
              distanceLabel,
              distanceMiles: Number.isFinite(numericDistance)
                ? Number(round2(numericDistance))
                : null,
              phone,
              website,
              source,
            } satisfies GarageSaleMapPin;
          })
          .filter((pin): pin is GarageSaleMapPin => pin !== null)
          .filter(
            (pin, index, arr) =>
              index ===
              arr.findIndex(
                (other) =>
                  other.title === pin.title &&
                  other.addressLabel === pin.addressLabel,
              ),
          )
          .sort((a, b) => {
            const aDistance = Number.isFinite(a.distanceMiles as number)
              ? Number(a.distanceMiles)
              : 9999;
            const bDistance = Number.isFinite(b.distanceMiles as number)
              ? Number(b.distanceMiles)
              : 9999;
            return aDistance - bDistance || a.title.localeCompare(b.title);
          });

        if (!thriftPins.length) {
          const fallbackPins = buildLocalThriftFallbackPins({
            originLatitude: weatherData?.latitude,
            originLongitude: weatherData?.longitude,
            radiusMiles: garageSaleRadiusMiles,
          });

          if (fallbackPins.length) {
            applyGarageSalePins(fallbackPins);
            setGarageSalesError(null);
            return;
          }

          setGarageSalePins([]);
          setGarageSalesError(
            'No nearby thrift stores were found for this area yet.',
          );
          return;
        }

        await AsyncStorage.setItem(
          thriftCacheKey,
          JSON.stringify({ timestamp: Date.now(), pins: thriftPins }),
        );

        applyGarageSalePins(thriftPins);
        setGarageSalesError(null);
        return;
      }

      const estateCacheTtlMs = 10 * 60 * 1000;
      const cacheLatitude = Number(weatherData?.latitude as number).toFixed(3);
      const cacheLongitude = Number(weatherData?.longitude as number).toFixed(
        3,
      );
      const salesModeCachePrefix =
        garageFinderMode === 'garage' ? 'garage' : 'estate';
      const estateCacheKey = `listassist_${salesModeCachePrefix}_cache_${cacheLatitude}_${cacheLongitude}_${garageSaleDayFilter}`;

      const filterCachedEstatePins = (pins: GarageSaleMapPin[]) => {
        return filterGarageSalePinsByRadius(pins, garageSaleRadiusMiles);
      };

      if (forceRefresh) {
        estateSalesRadiusCacheRef.current = null;
        await AsyncStorage.removeItem(estateCacheKey);
      }

      let showedEstatePreview = false;
      const maybeApplyEstatePreview = (
        pins: GarageSaleMapPin[],
        fetchedRadiusMiles: number,
        timestamp: number,
      ) => {
        if (showedEstatePreview || !pins.length) return;

        const previewPins = filterCachedEstatePins(pins);
        if (!previewPins.length) return;

        estateSalesRadiusCacheRef.current = {
          cacheKey: estateCacheKey,
          fetchedRadiusMiles,
          timestamp,
          pins,
        };
        applyGarageSalePins(previewPins);
        setGarageSalesShowingPreview(true);
        showedEstatePreview = true;
      };

      const inMemoryEstateCache = estateSalesRadiusCacheRef.current;
      if (
        !forceRefresh &&
        inMemoryEstateCache?.cacheKey === estateCacheKey &&
        Date.now() - inMemoryEstateCache.timestamp < estateCacheTtlMs &&
        inMemoryEstateCache.fetchedRadiusMiles >= garageSaleRadiusMiles &&
        inMemoryEstateCache.pins.length
      ) {
        const reusedPins = filterCachedEstatePins(inMemoryEstateCache.pins);
        applyGarageSalePins(reusedPins);
        setGarageSalesError(null);
        return;
      }

      if (
        !forceRefresh &&
        inMemoryEstateCache?.cacheKey === estateCacheKey &&
        inMemoryEstateCache.pins.length
      ) {
        maybeApplyEstatePreview(
          inMemoryEstateCache.pins,
          inMemoryEstateCache.fetchedRadiusMiles,
          inMemoryEstateCache.timestamp,
        );
      }

      const cachedEstateRaw = forceRefresh
        ? null
        : await AsyncStorage.getItem(estateCacheKey);
      if (cachedEstateRaw) {
        try {
          const cachedPayload = JSON.parse(cachedEstateRaw);
          const cachedPins = Array.isArray(cachedPayload?.pins)
            ? cachedPayload.pins
            : [];
          const cachedTimestamp = Number(cachedPayload?.timestamp || 0);
          const cachedRadiusMiles = Number(
            cachedPayload?.fetchedRadiusMiles || 0,
          );

          if (
            cachedPins.length &&
            Date.now() - cachedTimestamp < estateCacheTtlMs &&
            cachedRadiusMiles >= garageSaleRadiusMiles
          ) {
            estateSalesRadiusCacheRef.current = {
              cacheKey: estateCacheKey,
              fetchedRadiusMiles: cachedRadiusMiles,
              timestamp: cachedTimestamp,
              pins: cachedPins,
            };
            const reusedPins = filterCachedEstatePins(cachedPins);
            applyGarageSalePins(reusedPins);
            setGarageSalesError(null);
            return;
          }

          maybeApplyEstatePreview(
            cachedPins,
            cachedRadiusMiles,
            cachedTimestamp || Date.now(),
          );
        } catch (error) {
          console.log('Could not read estate sales cache', error);
        }
      }

      const params = new URLSearchParams({
        radiusMiles: String(garageSaleRadiusMiles),
      });

      if (
        Number.isFinite(weatherData?.latitude as number) &&
        Number.isFinite(weatherData?.longitude as number)
      ) {
        params.set('latitude', String(weatherData?.latitude));
        params.set('longitude', String(weatherData?.longitude));
      }

      const response = await fetch(
        `${garageFinderMode === 'garage' ? GARAGE_SALES_API_URL : `${LOCAL_BACKEND_BASE_URL}/api/estate-sales`}?${params.toString()}`,
        {
          headers: {
            Accept: 'application/json',
          },
        },
      );

      let payload: any = null;
      try {
        payload = await response.json();
        console.log('LIVE SALES RESPONSE:', payload);
        console.log(
          'RAW SALES COUNT:',
          payload?.sales?.length ?? payload?.length ?? 0,
        );
      } catch (error) {
        console.log('Garage sales backend did not return JSON', error);
      }

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            payload?.message ||
            `${garageFinderMode === 'garage' ? 'Garage sales' : 'Estate sales'} fetch failed with status ${response.status}`,
        );
      }

      const sales = Array.isArray(payload?.sales)
        ? payload.sales
        : Array.isArray(payload)
          ? payload
          : [];
      console.log('THRIFT/GARAGE payload mapped count:', sales.length, payload);
      const mappedPins: GarageSaleMapPin[] = sales
        .map((sale: any, index: number) => {
          const timing = getGarageSaleTimingStatus(sale);
          if (timing.status === 'expired') {
            return null;
          }

          const normalizedSaleType = String(
            sale?.saleType ||
              sale?.type ||
              sale?.sourceLabel ||
              sale?.source ||
              '',
          ).toLowerCase();
          const saleType: 'garage' | 'estate' = normalizedSaleType.includes(
            'estate',
          )
            ? 'estate'
            : 'garage';

          const rawLatitude = parseGarageSaleCoordinate(
            sale?.latitude ?? sale?.lat,
          );
          const rawLongitude = parseGarageSaleCoordinate(
            sale?.longitude ?? sale?.lon,
          );
          const hasCoordinates = hasValidCoordinates(rawLatitude, rawLongitude);
          const hasExactCoordinates =
            Boolean(sale?.hasExactCoordinates) && hasCoordinates;
          const isApproximateLocation =
            Boolean(sale?.isApproximateLocation) &&
            hasCoordinates &&
            !hasExactCoordinates;

          const latitude = hasCoordinates ? rawLatitude : Number.NaN;

          const longitude = hasCoordinates ? rawLongitude : Number.NaN;

          const backendProbableSale =
            sale?.isProbableSale === true ||
            String(sale?.timingConfidence || '')
              .trim()
              .toLowerCase() === 'low';
          const probableSale =
            backendProbableSale || timing.status === 'probable';
          const title = String(sale?.title || `Sale ${index + 1}`).trim();
          const street = String(sale?.street || '').trim();
          const crossStreet = String(sale?.crossStreet || '').trim();
          const mapAddress = String(sale?.mapAddress || '').trim();
          const rawAddressLabel = String(
            sale?.addressLabel ||
              sale?.address ||
              sale?.mapsQuery ||
              [sale?.city, sale?.state, sale?.zip].filter(Boolean).join(', ') ||
              'Address not provided',
          ).trim();
          const addressLabel = buildGarageSaleDisplayAddress({
            street,
            crossStreet,
            addressLabel: rawAddressLabel,
            mapAddress,
            mapsQuery: sale?.mapsQuery,
            city: sale?.city,
            state: sale?.state,
            zip: sale?.zip,
          });

          const dayLabel = probableSale
            ? normalizeGarageSaleText(sale?.dayLabel)
            : getGarageSaleDayLabel(sale, garageSaleDayFilter);
          const distanceMiles = getGarageSaleDistanceMiles(sale);
          const distanceLabel = getGarageSaleDistanceLabel(sale);
          const timeLabel = probableSale
            ? normalizeGarageSaleText(sale?.timeLabel)
            : getGarageSaleTimeLabelFromSale(sale, garageSaleDayFilter);
          const craigslistUrl = getGarageSaleCraigslistUrl(sale);
          const baseNotes = getGarageSaleNotesFromSale(sale);
          const notes = probableSale
            ? !hasCoordinates
              ? `${baseNotes} Exact map coordinates were not provided by the source. Use View or Map to open the best available location for this sale.`
              : `${baseNotes} Date or time was too vague to confirm, so this one is listed as a probable sale.`
            : isApproximateLocation
              ? `${baseNotes} Approximate location from listing area.`
              : baseNotes;

          return {
            id: String(sale?.id || `backend-sale-${index + 1}`),
            title,
            subtitle: isApproximateLocation
              ? `Approximate Location • ${getGarageSaleTypeLabel(saleType)} • ${distanceLabel}`
              : `${getGarageSaleTypeLabel(saleType)} • ${distanceLabel}`,
            query: `${title} ${addressLabel}`.trim(),
            mapsQuery: String(
              sale?.mapsQuery ||
                sale?.mapAddress ||
                sale?.address ||
                sale?.addressLabel ||
                addressLabel,
            ).trim(),
            latitude,
            longitude,
            addressLabel,
            mapAddress,
            street,
            crossStreet,
            city: String(sale?.city || '').trim(),
            state: String(sale?.state || '').trim(),
            zip: String(sale?.zip || '').trim(),
            displayAddress: addressLabel,
            timeLabel,
            notes,
            saleType,
            pinColor: getGarageSaleMarkerColor(saleType),
            craigslistUrl,
            dayLabel,
            distanceLabel,
            distanceMiles,
            probableSale,
            saleSortTimestamp: timing.sortTimestamp,
            hasExactCoordinates,
            isApproximateLocation,
          } satisfies GarageSaleMapPin;
        })
        .filter((pin): pin is GarageSaleMapPin => pin !== null);

      const sortedMappedPins = sortGarageSalePinsNearestFirst(mappedPins);
      const combinedPins = filterCachedEstatePins(sortedMappedPins);
      console.log('GARAGE PINS AFTER FRONTEND FILTER:', {
        mappedPins: mappedPins.length,
        combinedPins: combinedPins.length,
        pinsWithCoordinates: combinedPins.filter((pin) =>
          hasValidCoordinates(pin.latitude, pin.longitude),
        ).length,
        requestedDay: garageSaleDayFilter,
        requestedRadiusMiles: garageSaleRadiusMiles,
      });

      estateSalesRadiusCacheRef.current = {
        cacheKey: estateCacheKey,
        fetchedRadiusMiles: garageSaleRadiusMiles,
        timestamp: Date.now(),
        pins: sortedMappedPins,
      };

      await AsyncStorage.setItem(
        estateCacheKey,
        JSON.stringify({
          timestamp: Date.now(),
          fetchedRadiusMiles: garageSaleRadiusMiles,
          pins: sortedMappedPins,
        }),
      );

      applyGarageSalePins(combinedPins, { progressive: true });
      setGarageSalesError(null);
    } catch (error) {
      console.log('Failed to load garage sales', error);
      if (garageFinderMode === 'thrift') {
        const fallbackPins = buildLocalThriftFallbackPins({
          originLatitude: weatherData?.latitude,
          originLongitude: weatherData?.longitude,
          radiusMiles: garageSaleRadiusMiles,
        });

        if (fallbackPins.length) {
          applyGarageSalePins(fallbackPins);
          setGarageSalesError(null);
          return;
        }
      }

      setGarageSalesError(
        garageFinderMode === 'thrift'
          ? 'Nearby thrift stores are temporarily unavailable. Please try again shortly.'
          : garageFinderMode === 'garage'
            ? 'Could not load nearby garage sale results.'
            : 'Could not load nearby estate sale results.',
      );
      setGarageSalePins([]);
    } finally {
      setGarageSalesLoading(false);
      setGarageSalesShowingPreview(false);
    }
  };

  useEffect(() => {
    if (step !== 'garageSalesMap') return;

    void fetchGarageSales();
  }, [
    step,
    garageSaleRadiusMiles,
    garageFinderMode,
    garageSaleDayFilter,
    weatherData?.latitude,
    weatherData?.longitude,
    garageSalesRefreshTick,
  ]);

  const resolveLiveEbaySearchQuery = () => {
    const preferredProductQuery = buildLiveEbayQuery(
      barcodeProduct?.title,
      barcodeProduct?.barcode,
    );

    if (preferredProductQuery) {
      return {
        query: preferredProductQuery,
        isLiveItem: true,
      };
    }

    const liveQuery = buildLiveEbayQuery(
      getDealSearchTerms({
        product: barcodeProduct,
        packageFrontSearchText,
        packageFrontDetectedText,
      }),
      barcodeProduct?.barcode,
    );

    if (liveQuery) {
      return {
        query: liveQuery,
        isLiveItem: true,
      };
    }

    return {
      query: '',
      isLiveItem: false,
    };
  };

  const runLiveEbaySearch = async (queryOverride?: string) => {
    const resolved = resolveLiveEbaySearchQuery();
    const query = (queryOverride ?? resolved.query).trim();

    if (!query) {
      setEbayError('Scan an item or add package words first.');
      Alert.alert('eBay Search', 'Scan an item or add package words first.');
      return;
    }

    try {
      setEbayLoading(true);
      setEbayError(null);
      setEbayQueryLabel(query);

      const result = await searchEbay(query, 10);
      console.log('eBay live search result:', result);

      const items = Array.isArray(result?.itemSummaries)
        ? result.itemSummaries
        : [];
      const exactItems = Array.isArray(result?.exactItemSummaries)
        ? result.exactItemSummaries
        : items;
      const similarItems = Array.isArray(result?.similarItemSummaries)
        ? result.similarItemSummaries
        : [];

      setEbayResults(items);
      setEbayExactResults(exactItems);
      setEbaySimilarResults(similarItems);
      setEbayQueryLabel(result?.exactQuery || query);
      setEbayBroaderQueryLabel(result?.broaderQuery || '');

      Alert.alert(
        resolved.isLiveItem || queryOverride
          ? 'eBay search complete'
          : 'eBay test complete',
        similarItems.length
          ? `Found ${exactItems.length} exact and ${similarItems.length} similar item(s).`
          : `Found ${items.length} item(s) for "${query}".`,
      );
    } catch (error) {
      console.error('eBay live search failed:', error);
      setEbayExactResults([]);
      setEbaySimilarResults([]);
      setEbayError('Could not load eBay results.');
      Alert.alert('eBay Error', 'Could not load eBay results.');
    } finally {
      setEbayLoading(false);
    }
  };

  const renderEbayResultsBlock = () => {
    const exactItems = ebayExactResults.length ? ebayExactResults : ebayResults;
    const similarItems = ebaySimilarResults;
    const combinedItems = [...exactItems, ...similarItems];

    if (!combinedItems.length) return null;

    const summary = buildEbaySearchSummary(combinedItems);
    const resolvedSearchQuery = (ebayQueryLabel || '').trim();
    const resolvedBarcode = '';

    const renderListingCards = (items: EbaySearchItem[]) =>
      items.slice(0, 10).map((item, index) => (
        <View
          key={item.itemId ?? `${item.title}-${index}`}
          style={{
            borderWidth: 1,
            borderColor: '#d1d5db',
            borderRadius: 14,
            padding: 12,
            backgroundColor: '#ffffff',
          }}
        >
          {item.image?.imageUrl ? (
            <Image
              source={{ uri: item.image.imageUrl }}
              style={{
                width: '100%',
                height: 160,
                borderRadius: 10,
                marginBottom: 10,
                resizeMode: 'contain',
                backgroundColor: '#f9fafb',
              }}
            />
          ) : null}

          <Text
            style={{
              fontWeight: '800',
              fontSize: 16,
              color: '#111827',
              marginBottom: 6,
            }}
          >
            {item.title ?? 'No title'}
          </Text>

          <Text
            style={{
              fontSize: 15,
              fontWeight: '600',
              color: '#111827',
              marginBottom: 4,
            }}
          >
            {item.price?.value && item.price?.currency
              ? `${item.price.currency} ${item.price.value}`
              : 'No price'}
          </Text>

          {item.condition ? (
            <Text style={{ fontSize: 14, color: '#6b7280', marginBottom: 10 }}>
              {item.condition}
            </Text>
          ) : null}

          <TouchableOpacity
            onPress={() => openExternalLink(item.itemWebUrl)}
            style={{
              backgroundColor: '#f3f4f6',
              borderRadius: 12,
              paddingVertical: 12,
              alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: '800', color: '#111827' }}>
              View on eBay
            </Text>
          </TouchableOpacity>
        </View>
      ));

    return (
      <View style={{ marginTop: 16, gap: 12 }}>
        <View
          style={[
            styles.infoCard,
            {
              backgroundColor: '#eff6ff',
              borderColor: '#bfdbfe',
            },
          ]}
        >
          <Text style={[styles.infoCardTitle, { color: '#1d4ed8' }]}>
            eBay Live Listings
          </Text>
          <Text style={[styles.infoCardText, { color: '#1d4ed8' }]}>
            {ebayQueryLabel
              ? `Exact query: ${ebayQueryLabel}`
              : 'Current search'}
          </Text>
          {ebayBroaderQueryLabel ? (
            <Text
              style={[styles.infoCardText, { color: '#1d4ed8', marginTop: 4 }]}
            >
              Similar query: {ebayBroaderQueryLabel}
            </Text>
          ) : null}
          <Text
            style={[styles.infoCardText, { color: '#1d4ed8', marginTop: 6 }]}
          >
            {summary.lowestPrice !== null
              ? `Exact ${exactItems.length} • Similar ${similarItems.length} • Low ${formatPrice(summary.lowestPrice)}   •   Avg ${formatPrice(summary.averagePrice ?? summary.lowestPrice)}   •   High ${formatPrice(summary.highestPrice ?? summary.lowestPrice)}`
              : `Exact ${exactItems.length} • Similar ${similarItems.length}. Some listings did not include readable price data.`}
          </Text>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              marginTop: 12,
            }}
          >
            <TouchableOpacity
              onPress={() =>
                openResolvedEbaySearch({
                  sold: true,
                  query: resolvedSearchQuery,
                  barcode: resolvedBarcode,
                })
              }
              style={{
                flex: 1,
                backgroundColor: '#1E3A8A',
                borderRadius: 12,
                paddingVertical: 12,
                alignItems: 'center',
              }}
              activeOpacity={0.75}
            >
              <Text
                style={{ fontSize: 15, fontWeight: '800', color: '#ffffff' }}
              >
                View Sold Listings
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() =>
                openResolvedEbaySearch({
                  sold: false,
                  query: resolvedSearchQuery,
                  barcode: resolvedBarcode,
                })
              }
              style={{
                flex: 1,
                backgroundColor: '#f3f4f6',
                borderRadius: 12,
                paddingVertical: 12,
                alignItems: 'center',
                borderWidth: 1,
                borderColor: '#d1d5db',
              }}
              activeOpacity={0.75}
            >
              <Text
                style={{ fontSize: 15, fontWeight: '800', color: '#111827' }}
              >
                View Live Search
              </Text>
            </TouchableOpacity>
          </View>

          <Text
            style={[
              styles.infoCardText,
              { color: '#1d4ed8', marginTop: 10, fontSize: 13 },
            ]}
          >
            Sold listings open on eBay using the same matched search.
          </Text>
        </View>

        {exactItems.length ? (
          <View style={{ gap: 12 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: '#111827' }}>
              Exact Matches
            </Text>
            {renderListingCards(exactItems)}
          </View>
        ) : null}

        {similarItems.length ? (
          <View style={{ gap: 12 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: '#111827' }}>
              Similar Matches
            </Text>
            {renderListingCards(similarItems)}
          </View>
        ) : null}
      </View>
    );
  };

  const beginProcessing = (message: string) => {
    setUserError('');
    setProcessingMessage(message);
    setIsProcessing(true);
  };

  const endProcessing = () => {
    setProcessingMessage('');
    setIsProcessing(false);
  };

  const clearPackageFrontLookupTimer = () => {
    if (packageFrontLookupTimeoutRef.current) {
      clearTimeout(packageFrontLookupTimeoutRef.current);
      packageFrontLookupTimeoutRef.current = null;
    }
  };

  const showVisualFeedback = (
    type: 'success' | 'error' | 'info',
    message: string,
    durationMs = 1600,
  ) => {
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
    }

    setVisualFeedback({ type, message });

    feedbackTimeoutRef.current = setTimeout(() => {
      setVisualFeedback(null);
      feedbackTimeoutRef.current = null;
    }, durationMs);
  };

  const triggerBarcodeSuccessHaptic = async () => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    } catch (error) {
      console.log('Haptic feedback unavailable', error);
    }
  };

  const triggerFailureHaptic = async () => {
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } catch (error) {
      console.log('Haptic feedback unavailable', error);
    }
  };

  const triggerTickHaptic = async () => {
    try {
      await Haptics.selectionAsync();
    } catch (error) {
      console.log('Haptic feedback unavailable', error);
    }
  };

  const triggerCaptureHaptic = async () => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (error) {
      console.log('Haptic feedback unavailable', error);
    }
  };

  const triggerSavedHaptic = async () => {
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.log('Haptic feedback unavailable', error);
    }
  };

  const scheduleBarcodeReenable = (delayMs = BARCODE_SCAN_COOLDOWN_MS) => {
    if (barcodeUnlockTimeoutRef.current) {
      clearTimeout(barcodeUnlockTimeoutRef.current);
    }

    barcodeUnlockTimeoutRef.current = setTimeout(() => {
      setBarcodeScanEnabled(true);
      barcodeUnlockTimeoutRef.current = null;
    }, delayMs);
  };

  const resetBarcodeScannerState = () => {
    if (barcodeUnlockTimeoutRef.current) {
      clearTimeout(barcodeUnlockTimeoutRef.current);
      barcodeUnlockTimeoutRef.current = null;
    }

    setLastScannedCode(null);
    setIsBarcodeLookupLoading(false);
    setBarcodeScanEnabled(true);
    lastBarcodeLookupAtRef.current = 0;
    lastBarcodeValueRef.current = null;
  };

  const showBarcodeFailureScreen = (title: string, message: string) => {
    void triggerFailureHaptic();
    showVisualFeedback('info', 'Barcode not found — try Box instead', 1800);
    setBarcodeFailureState({
      title,
      message: `${message}

Barcode not found, try Box instead.`,
    });
    setBarcodeProduct(null);
    setUserError('');
    setPackageFrontLookupNote(null);
    endProcessing();
    resetBarcodeScannerState();
    setStep('barcodeFailure');
    scrollToTop();
  };

  const showBoxFailureMessage = (message?: string) => {
    void triggerFailureHaptic();
    showVisualFeedback('info', 'Box not found — try Item instead', 1800);
    setBarcodeFailureState({
      title: 'Box not found',
      message:
        message ||
        'List Assist could not identify that box front yet. Box not found, try Item instead.',
    });
    setBarcodeProduct(null);
    setPackageFrontCandidateProduct(null);
    setUserError('');
    resetPackageFrontLookup();
    endProcessing();
    setStep('barcodeFailure');
    scrollToTop();
  };

  const getPhotoState = (photoKey: PhotoKey) => {
    return photoKey === 'photo1' ? photo1 : photo2;
  };

  const setPhotoState = (
    photoKey: PhotoKey,
    updater: (prev: PhotoState) => PhotoState,
  ) => {
    if (photoKey === 'photo1') {
      setPhoto1((prev) => updater(prev));
    } else {
      setPhoto2((prev) => updater(prev));
    }
  };

  const getMeasurementLabel = (key: MeasurementKey) => {
    if (isCylinder && key === 'width') return 'Diameter';

    switch (key) {
      case 'length':
        return 'Length';
      case 'width':
        return 'Width';
      case 'depth':
        return 'Depth';
      default:
        return 'Measurement';
    }
  };

  const getPhotoTitle = (photoKey: PhotoKey) => {
    if (photoKey === 'photo1') {
      return isCylinder ? 'Main Photo' : 'First Photo';
    }
    return 'Second Photo';
  };

  const getModeLabel = () => {
    return isCylinder ? 'Cylinder Mode' : 'Standard Mode';
  };

  const getMeasurementKeysForPhoto = (photoKey: PhotoKey): MeasurementKey[] => {
    if (photoKey === 'photo1') {
      return ['length', 'width'];
    }
    return ['depth'];
  };

  const getPhotoProgressStep = (photoKey: PhotoKey) => {
    if (isCylinder) return 1;
    return photoKey === 'photo1' ? 1 : 2;
  };

  const getPhotoProgressTotal = () => {
    return isCylinder ? 1 : 2;
  };

  const getSavedMeasurementCountForPhoto = (photoKey: PhotoKey) => {
    const keys = getMeasurementKeysForPhoto(photoKey);
    return keys.filter((key) => measurements[key] !== null).length;
  };

  const isMeasurementSavedForPhoto = (
    photoKey: PhotoKey,
    key: MeasurementKey,
  ) => {
    if (photoKey === 'photo1' || key === 'depth') {
      return measurements[key] !== null;
    }
    return false;
  };

  const getTopContinueLabel = (photoKey: PhotoKey) => {
    if (photoKey === 'photo1') {
      return isCylinder ? 'View Final Results' : 'Take Second Photo';
    }
    return 'View Final Results';
  };

  const getCylinderStepNumber = () => {
    if (activeMeasurementKey === 'length') return 1;
    if (activeMeasurementKey === 'width') return 2;
    return 1;
  };

  const getCylinderStepTitle = () => {
    if (activeMeasurementKey === 'length') return 'Measure Length';
    return 'Measure Diameter';
  };

  const getCylinderStepDescription = () => {
    if (activeMeasurementKey === 'length') {
      return 'Tap the two far ends of the cylinder from top to bottom or end to end.';
    }

    return 'Tap across the round side at its widest point to measure diameter.';
  };

  const startBarcodeScan = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert(
          'Camera permission needed',
          'Please allow camera access to scan barcodes.',
        );
        return;
      }
    }

    setBarcodeProduct(null);
    setPendingBarcodeLinkProduct(null);
    resetBarcodeScannerState();
    setBarcodeFailureState(null);
    setUserError('');
    endProcessing();
    setStep('barcodeScanner');
  };

  const resetPackageFrontLookup = () => {
    packageFrontLookupRequestIdRef.current += 1;
    clearPackageFrontLookupTimer();
    setPackageFrontPhotoUri(null);
    setPackageFrontSearchText('');
    setPackageFrontDetectedText('');
    setPackageFrontLookupNote(null);
    setPackageFrontCandidateProduct(null);
    setIsPackageFrontLookupLoading(false);
    setUserError('');
    endProcessing();
  };

  const startPackageFrontScan = async () => {
    setBarcodeFailureState(null);
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert(
          'Camera permission needed',
          'Please allow camera access to scan the front of the package.',
        );
        return;
      }
    }

    setBarcodeProduct(null);
    setPackageFrontCandidateProduct(null);
    resetBarcodeScannerState();
    setUserError('');
    resetPackageFrontLookup();
    setStep('packageFrontCamera');
  };

  const resetLooseItemLookup = () => {
    setLooseItemPhotoUri(null);
    setLooseItemSearchText('');
    setLooseItemLookupNote(null);
    setLooseItemMatches([]);
    setLooseItemSelectedMatch(null);
    setIsLooseItemLookupLoading(false);
    setUserError('');
    endProcessing();
  };

  const startLooseItemScan = async () => {
    setBarcodeFailureState(null);
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert(
          'Camera permission needed',
          'Please allow camera access to photograph the loose item.',
        );
        return;
      }
    }

    setBarcodeProduct(null);
    resetBarcodeScannerState();
    resetPackageFrontLookup();
    resetLooseItemLookup();
    setUserError('');
    setStep('looseItemCamera');
  };

  const returnToPriceCheckerChooser = () => {
    setBarcodeFailureState(null);
    setBarcodeProduct(null);
    setPendingBarcodeLinkProduct(null);
    resetBarcodeScannerState();
    resetPackageFrontLookup();
    resetLooseItemLookup();
    setUserError('');
    endProcessing();
    if (homeScanMode === 'source') {
      setHomeMode('boxFinder');
      setIsPriceCheckerSession(true);
      setStep('referencePicker');
    } else {
      setIsPriceCheckerSession(false);
      setStep('priceCheckerChooser');
    }
    scrollToTop();
  };

  const openReferenceObjectPicker = () => {
    setBarcodeFailureState(null);
    setBarcodeProduct(null);
    resetBarcodeScannerState();
    setUserError('');
    endProcessing();
    setStep('referenceObjectPicker');
    scrollToTop();
  };

  const getPackageFrontDetectedLines = (sourceText?: string | null) =>
    Array.from(
      new Set(
        String(sourceText ?? packageFrontDetectedText ?? '')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .filter((line) => /[A-Za-z]/.test(line))
          .filter((line) => !/^\d{1,2}:\d{2}$/.test(line))
          .filter((line) => !/^Detected text$/i.test(line))
          .map((line) =>
            line.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9%°]+$/g, '').trim(),
          )
          .filter(Boolean),
      ),
    );

  const isWeakPackageFrontTitle = (value?: string | null) => {
    const cleaned = cleanListingTitle(String(value ?? '').trim(), 80);
    if (!cleaned) return true;

    const normalized = normalizeSearchText(cleaned);
    if (!normalized) return true;

    if (
      /^(package front item|front item|item|product|unknown item)$/i.test(
        cleaned,
      )
    ) {
      return true;
    }

    if (/^upc\s*\d{8,14}$/i.test(cleaned)) {
      return true;
    }

    return getMeaningfulTokens(cleaned).length < 2;
  };

  const buildBestPackageFrontTitle = (params?: {
    detectedText?: string | null;
    helperWords?: string | null;
    matchedProductTitle?: string | null;
  }) => {
    const detectedLines = getPackageFrontDetectedLines(params?.detectedText);
    const detectedBlob = detectedLines.join(' ');
    const helperWords = String(
      params?.helperWords ?? packageFrontSearchText ?? '',
    ).trim();
    const matchedProductTitle = String(
      params?.matchedProductTitle ?? '',
    ).trim();
    const matchedTokens = new Set(getMeaningfulTokens(matchedProductTitle));
    const weakMarketingPattern =
      /(heat protection|easier combing|damaged hair|dry hair|up to \d+|stronger hair|deep care|care level|heavily damaged)/i;

    const scoredLines = detectedLines.map((line, index) => {
      const cleaned = line.replace(/\s+/g, ' ').trim();
      const normalized = normalizeSearchText(cleaned);
      const lineTokens = getMeaningfulTokens(cleaned);
      let score = 0;

      if (!normalized) {
        return { cleaned, score: -999, index };
      }

      if (cleaned.length >= 4 && cleaned.length <= 36) score += 3;
      if (lineTokens.length >= 1 && lineTokens.length <= 4) score += 3;
      if (/^[A-Z0-9][A-Z0-9 &+\-]{2,}$/.test(cleaned)) score += 2;
      if (
        /\b(shampoo|conditioner|repair|serum|spray|cream|gliss|schwarzkopf)\b/i.test(
          cleaned,
        )
      ) {
        score += 6;
      }
      if (/\d+%|\d+°|\d+\s*(?:ml|oz|g|kg|lb)\b/i.test(cleaned)) score -= 3;
      if (weakMarketingPattern.test(cleaned)) score -= 7;

      const overlapCount = lineTokens.filter((token) =>
        matchedTokens.has(token),
      ).length;
      score += overlapCount * 5;

      if (index === 0) score += 1;

      return { cleaned, score, index };
    });

    const chosenLines = scoredLines
      .filter((item) => item.score >= 2)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.index - b.index;
      })
      .slice(0, 4)
      .sort((a, b) => a.index - b.index)
      .map((item) => item.cleaned);

    const titleParts: string[] = [];
    const pushUniqueTitlePart = (value?: string | null) => {
      const cleaned = String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!cleaned) return;
      const normalized = normalizeSearchText(cleaned);
      if (!normalized) return;
      if (titleParts.some((item) => normalizeSearchText(item) === normalized)) {
        return;
      }
      titleParts.push(cleaned);
    };

    chosenLines.forEach((line) => pushUniqueTitlePart(line));

    if (/laser/i.test(detectedBlob) && /inkjet/i.test(detectedBlob)) {
      pushUniqueTitlePart('Laser & Inkjet');
    }

    pushUniqueTitlePart((detectedBlob.match(/\b\d+\s*Sheets?\b/i) ?? [])[0]);
    pushUniqueTitlePart(
      (detectedBlob.match(
        /\b\d+(?:\.\d+)?\s*(?:IN|in)\s*x\s*\d+(?:\.\d+)?\s*(?:IN|in)?\b/i,
      ) ?? [])[0],
    );
    pushUniqueTitlePart((detectedBlob.match(/\b\d+\s*lb\b/i) ?? [])[0]);
    pushUniqueTitlePart((detectedBlob.match(/\b\d+\s*Bright\b/i) ?? [])[0]);
    pushUniqueTitlePart(helperWords);

    const ocrTitle =
      cleanListingTitle(titleParts.join(' '), 80) ||
      cleanListingTitle(helperWords || detectedLines.slice(0, 3).join(' '), 80);

    if (!isWeakPackageFrontTitle(ocrTitle)) {
      return ocrTitle;
    }

    if (!isWeakPackageFrontTitle(matchedProductTitle)) {
      return cleanListingTitle(matchedProductTitle, 80);
    }

    return (
      ocrTitle ||
      cleanListingTitle(matchedProductTitle, 80) ||
      'Package Front Item'
    );
  };

  const buildPackageFrontOcrSeedProduct = (params?: {
    detectedText?: string | null;
    helperWords?: string | null;
    matchedProduct?: BarcodeProduct | null;
  }): BarcodeProduct => {
    const title = buildBestPackageFrontTitle({
      detectedText: params?.detectedText,
      helperWords: params?.helperWords,
      matchedProductTitle: params?.matchedProduct?.title,
    });

    return {
      barcode: params?.matchedProduct?.barcode ?? '',
      title,
      length: params?.matchedProduct?.length ?? 0,
      width: params?.matchedProduct?.width ?? 0,
      height: params?.matchedProduct?.height ?? 0,
      weightOz: params?.matchedProduct?.weightOz,
      source: params?.matchedProduct?.source || 'Package front OCR',
      confidence: params?.matchedProduct?.confidence ?? 'low',
    };
  };

  const buildPackageFrontFallbackListing = (product: BarcodeProduct) => {
    const detectedLines = Array.from(
      new Set(
        packageFrontDetectedText
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .filter((line) => /[A-Za-z]/.test(line))
          .filter((line) => !/^\d{1,2}:\d{2}$/.test(line))
          .filter((line) => !/^Detected text$/i.test(line)),
      ),
    );

    const toTitleCase = (value: string) =>
      value
        .toLowerCase()
        .replace(/\b\w/g, (char) => char.toUpperCase())
        .replace(/\bUsa\b/g, 'USA')
        .replace(/\bGb\b/g, 'GB')
        .replace(/\bOz\b/g, 'oz')
        .replace(/\bLb\b/g, 'lb')
        .replace(/\bIn\b/g, 'in');

    const cleanedDetectedLines = detectedLines
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter((line) => line.length >= 3);

    const firstDetectedLine = cleanedDetectedLines[0] ?? '';
    const fallbackProductTitle = product.title.trim();
    const fallbackTokens = tokenizeSearchText(fallbackProductTitle);
    const overlapCount = tokenizeSearchText(firstDetectedLine).filter((token) =>
      fallbackTokens.includes(token),
    ).length;

    const titleBase = buildBestPackageFrontTitle({
      detectedText: packageFrontDetectedText,
      helperWords: packageFrontSearchText,
      matchedProductTitle:
        firstDetectedLine && overlapCount === 0
          ? `${fallbackProductTitle} ${toTitleCase(firstDetectedLine)}`
          : fallbackProductTitle,
    });

    const detectedBlob = cleanedDetectedLines.join(' ');
    const featureParts: string[] = [];

    const addFeature = (value?: string | null) => {
      const cleaned = String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!cleaned) return;
      if (
        featureParts.some(
          (item) => normalizeSearchText(item) === normalizeSearchText(cleaned),
        )
      )
        return;
      featureParts.push(cleaned);
    };

    addFeature((detectedBlob.match(/\b\d+\s*Sheets?\b/i) ?? [])[0]);
    addFeature(
      (detectedBlob.match(
        /\b\d+(?:\.\d+)?\s*(?:IN|in)\s*x\s*\d+(?:\.\d+)?\s*(?:IN|in)?\b/i,
      ) ?? [])[0],
    );
    addFeature((detectedBlob.match(/\b\d+\s*lb\b/i) ?? [])[0]);
    addFeature((detectedBlob.match(/\b\d+\s*Bright\b/i) ?? [])[0]);

    if (/laser/i.test(detectedBlob) && /inkjet/i.test(detectedBlob)) {
      addFeature('Laser & Inkjet');
    }

    const smartTitle = cleanListingTitle(
      [titleBase, ...featureParts].filter(Boolean).join(' '),
      80,
    );

    const seedProduct: BarcodeProduct = {
      ...product,
      title: smartTitle || fallbackProductTitle,
      source: `${product.source} • listing fallback`,
      confidence: product.confidence ?? 'medium',
    };

    const baseDraft = buildListingDraft({
      platform: listingPlatform,
      condition: listingCondition,
      product: seedProduct,
      measurements:
        product.length > 0 && product.width > 0 && product.height > 0
          ? {
              length: product.length,
              width: product.width,
              depth: product.height,
            }
          : measurements,
      isCylinder,
      packageFrontSearchText: smartTitle || packageFrontSearchText,
      titleVariantSeed: 0,
    });

    const confidenceLabel = (product.confidence ?? 'medium').toLowerCase();
    const detectedPreview = cleanedDetectedLines.slice(0, 12).join('\n');
    const noteLine = packageFrontLookupNote?.trim()
      ? `List Assist note: ${packageFrontLookupNote.trim()}`
      : 'List Assist created this draft from the Suggested Item card after the match was rejected.';

    return {
      seedProduct,
      draft: {
        ...baseDraft,
        titleOptions: [
          smartTitle,
          ...dedupeTitleOptions(
            [titleBase, ...baseDraft.titleOptions].filter(Boolean) as string[],
            smartTitle,
          ),
        ]
          .filter(Boolean)
          .slice(0, 6),
        shortDescription:
          `${listingCondition} ${smartTitle || fallbackProductTitle}. Best-guess listing draft built from the Suggested Item card, ${confidenceLabel} confidence match, and the visible package text.`
            .replace(/\s+/g, ' ')
            .trim(),
        fullDescription: [
          `${listingCondition} ${smartTitle || fallbackProductTitle}.`,
          '',
          'Suggested Item Details:',
          `• Suggested item: ${product.title}`,
          `• Confidence: ${product.confidence ?? 'medium'}`,
          `• Source: ${product.source}`,
          packageFrontSearchText
            ? `• Helper words entered: ${packageFrontSearchText}`
            : '',
          '',
          'Detected Package Text:',
          detectedPreview || 'No detected package text was available.',
          '',
          'Notes:',
          `• ${noteLine}`,
          '• This draft was prefilled so you can quickly edit the title and description instead of rescanning.',
          '• Please review all wording, item specifics, condition, and included contents before posting.',
        ]
          .filter(Boolean)
          .join('\n')
          .trim(),
        keywords: Array.from(
          new Set(
            [
              smartTitle || fallbackProductTitle,
              product.title,
              packageFrontSearchText,
              product.confidence ?? 'medium',
              product.source,
              ...featureParts,
            ]
              .filter(Boolean)
              .map((value) => String(value).trim()),
          ),
        ).join(', '),
      },
    };
  };

  const completePackageFrontMatch = async (
    product: BarcodeProduct,
    learningTexts: Array<string | null | undefined>,
    options?: {
      saveLearning?: boolean;
      learningSource?: 'auto' | 'confirmed';
    },
  ) => {
    setProcessingMessage('Building listing draft...');

    const shouldSaveLearning = options?.saveLearning ?? true;
    const learningSource = options?.learningSource ?? 'auto';

    if (shouldSaveLearning) {
      await savePackageFrontMemoryEntry(product, learningTexts);
      showVisualFeedback(
        'info',
        learningSource === 'confirmed'
          ? 'Confirmed and saved'
          : 'Saved to package memory',
        1300,
      );
    }

    const fallbackListing = buildPackageFrontFallbackListing(product);
    setPackageFrontCandidateProduct(null);
    setPendingBarcodeLinkProduct(null);
    setBarcodeProduct(fallbackListing.seedProduct);
    setMeasurements({
      length: fallbackListing.seedProduct.length,
      width: fallbackListing.seedProduct.width,
      depth: fallbackListing.seedProduct.height,
    });
    setTitleVariantSeed(0);
    setListingDraft(fallbackListing.draft);
    setUserError('');
    setSuccessMessage('Listing draft ready');
    showVisualFeedback('success', 'Draft built from package front');

    setTimeout(() => {
      setSuccessMessage('');
      setStep(getPostLookupStep());
      scrollToTop();
    }, 250);
  };

  const confirmPackageFrontCandidate = async () => {
    if (!packageFrontCandidateProduct) return;

    beginProcessing('Confirming package match...');

    try {
      await completePackageFrontMatch(
        packageFrontCandidateProduct,
        [
          packageFrontDetectedText,
          packageFrontSearchText,
          packageFrontCandidateProduct.title,
        ],
        {
          saveLearning: true,
          learningSource: 'confirmed',
        },
      );
    } catch (error) {
      console.error('confirmPackageFrontCandidate error:', error);
      setUserError(
        'List Assist had trouble saving that confirmed match. Please try again.',
      );
      setStep('packageFrontPreview');
    } finally {
      endProcessing();
    }
  };

  const applyResolvedProduct = (product: BarcodeProduct) => {
    setBarcodeProduct(product);

    const hasPackageDimensions =
      product.length > 0 && product.width > 0 && product.height > 0;

    setMeasurements({
      length: hasPackageDimensions ? product.length : null,
      width: hasPackageDimensions ? product.width : null,
      depth: hasPackageDimensions ? product.height : null,
    });

    setSuccessMessage('Match found');
    showVisualFeedback('success', 'Product found');

    setTimeout(() => {
      setSuccessMessage('');
      setSelectedFitModeKey('closest');
      setStep(getPostLookupStep());
      scrollToTop();
    }, 700);
  };

  const fallbackPackageFrontToImageMatch = async (params: {
    photoUri: string;
    helperText?: string;
    detectedText?: string;
    failureNote?: string;
  }) => {
    const imageHelperText = (
      params.helperText ||
      buildBestPackageFrontTitle({
        detectedText: params.detectedText,
        helperWords: params.helperText,
        matchedProductTitle: '',
      }) ||
      ''
    ).trim();

    setLooseItemPhotoUri(params.photoUri);
    setLooseItemSearchText(imageHelperText);
    setLooseItemSelectedMatch(null);
    setLooseItemMatches([]);

    try {
      const result = await lookupLooseItemFromPhoto(
        params.photoUri,
        imageHelperText,
      );
      const matches = (result.itemSummaries ?? []).slice(0, 8);

      setLooseItemMatches(matches);
      setLooseItemLookupNote(
        result.note ??
          (matches.length
            ? imageHelperText
              ? `Package text was weak, so List Assist switched to photo matching using "${imageHelperText}" and opened the top result.`
              : 'Package text was weak, so List Assist switched to photo matching using the same image and opened the top result.'
            : imageHelperText
              ? `Package text was weak, and no strong photo matches came back for "${imageHelperText}". Try a different photo or refine the wording below.`
              : 'Package text was weak, and no strong photo matches came back. Try better lighting, a cleaner background, or add a few exact words.'),
      );
      setPackageFrontLookupNote(
        matches.length
          ? 'Package text was weak, so List Assist switched to photo matching with the same image and opened the top result.'
          : 'Package text was weak, so List Assist switched to photo matching, but no strong match came back yet.',
      );
      setUserError(
        matches.length
          ? ''
          : 'Package text matching missed, so photo matching is being used instead.',
      );
      if (matches.length) {
        await applyLooseItemMatch(matches[0]);
      } else {
        setStep('looseItemPreview');
        scrollToTop();
      }
    } catch (error) {
      console.error('fallbackPackageFrontToImageMatch error:', error);
      const fallbackMatches = imageHelperText
        ? buildLooseItemMockMatches(imageHelperText).slice(0, 8)
        : [];

      setLooseItemMatches(fallbackMatches);
      setLooseItemLookupNote(
        fallbackMatches.length
          ? `Package text was weak and live photo matching could not reach the backend, so List Assist built a fallback top match using "${imageHelperText}" and opened it.`
          : 'Package text was weak and live photo matching could not reach the backend. Retake the photo, add a few helper words, or check the backend connection and try again.',
      );
      setPackageFrontLookupNote(
        'Package text was weak, and the image-match fallback also hit a backend problem.',
      );
      setUserError(
        fallbackMatches.length
          ? 'Live photo search is offline, so a fallback match is being used.'
          : 'Box front lookup and image fallback both failed. Retake the photo or check the backend connection and try again.',
      );
      if (fallbackMatches.length) {
        await applyLooseItemMatch(fallbackMatches[0]);
      } else {
        setStep('looseItemPreview');
        scrollToTop();
      }
    }
  };

  const runPackageFrontLookup = async (
    manualHint?: string,
    photoUriOverride?: string,
  ) => {
    const photoUriToUse = photoUriOverride || packageFrontPhotoUri;
    if (!photoUriToUse) return;

    const requestId = ++packageFrontLookupRequestIdRef.current;
    clearPackageFrontLookupTimer();
    setIsPackageFrontLookupLoading(true);
    beginProcessing('Reading package front...');

    packageFrontLookupTimeoutRef.current = setTimeout(() => {
      if (packageFrontLookupRequestIdRef.current !== requestId) return;

      setIsPackageFrontLookupLoading(false);
      setProcessingMessage('');
      setIsProcessing(false);
      setUserError(
        'Reading the package front is taking too long. Please retake the photo and make sure the package is well lit.',
      );
      setPackageFrontLookupNote(
        'Tip: if the package looks dark, brighten the lighting, fill more of the frame, and try another package-front photo.',
      );
    }, PACKAGE_FRONT_LOOKUP_TIMEOUT_MS);

    try {
      const result = await lookupProductFromPackageFront(
        photoUriToUse,
        manualHint,
      );

      if (packageFrontLookupRequestIdRef.current !== requestId) {
        return;
      }

      clearPackageFrontLookupTimer();
      setPackageFrontDetectedText(result.detectedText);
      setPackageFrontLookupNote(result.note);

      const effectiveHelperWords = (
        manualHint ??
        packageFrontSearchText ??
        ''
      ).trim();
      const ocrSeedProduct = buildPackageFrontOcrSeedProduct({
        detectedText: result.detectedText,
        helperWords: effectiveHelperWords,
        matchedProduct: result.product,
      });
      if (!result.product) {
        await fallbackPackageFrontToImageMatch({
          photoUri: photoUriToUse,
          helperText: effectiveHelperWords || ocrSeedProduct.title,
          detectedText: result.detectedText,
          failureNote: result.note,
        });
        return;
      }

      const resolvedProduct = {
        ...ocrSeedProduct,
        ...result.product,
        title:
          buildBestPackageFrontTitle({
            detectedText: result.detectedText,
            helperWords: effectiveHelperWords,
            matchedProductTitle: result.product.title,
          }) ||
          ocrSeedProduct.title ||
          result.product.title,
        source: result.product.source || 'Package front OCR',
        confidence:
          result.product.confidence ?? ocrSeedProduct.confidence ?? 'medium',
      };

      setPackageFrontCandidateProduct(null);
      setUserError('');
      setPackageFrontLookupNote(
        result.note ||
          'List Assist built this listing draft from the package-front image text.',
      );

      await completePackageFrontMatch(
        resolvedProduct,
        [result.detectedText, manualHint, packageFrontSearchText],
        {
          saveLearning: false,
          learningSource: 'auto',
        },
      );
    } catch (error) {
      if (packageFrontLookupRequestIdRef.current !== requestId) {
        return;
      }

      clearPackageFrontLookupTimer();
      console.error('runPackageFrontLookup error:', error);
      await fallbackPackageFrontToImageMatch({
        photoUri: photoUriToUse,
        helperText: (manualHint ?? packageFrontSearchText ?? '').trim(),
        detectedText: packageFrontDetectedText,
        failureNote:
          'List Assist hit a problem while reading that box front, so it switched to photo matching with the same image.',
      });
    } finally {
      if (packageFrontLookupRequestIdRef.current === requestId) {
        clearPackageFrontLookupTimer();
        setIsPackageFrontLookupLoading(false);
        endProcessing();
      }
    }
  };

  const takePackageFrontPhoto = async () => {
    try {
      if (!cameraRef.current) {
        Alert.alert('Camera not ready', 'Please try again.');
        return;
      }

      setUserError('');
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
      });
      await triggerCaptureHaptic();
      showVisualFeedback('info', 'Photo captured', 900);

      if (!photo?.uri) {
        Alert.alert('Photo failed', 'Could not capture image.');
        return;
      }

      setPackageFrontCandidateProduct(null);
      setPackageFrontPhotoUri(photo.uri);
      setPackageFrontSearchText('');
      setPackageFrontDetectedText('');
      setPackageFrontLookupNote('Analyzing the front of the package...');
      scrollToTop();
      setTimeout(() => {
        runPackageFrontLookup('', photo.uri);
      }, 0);
    } catch (error) {
      console.error('takePackageFrontPhoto error:', error);
      Alert.alert('Error', 'There was a problem taking the picture.');
    }
  };

  const runLooseItemLookup = async (
    manualHint?: string,
    photoUriOverride?: string,
  ) => {
    const lookupPhotoUri = photoUriOverride ?? looseItemPhotoUri;
    if (!lookupPhotoUri) return;

    const helperText = (manualHint ?? looseItemSearchText).trim();
    setLooseItemSearchText(helperText);
    setIsLooseItemLookupLoading(true);
    beginProcessing('Searching eBay for likely matches...');

    try {
      const result = await lookupLooseItemFromPhoto(lookupPhotoUri, helperText);
      const matches = (result.itemSummaries ?? []).slice(0, 8);
      setLooseItemMatches(matches);
      setLooseItemLookupNote(
        result.note ??
          (matches.length
            ? helperText
              ? `Top photo match found using your photo and "${helperText}". Opening results now.`
              : 'Top photo match found. Opening results now.'
            : helperText
              ? `No strong matches came back for this photo and "${helperText}". Try a different photo or refine the wording below.`
              : 'No strong matches came back. Try better lighting, a cleaner background, or add a few exact words.'),
      );
      setLooseItemSelectedMatch(null);
      setUserError('');
      if (matches.length) {
        await applyLooseItemMatch(matches[0]);
      } else {
        setStep('looseItemPreview');
        scrollToTop();
      }
    } catch (error) {
      console.log('runLooseItemLookup backend unavailable:', error);
      const fallbackMatches = helperText
        ? buildLooseItemMockMatches(helperText).slice(0, 8)
        : [];

      setLooseItemMatches(fallbackMatches);
      setLooseItemLookupNote(
        fallbackMatches.length
          ? `Live image search could not reach the backend, so List Assist built a few fallback matches using "${helperText}". Pick the closest one, or add better helper words and search again.`
          : 'Live image search is temporarily unavailable. Add a few helper words like brand, item type, model, or category, then tap Find Matches again.',
      );
      setUserError(
        fallbackMatches.length
          ? 'Live image search is offline, so fallback matches are being shown.'
          : 'Photo search needs helper words when live image search is offline. Add brand, item type, or model and try again.',
      );
      setLooseItemSelectedMatch(null);
      if (fallbackMatches.length) {
        await applyLooseItemMatch(fallbackMatches[0]);
      } else {
        setStep('looseItemPreview');
        scrollToTop();
      }
    } finally {
      setIsLooseItemLookupLoading(false);
      endProcessing();
    }
  };

  const takeLooseItemPhoto = async () => {
    try {
      if (!cameraRef.current) {
        Alert.alert('Camera not ready', 'Please try again.');
        return;
      }

      setUserError('');
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
      });
      await triggerCaptureHaptic();
      showVisualFeedback('info', 'Photo captured', 900);

      if (!photo?.uri) {
        Alert.alert('Photo failed', 'Could not capture image.');
        return;
      }

      setLooseItemPhotoUri(photo.uri);
      setLooseItemSearchText('');
      setLooseItemLookupNote(
        'Searching eBay for likely matches from your photo...',
      );
      setLooseItemMatches([]);
      setLooseItemSelectedMatch(null);
      scrollToTop();
      setTimeout(() => {
        runLooseItemLookup('', photo.uri);
      }, 0);
    } catch (error) {
      console.error('takeLooseItemPhoto error:', error);
      Alert.alert('Error', 'There was a problem taking the picture.');
    }
  };

  const applyLooseItemMatch = async (item: EbaySearchItem) => {
    const resolvedProduct: BarcodeProduct = {
      barcode: '',
      title: item.title,
      length: 0,
      width: 0,
      height: 0,
      source: 'eBay image search',
      confidence: 'medium',
    };

    setLooseItemSelectedMatch(item);
    setLooseItemLookupNote(
      isPriceCheckerSession
        ? 'Match confirmed. Opening Price Checker now.'
        : homeMode === 'dealFinder'
          ? 'Match selected. Opening market view now.'
          : 'Match selected. Moving this into Listing Helper now.',
    );
    await triggerSavedHaptic();
    applyResolvedProduct(resolvedProduct);
  };

  const handleBarcodeScanned = async ({ data }: any) => {
    if (!data || isBarcodeLookupLoading || !barcodeScanEnabled) return;

    const normalized = normalizeBarcode(String(data));
    if (!normalized) return;

    if (pendingBarcodeLinkProduct) {
      const linkedProduct: BarcodeProduct = {
        ...pendingBarcodeLinkProduct,
        barcode: normalized,
        source: `${pendingBarcodeLinkProduct.source} • linked barcode`,
      };

      await cacheBarcodeProduct(linkedProduct);
      await savePackageFrontMemoryEntry(linkedProduct, [
        packageFrontDetectedText,
        packageFrontSearchText,
        linkedProduct.title,
      ]);
      setPendingBarcodeLinkProduct(null);
      setBarcodeProduct(linkedProduct);
      setMeasurements({
        length: linkedProduct.length,
        width: linkedProduct.width,
        depth: linkedProduct.height,
      });

      await triggerSavedHaptic();
      showVisualFeedback('success', 'Barcode linked and saved', 1500);
      setBarcodeScanEnabled(false);

      setTimeout(() => {
        setSelectedFitModeKey('closest');
        setStep(getPostLookupStep());
        scrollToTop();
        scheduleBarcodeReenable(BARCODE_SCAN_COOLDOWN_MS);
      }, 500);

      return;
    }

    const now = Date.now();
    const isDuplicateWithinWindow =
      lastBarcodeValueRef.current === normalized &&
      now - lastBarcodeLookupAtRef.current < BARCODE_DUPLICATE_WINDOW_MS;

    if (isDuplicateWithinWindow) {
      return;
    }

    lastBarcodeValueRef.current = normalized;
    lastBarcodeLookupAtRef.current = now;

    setBarcodeScanEnabled(false);
    setLastScannedCode(normalized);
    setIsBarcodeLookupLoading(true);
    beginProcessing(`Looking up barcode ${normalized}...`);

    try {
      let lookupResult: BarcodeLookupResult;

      if (barcode429UntilRef.current > now) {
        lookupResult = {
          product: null,
          source: 'rate_limited',
          message:
            'The online UPC service is temporarily rate-limited. List Assist is using the local barcode catalog only right now.',
          retryAfterMs: barcode429UntilRef.current - now,
        };
      } else {
        lookupResult = await lookupBarcodeProduct(normalized);
      }

      if (lookupResult.source === 'rate_limited') {
        barcode429UntilRef.current =
          Date.now() +
          (lookupResult.retryAfterMs ?? BARCODE_RATE_LIMIT_COOLDOWN_MS);
        showBarcodeFailureScreen(
          'Online lookup paused',
          `${lookupResult.message ?? 'The online UPC service is temporarily rate-limited.'}

Local barcode matches will still work instantly. You can try Package Front or measure the item instead.`,
        );
        return;
      }

      const product = lookupResult.product;

      if (!product) {
        showBarcodeFailureScreen(
          'No product match found',
          `Barcode ${normalized} was detected, but no product match was returned.

This barcode may not be in the local catalog yet${barcode429UntilRef.current > Date.now() ? ', and the online lookup is cooling down.' : '.'}`,
        );
        return;
      }

      await savePackageFrontMemoryEntry(product, [product.title]);

      await triggerBarcodeSuccessHaptic();
      setProcessingMessage('Opening results...');
      applyResolvedProduct(product);
      scheduleBarcodeReenable(BARCODE_SCAN_COOLDOWN_MS);
    } catch (error) {
      console.error('handleBarcodeScanned error:', error);
      showBarcodeFailureScreen(
        'Lookup failed',
        'List Assist hit a problem while looking up that barcode. Please scan again, try Package Front, or measure the item instead.',
      );
    } finally {
      setIsBarcodeLookupLoading(false);
      endProcessing();
    }
  };

  const goBackFromCamera = async () => {
    await resetAll();
    scrollToTop();
  };

  const openCamera = async (photoKey: PhotoKey) => {
    setBarcodeProduct(null);
    resetBarcodeScannerState();
    setUserError('');
    if (!selectedReference) {
      Alert.alert(
        'Pick a reference object',
        'Choose quarter, soda can top, dollar bill, or business card first.',
      );
      return;
    }

    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert(
          'Camera permission needed',
          'Please allow camera access to continue.',
        );
        return;
      }
    }

    await triggerTickHaptic();
    setActivePhotoKey(photoKey);
    setStep(photoKey === 'photo1' ? 'cameraPhoto1' : 'cameraPhoto2');
  };

  const takePicture = async () => {
    try {
      if (!cameraRef.current) {
        Alert.alert('Camera not ready', 'Please try again.');
        return;
      }

      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
      });
      await triggerCaptureHaptic();
      showVisualFeedback('info', 'Photo captured', 900);

      if (!photo?.uri) {
        Alert.alert('Photo failed', 'Could not capture image.');
        return;
      }

      const targetPhotoKey = activePhotoKey;

      setPhotoState(targetPhotoKey, () => ({
        uri: photo.uri,
        referenceDetection: null,
        pixelsPerInch: null,
        measurementPoints: [],
      }));

      if (targetPhotoKey === 'photo1') {
        setMeasurements((prev) => ({
          ...prev,
          length: null,
          width: null,
          ...(isCylinder ? { depth: null } : {}),
        }));
        setStep('photo1Preview');
      } else {
        setMeasurements((prev) => ({
          ...prev,
          depth: null,
        }));
        setStep('photo2Preview');
      }
    } catch (error) {
      console.error('takePicture error:', error);
      Alert.alert('Error', 'There was a problem taking the picture.');
    }
  };

  const flipCamera = async () => {
    await triggerTickHaptic();
    setFacing((current) => (current === 'back' ? 'front' : 'back'));
  };

  const resetAll = async () => {
    await resetToMainHome(true);
  };

  const handleStartNewItemFromResults = async () => {
    await triggerTickHaptic();
    await resetAll();
    setHomeMode('boxFinder');
    setStep('referencePicker');
    scrollToTop();
  };

  const retakePhoto = async (photoKey: PhotoKey) => {
    await triggerTickHaptic();
    setPhotoState(photoKey, () => ({
      uri: null,
      referenceDetection: null,
      pixelsPerInch: null,
      measurementPoints: [],
    }));

    if (photoKey === 'photo1') {
      setMeasurements((prev) => ({
        ...prev,
        length: null,
        width: null,
        ...(isCylinder ? { depth: null } : {}),
      }));
      setActivePhotoKey('photo1');
      setActiveMeasurementKey('length');
      setStep('cameraPhoto1');
    } else {
      setMeasurements((prev) => ({
        ...prev,
        depth: null,
      }));
      setActivePhotoKey('photo2');
      setActiveMeasurementKey('depth');
      setStep('cameraPhoto2');
    }
  };

  const startReferenceTap = async (photoKey: PhotoKey) => {
    await triggerTickHaptic();
    setActivePhotoKey(photoKey);
    setStep(
      photoKey === 'photo1' ? 'photo1ReferenceTap' : 'photo2ReferenceTap',
    );
  };

  const handleReferenceTap = async (event: any) => {
    if (!selectedReference) {
      Alert.alert(
        'Missing reference',
        'Please choose a reference object first.',
      );
      return;
    }

    const { locationX, locationY } = event.nativeEvent;
    const suggestion = buildSuggestedDetection(
      locationX,
      locationY,
      selectedReference,
    );
    const computedPixelsPerInch =
      suggestion.estimatedPixels / selectedReference.realWidthInches;

    setPhotoState(activePhotoKey, (prev) => ({
      ...prev,
      referenceDetection: suggestion,
      pixelsPerInch: computedPixelsPerInch,
    }));

    await triggerTickHaptic();
    setStep(
      activePhotoKey === 'photo1'
        ? 'photo1ReferenceAdjust'
        : 'photo2ReferenceAdjust',
    );
  };

  const nudgeDetection = (direction: 'left' | 'right' | 'up' | 'down') => {
    const amount = 6;

    setPhotoState(activePhotoKey, (prev) => {
      if (!prev.referenceDetection) return prev;

      let nextX = prev.referenceDetection.x;
      let nextY = prev.referenceDetection.y;

      if (direction === 'left') nextX -= amount;
      if (direction === 'right') nextX += amount;
      if (direction === 'up') nextY -= amount;
      if (direction === 'down') nextY += amount;

      return {
        ...prev,
        referenceDetection: {
          ...prev.referenceDetection,
          x: clamp(nextX, 0, PREVIEW_WIDTH - prev.referenceDetection.width),
          y: clamp(nextY, 0, PREVIEW_HEIGHT - prev.referenceDetection.height),
        },
      };
    });
  };

  const resizeDetection = (delta: number) => {
    if (!selectedReference) return;

    setPhotoState(activePhotoKey, (prev) => {
      if (!prev.referenceDetection) return prev;

      const detection = prev.referenceDetection;
      const minSize = detection.shape === 'circle' ? 30 : 70;
      const maxWidth = PREVIEW_WIDTH - detection.x;
      const maxHeight = PREVIEW_HEIGHT - detection.y;

      if (detection.shape === 'circle') {
        const newSize = clamp(
          detection.width + delta,
          minSize,
          Math.min(maxWidth, maxHeight),
        );

        return {
          ...prev,
          referenceDetection: {
            ...detection,
            width: newSize,
            height: newSize,
            estimatedPixels: newSize,
          },
          pixelsPerInch: newSize / selectedReference.realWidthInches,
        };
      }

      const aspectRatio = detection.width / detection.height;
      let newWidth = clamp(detection.width + delta, minSize, maxWidth);
      let newHeight = newWidth / aspectRatio;

      if (newHeight > maxHeight) {
        newHeight = maxHeight;
        newWidth = newHeight * aspectRatio;
      }

      return {
        ...prev,
        referenceDetection: {
          ...detection,
          width: newWidth,
          height: newHeight,
          estimatedPixels: newWidth,
        },
        pixelsPerInch: newWidth / selectedReference.realWidthInches,
      };
    });
  };

  const recenterDetection = () => {
    setPhotoState(activePhotoKey, (prev) => {
      if (!prev.referenceDetection) return prev;

      const detection = prev.referenceDetection;

      return {
        ...prev,
        referenceDetection: {
          ...detection,
          x: (PREVIEW_WIDTH - detection.width) / 2,
          y: clamp(
            (PREVIEW_HEIGHT - detection.height) / 2,
            0,
            PREVIEW_HEIGHT - detection.height,
          ),
        },
      };
    });
  };

  const confirmReference = async () => {
    const currentPhoto = getPhotoState(activePhotoKey);

    if (!currentPhoto.referenceDetection || !currentPhoto.pixelsPerInch) {
      Alert.alert('Reference missing', 'Tap the reference object first.');
      return;
    }

    setPhotoState(activePhotoKey, (prev) => ({
      ...prev,
      measurementPoints: [],
    }));

    if (activePhotoKey === 'photo1') {
      setActiveMeasurementKey('length');
      setStep('measurePhoto1');
    } else {
      setActiveMeasurementKey('depth');
      setStep('measurePhoto2');
    }
  };

  const chooseMeasurementKey = async (key: MeasurementKey) => {
    if (isCylinder && activePhotoKey === 'photo1' && key === 'depth') {
      return;
    }

    await triggerTickHaptic();
    setActiveMeasurementKey(key);
    setPhotoState(activePhotoKey, (prev) => ({
      ...prev,
      measurementPoints: [],
    }));
  };

  const handleMeasurementTap = (event: any) => {
    const { locationX, locationY } = event.nativeEvent;

    setPhotoState(activePhotoKey, (prev) => {
      if (prev.measurementPoints.length >= 2) {
        return prev;
      }

      return {
        ...prev,
        measurementPoints: [
          ...prev.measurementPoints,
          { x: locationX, y: locationY },
        ],
      };
    });
  };

  const resetMeasurementPoints = async () => {
    await triggerTickHaptic();
    setPhotoState(activePhotoKey, (prev) => ({
      ...prev,
      measurementPoints: [],
    }));
  };

  const getDistanceBetweenPoints = (points: Point[]) => {
    if (points.length !== 2) return null;

    const [p1, p2] = points;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;

    return Math.sqrt(dx * dx + dy * dy);
  };

  const getCurrentMeasurementInches = () => {
    const currentPhoto = getPhotoState(activePhotoKey);
    const pixelDistance = getDistanceBetweenPoints(
      currentPhoto.measurementPoints,
    );

    if (!pixelDistance || !currentPhoto.pixelsPerInch) return null;

    return pixelDistance / currentPhoto.pixelsPerInch;
  };

  const saveCurrentMeasurement = async () => {
    const inches = getCurrentMeasurementInches();

    if (!inches) {
      Alert.alert(
        'Measurement missing',
        'Tap two points for this measurement first.',
      );
      return;
    }

    if (isCylinder && activePhotoKey === 'photo1') {
      if (activeMeasurementKey === 'length') {
        setMeasurements((prev) => ({
          ...prev,
          length: inches,
        }));

        setPhotoState(activePhotoKey, (prev) => ({
          ...prev,
          measurementPoints: [],
        }));

        await triggerSavedHaptic();
        showVisualFeedback('success', 'Length saved');
        setActiveMeasurementKey('width');

        //Alert.alert(
        // 'Length saved',
        //`${getMeasurementLabel('length')} saved as ${inches.toFixed(
        // 2,
        // )} inches. Now measure diameter.`,
        // );
        return;
      }

      if (activeMeasurementKey === 'width') {
        setMeasurements((prev) => ({
          ...prev,
          width: inches,
          depth: inches,
        }));

        setPhotoState(activePhotoKey, (prev) => ({
          ...prev,
          measurementPoints: [],
        }));

        await triggerSavedHaptic();
        showVisualFeedback('success', 'Diameter saved');

        //Alert.alert(
        //'Diameter saved',
        //`Diameter saved as ${inches.toFixed(2)} inches.`,
        // );
        return;
      }
    }

    setMeasurements((prev) => ({
      ...prev,
      [activeMeasurementKey]: inches,
    }));

    setPhotoState(activePhotoKey, (prev) => ({
      ...prev,
      measurementPoints: [],
    }));

    await triggerSavedHaptic();
    showVisualFeedback(
      'success',
      `${getMeasurementLabel(activeMeasurementKey)} saved`,
    );

    if (
      !isCylinder &&
      activePhotoKey === 'photo1' &&
      activeMeasurementKey === 'length'
    ) {
      setActiveMeasurementKey('width');

      //Alert.alert(
      //'Length saved',
      //`${getMeasurementLabel('length')} saved as ${inches.toFixed(
      //2,
      //)} inches. Now measure width.`,
      //);
      return;
    }

    if (activePhotoKey === 'photo2' && activeMeasurementKey === 'depth') {
      setStep('results');
      scrollToTop();
      //Alert.alert(
      //'Saved',
      //`${getMeasurementLabel(activeMeasurementKey)}: ${inches.toFixed(2)} in`,
      // [
      // {
      //text: 'OK',
      // onPress: () => setStep('results'),
      //},
      // ],
      //);
      return;
    }

    //Alert.alert(
    //'Saved',
    //`${getMeasurementLabel(activeMeasurementKey)}: ${inches.toFixed(2)} in`,
    //);
  };

  const goFromPhoto1 = () => {
    if (isCylinder) {
      if (
        measurements.length !== null &&
        measurements.width !== null &&
        measurements.depth !== null
      ) {
        setStep('results');
        return;
      }

      if (measurements.length !== null && measurements.width === null) {
        Alert.alert('Still missing measurements', 'Measure the diameter next.');
        setActiveMeasurementKey('width');
        return;
      }

      Alert.alert(
        'Still missing measurements',
        'Save both length and diameter first.',
      );
      return;
    }

    if (measurements.length !== null && measurements.width !== null) {
      openCamera('photo2');
      return;
    }

    if (measurements.length !== null && measurements.width === null) {
      setActiveMeasurementKey('width');
      Alert.alert('Still missing measurements', 'Measure width next.');
      return;
    }

    Alert.alert(
      'Still missing measurements',
      'Save both length and width first.',
    );
  };

  const goFromPhoto2 = () => {
    if (measurements.depth !== null) {
      setStep('results');
      return;
    }

    Alert.alert('Depth missing', 'Save the depth measurement first.');
  };

  const getCameraGuideText = () => {
    if (!selectedReference) {
      return 'Place the item and reference object in view.';
    }

    if (isCylinder) {
      return 'Move closer if needed. Keep the full cylinder and reference visible in one photo.';
    }

    if (activePhotoKey === 'photo2') {
      return 'Rotate the item slightly and capture the remaining depth. Keep both item and reference fully visible.';
    }

    return 'Move closer if needed. Fill most of the frame, but keep the entire item and reference visible.';
  };

  const getMeasureInstructionText = () => {
    const currentPhoto = getPhotoState(activePhotoKey);

    if (!currentPhoto.referenceDetection) {
      return 'Reference must be confirmed first.';
    }

    if (isCylinder && activePhotoKey === 'photo1') {
      if (currentPhoto.measurementPoints.length === 0) {
        return `Step ${getCylinderStepNumber()}: tap the first point for ${getMeasurementLabel(
          activeMeasurementKey,
        ).toLowerCase()}.`;
      }

      if (currentPhoto.measurementPoints.length === 1) {
        return `Step ${getCylinderStepNumber()}: tap the second point for ${getMeasurementLabel(
          activeMeasurementKey,
        ).toLowerCase()}.`;
      }

      return `${getMeasurementLabel(activeMeasurementKey)} is ready to save.`;
    }

    if (currentPhoto.measurementPoints.length === 0) {
      return `Tap the first point for ${getMeasurementLabel(activeMeasurementKey).toLowerCase()}.`;
    }

    if (currentPhoto.measurementPoints.length === 1) {
      return `Tap the second point for ${getMeasurementLabel(activeMeasurementKey).toLowerCase()}.`;
    }

    return `${getMeasurementLabel(activeMeasurementKey)} is ready to save.`;
  };

  const renderReferenceOverlay = (photoKey: PhotoKey) => {
    const photo = getPhotoState(photoKey);
    if (!photo.referenceDetection) return null;

    return (
      <View
        pointerEvents="none"
        style={[
          styles.detectedOverlay,
          photo.referenceDetection.shape === 'circle'
            ? styles.detectedCircle
            : styles.detectedRectangle,
          {
            left: photo.referenceDetection.x,
            top: photo.referenceDetection.y,
            width: photo.referenceDetection.width,
            height: photo.referenceDetection.height,
          },
        ]}
      />
    );
  };

  const renderMeasurementPoints = (photoKey: PhotoKey) => {
    const photo = getPhotoState(photoKey);

    return photo.measurementPoints.map((point, index) => (
      <View
        key={`point-${photoKey}-${index}-${point.x}-${point.y}`}
        style={[
          styles.measurePoint,
          {
            left: point.x - 11,
            top: point.y - 11,
          },
        ]}
      >
        <Text style={styles.measurePointText}>P{index + 1}</Text>
      </View>
    ));
  };

  const renderMeasurementLine = (photoKey: PhotoKey) => {
    const photo = getPhotoState(photoKey);

    if (photo.measurementPoints.length !== 2) return null;

    const [p1, p2] = photo.measurementPoints;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lineLength = Math.sqrt(dx * dx + dy * dy);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

    const midpointX = (p1.x + p2.x) / 2;
    const midpointY = (p1.y + p2.y) / 2;

    const measurementInches =
      photo.pixelsPerInch && lineLength
        ? lineLength / photo.pixelsPerInch
        : null;
    const measurementText = measurementInches
      ? `${measurementInches.toFixed(2)} in`
      : null;

    const labelWidth = 92;
    const labelHeight = 30;
    const labelLeft = clamp(
      midpointX - labelWidth / 2,
      8,
      PREVIEW_WIDTH - labelWidth - 8,
    );
    const labelTop = clamp(midpointY - 42, 8, PREVIEW_HEIGHT - labelHeight - 8);

    const capLength = 14;
    const capThickness = 3;

    return (
      <>
        <View
          pointerEvents="none"
          style={[
            styles.measureLine,
            {
              left: midpointX - lineLength / 2,
              top: midpointY - 1.5,
              width: lineLength,
              transform: [{ rotate: `${angle}deg` }],
            },
          ]}
        />

        <View
          pointerEvents="none"
          style={[
            styles.measureCap,
            {
              left: p1.x - capLength / 2,
              top: p1.y - capThickness / 2,
              width: capLength,
              height: capThickness,
              transform: [{ rotate: `${angle + 90}deg` }],
            },
          ]}
        />

        <View
          pointerEvents="none"
          style={[
            styles.measureCap,
            {
              left: p2.x - capLength / 2,
              top: p2.y - capThickness / 2,
              width: capLength,
              height: capThickness,
              transform: [{ rotate: `${angle + 90}deg` }],
            },
          ]}
        />

        {measurementText ? (
          <View
            pointerEvents="none"
            style={[
              styles.measureLabel,
              {
                left: labelLeft,
                top: labelTop,
                width: labelWidth,
                height: labelHeight,
              },
            ]}
          >
            <Text style={styles.measureLabelText}>{measurementText}</Text>
          </View>
        ) : null}
      </>
    );
  };

  const renderProgressCard = (photoKey: PhotoKey) => {
    const stepNumber = getPhotoProgressStep(photoKey);
    const totalSteps = getPhotoProgressTotal();
    const savedCount = getSavedMeasurementCountForPhoto(photoKey);
    const totalMeasurements = getMeasurementKeysForPhoto(photoKey).length;
    const photoLabel = getPhotoTitle(photoKey);

    return (
      <View style={styles.progressCard}>
        <View style={styles.progressTopRow}>
          <View style={styles.progressBadge}>
            <Text style={styles.progressBadgeText}>
              Step {stepNumber} of {totalSteps}
            </Text>
          </View>
          <Text style={styles.progressSummaryText}>
            {savedCount}/{totalMeasurements} saved
          </Text>
        </View>

        <Text style={styles.progressTitle}>{photoLabel}</Text>
        <Text style={styles.progressDescription}>
          {photoKey === 'photo1'
            ? isCylinder
              ? 'Save length and diameter from this photo.'
              : 'Save length and width before moving on.'
            : 'Save depth from the second photo to finish.'}
        </Text>
      </View>
    );
  };

  const renderCylinderStepCard = () => {
    if (!isCylinder || activePhotoKey !== 'photo1') return null;

    const isLength = activeMeasurementKey === 'length';
    const lengthDone = measurements.length !== null;
    const diameterDone = measurements.width !== null;

    return (
      <View style={styles.stepCard}>
        <Text style={styles.stepCardEyebrow}>Cylinder workflow</Text>
        <Text style={styles.stepCardTitle}>
          Step {getCylinderStepNumber()} of 2: {getCylinderStepTitle()}
        </Text>
        <Text style={styles.stepCardDescription}>
          {getCylinderStepDescription()}
        </Text>

        <View style={styles.stepPillRow}>
          <TouchableOpacity
            style={[
              styles.stepPill,
              isLength && styles.stepPillActive,
              lengthDone && styles.stepPillDone,
            ]}
            onPress={() => chooseMeasurementKey('length')}
            activeOpacity={0.75}
          >
            <Text
              style={[
                styles.stepPillText,
                (isLength || lengthDone) && styles.stepPillTextActive,
              ]}
            >
              {lengthDone ? '✓ Length' : '1. Length'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.stepPill,
              !isLength && styles.stepPillActive,
              diameterDone && styles.stepPillDone,
            ]}
            onPress={() => chooseMeasurementKey('width')}
            activeOpacity={0.75}
          >
            <Text
              style={[
                styles.stepPillText,
                (!isLength || diameterDone) && styles.stepPillTextActive,
              ]}
            >
              {diameterDone ? '✓ Diameter' : '2. Diameter'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderPhotoPreview = (photoKey: PhotoKey) => {
    const photo = getPhotoState(photoKey);

    if (!photo.uri) return null;

    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView
          ref={activeScrollRef}
          style={styles.flexFill}
          contentContainerStyle={styles.packageFrontScrollContent}
          showsVerticalScrollIndicator
        >
          <Text style={styles.title}>{getPhotoTitle(photoKey)}</Text>
          <Text style={styles.subtitle}>
            Check the photo. If it looks good, continue and tap the reference
            object.
          </Text>

          {renderProgressCard(photoKey)}

          <View style={[styles.resultCard, styles.photoPreviewCard]}>
            <View style={styles.previewWrap}>
              <Image
                source={{ uri: photo.uri }}
                style={styles.previewImage}
                resizeMode="cover"
              />
            </View>
          </View>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => startReferenceTap(photoKey)}
            activeOpacity={0.75}
          >
            <Text style={styles.primaryButtonText}>Use This Photo</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => retakePhoto(photoKey)}
            activeOpacity={0.75}
          >
            <Text style={[styles.secondaryButtonText, { color: '#fff' }]}>
              Retake Photo
            </Text>
          </TouchableOpacity>
        </ScrollView>
        {renderProcessingOverlay()}
      </SafeAreaView>
    );
  };

  const renderReferenceTap = (photoKey: PhotoKey) => {
    const photo = getPhotoState(photoKey);

    if (!photo.uri) return null;

    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView
          ref={activeScrollRef}
          style={styles.flexFill}
          contentContainerStyle={styles.packageFrontScrollContent}
          showsVerticalScrollIndicator
        >
          <Text style={styles.title}>Tap Reference Object</Text>
          <Text style={styles.subtitle}>
            Tap the {selectedReference?.label ?? 'reference object'} in the
            photo. You can fine-tune the box on the next screen.
          </Text>

          {renderProgressCard(photoKey)}

          <TouchableOpacity
            style={styles.previewWrap}
            activeOpacity={0.95}
            onPress={handleReferenceTap}
          >
            <Image
              source={{ uri: photo.uri }}
              style={styles.previewImage}
              resizeMode="cover"
            />
            {renderReferenceOverlay(photoKey)}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => retakePhoto(photoKey)}
            activeOpacity={0.75}
          >
            <Text style={[styles.secondaryButtonText, { color: '#fff' }]}>
              Retake Photo
            </Text>
          </TouchableOpacity>
        </ScrollView>
        {renderProcessingOverlay()}
      </SafeAreaView>
    );
  };

  const renderReferenceAdjust = (photoKey: PhotoKey) => {
    const photo = getPhotoState(photoKey);

    if (!photo.uri) return null;

    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView
          ref={activeScrollRef}
          style={styles.flexFill}
          contentContainerStyle={styles.packageFrontScrollContent}
          showsVerticalScrollIndicator
        >
          <Text style={styles.title}>Adjust Reference</Text>
          <Text style={styles.subtitle}>
            Line the green outline up with the reference object, then confirm
            it.
          </Text>

          {renderProgressCard(photoKey)}

          <View style={styles.previewWrap}>
            <Image
              source={{ uri: photo.uri }}
              style={styles.previewImage}
              resizeMode="cover"
            />
            {renderReferenceOverlay(photoKey)}
          </View>

          <View style={styles.adjustTopCardCompact}>
            <View style={styles.adjustTopGrid}>
              <View style={styles.adjustTopRowSpread}>
                <TouchableOpacity
                  style={styles.adjustArrowButton}
                  onPress={() => nudgeDetection('up')}
                >
                  <Text style={styles.adjustArrowButtonText}>↑</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.adjustMiddleRowCompact}>
                <TouchableOpacity
                  style={styles.adjustArrowButton}
                  onPress={() => nudgeDetection('left')}
                >
                  <Text style={styles.adjustArrowButtonText}>←</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.adjustRecenterButton}
                  onPress={recenterDetection}
                >
                  <Text style={styles.adjustRecenterButtonText}>Center</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.adjustArrowButton}
                  onPress={() => nudgeDetection('right')}
                >
                  <Text style={styles.adjustArrowButtonText}>→</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.adjustTopRowSpread}>
                <TouchableOpacity
                  style={styles.adjustArrowButton}
                  onPress={() => nudgeDetection('down')}
                >
                  <Text style={styles.adjustArrowButtonText}>↓</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.adjustBottomRow}>
                <TouchableOpacity
                  style={styles.adjustResizeButtonWide}
                  onPress={() => resizeDetection(-8)}
                >
                  <Text style={styles.adjustResizeButtonText}>Smaller</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.adjustResizeButtonWide}
                  onPress={() => resizeDetection(8)}
                >
                  <Text style={styles.adjustResizeButtonText}>Larger</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={confirmReference}
            activeOpacity={0.75}
          >
            <Text style={styles.primaryButtonText}>Confirm Reference</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => startReferenceTap(photoKey)}
            activeOpacity={0.75}
          >
            <Text style={[styles.secondaryButtonText, { color: '#fff' }]}>
              Tap Again
            </Text>
          </TouchableOpacity>
        </ScrollView>
        {renderProcessingOverlay()}
      </SafeAreaView>
    );
  };

  const renderMeasureScreen = (photoKey: PhotoKey) => {
    const photo = getPhotoState(photoKey);
    const measurementInches = getCurrentMeasurementInches();
    const measurementKeys = getMeasurementKeysForPhoto(photoKey);

    if (!photo.uri) return null;

    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView
          ref={activeScrollRef}
          style={styles.flexFill}
          contentContainerStyle={styles.packageFrontScrollContent}
          showsVerticalScrollIndicator
        >
          <Text style={styles.title}>
            {getMeasurementLabel(activeMeasurementKey)}
          </Text>
          <Text style={styles.subtitle}>{getMeasureInstructionText()}</Text>

          {renderProgressCard(photoKey)}
          {renderCylinderStepCard()}

          <View style={styles.dimensionRow}>
            {measurementKeys.map((key) => {
              const isActive = activeMeasurementKey === key;
              const isSaved = isMeasurementSavedForPhoto(photoKey, key);

              return (
                <TouchableOpacity
                  key={`${photoKey}-${key}`}
                  style={[
                    styles.dimensionButton,
                    isActive && styles.dimensionButtonActive,
                    isSaved && styles.dimensionButtonSaved,
                  ]}
                  onPress={() => chooseMeasurementKey(key)}
                  activeOpacity={0.75}
                >
                  <View style={styles.dimensionButtonInner}>
                    <Text
                      style={[
                        styles.dimensionButtonText,
                        isActive && styles.dimensionButtonTextActive,
                        isSaved && styles.dimensionButtonTextSaved,
                      ]}
                    >
                      {getMeasurementLabel(key)}
                    </Text>
                    {isSaved ? (
                      <View style={styles.dimensionCheckBadge}>
                        <Text style={styles.dimensionCheckBadgeText}>✓</Text>
                      </View>
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            style={styles.previewWrap}
            activeOpacity={0.95}
            onPress={handleMeasurementTap}
          >
            <Image
              source={{ uri: photo.uri }}
              style={styles.previewImage}
              resizeMode="cover"
            />
            {renderReferenceOverlay(photoKey)}
            {renderMeasurementLine(photoKey)}
            {renderMeasurementPoints(photoKey)}
          </TouchableOpacity>

          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>Current measurement</Text>
            <Text style={styles.resultValueSmall}>
              {measurementInches
                ? `${measurementInches.toFixed(2)} in`
                : 'Tap two points'}
            </Text>
            <Text style={styles.resultDescription}>
              {getMeasureInstructionText()}
            </Text>
          </View>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={saveCurrentMeasurement}
            activeOpacity={0.75}
          >
            <Text style={styles.primaryButtonText}>
              Save {getMeasurementLabel(activeMeasurementKey)}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={resetMeasurementPoints}
            activeOpacity={0.75}
          >
            <Text style={[styles.secondaryButtonText, { color: '#fff' }]}>
              Clear Points
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() =>
              photoKey === 'photo1' ? goFromPhoto1() : goFromPhoto2()
            }
            activeOpacity={0.75}
          >
            <Text style={[styles.secondaryButtonText, { color: '#fff' }]}>
              {getTopContinueLabel(photoKey)}
            </Text>
          </TouchableOpacity>
        </ScrollView>
        {renderProcessingOverlay()}
      </SafeAreaView>
    );
  };

  const renderFeedbackOverlay = () => {
    if (!visualFeedback) return null;

    const containerStyle =
      visualFeedback.type === 'success'
        ? styles.feedbackToastSuccess
        : visualFeedback.type === 'error'
          ? styles.feedbackToastError
          : styles.feedbackToastInfo;

    const textStyle =
      visualFeedback.type === 'success'
        ? styles.feedbackToastTextSuccess
        : visualFeedback.type === 'error'
          ? styles.feedbackToastTextError
          : styles.feedbackToastTextInfo;

    return (
      <View pointerEvents="none" style={[styles.feedbackToast, containerStyle]}>
        <Text style={[styles.feedbackToastText, textStyle]}>
          {visualFeedback.message}
        </Text>
      </View>
    );
  };

  // ===== GARAGE SALE PHASE 1: HOME SCREEN UI START =====
  const renderReferencePicker = () => {
    const isSourcingOnly = homeMode === 'dealFinder';

    return (
      <SafeAreaView style={styles.screen}>
        {successMessage ? (
          <View
            style={{
              position: 'absolute',
              top: 80,
              left: 20,
              right: 20,
              backgroundColor: '#dcfce7',
              padding: 14,
              borderRadius: 12,
              alignItems: 'center',
              zIndex: 999,
            }}
          >
            <Text style={{ color: '#166534', fontWeight: '600', fontSize: 16 }}>
              {successMessage}
            </Text>
          </View>
        ) : null}
        <ScrollView
          ref={activeScrollRef}
          style={styles.flexFill}
          contentContainerStyle={styles.packageFrontScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
          contentInsetAdjustmentBehavior="automatic"
        >
          {/* ===== GARAGE SALE PHASE 1: SOURCING ONLY BLOCK START ===== */}
          {isSourcingOnly ? (
            <>
              <Text style={styles.title}>Thrift Store Finder</Text>

              <View
                style={[
                  styles.resultCard,
                  {
                    backgroundColor: '#eef6ff',
                    borderColor: '#bfdbfe',
                    borderWidth: 1,
                  },
                ]}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.resultLabel}>Local Weather</Text>
                    <Text style={styles.resultValueSmall}>
                      {weatherData?.locationLabel || 'Checking your area...'}
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={[
                      styles.secondaryButton,
                      {
                        height: 48,
                        justifyContent: 'center',
                        alignItems: 'center',
                      },
                      {
                        width: 110,
                        minWidth: 110,
                        paddingVertical: 10,
                        paddingHorizontal: 14,
                      },
                    ]}
                    onPress={() => {
                      void fetchSourcingWeather();
                    }}
                    activeOpacity={0.75}
                  >
                    <Text
                      style={[styles.secondaryButtonText, { color: '#fff' }]}
                    >
                      Refresh
                    </Text>
                  </TouchableOpacity>
                </View>

                {weatherLoading ? (
                  <Text style={[styles.resultDescription, { marginTop: 12 }]}>
                    Loading local weather...
                  </Text>
                ) : weatherError ? (
                  <Text
                    style={[
                      styles.resultDescription,
                      { marginTop: 12, color: '#b91c1c' },
                    ]}
                  >
                    {weatherError}
                  </Text>
                ) : weatherData ? (
                  <>
                    <Text
                      style={[
                        styles.resultValueSmall,
                        { marginTop: 12, fontSize: 28, lineHeight: 34 },
                      ]}
                    >
                      {getWeatherIcon(weatherData.conditionLabel)}{' '}
                      {weatherData.currentTempF}° • {weatherData.conditionLabel}
                    </Text>
                    <Text style={[styles.resultDescription, { marginTop: 8 }]}>
                      High {weatherData.highTempF}° / Low {weatherData.lowTempF}
                      °
                    </Text>
                    <Text style={styles.resultDescription}>
                      Rain chance {weatherData.rainChance}% • Wind{' '}
                      {weatherData.windMph} mph
                    </Text>
                    <Text
                      style={[
                        styles.resultDescription,
                        { marginTop: 10, fontWeight: '600', color: '#1d4ed8' },
                      ]}
                    >
                      {weatherData.sourcingNote}
                    </Text>
                  </>
                ) : (
                  <Text style={[styles.resultDescription, { marginTop: 12 }]}>
                    Weather is not available yet. Tap Refresh to try again.
                  </Text>
                )}
              </View>
              <View style={styles.resultCard}>
                <Text style={styles.resultLabel}>Deal Finder</Text>
                <Text style={styles.resultValueSmall}>
                  {garageFinderMode === 'thrift'
                    ? 'Thrift Stores'
                    : 'Estate Sales'}
                </Text>
                <Text style={styles.resultDescription}>
                  {garageFinderMode === 'thrift'
                    ? 'Open a simple local thrift board for your area with one-tap access to nearby thrift stores, resale shops, and second-hand spots.'
                    : 'Open a simple local estate-sale board for your area with one-tap access to nearby estate sales and map results.'}
                </Text>
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={() => {
                    if (garageFinderMode === 'thrift') {
                      setSelectedGarageSalePinId(null);
                      setVisibleGarageSalesCount(10);
                      setStep('garageSalesMap');
                    } else {
                      setStep('estateSaleLanding');
                    }
                    scrollToTop();
                  }}
                  activeOpacity={0.75}
                >
                  <Text style={styles.primaryButtonText}>
                    {garageFinderMode === 'thrift'
                      ? 'Thrift Stores Near You'
                      : 'EstateSales.net Near You'}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              {/* ===== GARAGE SALE PHASE 1: STANDARD HOME BLOCK ===== */}
              <View style={styles.headerRow}>
                <Image
                  source={require('../../assets/logo-icon.png')}
                  style={styles.headerIcon}
                  resizeMode="contain"
                />
                <Text style={styles.headerTitle}>List Assist</Text>
              </View>
              <Text style={styles.subtitle}></Text>

              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: '#e5e7eb',
                  borderRadius: 999,
                  padding: 4,
                  marginTop: 4,
                  marginBottom: 16,
                }}
              >
                <TouchableOpacity
                  style={{
                    flex: 1,
                    paddingVertical: 10,
                    borderRadius: 999,
                    backgroundColor:
                      homeScanMode === 'list' ? '#111827' : 'transparent',
                    alignItems: 'center',
                  }}
                  onPress={() => setHomeScanMode('list')}
                  activeOpacity={0.85}
                >
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: '800',
                      color: homeScanMode === 'list' ? '#ffffff' : '#374151',
                    }}
                  >
                    List Mode
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={{
                    flex: 1,
                    paddingVertical: 10,
                    borderRadius: 999,
                    backgroundColor:
                      homeScanMode === 'source' ? '#111827' : 'transparent',
                    alignItems: 'center',
                  }}
                  onPress={() => setHomeScanMode('source')}
                  activeOpacity={0.85}
                >
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: '800',
                      color: homeScanMode === 'source' ? '#ffffff' : '#374151',
                    }}
                  >
                    Source Mode
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.resultCard}>
                <Text style={styles.resultValueSmall}>
                  Scan Barcode, Box, or Item
                </Text>

                {barcodeFailureState ? (
                  <View
                    style={[
                      styles.barcodeFailureCard,
                      { marginTop: 14, marginBottom: 2 },
                    ]}
                  >
                    <Text style={styles.barcodeFailureTitle}>
                      {barcodeFailureState.title}
                    </Text>
                    <Text style={styles.barcodeFailureBody}>
                      {barcodeFailureState.message}
                    </Text>
                  </View>
                ) : null}

                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    marginTop: 12,
                  }}
                >
                  <Animated.View
                    style={{
                      flex: 1,
                      transform: [{ scale: scaleAnimBarcode }],
                    }}
                  >
                    <TouchableOpacity
                      style={[
                        styles.primaryButton,
                        {
                          height: 48,
                          justifyContent: 'center',
                          alignItems: 'center',
                          marginTop: 0,
                          paddingHorizontal: 8,
                        },
                      ]}
                      onPress={() => {
                        setHomeMode('boxFinder');
                        setIsPriceCheckerSession(homeScanMode === 'source');
                        startBarcodeScan();
                      }}
                      onPressIn={() => {
                        Animated.spring(scaleAnimBarcode, {
                          toValue: 0.96,
                          useNativeDriver: true,
                        }).start();
                      }}
                      onPressOut={() => {
                        Animated.spring(scaleAnimBarcode, {
                          toValue: 1,
                          useNativeDriver: true,
                        }).start();
                      }}
                      activeOpacity={0.85}
                    >
                      <Text
                        style={styles.splitActionButtonText}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                      >
                        Barcode
                      </Text>
                    </TouchableOpacity>
                  </Animated.View>

                  <Animated.View
                    style={{
                      flex: 1,
                      transform: [{ scale: scaleAnimBox }],
                    }}
                  >
                    <TouchableOpacity
                      style={[
                        styles.secondaryButton,
                        {
                          height: 48,
                          justifyContent: 'center',
                          alignItems: 'center',
                          marginTop: 0,
                          paddingHorizontal: 8,
                          backgroundColor: '#0F766E',
                          borderColor: '#0F766E',
                        },
                      ]}
                      onPress={() => {
                        setHomeMode('boxFinder');
                        setIsPriceCheckerSession(homeScanMode === 'source');
                        startPackageFrontScan();
                      }}
                      onPressIn={() => {
                        Animated.spring(scaleAnimBox, {
                          toValue: 0.96,
                          useNativeDriver: true,
                        }).start();
                      }}
                      onPressOut={() => {
                        Animated.spring(scaleAnimBox, {
                          toValue: 1,
                          useNativeDriver: true,
                        }).start();
                      }}
                      activeOpacity={0.85}
                    >
                      <Text
                        style={[styles.secondaryButtonText, { color: '#fff' }]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                      >
                        Box
                      </Text>
                    </TouchableOpacity>
                  </Animated.View>

                  <Animated.View
                    style={{
                      flex: 1,
                      transform: [{ scale: scaleAnimItem }],
                    }}
                  >
                    <TouchableOpacity
                      style={[
                        styles.secondaryButton,
                        {
                          height: 48,
                          justifyContent: 'center',
                          alignItems: 'center',
                          marginTop: 0,
                          paddingHorizontal: 8,
                          backgroundColor: '#2DBE60',
                          borderColor: '#2DBE60',
                        },
                      ]}
                      onPress={() => {
                        setHomeMode('boxFinder');
                        setIsPriceCheckerSession(homeScanMode === 'source');
                        startLooseItemScan();
                      }}
                      onPressIn={() => {
                        Animated.spring(scaleAnimItem, {
                          toValue: 0.96,
                          useNativeDriver: true,
                        }).start();
                      }}
                      onPressOut={() => {
                        Animated.spring(scaleAnimItem, {
                          toValue: 1,
                          useNativeDriver: true,
                        }).start();
                      }}
                      activeOpacity={0.85}
                    >
                      <Text
                        style={[styles.secondaryButtonText, { color: '#fff' }]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                      >
                        Item
                      </Text>
                    </TouchableOpacity>
                  </Animated.View>
                </View>
              </View>

              {homeScanMode === 'source' ? (
                <View style={[styles.resultCard, { marginTop: 18 }]}>
                  <Text style={styles.sectionLabel}>Find Deals Near You</Text>

                  <TouchableOpacity
                    style={[
                      styles.secondaryButton,
                      styles.finderButton,
                      {
                        backgroundColor: '#1E3A8A',
                        borderColor: '#1E3A8A',
                      },
                    ]}
                    onPress={() => {
                      setHomeMode('dealFinder');
                      setGarageFinderMode('garage');
                      setStep('garageSaleLanding');
                      scrollToTop();
                    }}
                    activeOpacity={0.75}
                  >
                    <Text
                      style={[styles.secondaryButtonText, { color: '#fff' }]}
                    >
                      Garage Sale Finder
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.secondaryButton,
                      styles.finderButton,
                      {
                        marginTop: 16,
                        backgroundColor: '#2563EB',
                        borderColor: '#2563EB',
                      },
                    ]}
                    onPress={() => {
                      setHomeMode('boxFinder');
                      setGarageFinderMode('sales');
                      setStep('estateSaleLanding');
                      scrollToTop();
                    }}
                    activeOpacity={0.75}
                  >
                    <Text
                      style={[styles.secondaryButtonText, { color: '#fff' }]}
                    >
                      Estate Sale Finder
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.secondaryButton,
                      styles.finderButton,
                      {
                        marginTop: 16,
                        backgroundColor: '#0F766E',
                        borderColor: '#0F766E',
                      },
                    ]}
                    onPress={() => {
                      setHomeMode('dealFinder');
                      setGarageFinderMode('thrift');
                      setStep('referencePicker');
                      scrollToTop();
                    }}
                    activeOpacity={0.75}
                  >
                    <Text
                      style={[styles.secondaryButtonText, { color: '#fff' }]}
                    >
                      Thrift Store Finder
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={[styles.resultCard, { marginTop: 22 }]}>
                  <Text style={styles.sectionLabel}>Seller Resources</Text>

                  <View
                    style={{
                      height: 1,
                      backgroundColor: '#E5E7EB',
                      marginTop: 10,
                      marginBottom: 14,
                    }}
                  />

                  <TouchableOpacity
                    style={[
                      styles.secondaryButton,
                      {
                        height: 48,
                        justifyContent: 'center',
                        alignItems: 'center',
                      },
                      {
                        marginTop: 0,
                        backgroundColor: '#7C3AED',
                        borderColor: '#7C3AED',
                        paddingVertical: 12,
                      },
                    ]}
                    onPress={() => {
                      setStep('sellerTools');
                      scrollToTop();
                    }}
                    activeOpacity={0.75}
                  >
                    <Text
                      style={[styles.secondaryButtonText, { color: '#fff' }]}
                    >
                      Recommended Seller Tools
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}
        </ScrollView>
        {renderProcessingOverlay()}
      </SafeAreaView>
    );
  };

  const renderSellerTools = () => {
    const groupedProducts = SELLER_TOOLS_PRODUCTS.reduce<
      Record<string, SellerToolProduct[]>
    >((acc, product) => {
      if (!acc[product.category]) acc[product.category] = [];
      acc[product.category].push(product);
      return acc;
    }, {});

    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView
          ref={activeScrollRef}
          style={styles.flexFill}
          contentContainerStyle={styles.packageFrontScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
          contentInsetAdjustmentBehavior="automatic"
        >
          <Text style={styles.title}>Seller Tools</Text>

          {Object.entries(groupedProducts).map(([category, products]) => (
            <View key={category} style={styles.resultCard}>
              <Text style={styles.resultValueSmall}>{category}</Text>

              {products.map((product, index) => (
                <View
                  key={product.id}
                  style={{
                    marginTop: index === 0 ? 12 : 18,
                    paddingTop: index === 0 ? 0 : 18,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderTopColor: '#e5e7eb',
                  }}
                >
                  <Text
                    style={[
                      styles.resultValueSmall,
                      { fontSize: 22, lineHeight: 28 },
                    ]}
                  >
                    {product.name}
                  </Text>
                  <Text style={[styles.resultDescription, { marginTop: 8 }]}>
                    {product.description}
                  </Text>
                  {product.note ? (
                    <Text
                      style={[
                        styles.resultDescription,
                        { marginTop: 8, fontWeight: '600', color: '#7C3AED' },
                      ]}
                    >
                      {product.note}
                    </Text>
                  ) : null}
                  <TouchableOpacity
                    style={[
                      styles.secondaryButton,
                      {
                        marginTop: 12,
                        height: 48,
                        justifyContent: 'center',
                        alignItems: 'center',
                        backgroundColor: '#7C3AED',
                        borderColor: '#7C3AED',
                      },
                    ]}
                    onPress={() => {
                      void openAmazonLink(product.amazonUrl);
                    }}
                    activeOpacity={0.75}
                  >
                    <Text
                      style={[styles.secondaryButtonText, { color: '#fff' }]}
                    >
                      View on Amazon
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
        {renderProcessingOverlay()}
      </SafeAreaView>
    );
  };

  const renderLandingWeatherCard = () => (
    <View
      style={[
        styles.resultCard,
        {
          backgroundColor: '#eef6ff',
          borderColor: '#bfdbfe',
          borderWidth: 1,
          marginTop: 16,
          marginBottom: 16,
        },
      ]}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.resultLabel}>Local Weather</Text>
          <Text style={styles.resultValueSmall}>
            {sourcingLocationLabel === 'your area'
              ? 'Checking your area...'
              : sourcingLocationLabel}
          </Text>
        </View>

        <TouchableOpacity
          style={[
            styles.secondaryButton,
            {
              height: 48,
              justifyContent: 'center',
              alignItems: 'center',
              width: 110,
              minWidth: 110,
              paddingVertical: 10,
              paddingHorizontal: 14,
            },
          ]}
          onPress={() => {
            void fetchSourcingLocationLabel();
            void fetchSourcingWeather();
          }}
          activeOpacity={0.75}
        >
          <Text style={[styles.secondaryButtonText, { color: '#fff' }]}>
            Refresh
          </Text>
        </TouchableOpacity>
      </View>

      {weatherLoading ? (
        <Text style={[styles.resultDescription, { marginTop: 12 }]}>
          Loading local weather...
        </Text>
      ) : weatherError ? (
        <Text
          style={[
            styles.resultDescription,
            { marginTop: 12, color: '#b91c1c' },
          ]}
        >
          {weatherError}
        </Text>
      ) : weatherData ? (
        <>
          <Text
            style={[
              styles.resultValueSmall,
              { marginTop: 12, fontSize: 28, lineHeight: 34 },
            ]}
          >
            {getWeatherIcon(weatherData.conditionLabel)}{' '}
            {weatherData.currentTempF}° • {weatherData.conditionLabel}
          </Text>
          <Text style={[styles.resultDescription, { marginTop: 8 }]}>
            High {weatherData.highTempF}° / Low {weatherData.lowTempF}°
          </Text>
          <Text style={styles.resultDescription}>
            Rain chance {weatherData.rainChance}% • Wind {weatherData.windMph}{' '}
            mph
          </Text>
          <Text
            style={[
              styles.resultDescription,
              { marginTop: 10, fontWeight: '600', color: '#1d4ed8' },
            ]}
          >
            {weatherData.sourcingNote}
          </Text>
        </>
      ) : (
        <Text style={[styles.resultDescription, { marginTop: 12 }]}>
          Weather is not available yet. Tap Refresh to try again.
        </Text>
      )}
    </View>
  );

  const renderInlineSourceScanCard = (returnStep: AppStep) => {
    return (
      <View style={styles.resultCard}>
        <Text style={styles.resultDescription}>
          Scan Barcode, Box, or Item.
        </Text>

        <View style={styles.priceCheckerScanRow}>
          <TouchableOpacity
            style={[
              styles.priceCheckerScanButton,
              { backgroundColor: '#1E2F4D' },
            ]}
            onPress={() => {
              setPriceCheckerReturnStep(returnStep);
              setIsPriceCheckerSession(true);
              void startBarcodeScan();
              scrollToTop();
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.priceCheckerScanButtonText}>Barcode</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.priceCheckerScanButton,
              { backgroundColor: '#157A74' },
            ]}
            onPress={() => {
              setPriceCheckerReturnStep(returnStep);
              setIsPriceCheckerSession(true);
              void startPackageFrontScan();
              scrollToTop();
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.priceCheckerScanButtonText}>Box</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.priceCheckerScanButton,
              { backgroundColor: '#24C55A' },
            ]}
            onPress={() => {
              setPriceCheckerReturnStep(returnStep);
              setIsPriceCheckerSession(true);
              void startLooseItemScan();
              scrollToTop();
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.priceCheckerScanButtonText}>Item</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderGarageSaleLanding = () => {
    const locationLabel = sourcingLocationLabel || 'your area';

    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView
          ref={activeScrollRef}
          style={styles.flexFill}
          contentContainerStyle={styles.packageFrontScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
          contentInsetAdjustmentBehavior="automatic"
        >
          <Text style={styles.title}>Garage Sale Finder</Text>

          {renderLandingWeatherCard()}

          <View style={styles.resultCard}>
            <Text style={styles.resultValueSmall}>
              Craigslist for {locationLabel}
            </Text>

            <TouchableOpacity
              style={[
                styles.primaryButton,
                {
                  backgroundColor: '#1E3A8A',
                  marginTop: 18,
                },
              ]}
              onPress={() => {
                void openCraigslistGarageSalesLink();
              }}
              activeOpacity={0.75}
            >
              <Text style={styles.primaryButtonText}>
                Craigslist Garage Sales Near You
              </Text>
            </TouchableOpacity>
          </View>

          {renderInlineSourceScanCard('garageSaleLanding')}
        </ScrollView>
        {renderProcessingOverlay()}
      </SafeAreaView>
    );
  };

  const renderEstateSaleLanding = () => {
    const locationLabel = sourcingLocationLabel || 'your area';

    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView
          ref={activeScrollRef}
          style={styles.flexFill}
          contentContainerStyle={styles.packageFrontScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
          contentInsetAdjustmentBehavior="automatic"
        >
          <Text style={styles.title}>Estate Sale Finder</Text>

          {renderLandingWeatherCard()}

          <View style={styles.resultCard}>
            <Text style={styles.resultValueSmall}>
              EstateSales.net for {locationLabel}
            </Text>

            <TouchableOpacity
              style={[
                styles.primaryButton,
                {
                  backgroundColor: '#2563EB',
                  marginTop: 18,
                },
              ]}
              onPress={() => {
                void openEstateSalesNetLink();
              }}
              activeOpacity={0.75}
            >
              <Text style={styles.primaryButtonText}>
                EstateSales.net Near You
              </Text>
            </TouchableOpacity>
          </View>

          {renderInlineSourceScanCard('estateSaleLanding')}
        </ScrollView>
        {renderProcessingOverlay()}
      </SafeAreaView>
    );
  };

  const renderGarageSales = () => {
    const locationLabel = weatherData?.locationLabel || 'your area';
    const isThriftFinder = garageFinderMode === 'thrift';
    const isGarageFinder = garageFinderMode === 'garage';
    const searchCards = isThriftFinder
      ? [
          {
            id: 'thrift-stores-near-me',
            title: 'Thrift Stores Near Me',
            subtitle:
              'Best quick search for nearby thrift and second-hand stores.',
            query: `thrift stores near ${locationLabel}`,
          },
          {
            id: 'resale-shops-near-me',
            title: 'Resale Shops',
            subtitle: 'Good for resale boutiques and consignment shops.',
            query: `resale shops near ${locationLabel}`,
          },
          {
            id: 'second-hand-stores-near-me',
            title: 'Second-Hand Stores',
            subtitle: 'Useful for broader used-goods store searches.',
            query: `second hand stores near ${locationLabel}`,
          },
          {
            id: 'consignment-stores-near-me',
            title: 'Consignment Stores',
            subtitle: 'Looks for nearby consignment and curated resale spots.',
            query: `consignment stores near ${locationLabel}`,
          },
        ]
      : isGarageFinder
        ? [
            {
              id: 'garage-sales',
              title: 'Garage Sales',
              subtitle: 'Nearby garage sale listings in your selected radius.',
              query: `garage sales near ${locationLabel}`,
            },
          ]
        : [
            {
              id: 'estate-sales',
              title: 'Estate Sales',
              subtitle: 'Nearby estate sale listings in your selected radius.',
              query: `estate sales near ${locationLabel}`,
            },
          ];

    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView
          ref={activeScrollRef}
          style={styles.flexFill}
          contentContainerStyle={styles.packageFrontScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
          contentInsetAdjustmentBehavior="automatic"
        >
          <Text style={styles.title}>{getFinderTitle(garageFinderMode)}</Text>
          <Text style={styles.subtitle}>
            {getFinderResultIntro(garageFinderMode, locationLabel)}
          </Text>

          {renderGarageSaleRadiusPicker()}

          {renderInlineSourceScanCard('garageSales')}

          <View
            style={[
              styles.resultCard,
              {
                backgroundColor: '#eef6ff',
                borderColor: '#bfdbfe',
                borderWidth: 1,
              },
            ]}
          >
            <Text style={styles.resultLabel}>Search Area</Text>
            <Text style={styles.resultValueSmall}>{locationLabel}</Text>
            <Text style={[styles.resultDescription, { marginTop: 6 }]}>
              Current radius: {garageSaleRadiusMiles} miles
            </Text>
            <Text style={styles.resultDescription}>
              {garageFinderMode === 'thrift'
                ? 'These are nearby thrift-search shortcuts plus a live map view of thrift stores around you.'
                : garageFinderMode === 'garage'
                  ? 'These are nearby garage-sale results. Save the good ones below, then open them in Maps when you head out.'
                  : 'These are nearby estate-sale results. Save the good ones below, then open them in Maps when you head out.'}
            </Text>

            <TouchableOpacity
              style={[
                styles.primaryButton,
                { height: 48, justifyContent: 'center', alignItems: 'center' },
                { marginTop: 14 },
              ]}
              onPress={() => {
                setIsGarageSalesMapReady(false);
                setHasAutoFittedGarageSalesMap(false);
                setStep('garageSalesMap');
                scrollToTop();
              }}
              activeOpacity={0.75}
            >
              <Text style={styles.primaryButtonText}>
                {getFinderMapButtonLabel(garageFinderMode, garageSaleDayFilter)}
              </Text>
            </TouchableOpacity>
          </View>

          {savedGarageSales.length ? (
            <View style={styles.resultCard}>
              <Text style={styles.resultLabel}>Saved Stops</Text>
              <Text style={styles.resultDescription}>
                Your favorite searches stay here so you can reopen them fast.
              </Text>
              <View style={{ marginTop: 14, gap: 12 }}>
                {savedGarageSales
                  .slice()
                  .sort((a, b) => b.savedAt - a.savedAt)
                  .map((card) => (
                    <View
                      key={card.id}
                      style={{
                        borderWidth: 1,
                        borderColor: '#dbe4f0',
                        borderRadius: 14,
                        padding: 14,
                        backgroundColor: '#f8fafc',
                      }}
                    >
                      <Text style={styles.resultValueSmall}>{card.title}</Text>
                      <Text
                        style={[styles.resultDescription, { marginTop: 6 }]}
                      >
                        {card.subtitle}
                      </Text>
                      <Text
                        style={[styles.resultDescription, { marginTop: 6 }]}
                      >
                        Date:{' '}
                        {getGarageSaleDateLabel(card, garageSaleDayFilter)}
                      </Text>
                      {card.timeLabel ? (
                        <Text
                          style={[styles.resultDescription, { marginTop: 6 }]}
                        >
                          Time: {card.timeLabel}
                        </Text>
                      ) : null}
                      {card.distanceLabel ? (
                        <Text
                          style={[styles.resultDescription, { marginTop: 6 }]}
                        >
                          Distance: {card.distanceLabel}
                        </Text>
                      ) : null}
                      <Text
                        style={[styles.resultDescription, { marginTop: 8 }]}
                      >
                        {card.query}
                      </Text>

                      <TouchableOpacity
                        style={[
                          styles.primaryButton,
                          {
                            height: 48,
                            justifyContent: 'center',
                            alignItems: 'center',
                          },
                          { marginTop: 12 },
                        ]}
                        onPress={() => {
                          const savedPin = buildGarageSaleMapPins(
                            locationLabel,
                            weatherData?.latitude,
                            weatherData?.longitude,
                            [card],
                          )[0];

                          openExternalLink(
                            buildGarageSaleMapsUrl({
                              selectedPin: savedPin ?? null,
                              userLatitude: weatherData?.latitude,
                              userLongitude: weatherData?.longitude,
                            }) || undefined,
                          );
                        }}
                        activeOpacity={0.75}
                      >
                        <Text style={styles.primaryButtonText}>
                          Open Saved Stop
                        </Text>
                      </TouchableOpacity>

                      {card.craigslistUrl ? (
                        <TouchableOpacity
                          style={[
                            styles.secondaryButton,
                            {
                              height: 48,
                              justifyContent: 'center',
                              alignItems: 'center',
                            },
                            { marginTop: 10 },
                          ]}
                          onPress={() => openExternalLink(card.craigslistUrl)}
                          activeOpacity={0.75}
                        >
                          <Text
                            style={[
                              styles.secondaryButtonText,
                              { color: '#fff' },
                            ]}
                          >
                            Open Craigslist Ad
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  ))}
              </View>
            </View>
          ) : null}

          {searchCards.map((card) => {
            const isSaved = savedGarageSales.some(
              (item) => item.id === card.id,
            );

            return (
              <View key={card.id} style={styles.resultCard}>
                <Text style={styles.resultLabel}>Nearby Search Card</Text>
                <Text style={styles.resultValueSmall}>{card.title}</Text>
                <Text style={styles.resultDescription}>{card.subtitle}</Text>
                <Text style={[styles.resultDescription, { marginTop: 8 }]}>
                  Search: {card.query}
                </Text>

                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    {
                      height: 48,
                      justifyContent: 'center',
                      alignItems: 'center',
                    },
                    { marginTop: 14 },
                  ]}
                  onPress={() => {
                    const livePin = buildGarageSaleMapPins(
                      locationLabel,
                      weatherData?.latitude,
                      weatherData?.longitude,
                      [card],
                    )[0];

                    openExternalLink(
                      buildGarageSaleMapsUrl({
                        selectedPin: livePin ?? null,
                        userLatitude: weatherData?.latitude,
                        userLongitude: weatherData?.longitude,
                      }) || undefined,
                    );
                  }}
                  activeOpacity={0.75}
                >
                  <Text style={styles.primaryButtonText}>Open in Maps</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.secondaryButton,
                    {
                      height: 48,
                      justifyContent: 'center',
                      alignItems: 'center',
                    },
                    { marginTop: 12 },
                  ]}
                  onPress={() =>
                    void toggleSavedGarageSale({
                      id: card.id,
                      title: card.title,
                      subtitle: card.subtitle,
                      query: card.query,
                      mapsQuery: card.query,
                      addressLabel: card.title,
                    })
                  }
                  activeOpacity={0.75}
                >
                  <Text style={[styles.secondaryButtonText, { color: '#fff' }]}>
                    {isSaved
                      ? 'Show Again'
                      : `Hide ${getFinderSavedItemLabel(garageFinderMode)}`}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}

          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>Phase 3 Win</Text>
            <Text style={styles.resultDescription}>
              {garageFinderMode === 'garage'
                ? "Start with today's garage sales, save the strongest stop cards, then bring hidden garage sales back when you are ready. You now also have a dedicated map view one tap away."
                : "Start with Today's Sales, save the strongest stop cards, then bring hidden sales back when you are ready. You now also have a dedicated map view one tap away."}
            </Text>
          </View>
        </ScrollView>
        {renderProcessingOverlay()}
      </SafeAreaView>
    );
  };

  const userPulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(userPulseAnim, {
          toValue: 1,
          duration: 1400,
          useNativeDriver: true,
        }),
        Animated.timing(userPulseAnim, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );

    pulseLoop.start();

    return () => {
      pulseLoop.stop();
    };
  }, [userPulseAnim]);

  const recenterMapOnUser = () => {
    if (
      !weatherData?.latitude ||
      !weatherData?.longitude ||
      !garageSalesMapRef.current
    ) {
      return;
    }

    garageSalesMapRef.current.animateToRegion(
      {
        latitude: weatherData.latitude,
        longitude: weatherData.longitude,
        latitudeDelta: 0.08,
        longitudeDelta: 0.08,
      },
      700,
    );
  };

  const savedGarageSaleStopCount = savedGarageSales.length;

  useEffect(() => {
    if (step !== 'garageSalesMap') return;
    if (!isGarageSalesMapReady) return;
    if (garageSalesLoading) return;
    if (hasAutoFittedGarageSalesMap) return;
    if (!garageSalesMapRef.current) return;

    const locationLabel = weatherData?.locationLabel || 'your area';
    const fallbackPins = buildGarageSaleMapPins(
      locationLabel,
      weatherData?.latitude,
      weatherData?.longitude,
      savedGarageSales,
    );
    const savedPins = fallbackPins.filter((pin) => pin.id.startsWith('saved-'));
    const basePins = garageSalePins.length
      ? [...garageSalePins, ...savedPins]
      : fallbackPins;

    const coordinates = basePins
      .filter((pin) => hasValidCoordinates(pin.latitude, pin.longitude))
      .map((pin) => ({
        latitude: pin.latitude,
        longitude: pin.longitude,
      }));

    if (
      weatherData?.latitude &&
      weatherData?.longitude &&
      !coordinates.some(
        (point) =>
          Math.abs(point.latitude - weatherData.latitude) < 0.0001 &&
          Math.abs(point.longitude - weatherData.longitude) < 0.0001,
      )
    ) {
      coordinates.push({
        latitude: weatherData.latitude,
        longitude: weatherData.longitude,
      });
    }

    if (coordinates.length < 2) return;

    const runFit = () => {
      try {
        garageSalesMapRef.current?.fitToCoordinates(coordinates, {
          edgePadding: {
            top: 55,
            right: 55,
            bottom: 55,
            left: 55,
          },
          animated: false,
        });
        setHasAutoFittedGarageSalesMap(true);
      } catch (error) {
        console.log('Garage sales map auto-fit error:', error);
      }
    };

    const timeout = setTimeout(runFit, 550);
    return () => clearTimeout(timeout);
  }, [
    step,
    isGarageSalesMapReady,
    garageSalesLoading,
    garageSalePins,
    savedGarageSales,
    weatherData?.locationLabel,
    weatherData?.latitude,
    weatherData?.longitude,
    hasAutoFittedGarageSalesMap,
  ]);

  const garageSaleRadiusOptions: GarageSaleRadiusMiles[] = [5, 10, 25, 50];

  const renderGarageSaleRadiusPicker = () => (
    <View
      style={[
        styles.resultCard,
        {
          backgroundColor: '#eef6ff',
          borderColor: '#bfdbfe',
          borderWidth: 1,
        },
      ]}
    >
      <Text style={styles.resultLabel}>Search Radius</Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
          marginTop: 14,
        }}
      >
        {garageSaleRadiusOptions.map((radius) => {
          const isActive = garageSaleRadiusMiles === radius;

          return (
            <TouchableOpacity
              key={`radius-${radius}`}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 16,
                borderRadius: 999,
                backgroundColor: isActive ? '#2563eb' : '#ffffff',
                borderWidth: 1,
                borderColor: isActive ? '#2563eb' : '#cbd5e1',
              }}
              onPress={() => {
                setGarageSaleRadiusMiles(radius);
                setHasAutoFittedGarageSalesMap(false);
              }}
              activeOpacity={0.8}
            >
              <Text
                style={{
                  color: isActive ? '#ffffff' : '#334155',
                  fontWeight: '600',
                }}
              >
                {radius} mi
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  const garageSaleDayOptions: GarageSaleDayFilter[] = ['today', 'tomorrow'];

  const renderGarageSaleDayPicker = () => (
    <View
      style={[
        styles.resultCard,
        {
          backgroundColor: '#f8fafc',
          borderColor: '#dbe4f0',
          borderWidth: 1,
        },
      ]}
    >
      <Text style={styles.resultLabel}>Sale Window</Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          flexWrap: 'nowrap',
          gap: 6,
          marginTop: 14,
        }}
      >
        {garageSaleDayOptions.map((dayOption) => {
          const isActive = garageSaleDayFilter === dayOption;

          return (
            <TouchableOpacity
              key={`day-filter-${dayOption}`}
              style={{
                flex: 1,
                minWidth: 0,
                paddingVertical: 10,
                paddingHorizontal: 6,
                borderRadius: 999,
                backgroundColor: isActive ? '#0f172a' : '#ffffff',
                borderWidth: 1,
                borderColor: isActive ? '#0f172a' : '#cbd5e1',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onPress={() => {
                setGarageSaleDayFilter(dayOption);
                setHasAutoFittedGarageSalesMap(false);
              }}
              activeOpacity={0.8}
            >
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
                style={{
                  color: isActive ? '#ffffff' : '#334155',
                  fontWeight: '600',
                  fontSize: 13,
                }}
              >
                {getGarageSaleDayFilterShortLabel(dayOption)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  const renderRouteSummary = () => {
    const orderedRoutePins = sortRouteStopsByNearest(
      savedGarageSales
        .map((saved) => {
          if (
            Number.isFinite(saved.latitude) &&
            Number.isFinite(saved.longitude)
          ) {
            return {
              id: saved.id,
              title: saved.title,
              subtitle: saved.subtitle,
              query: saved.query,
              mapsQuery: saved.mapsQuery,
              latitude: Number(saved.latitude),
              longitude: Number(saved.longitude),
              addressLabel:
                saved.addressLabel || saved.mapsQuery || saved.title,
              timeLabel: 'Saved target',
              notes: 'Saved garage sale stop.',
              saleType: saved.saleType || 'garage',
              pinColor: '#2DBE60',
              hasExactCoordinates: true,
            } as GarageSaleMapPin;
          }

          return null;
        })
        .filter(Boolean) as GarageSaleMapPin[],
      weatherData?.latitude,
      weatherData?.longitude,
    ) as GarageSaleMapPin[];

    const routeUrl = orderedRoutePins.length
      ? buildMultiStopMapsUrl(
          orderedRoutePins,
          weatherData?.latitude,
          weatherData?.longitude,
        )
      : null;

    const totalMiles = calculateRouteDistanceMiles(
      orderedRoutePins,
      weatherData?.latitude,
      weatherData?.longitude,
    );
    const estimatedMinutes = estimateRouteDriveMinutes(totalMiles);

    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView
          ref={activeScrollRef}
          style={styles.flexFill}
          contentContainerStyle={styles.packageFrontScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
          contentInsetAdjustmentBehavior="automatic"
        >
          <Text style={styles.title}>Saved Stops</Text>

          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>Saved Stops Summary</Text>
            <Text style={styles.resultDescription}>
              {orderedRoutePins.length} stop
              {orderedRoutePins.length === 1 ? '' : 's'}
              {totalMiles > 0 ? ` • about ${totalMiles} mi` : ''}
              {estimatedMinutes > 0 ? ` • about ${estimatedMinutes} min` : ''}
            </Text>
            <Text style={[styles.resultDescription, { marginTop: 8 }]}>
              Review the current sales below, then launch navigation when you
              are ready to drive.
            </Text>
          </View>

          {orderedRoutePins.map((stop, index) => (
            <View key={stop.id} style={styles.resultCard}>
              <Text style={styles.resultLabel}>Stop {index + 1}</Text>
              <Text style={styles.resultValueSmall}>
                {formatRouteStopTitle(stop)}
              </Text>
              <Text style={[styles.resultDescription, { marginTop: 6 }]}>
                {stop.addressLabel || stop.mapsQuery || stop.query}
              </Text>
              <Text style={[styles.resultDescription, { marginTop: 6 }]}>
                {getGarageSaleTypeLabel(stop.saleType)}
              </Text>
            </View>
          ))}

          <View style={styles.mapButtonGrid}>
            <TouchableOpacity
              style={[styles.mapGridButton, styles.mapStartGridButton]}
              onPress={() => openExternalLink(routeUrl || undefined)}
              activeOpacity={0.8}
              disabled={!routeUrl}
            >
              <Text style={styles.mapStartGridButtonText}>
                Start Navigation
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.mapGridButton, styles.mapRecenterGridButton]}
              onPress={() => {
                setStep('garageSalesMap');
                scrollToTop();
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.mapRecenterGridButtonText}>Back to Map</Text>
            </TouchableOpacity>
          </View>

          {orderedRoutePins.length ? (
            <View style={styles.mapClearRouteWrap}>
              <TouchableOpacity
                style={[styles.mapGridButton, styles.mapClearGridButton]}
                onPress={clearAllRouteStops}
                activeOpacity={0.8}
              >
                <Text style={styles.mapClearGridButtonText}>Start Fresh</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    );
  };

  const renderGarageSalesMap = () => {
    const locationLabel = weatherData?.locationLabel || 'your area';
    const isThriftFinder = garageFinderMode === 'thrift';
    const savedPinsFromFavorites = savedGarageSales
      .filter((saved) =>
        isThriftFinder
          ? saved.saleType === 'thrift'
          : saved.saleType !== 'thrift',
      )
      .map((saved) => {
        if (
          !Number.isFinite(saved.latitude as number) ||
          !Number.isFinite(saved.longitude as number)
        ) {
          return null;
        }

        return {
          id: `saved-${saved.id}`,
          title: saved.title,
          subtitle: saved.subtitle,
          query: saved.query,
          mapsQuery: saved.mapsQuery,
          latitude: Number(saved.latitude),
          longitude: Number(saved.longitude),
          addressLabel: saved.addressLabel || saved.mapsQuery || saved.title,
          timeLabel: saved.timeLabel || 'Saved target',
          notes:
            saved.notes ||
            (isThriftFinder
              ? 'Saved thrift store stop.'
              : 'Saved garage sale stop.'),
          saleType: saved.saleType || (isThriftFinder ? 'thrift' : 'garage'),
          pinColor: '#2DBE60',
          craigslistUrl: saved.craigslistUrl,
          dayLabel: saved.dayLabel,
          distanceLabel: saved.distanceLabel,
          phone: saved.phone,
          website: saved.website,
          source: saved.source,
          openingHours: saved.openingHours,
          hasExactCoordinates: true,
        } as GarageSaleMapPin;
      })
      .filter((pin): pin is GarageSaleMapPin => pin !== null);

    const fallbackPins = isThriftFinder
      ? savedPinsFromFavorites
      : buildGarageSaleMapPins(
          locationLabel,
          weatherData?.latitude,
          weatherData?.longitude,
          savedGarageSales,
        );
    const savedPins = isThriftFinder
      ? savedPinsFromFavorites
      : fallbackPins.filter((pin) => pin.id.startsWith('saved-'));
    const liveAndSavedPins = garageSalePins.length
      ? [...garageSalePins, ...savedPins]
      : fallbackPins;
    const basePins = dedupeRouteStops(liveAndSavedPins) as GarageSaleMapPin[];
    const displayPins = basePins;

    const selectedPin =
      displayPins.find((pin) => pin.id === selectedGarageSalePinId) ||
      displayPins[0] ||
      null;
    const selectedPinIsSaved = selectedPin
      ? savedGarageSales.some(
          (sale) =>
            sale.id === selectedPin.id || `saved-${sale.id}` === selectedPin.id,
        )
      : false;
    const routePins = sortRouteStopsByNearest(
      savedGarageSales
        .map((saved) => {
          const matchedPin = basePins.find((pin) => pin.id === saved.id);

          if (matchedPin) {
            return matchedPin;
          }

          if (
            Number.isFinite(saved.latitude) &&
            Number.isFinite(saved.longitude)
          ) {
            return {
              id: saved.id,
              title: saved.title,
              subtitle: saved.subtitle,
              query: saved.query,
              mapsQuery: saved.mapsQuery,
              latitude: Number(saved.latitude),
              longitude: Number(saved.longitude),
              addressLabel:
                saved.addressLabel || saved.mapsQuery || saved.title,
              timeLabel: 'Saved target',
              notes: 'Saved garage sale stop.',
              saleType: saved.saleType || 'garage',
              pinColor: '#2DBE60',
              hasExactCoordinates: true,
            } as GarageSaleMapPin;
          }

          return null;
        })
        .filter(Boolean) as GarageSaleMapPin[],
      weatherData?.latitude,
      weatherData?.longitude,
    ) as GarageSaleMapPin[];
    const routeUrl = routePins.length
      ? buildMultiStopMapsUrl(
          routePins,
          weatherData?.latitude,
          weatherData?.longitude,
        )
      : selectedPin
        ? buildGarageSaleMapsUrl({
            selectedPin,
            userLatitude: weatherData?.latitude,
            userLongitude: weatherData?.longitude,
          })
        : null;

    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView
          ref={activeScrollRef}
          style={styles.flexFill}
          contentContainerStyle={styles.packageFrontScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
          contentInsetAdjustmentBehavior="automatic"
          stickyHeaderIndices={[1]}
        >
          <View>
            <Text style={styles.title}>{getFinderTitle(garageFinderMode)}</Text>

            {renderGarageSaleRadiusPicker()}

            <View style={styles.mapLegendHeaderRow}>
              <Text style={styles.mapLegendTitle}>Marker Key</Text>
              <TouchableOpacity
                style={{
                  backgroundColor: '#111827',
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  borderRadius: 999,
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: 34,
                }}
                onPress={() => {
                  setHomeMode('boxFinder');
                  setHomeScanMode('source');
                  setIsPriceCheckerSession(true);
                  setStep('referencePicker');
                  scrollToTop();
                }}
                activeOpacity={0.85}
              >
                <Text
                  style={{
                    color: '#ffffff',
                    fontSize: 12,
                    fontWeight: '800',
                  }}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  Price Checker
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.mapLegendRow}>
              <View style={styles.mapLegendItem}>
                <View
                  style={[
                    styles.mapLegendSwatch,
                    {
                      backgroundColor:
                        garageFinderMode === 'thrift' ? '#0f766e' : '#7C3AED',
                    },
                  ]}
                />
                <Text style={styles.mapLegendText}>
                  {garageFinderMode === 'thrift' ? 'Store' : 'Sale'}
                </Text>
              </View>

              <View style={styles.mapLegendItem}>
                <View style={styles.mapLegendSelectedMarkerWrap}>
                  <View
                    style={[
                      styles.saleMarkerOuter,
                      styles.saleMarkerOuterSelected,
                      styles.mapLegendSelectedMarkerOuter,
                      { borderColor: '#16a34a' },
                    ]}
                  >
                    <View
                      style={[
                        styles.saleMarkerInner,
                        styles.saleMarkerInnerSelected,
                        styles.mapLegendSelectedMarkerInner,
                        { backgroundColor: '#16a34a' },
                      ]}
                    />
                  </View>
                </View>
                <Text style={styles.mapLegendText}>Selected</Text>
              </View>

              <View style={styles.mapLegendItem}>
                <View style={styles.mapLegendTargetSwatch}>
                  <View style={styles.mapLegendTargetInner} />
                </View>
                <Text style={styles.mapLegendText}>You</Text>
              </View>
            </View>

            {garageSalesLoading ? (
              <Animated.View
                style={[
                  styles.loadingStatusCard,
                  garageSalesShowSlowPulse
                    ? { opacity: garageSalesLoadingPulseAnim }
                    : null,
                ]}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={styles.loadingStatusTitle}>
                      {garageFinderMode === 'thrift'
                        ? 'Loading Thrift Stores'
                        : garageFinderMode === 'garage'
                          ? garageSalesShowingPreview
                            ? 'Refreshing Garage Sales'
                            : 'Loading Garage Sales'
                          : garageSalesShowingPreview
                            ? 'Refreshing Estate Sales'
                            : 'Loading Estate Sales'}
                    </Text>
                    <Text style={styles.loadingStatusText}>
                      {garageSalesLoadingMessage}
                    </Text>
                    <Text style={styles.loadingStatusMeta}>
                      {garageFinderMode === 'thrift'
                        ? `Search radius: ${garageSaleRadiusMiles} miles.`
                        : garageSalesShowingPreview
                          ? `Showing saved pins while live ${garageSaleRadiusMiles}-mile results finish loading.`
                          : `Live sale results within ${garageSaleRadiusMiles} miles are loading now.`}
                    </Text>
                    {garageSalesShowSlowPulse ? (
                      <Text style={styles.loadingStatusPulseText}>
                        Still working… hang tight
                      </Text>
                    ) : null}
                  </View>
                  <ActivityIndicator size="small" color="#2563eb" />
                </View>
              </Animated.View>
            ) : null}

            {garageSalesError ? (
              <View style={styles.resultCard}>
                <Text style={styles.resultLabel}>
                  {garageFinderMode === 'thrift'
                    ? 'Thrift Store Feed Status'
                    : 'Backend Feed Status'}
                </Text>
                <Text style={styles.resultDescription}>{garageSalesError}</Text>
                <Text style={[styles.resultDescription, { marginTop: 8 }]}>
                  {garageFinderMode === 'thrift'
                    ? 'Live thrift store pins may be limited until the backend feed responds again.'
                    : 'Live pins may be limited until the backend feed responds again.'}
                </Text>
              </View>
            ) : null}
          </View>

          <View
            style={{
              backgroundColor: '#f7f8fc',
              paddingTop: 8,
              paddingBottom: 8,
            }}
          >
            <View style={[styles.resultCard, { padding: 10, marginTop: 0 }]}>
              <View style={styles.mapStickyHeaderRow}>
                <Text style={styles.mapStickyHeaderTitle}>
                  {garageFinderMode === 'thrift'
                    ? 'Thrift Store Map'
                    : 'Sales Map'}
                </Text>
                {!isGarageSalesMapHidden ? (
                  <TouchableOpacity
                    style={[
                      styles.mapToggleButton,
                      styles.mapToggleButtonVisible,
                    ]}
                    onPress={() =>
                      setIsGarageSalesMapHidden((current) => !current)
                    }
                    activeOpacity={0.8}
                  >
                    <Text style={styles.mapToggleButtonText}>Hide Map</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              {isGarageSalesMapHidden ? (
                <View style={styles.mapHiddenState}>
                  <TouchableOpacity
                    style={styles.floatingShowMapButton}
                    onPress={() => setIsGarageSalesMapHidden(false)}
                    activeOpacity={0.9}
                  >
                    <Text style={styles.floatingShowMapButtonText}>
                      🗺️ Show Map
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <MapView
                  ref={garageSalesMapRef}
                  style={{ width: '100%', height: 320, borderRadius: 16 }}
                  customMapStyle={GARAGE_SALE_MAP_STYLE}
                  showsPointsOfInterest={false}
                  showsBuildings={false}
                  showsIndoors={false}
                  showsTraffic={false}
                  onRegionChangeComplete={(region) => {
                    setGarageSalesMapLatitudeDelta(region.latitudeDelta);
                  }}
                  onMapReady={() => setIsGarageSalesMapReady(true)}
                  initialRegion={{
                    latitude: weatherData?.latitude ?? 41.8781,
                    longitude: weatherData?.longitude ?? -87.6298,
                    latitudeDelta: 0.2,
                    longitudeDelta: 0.2,
                  }}
                >
                  {weatherData?.latitude && weatherData?.longitude ? (
                    <Marker
                      coordinate={{
                        latitude: weatherData.latitude,
                        longitude: weatherData.longitude,
                      }}
                      title="You are here"
                      anchor={{ x: 0.5, y: 0.5 }}
                      tracksViewChanges={false}
                    >
                      <View style={styles.userMarkerWrap}>
                        <Animated.View
                          style={[
                            styles.userMarkerPulse,
                            {
                              opacity: userPulseAnim.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0.42, 0],
                              }),
                              transform: [
                                {
                                  scale: userPulseAnim.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [1, 2.35],
                                  }),
                                },
                              ],
                            },
                          ]}
                        />
                        <View style={styles.userMarkerOuter}>
                          <View style={styles.userMarkerInner} />
                        </View>
                      </View>
                      <Callout tooltip>
                        <View style={styles.userCalloutWrap}>
                          <View style={styles.userCalloutCard}>
                            <Text style={styles.userCalloutTitle}>
                              You are here
                            </Text>
                            <Text style={styles.userCalloutSubtitle}>
                              {locationLabel}
                            </Text>
                          </View>
                          <View style={styles.userCalloutPointer} />
                        </View>
                      </Callout>
                    </Marker>
                  ) : null}

                  {displayPins
                    .filter((pin) =>
                      hasValidCoordinates(pin.latitude, pin.longitude),
                    )
                    .map((pin) => {
                      const isSelected = selectedGarageSalePinId === pin.id;
                      const markerColor = isSelected
                        ? '#16a34a'
                        : getGarageSaleMarkerColor(pin.saleType);

                      return (
                        <Marker
                          key={pin.id}
                          coordinate={{
                            latitude: pin.latitude,
                            longitude: pin.longitude,
                          }}
                          title={pin.title}
                          description={pin.subtitle}
                          anchor={{ x: 0.5, y: 1 }}
                          centerOffset={{ x: 0, y: -18 }}
                          tracksViewChanges={false}
                          onPress={() => {
                            setSelectedGarageSalePinId(pin.id);
                            scrollGarageSaleCardToTop(pin.id);
                          }}
                        >
                          {pin.isCluster ? (
                            <View style={styles.clusterMarkerWrap}>
                              <View style={styles.clusterMarkerBubble}>
                                <Text style={styles.clusterMarkerText}>
                                  {pin.clusterCount}
                                </Text>
                              </View>
                            </View>
                          ) : (
                            <View style={styles.saleMarkerWrap}>
                              <View
                                style={[
                                  styles.saleMarkerOuter,
                                  isSelected && styles.saleMarkerOuterSelected,
                                  {
                                    borderColor: markerColor,
                                  },
                                ]}
                              >
                                <View
                                  style={[
                                    styles.saleMarkerInner,
                                    isSelected &&
                                      styles.saleMarkerInnerSelected,
                                    {
                                      backgroundColor: markerColor,
                                    },
                                  ]}
                                />
                              </View>
                            </View>
                          )}

                          <Callout
                            tooltip={false}
                            onPress={() => {
                              if (!pin.isCluster) {
                                setSelectedGarageSalePinId(pin.id);
                                scrollGarageSaleCardToTop(pin.id);
                              }
                            }}
                          >
                            <View
                              style={{
                                width: 260,
                                maxWidth: 260,
                                paddingVertical: 6,
                                paddingHorizontal: 4,
                              }}
                            >
                              <Text
                                style={{
                                  fontWeight: '800',
                                  marginBottom: 4,
                                  fontSize: 14,
                                  flexWrap: 'wrap',
                                }}
                              >
                                {pin.title}
                              </Text>
                              <Text
                                style={{
                                  fontSize: 12,
                                  lineHeight: 16,
                                  flexWrap: 'wrap',
                                }}
                              >
                                {getGarageSaleCompactMeta(pin)}
                              </Text>
                              {pin.dayLabel ? (
                                <Text
                                  style={{
                                    fontSize: 12,
                                    lineHeight: 16,
                                    flexWrap: 'wrap',
                                    marginTop: 2,
                                  }}
                                >
                                  {pin.timeLabel
                                    ? `${pin.dayLabel} • ${stripGarageSaleTimePrefix(pin.timeLabel) || pin.timeLabel}`
                                    : pin.dayLabel}
                                </Text>
                              ) : null}
                              {pin.displayAddress ? (
                                <Text
                                  style={{
                                    fontSize: 12,
                                    lineHeight: 16,
                                    flexWrap: 'wrap',
                                    marginTop: 2,
                                  }}
                                >
                                  {pin.displayAddress}
                                </Text>
                              ) : null}
                            </View>
                          </Callout>
                        </Marker>
                      );
                    })}
                </MapView>
              )}
            </View>
          </View>

          <View style={styles.mapButtonGrid}>
            <TouchableOpacity
              style={[styles.mapGridButton, styles.mapPrimaryGridButton]}
              onPress={clearAllRouteStops}
              activeOpacity={0.8}
            >
              <Text style={styles.mapPrimaryGridButtonText}>Start Fresh</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.mapGridButton, styles.mapDarkGridButton]}
              onPress={recenterMapOnUser}
              activeOpacity={0.8}
            >
              <Text style={styles.mapDarkGridButtonText}>Recenter on Me</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>
              {garageFinderMode === 'thrift' ? 'Store List' : 'Sales List'}
            </Text>
            <Text style={styles.resultDescription}>
              Showing the first{' '}
              {Math.min(visibleGarageSalesCount, displayPins.length)} of{' '}
              {displayPins.length} qualifying{' '}
              {garageFinderMode === 'thrift' ? 'stores' : 'sales'}.
            </Text>

            <View style={{ marginTop: 14, gap: 12 }}>
              {displayPins.slice(0, visibleGarageSalesCount).map((sale) => {
                const isHidden = savedGarageSales.some(
                  (item) => item.id === sale.id,
                );
                const isSelected = selectedPin?.id === sale.id;
                const thriftWebsiteUrl = String(sale.website || '').trim();
                const thriftSearchUrl = buildThriftStoreWebsiteSearchUrl(sale);
                const saleViewUrl =
                  garageFinderMode === 'thrift'
                    ? thriftWebsiteUrl || thriftSearchUrl || undefined
                    : sale.craigslistUrl ||
                      buildGarageSaleFallbackViewUrl(sale);
                const saleViewButtonLabel = 'View';

                return (
                  <TouchableOpacity
                    key={`sale-list-${sale.id}`}
                    onLayout={(event) => {
                      garageSaleCardLayoutsRef.current[sale.id] =
                        event.nativeEvent.layout.y;
                    }}
                    style={[
                      styles.resultCard,
                      {
                        marginTop: 0,
                        borderWidth: 1,
                        borderColor: isSelected ? '#2563eb' : '#dbe4f0',
                        backgroundColor: isSelected ? '#eff6ff' : '#ffffff',
                      },
                    ]}
                    onPress={() => {
                      setSelectedGarageSalePinId(sale.id);
                      scrollGarageSaleCardToTop(sale.id);
                      if (
                        Number.isFinite(sale.latitude) &&
                        Number.isFinite(sale.longitude)
                      ) {
                        garageSalesMapRef.current?.animateToRegion(
                          {
                            latitude: sale.latitude,
                            longitude: sale.longitude,
                            latitudeDelta: Math.max(
                              garageSalesMapLatitudeDelta * 0.6,
                              0.02,
                            ),
                            longitudeDelta: Math.max(
                              garageSalesMapLatitudeDelta * 0.6,
                              0.02,
                            ),
                          },
                          300,
                        );
                      }
                    }}
                    activeOpacity={0.85}
                  >
                    {(() => {
                      const displayAddress =
                        sale.displayAddress ||
                        buildGarageSaleDisplayAddress({
                          street: sale.street,
                          crossStreet: sale.crossStreet,
                          addressLabel: sale.addressLabel,
                          mapAddress: sale.mapAddress,
                          mapsQuery: sale.mapsQuery,
                          city: sale.city,
                          state: sale.state,
                          zip: sale.zip,
                        });
                      const showProbableBadge =
                        shouldShowGarageSaleProbableBadge(sale);
                      const compactMeta = getGarageSaleCompactMeta(sale);
                      const dateLabel = getGarageSaleDateLabel(
                        sale,
                        garageSaleDayFilter,
                      );
                      const timeLabel =
                        garageFinderMode === 'thrift'
                          ? getThriftStoreHoursLabel(sale)
                          : getGarageSaleDisplayTimeLabel(
                              sale,
                              garageSaleDayFilter,
                            );
                      const openStatusLabel =
                        garageFinderMode === 'thrift'
                          ? getThriftStoreOpenStatusLabel(sale)
                          : '';

                      return (
                        <>
                          <Text style={styles.resultValueSmall}>
                            {sale.title}
                          </Text>
                          {showProbableBadge ? (
                            <Text
                              style={[
                                styles.resultDescription,
                                {
                                  marginTop: 6,
                                  color: '#b45309',
                                  fontWeight: '600',
                                },
                              ]}
                            >
                              Probable Sale
                            </Text>
                          ) : null}
                          <Text
                            style={[styles.resultDescription, { marginTop: 6 }]}
                          >
                            {compactMeta}
                          </Text>
                          {openStatusLabel ? (
                            <Text
                              style={[
                                styles.resultDescription,
                                {
                                  marginTop: 6,
                                  color:
                                    openStatusLabel === 'Open now'
                                      ? '#15803d'
                                      : '#b91c1c',
                                  fontWeight: '700',
                                },
                              ]}
                            >
                              {openStatusLabel}
                            </Text>
                          ) : null}
                          {sale.isApproximateLocation ? (
                            <Text
                              style={[
                                styles.resultDescription,
                                {
                                  marginTop: 6,
                                  color: '#1d4ed8',
                                  fontWeight: '600',
                                },
                              ]}
                            >
                              Approximate location from listing area
                            </Text>
                          ) : null}
                          {dateLabel && dateLabel !== 'Date unavailable' ? (
                            <Text
                              style={[
                                styles.resultDescription,
                                { marginTop: 6 },
                              ]}
                            >
                              Date: {dateLabel}
                            </Text>
                          ) : null}
                          {timeLabel && timeLabel !== 'Time not listed' ? (
                            <Text
                              style={[
                                styles.resultDescription,
                                { marginTop: 6 },
                              ]}
                            >
                              {garageFinderMode === 'thrift' ? 'Hours' : 'Time'}
                              : {timeLabel}
                            </Text>
                          ) : null}
                          <Text
                            style={[styles.resultDescription, { marginTop: 6 }]}
                          >
                            Address: {displayAddress}
                          </Text>
                          {garageFinderMode === 'thrift' && sale.phone ? (
                            <TouchableOpacity
                              onPress={() => {
                                void openPhoneNumber(sale.phone);
                              }}
                              activeOpacity={0.7}
                            >
                              <Text
                                style={[
                                  styles.resultDescription,
                                  {
                                    marginTop: 6,
                                    color: '#2563eb',
                                    textDecorationLine: 'underline',
                                  },
                                ]}
                              >
                                Phone: {sale.phone}
                              </Text>
                            </TouchableOpacity>
                          ) : null}
                          {garageFinderMode === 'thrift' ? (
                            <Text
                              style={[
                                styles.resultDescription,
                                { marginTop: 6 },
                              ]}
                              numberOfLines={1}
                            >
                              Website:{' '}
                              {sale.website
                                ? sale.website.replace(/^https?:\/\//, '')
                                : 'Not listed — Tap View for more info'}
                            </Text>
                          ) : null}
                          {garageFinderMode === 'thrift' && sale.source ? (
                            <Text
                              style={[
                                styles.resultDescription,
                                { marginTop: 6, color: '#64748b' },
                              ]}
                            >
                              Source: {sale.source}
                            </Text>
                          ) : null}
                        </>
                      );
                    })()}

                    <View style={styles.saleActionRow}>
                      <TouchableOpacity
                        style={[
                          styles.saleActionButton,
                          styles.saleActionButtonView,
                          !saleViewUrl && styles.saleActionButtonDisabled,
                        ]}
                        onPress={() =>
                          saleViewUrl && openExternalLink(saleViewUrl)
                        }
                        activeOpacity={saleViewUrl ? 0.75 : 1}
                        disabled={!saleViewUrl}
                      >
                        <Text style={styles.saleActionIcon}>🔗</Text>
                        <Text
                          style={[
                            styles.saleActionText,
                            styles.saleActionTextLight,
                          ]}
                        >
                          {saleViewButtonLabel}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.saleActionButton,
                          styles.saleActionButtonHide,
                        ]}
                        onPress={() =>
                          void toggleSavedGarageSale({
                            id: sale.id,
                            title: sale.title,
                            subtitle: sale.subtitle,
                            query: sale.query,
                            latitude: sale.latitude,
                            longitude: sale.longitude,
                            mapsQuery: sale.mapsQuery,
                            addressLabel: sale.addressLabel,
                            saleType: sale.saleType,
                            craigslistUrl: sale.craigslistUrl,
                            dayLabel: sale.dayLabel,
                            timeLabel:
                              garageFinderMode === 'thrift'
                                ? getThriftStoreHoursLabel(sale)
                                : getGarageSaleDisplayTimeLabel(
                                    sale,
                                    garageSaleDayFilter,
                                  ),
                            notes: sale.notes,
                            distanceLabel: sale.distanceLabel,
                            phone: sale.phone,
                            website: sale.website,
                            source: sale.source,
                            openingHours: sale.openingHours,
                          })
                        }
                        activeOpacity={0.75}
                      >
                        <Text style={styles.saleActionIcon}>🙈</Text>
                        <Text style={styles.saleActionText}>
                          {isHidden ? 'Show' : 'Hide'}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.saleActionButton,
                          styles.saleActionButtonMap,
                        ]}
                        onPress={() =>
                          openExternalLink(
                            buildGarageSaleMapsUrl({
                              selectedPin: sale,
                              userLatitude: weatherData?.latitude,
                              userLongitude: weatherData?.longitude,
                            }) || undefined,
                          )
                        }
                        activeOpacity={0.75}
                      >
                        <Text style={styles.saleActionIcon}>🗺️</Text>
                        <Text
                          style={[
                            styles.saleActionText,
                            styles.saleActionTextLight,
                          ]}
                        >
                          Map
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {displayPins.length > visibleGarageSalesCount ||
            (displayPins.length >= 10 && visibleGarageSalesCount === 10) ? (
              <TouchableOpacity
                style={[
                  styles.secondaryButton,
                  { backgroundColor: '#f97316' },
                  {
                    height: 48,
                    justifyContent: 'center',
                    alignItems: 'center',
                  },
                  {
                    marginTop: 14,
                    alignSelf: 'center',
                    paddingVertical: 10,
                    paddingHorizontal: 18,
                    minHeight: 0,
                  },
                ]}
                onPress={() =>
                  setVisibleGarageSalesCount((count) => count + 10)
                }
                activeOpacity={0.75}
              >
                <Text style={[styles.secondaryButtonText, { color: '#fff' }]}>
                  More Sales
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>What This Map Is</Text>
            <Text style={styles.resultDescription}>
              {garageFinderMode === 'thrift'
                ? 'This map uses your current location plus your selected radius. Tap Hide Store on anything you do not want to see. Start Fresh brings every hidden store back and reloads the current matches.'
                : 'This map uses your current location plus your selected radius and day filter. Tap Hide Sale on anything you do not want to see. Start Fresh brings every hidden sale back and reloads the current matches.'}
            </Text>
          </View>
        </ScrollView>

        <TouchableOpacity
          style={styles.backToTopFloatingButton}
          onPress={scrollToTop}
          activeOpacity={0.85}
        >
          <Text style={styles.backToTopFloatingButtonIcon}>↑</Text>
          <Text style={styles.backToTopFloatingButtonText}>Top</Text>
        </TouchableOpacity>

        {renderProcessingOverlay()}
      </SafeAreaView>
    );
  };

  const renderReferenceObjectPicker = () => {
    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView
          ref={activeScrollRef}
          style={styles.flexFill}
          contentContainerStyle={styles.packageFrontScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
          contentInsetAdjustmentBehavior="automatic"
        >
          <Text style={styles.title}>Box Size Estimator</Text>
          <Text style={styles.resultValueSmall}>Reference Object</Text>
          <Text style={styles.subtitle}>
            Pick a known object you’ll place next to the item, then choose
            standard or cylinder mode and start the first photo.
          </Text>

          <View style={styles.referenceGrid}>
            {REFERENCE_OPTIONS.map((option) => {
              const active = selectedReference?.key === option.key;

              return (
                <TouchableOpacity
                  key={option.key}
                  style={[
                    styles.referenceCard,
                    active && styles.referenceCardSelected,
                  ]}
                  onPress={() => setSelectedReference(option)}
                  activeOpacity={0.75}
                >
                  <Text
                    style={[
                      styles.referenceLabel,
                      active && styles.referenceLabelSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                  <Text
                    style={[
                      styles.referenceDescription,
                      active && styles.referenceDescriptionSelected,
                    ]}
                  >
                    Known {option.measurementLabel}: {option.realWidthInches}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            style={styles.primaryButtonTopVisible}
            onPress={() => openCamera('photo1')}
            activeOpacity={0.75}
          >
            <Text style={styles.primaryButtonTopVisibleText}>
              {isCylinder ? 'Take Main Photo' : 'Take First Photo'}
            </Text>
          </TouchableOpacity>

          <View style={styles.modeCard}>
            <Text style={styles.modeLabel}>Measurement Mode</Text>

            <View style={styles.modeButtonRow}>
              <TouchableOpacity
                style={[
                  styles.modeOptionButton,
                  !isCylinder && styles.modeOptionButtonActive,
                ]}
                onPress={() => setIsCylinder(false)}
                activeOpacity={0.75}
              >
                <Text
                  style={[
                    styles.modeOptionTitle,
                    !isCylinder && styles.modeOptionTitleActive,
                  ]}
                >
                  Standard
                </Text>
                <Text
                  style={[
                    styles.modeOptionSubtitle,
                    !isCylinder && styles.modeOptionSubtitleActive,
                  ]}
                >
                  2 photos
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.modeOptionButton,
                  isCylinder && styles.modeOptionButtonActive,
                ]}
                onPress={() => setIsCylinder(true)}
                activeOpacity={0.75}
              >
                <Text
                  style={[
                    styles.modeOptionTitle,
                    isCylinder && styles.modeOptionTitleActive,
                  ]}
                >
                  Cylinder
                </Text>
                <Text
                  style={[
                    styles.modeOptionSubtitle,
                    isCylinder && styles.modeOptionSubtitleActive,
                  ]}
                >
                  1 photo
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.modeHelpText}>
              {isCylinder
                ? 'Cylinder mode is on. Use this for bottles, cans, and tubes.'
                : 'Standard mode is on. Use this for boxes and most other items.'}
            </Text>
          </View>
        </ScrollView>
        {renderProcessingOverlay()}
      </SafeAreaView>
    );
  };

  const renderCamera = () => {
    return (
      <View style={styles.cameraScreen}>
        <CameraView ref={cameraRef} style={styles.camera} facing={facing} />

        <SafeAreaView style={styles.cameraOverlay}>
          <View style={styles.cameraTopBar}>
            <View style={styles.cameraBadgeStack}>
              <View style={styles.referenceBadge}>
                <Text style={styles.referenceBadgeText}>
                  {getPhotoTitle(activePhotoKey)}
                </Text>
              </View>
              <View
                style={[
                  styles.modeBadge,
                  isCylinder
                    ? styles.modeBadgeCylinder
                    : styles.modeBadgeStandard,
                ]}
              >
                <Text style={styles.modeBadgeText}>{getModeLabel()}</Text>
              </View>
            </View>

            <View style={styles.cameraTopSpacer} />
          </View>

          <View style={styles.cameraGuideWrap}>
            <View
              style={[styles.guideBox, isCylinder && styles.guideBoxCylinder]}
            />
            <Text style={styles.guideText}>{getCameraGuideText()}</Text>
            <Text style={styles.guideSubText}>
              Tip: Fill about 75% of the frame for best accuracy.
            </Text>
          </View>

          <View style={styles.cameraBottomBar}>
            <TouchableOpacity
              style={[
                styles.captureButtonOuter,
                isProcessing && styles.buttonDisabled,
              ]}
              disabled={isProcessing}
              onPress={takePicture}
            >
              <View style={styles.captureButtonInner} />
            </TouchableOpacity>
          </View>
          {renderProcessingOverlay()}
        </SafeAreaView>
      </View>
    );
  };

  const renderUserError = () => {
    if (!userError) return null;

    return (
      <View style={styles.errorBanner}>
        <Text style={styles.errorBannerText}>{userError}</Text>
      </View>
    );
  };

  const renderProcessingOverlay = () => {
    if (!isProcessing) return null;

    return (
      <View style={styles.processingOverlay}>
        <View style={styles.processingCard}>
          <ActivityIndicator size="large" color="#111" />
          <Text style={styles.processingText}>
            {processingMessage || 'Working...'}
          </Text>
        </View>
      </View>
    );
  };

  const renderBarcodeScanner = () => {
    return (
      <View style={styles.cameraScreen}>
        <CameraView
          style={styles.camera}
          facing={facing}
          autofocus="on"
          onBarcodeScanned={
            isBarcodeLookupLoading || !barcodeScanEnabled
              ? undefined
              : handleBarcodeScanned
          }
          barcodeScannerSettings={{
            barcodeTypes: [
              'ean13',
              'ean8',
              'upc_a',
              'upc_e',
              'code128',
              'code39',
            ],
          }}
        />

        <SafeAreaView style={styles.cameraOverlay}>
          <View style={styles.cameraTopBar}>
            <View style={styles.cameraBadgeStack}>
              <Text style={styles.cameraInfoLabel}>Scan Item</Text>
            </View>

            <View style={styles.cameraTopSpacer} />
          </View>

          <View style={styles.cameraGuideWrap}>
            <View style={styles.guideBox} />
            <Text style={styles.guideText}>
              Center the barcode inside the guide box.
            </Text>
            <Text style={styles.guideSubText}>
              Autofocus is on. Move closer first, then hold steady for a moment.
              If barcode lookup misses, List Assist will send you to
              package-front mode.
            </Text>
            {isBarcodeLookupLoading ? (
              <View style={styles.lookupStatusCard}>
                <ActivityIndicator size="small" color="#ffffff" />
                <Text style={styles.lookupStatusText}>
                  Looking up barcode {lastScannedCode}...
                </Text>
              </View>
            ) : null}
          </View>

          {renderProcessingOverlay()}
        </SafeAreaView>
      </View>
    );
  };

  const renderBarcodeFailure = () => {
    const failureTitle = barcodeFailureState?.title ?? 'No product match found';
    const failureMessage =
      barcodeFailureState?.message ??
      'List Assist could not match that barcode this time.';

    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView
          ref={activeScrollRef}
          style={styles.flexFill}
          contentContainerStyle={styles.barcodeFailureScrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>{failureTitle}</Text>
          <Text style={styles.subtitle}>
            The barcode was detected, but List Assist could not finish the
            lookup.
          </Text>

          <View style={styles.barcodeFailureCard}>
            <Text style={styles.barcodeFailureBody}>{failureMessage}</Text>
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.infoCardTitle}>What to do next</Text>
            <Text style={styles.infoCardText}>
              Scan Again is best if the barcode was blurry or partly cut off.
            </Text>
            <Text style={styles.infoCardText}>
              Try Photo Scan is best when the barcode lookup missed a real-world
              item that the camera can still recognize.
            </Text>
          </View>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => {
              setBarcodeFailureState(null);
              resetBarcodeScannerState();
              setStep('barcodeScanner');
            }}
          >
            <Text style={styles.primaryButtonText}>Scan Again</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondaryButton, { backgroundColor: '#2DBE60' }]}
            onPress={() => {
              setBarcodeFailureState(null);
              startPackageFrontScan();
            }}
          >
            <Text style={[styles.secondaryButtonText, { color: '#fff' }]}>
              Try Photo Scan
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  };

  const renderPackageFrontCamera = () => {
    return (
      <View style={styles.cameraScreen}>
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing={facing}
          autofocus="on"
        />

        <SafeAreaView style={styles.cameraOverlay}>
          <View style={styles.cameraTopBar}>
            <View style={styles.cameraBadgeStack}>
              <Text style={styles.cameraInfoLabel}>Front of Package</Text>
            </View>

            <View style={styles.cameraTopSpacer} />
          </View>

          <View style={styles.cameraGuideWrap}>
            <View style={[styles.guideBox, styles.guideBoxPhotoLarge]} />
            <Text style={styles.guideText}>
              Fill the frame with the package front.
            </Text>
            <Text style={styles.guideSubText}>
              Get close, keep the front edges visible, then hold steady. Plain
              background is best. Avoid glare and shadows.
            </Text>
          </View>

          <View style={styles.cameraBottomBar}>
            <TouchableOpacity
              style={[
                styles.captureButtonOuter,
                isProcessing && styles.buttonDisabled,
              ]}
              disabled={isProcessing}
              onPress={takePackageFrontPhoto}
            >
              <View style={styles.captureButtonInner} />
            </TouchableOpacity>
          </View>
          {renderProcessingOverlay()}
        </SafeAreaView>
      </View>
    );
  };

  const renderPackageFrontPreview = () => {
    if (!packageFrontPhotoUri) return null;

    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView
          ref={activeScrollRef}
          style={styles.flexFill}
          contentContainerStyle={styles.packageFrontScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
        >
          <Text style={styles.title}>Front of Package</Text>
          <Text style={styles.subtitle}>
            The photo did not match the right item yet. Enter a short
            description and List Assist will search again using both the
            package-front photo and your description.
          </Text>

          {renderUserError()}

          <Image
            source={{ uri: packageFrontPhotoUri }}
            style={styles.packageFrontPreviewImage}
            resizeMode="contain"
          />

          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>Item description</Text>
            <TextInput
              style={styles.packageTextInput}
              placeholder="Enter a short description of the item"
              value={packageFrontSearchText}
              onChangeText={setPackageFrontSearchText}
              autoCapitalize="words"
              autoCorrect={false}
              multiline
            />
            {packageFrontLookupNote ? (
              <Text style={styles.resultDescription}>
                {packageFrontLookupNote}
              </Text>
            ) : null}
            {packageFrontDetectedText ? (
              <>
                <Text style={styles.resultLabel}>Detected text</Text>
                <Text style={styles.detectedTextPreview}>
                  {packageFrontDetectedText.length > 320
                    ? `${packageFrontDetectedText.slice(0, 320)}...`
                    : packageFrontDetectedText}
                </Text>
              </>
            ) : null}
          </View>

          {isPackageFrontLookupLoading ? (
            <View style={styles.lookupStatusCardInline}>
              <ActivityIndicator size="small" color="#111" />
              <Text style={styles.lookupStatusInlineText}>
                Analyzing the front of the package...
              </Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[
              styles.primaryButton,
              { height: 48, justifyContent: 'center', alignItems: 'center' },
              isProcessing && styles.buttonDisabled,
            ]}
            disabled={isProcessing}
            onPress={() => runPackageFrontLookup(packageFrontSearchText)}
            activeOpacity={0.75}
          >
            <Text style={styles.primaryButtonText}>
              Search with Photo + Description
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.secondaryButton,
              { height: 48, justifyContent: 'center', alignItems: 'center' },
              isProcessing && styles.buttonDisabled,
            ]}
            disabled={isProcessing}
            onPress={() => void startPackageFrontScan()}
            activeOpacity={0.75}
          >
            <Text style={[styles.secondaryButtonText, { color: '#fff' }]}>
              Retake Photo
            </Text>
          </TouchableOpacity>

          <View style={styles.packageFrontBottomSpacer} />
        </ScrollView>
        {renderProcessingOverlay()}
      </SafeAreaView>
    );
  };

  const renderPackageFrontConfirm = () => {
    if (!packageFrontPhotoUri || !packageFrontCandidateProduct) return null;

    const confidence = packageFrontCandidateProduct.confidence ?? 'medium';
    const confidenceText =
      confidence.charAt(0).toUpperCase() + confidence.slice(1);

    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView
          ref={activeScrollRef}
          style={styles.flexFill}
          contentContainerStyle={styles.packageFrontScrollContent}
          showsVerticalScrollIndicator
        >
          <Text style={styles.title}>Confirm Package Match</Text>
          <Text style={styles.subtitle}>
            List Assist found a likely item. Confirm it if this looks right, and
            it will learn this package faster for next time.
          </Text>

          <Image
            source={{ uri: packageFrontPhotoUri }}
            style={styles.packageFrontPreviewImage}
            resizeMode="contain"
          />

          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>Suggested item</Text>
            <Text style={styles.resultValueSmall}>
              {packageFrontCandidateProduct.title}
            </Text>
            <Text style={styles.resultDescription}>
              Confidence: {confidenceText}
            </Text>
            <Text style={styles.resultDescription}>
              Source: {packageFrontCandidateProduct.source}
            </Text>
            {packageFrontLookupNote ? (
              <Text style={styles.resultDescription}>
                {packageFrontLookupNote}
              </Text>
            ) : null}
            {packageFrontDetectedText ? (
              <>
                <Text style={[styles.resultLabel, { marginTop: 10 }]}>
                  Detected text
                </Text>
                <Text style={styles.detectedTextPreview}>
                  {packageFrontDetectedText.length > 320
                    ? `${packageFrontDetectedText.slice(0, 320)}...`
                    : packageFrontDetectedText}
                </Text>
              </>
            ) : null}
          </View>

          <TouchableOpacity
            style={[
              styles.primaryButton,
              { height: 48, justifyContent: 'center', alignItems: 'center' },
              isProcessing && styles.buttonDisabled,
            ]}
            disabled={isProcessing}
            onPress={confirmPackageFrontCandidate}
            activeOpacity={0.75}
          >
            <Text style={styles.primaryButtonText}>
              Yes, Use and Learn This Match
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.secondaryButton,
              { height: 48, justifyContent: 'center', alignItems: 'center' },
              isProcessing && styles.buttonDisabled,
            ]}
            disabled={isProcessing}
            onPress={() => {
              setPackageFrontCandidateProduct(null);
              setUserError(
                'Enter a short description below, then search again using the same package-front photo.',
              );
              setPackageFrontLookupNote(
                'Add a short item description, then tap Search with Photo + Description.',
              );
              setStep('packageFrontPreview');
              scrollToTop();
            }}
            activeOpacity={0.75}
          >
            <Text style={[styles.secondaryButtonText, { color: '#fff' }]}>
              Not This Item
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.secondaryButton,
              { height: 48, justifyContent: 'center', alignItems: 'center' },
              isProcessing && styles.buttonDisabled,
            ]}
            disabled={isProcessing}
            onPress={() => {
              setPackageFrontCandidateProduct(null);
              setStep('packageFrontCamera');
            }}
            activeOpacity={0.75}
          >
            <Text style={[styles.secondaryButtonText, { color: '#fff' }]}>
              Retake Photo
            </Text>
          </TouchableOpacity>

          <View style={styles.packageFrontBottomSpacer} />
        </ScrollView>
        {renderProcessingOverlay()}
      </SafeAreaView>
    );
  };

  const renderLooseItemCamera = () => {
    return (
      <View style={styles.cameraScreen}>
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing={facing}
          autofocus="on"
        />

        <SafeAreaView style={styles.cameraOverlay}>
          <View style={styles.cameraTopBar}>
            <View style={styles.cameraBadgeStack}>
              <Text style={styles.cameraInfoLabel}>Scan Item</Text>
            </View>

            <View style={styles.cameraTopSpacer} />
          </View>

          <View style={styles.cameraGuideWrap}>
            <View style={[styles.guideBox, styles.guideBoxPhotoLarge]} />
            <Text style={styles.guideText}>Fill the frame with the item.</Text>
            <Text style={styles.guideSubText}>
              Get close and keep the item edges visible. Plain background is
              best. Avoid glare and shadows.
            </Text>
          </View>

          <View style={styles.cameraBottomBar}>
            <TouchableOpacity
              style={[
                styles.captureButtonOuter,
                isProcessing && styles.buttonDisabled,
              ]}
              disabled={isProcessing}
              onPress={takeLooseItemPhoto}
            >
              <View style={styles.captureButtonInner} />
            </TouchableOpacity>
          </View>
          {renderProcessingOverlay()}
        </SafeAreaView>
      </View>
    );
  };

  const renderLooseItemPreview = () => {
    if (!looseItemPhotoUri) return null;

    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView
          ref={activeScrollRef}
          style={styles.flexFill}
          contentContainerStyle={styles.packageFrontScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
        >
          <Text style={styles.title}>Find from Photo</Text>
          <Text style={styles.subtitle}>
            We’ll search eBay using this item photo. If live photo search is
            offline, add a few helper words like brand, model, or item type.
          </Text>

          {renderUserError()}

          <Image
            source={{ uri: looseItemPhotoUri }}
            style={styles.packageFrontPreviewImage}
            resizeMode="contain"
          />

          {isLooseItemLookupLoading ? (
            <View style={styles.lookupStatusCardInline}>
              <ActivityIndicator size="small" color="#111" />
              <Text style={styles.lookupStatusInlineText}>
                Searching eBay for likely matches...
              </Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[
              styles.primaryButton,
              { height: 48, justifyContent: 'center', alignItems: 'center' },
              isProcessing && styles.buttonDisabled,
            ]}
            disabled={isProcessing}
            onPress={() => runLooseItemLookup(looseItemSearchText)}
            activeOpacity={0.75}
          >
            <Text style={styles.primaryButtonText}>Find Matches</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.secondaryButton,
              { height: 48, justifyContent: 'center', alignItems: 'center' },
              isProcessing && styles.buttonDisabled,
            ]}
            disabled={isProcessing}
            onPress={() => void startLooseItemScan()}
            activeOpacity={0.75}
          >
            <Text style={[styles.secondaryButtonText, { color: '#fff' }]}>
              Retake Photo
            </Text>
          </TouchableOpacity>

          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>Add a few words if needed</Text>
            <TextInput
              style={styles.packageTextInput}
              placeholder="Brand, model, toy line, lamp, figure, etc."
              value={looseItemSearchText}
              onChangeText={setLooseItemSearchText}
              autoCapitalize="words"
              autoCorrect={false}
              multiline
            />
            {looseItemLookupNote ? (
              <Text style={styles.resultDescription}>
                {looseItemLookupNote}
              </Text>
            ) : (
              <Text style={styles.resultDescription}>
                Use a plain background and make the item fill most of the frame.
              </Text>
            )}
          </View>

          <View style={styles.packageFrontBottomSpacer} />
        </ScrollView>
        {renderProcessingOverlay()}
      </SafeAreaView>
    );
  };

  const renderLooseItemConfirm = () => {
    if (!looseItemPhotoUri) return null;

    const hasMatches = looseItemMatches.length > 0;
    const looseItemPrimaryTitle = (looseItemMatches[0]?.title || '').trim();
    const looseItemResolvedQuery = buildLiveEbayQuery(
      looseItemPrimaryTitle || looseItemSearchText,
      null,
    ).trim();
    const topMatch = looseItemMatches[0] ?? null;

    if (isPriceCheckerSession) {
      return (
        <SafeAreaView style={styles.screen}>
          <ScrollView
            ref={activeScrollRef}
            style={styles.flexFill}
            contentContainerStyle={styles.packageFrontScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
          >
            <Text style={styles.title}>Is this the correct item?</Text>
            <Text style={styles.subtitle}>
              We found the most likely item from your photo. Confirm it below,
              or retake the picture and try again.
            </Text>

            <Image
              source={{ uri: looseItemPhotoUri }}
              style={styles.packageFrontPreviewImage}
              resizeMode="contain"
            />

            {topMatch ? (
              <View style={styles.resultCard}>
                <Text style={styles.resultLabel}>Best match found</Text>
                <Text style={styles.resultValueSmall}>{topMatch.title}</Text>
                <Text style={styles.resultDescription}>
                  {topMatch.price?.value && topMatch.price?.currency
                    ? `${topMatch.price.currency} ${topMatch.price.value}`
                    : 'No price shown'}
                  {topMatch.condition ? ` • ${topMatch.condition}` : ''}
                </Text>
              </View>
            ) : (
              <View style={styles.resultCard}>
                <Text style={styles.resultLabel}>No strong match yet</Text>
                <Text style={styles.resultDescription}>
                  We could not confirm the item from this photo. Please retake
                  the picture and try again.
                </Text>
              </View>
            )}

            {looseItemLookupNote ? (
              <View style={styles.resultCard}>
                <Text style={styles.resultDescription}>
                  {looseItemLookupNote}
                </Text>
              </View>
            ) : null}

            {topMatch ? (
              <View style={{ gap: 10 }}>
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={() => applyLooseItemMatch(topMatch)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.primaryButtonText}>Yes</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.secondaryButton,
                    {
                      height: 48,
                      justifyContent: 'center',
                      alignItems: 'center',
                    },
                  ]}
                  onPress={() => {
                    setLooseItemSelectedMatch(null);
                    setStep('looseItemCamera');
                    scrollToTop();
                  }}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.secondaryButtonText, { color: '#fff' }]}>
                    No - Retake Photo
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={[
                  styles.secondaryButton,
                  {
                    height: 48,
                    justifyContent: 'center',
                    alignItems: 'center',
                  },
                ]}
                onPress={() => {
                  setLooseItemSelectedMatch(null);
                  setStep('looseItemCamera');
                  scrollToTop();
                }}
                activeOpacity={0.75}
              >
                <Text style={[styles.secondaryButtonText, { color: '#fff' }]}>
                  Retake Photo
                </Text>
              </TouchableOpacity>
            )}

            <View style={styles.packageFrontBottomSpacer} />
          </ScrollView>
          {renderProcessingOverlay()}
        </SafeAreaView>
      );
    }

    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView
          ref={activeScrollRef}
          style={styles.flexFill}
          contentContainerStyle={styles.packageFrontScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
        >
          <Text style={styles.title}>Is this the correct item?</Text>
          <Text style={styles.subtitle}>
            Pick the closest eBay result below. If these look off, refine the
            words or retake the photo.
          </Text>

          <Image
            source={{ uri: looseItemPhotoUri }}
            style={styles.packageFrontPreviewImage}
            resizeMode="contain"
          />

          {looseItemLookupNote ? (
            <View style={styles.resultCard}>
              <Text style={styles.resultDescription}>
                {looseItemLookupNote}
              </Text>
            </View>
          ) : null}

          {hasMatches && looseItemResolvedQuery ? (
            <View
              style={[
                styles.infoCard,
                {
                  backgroundColor: '#EFF6FF',
                  borderColor: '#93C5FD',
                  shadowColor: '#1E3A8A',
                  shadowOpacity: 0.05,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 3 },
                  elevation: 2,
                },
              ]}
            >
              <Text style={[styles.infoCardTitle, { color: '#1D4ED8' }]}>
                eBay Market Check
              </Text>
              <Text style={[styles.infoCardText, { color: '#1d4ed8' }]}>
                Search used: {looseItemResolvedQuery}
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  marginTop: 12,
                }}
              >
                <TouchableOpacity
                  onPress={() =>
                    openResolvedEbaySearch({
                      sold: true,
                      query: looseItemResolvedQuery,
                      barcode: '',
                    })
                  }
                  style={{
                    flex: 1,
                    backgroundColor: '#1D4ED8',
                    borderRadius: 14,
                    paddingVertical: 12,
                    alignItems: 'center',
                  }}
                  activeOpacity={0.75}
                >
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: '800',
                      color: '#ffffff',
                    }}
                  >
                    View Sold Listings
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() =>
                    openResolvedEbaySearch({
                      sold: false,
                      query: looseItemResolvedQuery,
                      barcode: '',
                    })
                  }
                  style={{
                    flex: 1,
                    backgroundColor: '#FFFFFF',
                    borderRadius: 14,
                    paddingVertical: 12,
                    alignItems: 'center',
                    borderWidth: 1,
                    borderColor: '#93C5FD',
                  }}
                  activeOpacity={0.75}
                >
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: '800',
                      color: '#1E3A8A',
                    }}
                  >
                    View Live Search
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {hasMatches ? (
            <View style={{ gap: 12 }}>
              {looseItemMatches.map((item) => (
                <View key={item.itemId} style={styles.resultCard}>
                  <Text style={styles.resultLabel}>Likely match</Text>
                  {item.image?.imageUrl ? (
                    <Image
                      source={{ uri: item.image.imageUrl }}
                      style={{
                        width: '100%',
                        height: 180,
                        borderRadius: 14,
                        marginBottom: 12,
                        backgroundColor: '#f3f4f6',
                      }}
                      resizeMode="contain"
                    />
                  ) : null}
                  <Text style={styles.resultValueSmall}>{item.title}</Text>
                  <Text style={styles.resultDescription}>
                    {item.price?.value && item.price?.currency
                      ? `${item.price.currency} ${item.price.value}`
                      : 'No price'}
                    {item.condition ? ` • ${item.condition}` : ''}
                  </Text>
                  <TouchableOpacity
                    style={styles.primaryButton}
                    onPress={() => applyLooseItemMatch(item)}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.primaryButtonText}>This Is It</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.secondaryButton,
                      {
                        height: 48,
                        justifyContent: 'center',
                        alignItems: 'center',
                      },
                      { marginTop: 10 },
                    ]}
                    onPress={() => openExternalLink(item.itemWebUrl)}
                    activeOpacity={0.75}
                  >
                    <Text
                      style={[styles.secondaryButtonText, { color: '#fff' }]}
                    >
                      Open eBay Result
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.resultCard}>
              <Text style={styles.resultLabel}>No strong matches yet</Text>
              <Text style={styles.resultDescription}>
                Try better lighting, a cleaner background, or add a few exact
                words below.
              </Text>
            </View>
          )}

          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>Help us narrow it down</Text>
            <TextInput
              style={styles.packageTextInput}
              placeholder="Add brand, model, or item type"
              value={looseItemSearchText}
              onChangeText={setLooseItemSearchText}
              autoCapitalize="words"
              autoCorrect={false}
              multiline
            />
          </View>

          <TouchableOpacity
            style={[
              styles.secondaryButton,
              { height: 48, justifyContent: 'center', alignItems: 'center' },
              isProcessing && styles.buttonDisabled,
              { marginTop: 4 },
            ]}
            disabled={isProcessing}
            onPress={() => runLooseItemLookup(looseItemSearchText)}
            activeOpacity={0.75}
          >
            <Text style={[styles.secondaryButtonText, { color: '#fff' }]}>
              None of These - Search Again
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.secondaryButton,
              { height: 48, justifyContent: 'center', alignItems: 'center' },
              isProcessing && styles.buttonDisabled,
            ]}
            disabled={isProcessing}
            onPress={() => void startLooseItemScan()}
            activeOpacity={0.75}
          >
            <Text style={[styles.secondaryButtonText, { color: '#fff' }]}>
              Retake Photo
            </Text>
          </TouchableOpacity>

          <View style={styles.packageFrontBottomSpacer} />
        </ScrollView>
        {renderProcessingOverlay()}
      </SafeAreaView>
    );
  };

  const copyText = async (value: string, label: string) => {
    try {
      await Clipboard.setStringAsync(value);
      showVisualFeedback('success', `${label} copied`);
    } catch (error) {
      console.log('Copy failed', error);
      setUserError(`Could not copy ${label.toLowerCase()}.`);
    }
  };

  const renderCompCheck = () => {
    const resolvedTitle = (barcodeProduct?.title || '').trim();
    const resolvedBarcode = (barcodeProduct?.barcode || '').trim();
    const marketQuery = buildLiveEbayQuery(
      resolvedTitle,
      resolvedBarcode,
    ).trim();
    const hasMarketQuery = Boolean(marketQuery || resolvedBarcode);

    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView
          ref={activeScrollRef}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.eyebrow}>Step 2 · Market View</Text>
          <Text style={styles.title}>Check the Market</Text>
          <Text style={styles.subtitle}>
            Use active and sold listings to judge value fast before you buy or
            list.
          </Text>

          <View style={[styles.infoCard, styles.dealFinderHighlightCard]}>
            <Text style={styles.infoCardTitle}>Matched Product</Text>
            <Text style={styles.infoCardText}>
              {resolvedTitle || 'No product title was found yet.'}
            </Text>
            {resolvedBarcode ? (
              <Text style={styles.infoCardText}>
                Barcode: {resolvedBarcode}
              </Text>
            ) : null}
            {barcodeProduct?.source ? (
              <Text style={styles.infoCardText}>
                Source: {barcodeProduct.source}
              </Text>
            ) : null}
          </View>

          {barcodeProduct ? (
            <View
              style={[
                styles.resultCard,
                {
                  backgroundColor: '#FFF7ED',
                  borderColor: '#F59E0B',
                  shadowColor: '#7C2D12',
                  shadowOpacity: 0.06,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 3 },
                  elevation: 2,
                },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: '#9A3412' }]}>
                Price Data
              </Text>
              <Text style={[styles.resultValue, { color: '#7C2D12' }]}>
                {getSuggestedPriceRange(barcodeProduct).label}
              </Text>
              <Text style={[styles.helperText, { color: '#9A3412' }]}>
                Check Sold Listings to confirm price before listing.
              </Text>
            </View>
          ) : null}

          {hasMarketQuery ? (
            <View style={styles.resultCard}>
              <Text style={styles.resultLabel}>Quick Market Actions</Text>
              <Text style={styles.resultDescription}>
                Open current listings or sold comps for this matched item.
              </Text>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() =>
                  openResolvedEbaySearch({
                    sold: false,
                    query: marketQuery,
                    barcode: '',
                  })
                }
                activeOpacity={0.75}
              >
                <Text style={styles.primaryButtonText}>
                  View Active Listings
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  {
                    backgroundColor: '#2563EB',
                    marginTop: 12,
                  },
                ]}
                onPress={() =>
                  openResolvedEbaySearch({
                    sold: true,
                    query: marketQuery,
                    barcode: '',
                  })
                }
                activeOpacity={0.75}
              >
                <Text style={styles.primaryButtonText}>View Sold Listings</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  {
                    backgroundColor: '#16A34A',
                    marginTop: 12,
                  },
                ]}
                onPress={() => {
                  if (homeScanMode === 'source') {
                    setBarcodeFailureState(null);
                    setBarcodeProduct(null);
                    setPendingBarcodeLinkProduct(null);
                    resetBarcodeScannerState();
                    resetPackageFrontLookup();
                    resetLooseItemLookup();
                    setUserError('');
                    endProcessing();
                    setHomeMode('boxFinder');
                    setHomeScanMode('source');
                    setIsPriceCheckerSession(true);
                    setStep('referencePicker');
                    scrollToTop();
                  } else {
                    returnToPriceCheckerChooser();
                  }
                }}
                activeOpacity={0.75}
              >
                <Text style={styles.primaryButtonText}>Scan Another Item</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {renderEbayResultsBlock()}
        </ScrollView>
      </SafeAreaView>
    );
  };

  const renderPriceCheckerChooser = () => {
    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView
          ref={activeScrollRef}
          style={styles.flexFill}
          contentContainerStyle={styles.packageFrontScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
          contentInsetAdjustmentBehavior="automatic"
        >
          <Text style={styles.title}>Price Checker</Text>

          <View style={styles.resultCard}>
            <Text style={styles.resultDescription}>
              Scan Barcode, Box, or Item.
            </Text>

            <View style={styles.priceCheckerScanRow}>
              <TouchableOpacity
                style={[
                  styles.priceCheckerScanButton,
                  { backgroundColor: '#1E2F4D' },
                ]}
                onPress={() => void startBarcodeScan()}
                activeOpacity={0.85}
              >
                <Text style={styles.priceCheckerScanButtonText}>Barcode</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.priceCheckerScanButton,
                  { backgroundColor: '#157A74' },
                ]}
                onPress={() => void startPackageFrontScan()}
                activeOpacity={0.85}
              >
                <Text style={styles.priceCheckerScanButtonText}>Box</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.priceCheckerScanButton,
                  { backgroundColor: '#24C55A' },
                ]}
                onPress={() => void startLooseItemScan()}
                activeOpacity={0.85}
              >
                <Text style={styles.priceCheckerScanButtonText}>Item</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
        {renderProcessingOverlay()}
      </SafeAreaView>
    );
  };

  const renderPriceCheckerResult = () => {
    const looseItemPrimaryTitle = (looseItemMatches[0]?.title || '').trim();
    const looseItemResolvedQuery = buildLiveEbayQuery(
      looseItemPrimaryTitle || looseItemSearchText,
      null,
    ).trim();

    const marketQuery = (
      looseItemResolvedQuery ||
      getDealSearchTerms({
        product: barcodeProduct,
        packageFrontSearchText,
        packageFrontDetectedText,
      })
    ).trim();

    const marketPriceItems = ebayExactResults.length
      ? ebayExactResults
      : ebayResults.length
        ? ebayResults
        : looseItemMatches;
    const suggestedPrice = getSuggestedPriceRange(
      barcodeProduct,
      listingCondition,
      marketPriceItems,
    );
    const suggestedPriceLabel = suggestedPrice.label;
    const listingConfidence = getListingConfidence(barcodeProduct);
    const titleText =
      buildBestListingTitle(barcodeProduct, listingCondition) ||
      barcodeProduct?.title ||
      'Item not identified yet';

    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView
          ref={activeScrollRef}
          style={styles.flexFill}
          contentContainerStyle={styles.packageFrontScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
          contentInsetAdjustmentBehavior="automatic"
        >
          <Text style={styles.title}>Price Checker</Text>

          <View style={styles.resultCard}>
            <View style={styles.titleCardHeader}>
              <Text style={styles.sectionTitle}>Title</Text>
              <View
                style={[
                  styles.miniConfidencePill,
                  {
                    backgroundColor: '#ECFDF5',
                    borderColor: '#86EFAC',
                  },
                ]}
              >
                <Text
                  style={[styles.miniConfidencePillText, { color: '#166534' }]}
                >
                  {listingConfidence.label}
                </Text>
              </View>
            </View>
            <Text style={styles.resultValueSmall}>{titleText}</Text>
          </View>

          <View
            style={[
              styles.resultCard,
              {
                backgroundColor: '#FFF7ED',
                borderColor: '#F59E0B',
                shadowColor: '#7C2D12',
                shadowOpacity: 0.06,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 3 },
                elevation: 2,
              },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: '#9A3412' }]}>
              Price Data
            </Text>
            <Text style={[styles.resultValue, { color: '#7C2D12' }]}>
              {suggestedPriceLabel}
            </Text>
            <Text style={[styles.helperText, { color: '#9A3412' }]}>
              {suggestedPrice.helperText}
            </Text>
          </View>

          {marketQuery ? (
            <View
              style={[
                styles.infoCard,
                {
                  backgroundColor: '#EFF6FF',
                  borderColor: '#93C5FD',
                  shadowColor: '#1E3A8A',
                  shadowOpacity: 0.05,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 3 },
                  elevation: 2,
                },
              ]}
            >
              <Text style={[styles.infoCardTitle, { color: '#1D4ED8' }]}>
                eBay Market Check
              </Text>

              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  marginTop: 12,
                }}
              >
                <TouchableOpacity
                  onPress={() =>
                    openResolvedEbaySearch({
                      sold: true,
                      query: marketQuery,
                      barcode: '',
                    })
                  }
                  style={{
                    flex: 1,
                    backgroundColor: '#1D4ED8',
                    borderRadius: 14,
                    paddingVertical: 12,
                    alignItems: 'center',
                  }}
                  activeOpacity={0.75}
                >
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: '800',
                      color: '#ffffff',
                    }}
                  >
                    View Sold Listings
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() =>
                    openResolvedEbaySearch({
                      sold: false,
                      query: marketQuery,
                      barcode: '',
                    })
                  }
                  style={{
                    flex: 1,
                    backgroundColor: '#FFFFFF',
                    borderRadius: 14,
                    paddingVertical: 12,
                    alignItems: 'center',
                    borderWidth: 1,
                    borderColor: '#93C5FD',
                  }}
                  activeOpacity={0.75}
                >
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: '800',
                      color: '#1E3A8A',
                    }}
                  >
                    View Live Search
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          <TouchableOpacity
            style={[
              styles.primaryButton,
              { marginTop: 10, backgroundColor: '#16A34A' },
            ]}
            onPress={returnToPriceCheckerChooser}
            activeOpacity={0.75}
          >
            <Text style={styles.primaryButtonText}>Scan Another Item</Text>
          </TouchableOpacity>
        </ScrollView>
        {renderProcessingOverlay()}
      </SafeAreaView>
    );
  };

  const renderListingBuilder = () => {
    const conditionOptions: ListingCondition[] = [
      'Used',
      'New',
      'Open Box',
      'For Parts',
    ];

    const baseDraft =
      listingDraft ??
      buildListingDraft({
        platform: listingPlatform,
        condition: listingCondition,
        product: barcodeProduct,
        measurements,
        isCylinder,
        packageFrontSearchText,
        titleVariantSeed,
      });

    const draft = enhanceListingDraftForDisplay({
      draft: baseDraft,
      product: barcodeProduct,
      condition: listingCondition,
      detectedText: packageFrontDetectedText,
      manualHint: packageFrontSearchText,
    });

    const cleanedTitleOptions = dedupeTitleOptions(draft.titleOptions ?? []);
    const bestTitleIndex = getBestTitleIndex(cleanedTitleOptions, {
      platform: listingPlatform,
      condition: listingCondition,
      product: barcodeProduct,
      measurements,
      isCylinder,
    });
    const bestTitle =
      buildBestListingTitle(barcodeProduct, listingCondition) ||
      enforceTitleLength(
        cleanedTitleOptions[bestTitleIndex] ?? cleanedTitleOptions[0] ?? '',
        80,
      );
    const listingConfidence = getListingConfidence(barcodeProduct);
    const listingMarketQuery = buildLiveEbayQuery(
      (barcodeProduct?.title || bestTitle || '').trim(),
      (barcodeProduct?.barcode || '').trim(),
    ).trim();
    const hasListingMarketQuery = Boolean(
      listingMarketQuery || (barcodeProduct?.barcode || '').trim(),
    );

    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView
          ref={activeScrollRef}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>Build the Listing</Text>
          {draft.priceSuggestion ? (
            <View
              style={[
                styles.resultCard,
                {
                  backgroundColor: '#FFF7ED',
                  borderColor: '#F59E0B',
                  shadowColor: '#7C2D12',
                  shadowOpacity: 0.06,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 3 },
                  elevation: 2,
                },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: '#9A3412' }]}>
                Price Data
              </Text>
              <Text style={[styles.resultValue, { color: '#7C2D12' }]}>
                {draft.priceSuggestion}
              </Text>
              <Text style={[styles.helperText, { color: '#9A3412' }]}>
                Check Sold Listings to confirm price before listing.
              </Text>
            </View>
          ) : null}

          {hasListingMarketQuery ? (
            <View
              style={[
                styles.infoCard,
                {
                  backgroundColor: '#eff6ff',
                  borderColor: '#bfdbfe',
                },
              ]}
            >
              <Text style={[styles.infoCardTitle, { color: '#1d4ed8' }]}>
                eBay Market Check
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  marginTop: 12,
                }}
              >
                <TouchableOpacity
                  onPress={() =>
                    openResolvedEbaySearch({
                      sold: true,
                      query: listingMarketQuery,
                      barcode: '',
                    })
                  }
                  style={{
                    flex: 1,
                    backgroundColor: '#1E3A8A',
                    borderRadius: 12,
                    paddingVertical: 12,
                    alignItems: 'center',
                  }}
                  activeOpacity={0.75}
                >
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: '800',
                      color: '#ffffff',
                    }}
                  >
                    View Sold Listings
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() =>
                    openResolvedEbaySearch({
                      sold: false,
                      query: listingMarketQuery,
                      barcode: '',
                    })
                  }
                  style={{
                    flex: 1,
                    backgroundColor: '#f3f4f6',
                    borderRadius: 12,
                    paddingVertical: 12,
                    alignItems: 'center',
                    borderWidth: 1,
                    borderColor: '#d1d5db',
                  }}
                  activeOpacity={0.75}
                >
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: '800',
                      color: '#111827',
                    }}
                  >
                    View Live Search
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          <View style={styles.resultCard}>
            <Text style={styles.sectionTitle}>Condition</Text>
            <View style={styles.chipRow}>
              {conditionOptions.map((option) => {
                const isSelected = listingCondition === option;
                return (
                  <TouchableOpacity
                    key={option}
                    style={[
                      styles.fitModeChip,
                      isSelected && styles.fitModeChipSelected,
                    ]}
                    onPress={() => {
                      setListingCondition(option);
                      const nextDraft = buildListingDraft({
                        platform: listingPlatform,
                        condition: option,
                        product: barcodeProduct,
                        measurements,
                        isCylinder,
                        packageFrontSearchText,
                        titleVariantSeed,
                      });
                      setListingDraft(nextDraft);
                    }}
                    activeOpacity={0.75}
                  >
                    <Text
                      style={[
                        styles.fitModeChipText,
                        isSelected && styles.fitModeChipTextSelected,
                      ]}
                    >
                      {option}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.resultCard}>
            <View style={styles.titleCardHeader}>
              <Text style={styles.sectionTitle}>Title</Text>
              <View
                style={[
                  styles.miniConfidencePill,
                  {
                    backgroundColor: '#ECFDF5',
                    borderColor: '#86EFAC',
                  },
                ]}
              >
                <Text
                  style={[styles.miniConfidencePillText, { color: '#166534' }]}
                >
                  {listingConfidence.label}
                </Text>
              </View>
            </View>
            <Text style={styles.resultValueSmall}>
              {bestTitle || 'No title yet'}
            </Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => copyText(bestTitle, 'Best title')}
              activeOpacity={0.75}
            >
              <Text style={styles.primaryButtonText}>Copy Title</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.resultCard}>
            <Text style={styles.sectionTitle}>Description</Text>
            <Text style={styles.resultDescription}>
              {draft.fullDescription}
            </Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() =>
                copyText(draft.fullDescription, 'Full description')
              }
              activeOpacity={0.75}
            >
              <Text style={styles.primaryButtonText}>Copy Description</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[
              styles.primaryButton,
              { marginTop: 10, backgroundColor: '#16A34A' },
            ]}
            onPress={() => setStep('referencePicker')}
          >
            <Text style={styles.primaryButtonText}>Scan Another Item</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  };

  if (
    !permission?.granted &&
    (step === 'cameraPhoto1' ||
      step === 'cameraPhoto2' ||
      step === 'barcodeScanner' ||
      step === 'packageFrontCamera' ||
      step === 'looseItemCamera')
  ) {
    return (
      <>
        <SafeAreaView style={styles.centeredScreen}>
          <Text style={styles.infoText}>Camera permission is required.</Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={requestPermission}
          >
            <Text style={styles.primaryButtonText}>Grant Permission</Text>
          </TouchableOpacity>
        </SafeAreaView>
        {renderFeedbackOverlay()}
      </>
    );
  }

  // ===== GARAGE SALE PHASE 1: HOME SCREEN UI END =====
  let screen = renderReferencePicker();

  if (step === 'barcodeScanner') screen = renderBarcodeScanner();
  else if (step === 'barcodeFailure') screen = renderBarcodeFailure();
  else if (step === 'referenceObjectPicker')
    screen = renderReferenceObjectPicker();
  else if (step === 'packageFrontCamera') screen = renderPackageFrontCamera();
  else if (step === 'packageFrontPreview') screen = renderPackageFrontPreview();
  else if (step === 'packageFrontConfirm') screen = renderPackageFrontConfirm();
  else if (step === 'looseItemCamera') screen = renderLooseItemCamera();
  else if (step === 'looseItemPreview') screen = renderLooseItemPreview();
  else if (step === 'looseItemConfirm') screen = renderLooseItemConfirm();
  else if (step === 'sellerTools') screen = renderSellerTools();
  else if (step === 'garageSaleLanding') screen = renderGarageSaleLanding();
  else if (step === 'estateSaleLanding') screen = renderEstateSaleLanding();
  else if (step === 'garageSales') screen = renderGarageSales();
  else if (step === 'garageSalesMap') screen = renderGarageSalesMap();
  else if (step === 'routeSummary') screen = renderRouteSummary();
  else if (step === 'cameraPhoto1' || step === 'cameraPhoto2')
    screen = renderCamera();
  else if (step === 'photo1Preview') screen = renderPhotoPreview('photo1');
  else if (step === 'photo2Preview') screen = renderPhotoPreview('photo2');
  else if (step === 'photo1ReferenceTap') screen = renderReferenceTap('photo1');
  else if (step === 'photo2ReferenceTap') screen = renderReferenceTap('photo2');
  else if (step === 'photo1ReferenceAdjust')
    screen = renderReferenceAdjust('photo1');
  else if (step === 'photo2ReferenceAdjust')
    screen = renderReferenceAdjust('photo2');
  else if (step === 'measurePhoto1') screen = renderMeasureScreen('photo1');
  else if (step === 'measurePhoto2') screen = renderMeasureScreen('photo2');
  else if (step === 'compCheck') screen = renderCompCheck();
  else if (step === 'results') screen = renderResults();
  else if (step === 'priceCheckerChooser') screen = renderPriceCheckerChooser();
  else if (step === 'priceCheckerResult') screen = renderPriceCheckerResult();
  else if (step === 'listingBuilder') screen = renderListingBuilder();

  return (
    <>
      {screen}
      {renderFeedbackOverlay()}
    </>
  );
}

function buildSuggestedDetection(
  tapX: number,
  tapY: number,
  reference: ReferenceConfig,
): DetectionBox {
  if (reference.shape === 'circle') {
    const size = reference.key === 'quarter' ? 72 : 92;

    return {
      x: clamp(tapX - size / 2, 0, PREVIEW_WIDTH - size),
      y: clamp(tapY - size / 2, 0, PREVIEW_HEIGHT - size),
      width: size,
      height: size,
      shape: 'circle',
      estimatedPixels: size,
    };
  }

  if (reference.key === 'dollarBill') {
    const width = 190;
    const height = 82;

    return {
      x: clamp(tapX - width / 2, 0, PREVIEW_WIDTH - width),
      y: clamp(tapY - height / 2, 0, PREVIEW_HEIGHT - height),
      width,
      height,
      shape: 'rectangle',
      estimatedPixels: width,
    };
  }

  const width = 145;
  const height = 88;

  return {
    x: clamp(tapX - width / 2, 0, PREVIEW_WIDTH - width),
    y: clamp(tapY - height / 2, 0, PREVIEW_HEIGHT - height),
    width,
    height,
    shape: 'rectangle',
    estimatedPixels: width,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    marginTop: 6,
  },
  headerIcon: {
    width: 32,
    height: 32,
    marginRight: 10,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '600',
    letterSpacing: 0.2,
    color: '#000',
  },
  priceCheckerScanRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 10,
  },
  priceCheckerScanButton: {
    flex: 1,
    minHeight: 104,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  priceCheckerScanButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
  },
  scanButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    marginBottom: 18,
  },
  scanHalfButton: {
    width: '48%',
    height: 62,
    minHeight: 62,
    maxHeight: 62,
    borderRadius: 18,
    paddingVertical: 0,
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  scanHalfButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 20,
    textAlign: 'center',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },

  splitButtonRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 16,
    marginTop: 18,
    marginBottom: 18,
  },
  splitActionButton: {
    flex: 1,
    height: 62,
    minHeight: 62,
    maxHeight: 62,
    borderRadius: 18,
    paddingVertical: 0,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  splitActionButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 20,
    textAlign: 'center',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },

  splitActionButton: {
    flex: 1,
    height: 62,
    minHeight: 62,
    maxHeight: 62,
    borderRadius: 18,
    paddingVertical: 0,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  splitActionButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 20,
    textAlign: 'center',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },

  weatherCard: {
    backgroundColor: '#EEF5FF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#D6E4FF',
  },
  mapLegendHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    marginBottom: 10,
  },
  mapLegendTitle: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '800',
  },
  mapLegendInfoButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapLegendInfoButtonText: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '800',
  },
  mapLegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    rowGap: 10,
    marginBottom: 8,
  },
  mapLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    alignItems: 'center',
  },
  mapLegendSwatch: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginRight: 6,
  },
  mapLegendSelectedMarkerWrap: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  mapLegendSelectedMarkerOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  mapLegendSelectedMarkerInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  mapLegendTargetSwatch: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#ffffff',
    borderWidth: 3,
    borderColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  mapLegendTargetInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ef4444',
  },
  mapLegendText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '600',
  },
  mapLegendInfoCard: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  mapLegendInfoText: {
    color: '#475569',
    fontSize: 14,
    lineHeight: 22,
  },
  mapHelperText: {
    color: '#475569',
    fontSize: 13,
    marginTop: 12,
    marginBottom: 2,
  },
  saleMarkerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  saleMarkerOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  saleMarkerOuterSelected: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 4,
    shadowOpacity: 0.24,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  saleMarkerInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  saleMarkerInnerSelected: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  clusterMarkerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  clusterMarkerBubble: {
    minWidth: 34,
    height: 34,
    borderRadius: 17,
    paddingHorizontal: 8,
    backgroundColor: '#0f172a',
    borderWidth: 2,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.22,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  clusterMarkerText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },

  mapActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    marginTop: 12,
    marginBottom: 4,
  },
  mapButtonGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
    columnGap: 12,
    marginTop: 12,
  },
  mapGridButton: {
    width: '48%',
    minHeight: 54,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },

  mapNavigateGridButton: {
    backgroundColor: '#2563EB',
  },
  mapNavigateGridButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  mapAddGridButton: {
    backgroundColor: '#16a34a',
  },
  mapAddGridButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  mapRemoveGridButton: {
    backgroundColor: '#f59e0b',
  },
  mapStartGridButton: {
    backgroundColor: '#7C3AED',
  },
  mapStartGridButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  mapRecenterGridButton: {
    backgroundColor: '#0f172a',
  },
  mapRecenterGridButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  mapPrimaryGridButton: {
    backgroundColor: '#2563EB',
  },
  mapPrimaryGridButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  mapDarkGridButton: {
    backgroundColor: '#0f172a',
  },
  mapDarkGridButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  backToTopFloatingButton: {
    position: 'absolute',
    right: 8,
    bottom: 76,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#0f172a',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 7,
    borderWidth: 1,
    borderColor: '#1e3a8a',
  },
  backToTopFloatingButtonIcon: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
  },
  backToTopFloatingButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  mapGridButtonPlaceholder: {
    width: '48%',
    minHeight: 54,
  },
  mapClearRouteWrap: {
    alignItems: 'center',
    marginTop: 12,
  },
  mapClearGridButton: {
    width: '48%',
    backgroundColor: '#dc2626',
  },
  mapClearGridButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  startRouteButton: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  startRouteButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },

  userMarkerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  userMarkerPulse: {
    position: 'absolute',
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(239, 68, 68, 0.28)',
  },
  userMarkerOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    borderWidth: 3,
    borderColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  userMarkerInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ef4444',
  },
  userCalloutShell: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  userCalloutBubble: {
    width: 180,
    minWidth: 180,
    maxWidth: 180,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  userCalloutTitle: {
    fontSize: 22,
    lineHeight: 22,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 6,
  },
  userCalloutText: {
    fontSize: 16,
    lineHeight: 20,
    color: '#374151',
  },
  userCalloutArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderTopWidth: 12,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#ffffff',
    marginTop: -1,
  },
  userCalloutWrap: {
    alignItems: 'center',
  },
  userCalloutCard: {
    minWidth: 160,
    maxWidth: 220,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  userCalloutTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 4,
    textAlign: 'center',
  },
  userCalloutSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    color: '#334155',
    textAlign: 'center',
  },
  userCalloutPointer: {
    width: 14,
    height: 14,
    backgroundColor: '#ffffff',
    transform: [{ rotate: '45deg' }],
    marginTop: -7,
  },
  recenterMapButton: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    alignSelf: 'flex-start',
    marginTop: 12,
    marginBottom: 4,
  },
  recenterMapButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },

  saleTypeBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 10,
  },
  saleTypeBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  saleTypeBadgeText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },

  screen: {
    flex: 1,
    backgroundColor: '#fff',
  },
  flexFill: {
    flex: 1,
  },
  centeredScreen: {
    flex: 1,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 10,
  },
  inlineBackButton: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 2,
    marginBottom: 4,
  },
  inlineBackButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  barcodeFailureScrollContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 12,
    flexGrow: 1,
    justifyContent: 'center',
  },
  barcodeFailureCard: {
    borderWidth: 1,
    borderColor: '#f3d3a1',
    borderRadius: 16,
    backgroundColor: '#fff8ef',
    padding: 16,
  },
  barcodeFailureBody: {
    fontSize: 16,
    lineHeight: 22,
    color: '#5b4230',
  },
  infoCard: {
    borderWidth: 1,
    borderColor: '#DBEAFE',
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    padding: 16,
    gap: 8,
  },
  infoCardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111',
  },
  infoCardText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#4b5563',
  },
  dealFinderHighlightCard: {
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
  },
  packageFrontScrollContent: {
    padding: 16,
    paddingBottom: 180,
    gap: 10,
    flexGrow: 1,
  },
  packageFrontBottomSpacer: {
    height: 120,
  },
  cameraScreen: {
    flex: 1,
    backgroundColor: '#000',
    position: 'relative',
  },
  camera: {
    ...StyleSheet.absoluteFillObject,
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  cameraTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topButton: {
    position: 'absolute',
    right: 16,
    bottom: 70,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    minWidth: 70,
    alignItems: 'center',
  },
  topButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  cameraBadgeStack: {
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 10,
    flexShrink: 1,
  },
  referenceBadge: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  referenceBadgeText: {
    color: '#fff',
    fontWeight: '600',
  },
  cameraInfoLabel: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  modeBadge: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 2,
  },
  modeBadgeStandard: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderColor: '#d1d5db',
  },
  modeBadgeCylinder: {
    backgroundColor: 'rgba(34,197,94,0.92)',
    borderColor: '#16a34a',
  },
  modeBadgeText: {
    color: '#111',
    fontWeight: '800',
    fontSize: 13,
  },
  cameraGuideWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  guideBox: {
    width: 260,
    height: 260,
    borderWidth: 2,
    borderColor: '#fff',
    borderRadius: 16,
    backgroundColor: 'transparent',
  },
  guideBoxPhotoLarge: {
    width: '96%',
    height: Math.min(SCREEN_WIDTH * 1.35, 560),
    borderRadius: 22,
  },
  guideBoxCylinder: {
    width: 280,
    height: 220,
    borderRadius: 24,
  },
  guideText: {
    color: '#fff',
    marginTop: 14,
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  guideSubText: {
    color: '#ddd',
    marginTop: 6,
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  cameraBottomBar: {
    alignItems: 'center',
    paddingBottom: 18,
  },
  captureButtonOuter: {
    width: 86,
    height: 86,
    borderRadius: 43,
    borderWidth: 4,
    borderColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButtonInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#fff',
  },
  eyebrow: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '600',
    marginBottom: 6,
    color: '#111',
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 20,
    color: '#555',
    marginBottom: 8,
  },
  referenceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 16,
  },
  referenceGridItem: {
    width: '48%',
    minHeight: 150,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#d1d5db',
    paddingHorizontal: 18,
    paddingVertical: 20,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    marginBottom: 0,
  },
  cardList: {
    gap: 8,
    marginBottom: 6,
  },
  referenceCard: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 16,
    minHeight: 72,
    justifyContent: 'center',
    backgroundColor: '#fafafa',
  },
  referenceCardSelected: {
    borderColor: '#111',
    backgroundColor: '#f1f1f1',
  },
  referenceLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111',
    marginBottom: 2,
  },
  referenceLabelSelected: {
    color: '#000',
  },
  referenceDescription: {
    fontSize: 12,
    lineHeight: 16,
    color: '#666',
  },
  referenceDescriptionSelected: {
    color: '#333',
  },
  modeCard: {
    borderWidth: 2,
    borderColor: '#111',
    borderRadius: 16,
    padding: 12,
    backgroundColor: '#f8fafc',
    marginBottom: 8,
  },
  modeLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111',
    marginBottom: 6,
  },
  modeButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modeOptionButton: {
    flex: 1,
    borderWidth: 2,
    borderColor: '#cbd5e1',
    borderRadius: 14,
    backgroundColor: '#ffffff',
    paddingVertical: 13,
    paddingHorizontal: 12,
    minHeight: 84,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeOptionButtonActive: {
    backgroundColor: '#111',
    borderColor: '#111',
  },
  modeOptionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111',
  },
  modeOptionTitleActive: {
    color: '#fff',
  },
  modeOptionSubtitle: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  modeOptionSubtitleActive: {
    color: '#e5e7eb',
  },
  modeHelpText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#555',
    marginTop: 8,
  },
  stepCard: {
    borderWidth: 2,
    borderColor: '#16a34a',
    borderRadius: 16,
    padding: 16,
    backgroundColor: '#f0fdf4',
    marginBottom: 8,
  },
  stepCardEyebrow: {
    fontSize: 13,
    fontWeight: '600',
    color: '#166534',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  stepCardTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111',
    marginBottom: 6,
  },
  stepCardDescription: {
    fontSize: 14,
    lineHeight: 20,
    color: '#374151',
  },
  stepPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
  },
  stepPill: {
    flex: 1,
    borderWidth: 2,
    borderColor: '#bbf7d0',
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#ffffff',
    alignItems: 'center',
  },
  stepPillActive: {
    backgroundColor: '#16a34a',
    borderColor: '#16a34a',
  },
  stepPillDone: {
    backgroundColor: '#166534',
    borderColor: '#166534',
  },
  stepPillText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#166534',
  },
  stepPillTextActive: {
    color: '#fff',
  },

  progressCard: {
    borderWidth: 1,
    borderColor: '#dbeafe',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#f8fbff',
    marginBottom: 8,
  },
  progressTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  progressBadge: {
    backgroundColor: '#111',
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  progressBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  progressSummaryText: {
    color: '#4b5563',
    fontSize: 12,
    fontWeight: '600',
  },
  progressTitle: {
    color: '#111',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 3,
  },
  progressDescription: {
    color: '#556',
    fontSize: 13,
    lineHeight: 18,
  },
  primaryButtonTopVisible: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#111',
    borderRadius: 12,
    minHeight: 52,
    paddingVertical: 13,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    marginBottom: 6,
  },
  primaryButtonTopVisibleText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },

  primaryButtonTopAnchored: {
    backgroundColor: '#111',
    borderRadius: 12,
    paddingVertical: 14,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  topActionCard: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 14,
    backgroundColor: '#f9fafb',
    padding: 10,
    marginBottom: 8,
  },
  topActionHint: {
    fontSize: 13,
    lineHeight: 18,
    color: '#4b5563',
    marginBottom: 2,
  },
  topActionButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
  },
  topActionButton: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderRadius: 18,
    paddingVertical: 16,
    minHeight: 62,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: '#1E293B',
    borderRadius: 18,
    paddingVertical: 16,
    minHeight: 62,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  primaryButtonDisabled: {
    backgroundColor: '#cfcfcf',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  primaryButtonTextDisabled: {
    color: '#7a7a7a',
  },
  secondaryButton: {
    backgroundColor: '#2DBE60',
    borderRadius: 18,
    paddingVertical: 16,
    minHeight: 62,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  secondaryButtonText: {
    textAlign: 'center',
    color: '#111',
    fontSize: 16,
    fontWeight: '600',
  },
  primaryButtonCompact: {
    backgroundColor: '#111',
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 16,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  secondaryButtonCompact: {
    backgroundColor: '#eee',
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 16,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saleActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  saleActionButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  saleActionButtonMap: {
    backgroundColor: '#2563EB',
  },
  saleActionButtonHide: {
    backgroundColor: '#e5e7eb',
  },
  saleActionButtonView: {
    backgroundColor: '#16a34a',
  },
  saleActionButtonDisabled: {
    backgroundColor: '#9ca3af',
  },
  saleActionIcon: {
    fontSize: 14,
  },
  saleActionText: {
    color: '#111',
    fontSize: 15,
    fontWeight: '800',
  },
  saleActionTextLight: {
    color: '#ffffff',
  },
  profitTickerBar: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  profitTickerText: {
    fontSize: 13,
    fontWeight: '800',
  },
  otherMarketplacesSection: {
    marginTop: 14,
    marginBottom: 2,
    paddingTop: 6,
  },
  otherMarketplacesHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 6,
    marginLeft: 2,
  },
  loadingStatusCard: {
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#eff6ff',
    marginBottom: 6,
    shadowColor: '#2563eb',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  loadingStatusTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1e3a8a',
    marginBottom: 4,
  },
  loadingStatusText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#1d4ed8',
  },
  loadingStatusMeta: {
    fontSize: 13,
    lineHeight: 18,
    color: '#475569',
    marginTop: 8,
  },
  loadingStatusPulseText: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 6,
    fontWeight: '600',
  },
  resultCard: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 16,
    paddingBottom: 18,
    backgroundColor: '#FFFFFF',
    marginBottom: 10,
  },
  finderCard: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: '#fafafa',
    marginTop: 18,
    marginBottom: 6,
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  finderButton: {
    height: 62,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
    borderRadius: 18,
  },
  finderDescription: {
    fontSize: 13,
    lineHeight: 19,
    color: '#555',
    marginTop: 12,
  },
  resultLabel: {
    fontSize: 13,
    color: '#666',
    marginBottom: 4,
  },
  resultValue: {
    fontSize: 22,
    fontWeight: '600',
    color: '#111',
    marginBottom: 6,
  },
  resultValueSmall: {
    fontSize: 17,
    fontWeight: '600',
    color: '#111',
    marginBottom: 4,
  },
  resultDescription: {
    fontSize: 13,
    lineHeight: 19,
    color: '#555',
  },
  savedMeasurementText: {
    fontSize: 16,
    color: '#333',
    marginTop: 6,
  },

  savedPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  savedPill: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
  },
  savedPillDone: {
    backgroundColor: '#ecfdf3',
    borderColor: '#86efac',
  },
  savedPillText: {
    color: '#4b5563',
    fontSize: 13,
    fontWeight: '600',
  },
  savedPillTextDone: {
    color: '#166534',
  },
  previewWrap: {
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    alignSelf: 'center',
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#ddd',
    marginBottom: 6,
    position: 'relative',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  packageFrontPreviewImage: {
    width: '100%',
    height: 320,
    borderRadius: 18,
    backgroundColor: '#f3f4f6',
    marginBottom: 8,
  },
  detectedOverlay: {
    position: 'absolute',
    borderWidth: 3,
    borderColor: '#2DBE60',
    backgroundColor: 'rgba(34,197,94,0.14)',
  },
  detectedCircle: {
    borderRadius: 999,
  },
  detectedRectangle: {
    borderRadius: 10,
  },
  measurePoint: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#2563EB',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  measurePointText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '600',
  },
  measureLine: {
    position: 'absolute',
    height: 3,
    backgroundColor: '#2563EB',
    borderRadius: 999,
  },
  measureCap: {
    position: 'absolute',
    backgroundColor: '#2563EB',
    borderRadius: 999,
  },
  measureLabel: {
    position: 'absolute',
    backgroundColor: 'rgba(17,17,17,0.92)',
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  measureLabelText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
  statusPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  adjustTopCardCompact: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 14,
    padding: 10,
    backgroundColor: '#fafafa',
    marginBottom: 8,
  },
  adjustTopGrid: {
    gap: 9,
  },
  adjustTopRowSpread: {
    flexDirection: 'row',
    alignItems: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  adjustMiddleRowCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  adjustBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    justifyContent: 'space-between',
    alignItems: 'stretch',
  },
  adjustArrowButton: {
    backgroundColor: '#111',
    borderRadius: 10,
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  adjustArrowButtonText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 22,
    lineHeight: 22,
  },
  adjustResizeButton: {
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adjustResizeButtonWide: {
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 10,
    minWidth: 92,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  adjustResizeButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  adjustRecenterButton: {
    backgroundColor: '#e5e7eb',
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
    minWidth: 82,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adjustRecenterButtonText: {
    color: '#111',
    fontWeight: '600',
    fontSize: 13,
  },
  adjustConfirmButton: {
    flex: 1.7,
  },
  adjustRetakeButton: {
    minWidth: 88,
  },
  dimensionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 2,
    marginBottom: 8,
  },
  dimensionButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fafafa',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  dimensionButtonActive: {
    backgroundColor: '#111',
    borderColor: '#111',
  },
  dimensionButtonReady: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  dimensionButtonText: {
    color: '#555',
    fontSize: 14,
    fontWeight: '600',
  },
  dimensionButtonTextActive: {
    color: '#fff',
  },

  dimensionButtonSaved: {
    backgroundColor: '#f0fdf4',
    borderColor: '#86efac',
  },
  dimensionButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  dimensionButtonTextSaved: {
    color: '#166534',
  },
  dimensionCheckBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#16a34a',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  dimensionCheckBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  photoPreviewCard: {
    marginTop: 10,
  },

  resultsHeroCard: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 16,
    padding: 14,
    backgroundColor: '#fafafa',
    marginBottom: 8,
  },
  resultsHeroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  resultsModeBadge: {
    backgroundColor: '#111',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  resultsModeBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  resultsReferenceText: {
    color: '#4b5563',
    fontSize: 13,
    fontWeight: '600',
  },
  resultsHeroTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111',
    marginBottom: 12,
  },
  resultsGrid: {
    gap: 8,
  },
  resultsMetricCard: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
  },
  resultsMetricLabel: {
    color: '#6b7280',
    fontSize: 13,
    marginBottom: 4,
  },
  resultsMetricValue: {
    color: '#111',
    fontSize: 22,
    fontWeight: '800',
  },
  resultsPreviewWrap: {
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT * 0.7,
    alignSelf: 'center',
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#ddd',
    marginBottom: 6,
    position: 'relative',
  },
  infoText: {
    fontSize: 16,
    color: '#333',
    marginBottom: 16,
    textAlign: 'center',
  },
  boxBuddyCard: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 14,
    padding: 14,
    backgroundColor: '#fafafa',
    marginBottom: 8,
  },
  boxBuddySectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111',
    marginBottom: 8,
  },
  boxBuddyChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  boxBuddyChip: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
  },
  boxBuddyChipSelected: {
    backgroundColor: '#111',
    borderColor: '#111',
  },
  boxBuddyChipText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '600',
  },
  boxBuddyChipTextSelected: {
    color: '#fff',
  },
  boxBuddyHelperText: {
    fontSize: 13,
    color: '#6B7280', // softer gray
    marginTop: 8,
  },
  boxResultCard: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#fff',
    marginTop: 10,
  },
  boxResultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 6,
  },
  boxResultName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    color: '#111',
  },
  boxResultBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  boxResultBadgeText: {
    fontSize: 12,
    fontWeight: '800',
  },
  boxResultMeta: {
    color: '#4b5563',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  resizeHintCard: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
    borderRadius: 10,
    padding: 10,
  },
  resizeHintTitle: {
    color: '#1d4ed8',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 4,
  },
  resizeHintText: {
    color: '#1e3a8a',
    fontSize: 13,
    lineHeight: 18,
  },

  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  fitModeChip: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
  },
  fitModeChipSelected: {
    backgroundColor: '#111',
    borderColor: '#111',
  },
  fitModeChipText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '600',
  },
  fitModeChipTextSelected: {
    color: '#fff',
  },
  listingField: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    backgroundColor: '#fff',
    padding: 12,
    color: '#111',
    fontSize: 14,
    marginTop: 8,
    textAlignVertical: 'top',
  },
  listingTitleField: {
    minHeight: 64,
  },
  titleOptionWrap: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 10,
    backgroundColor: '#fff',
  },
  titleOptionWrapBest: {
    borderColor: '#86efac',
    backgroundColor: '#f0fdf4',
  },
  titleOptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
    gap: 8,
  },
  titleOptionLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: '#374151',
  },
  bestTitleBadge: {
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#86efac',
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  bestTitleBadgeText: {
    color: '#166534',
    fontSize: 12,
    fontWeight: '800',
  },
  bestTitleHelperText: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 4,
    marginBottom: 2,
  },
  listingLargeField: {
    minHeight: 150,
  },
  listingPremiumHero: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: '#eff6ff',
    padding: 16,
    marginBottom: 14,
  },
  listingConfidenceChip: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 10,
  },
  listingConfidenceChipText: {
    color: '#1d4ed8',
    fontSize: 12,
    fontWeight: '800',
  },
  listingPremiumHeroTitle: {
    color: '#111827',
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
  },
  listingPremiumHeroSubtitle: {
    color: '#475569',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  listingTipBanner: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 10,
    marginBottom: 14,
  },
  listingTipBannerText: {
    color: '#475569',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  bestMatchHero: {
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 16,
    padding: 16,
    backgroundColor: '#fafafa',
    marginBottom: 8,
  },
  bestMatchTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10,
  },
  bestMatchReferenceText: {
    color: '#4b5563',
    fontSize: 13,
    fontWeight: '600',
  },
  bestMatchTitle: {
    color: '#111',
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 8,
  },
  bestMatchMeta: {
    color: '#4b5563',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 4,
  },
  compactDimsCard: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 14,
    padding: 14,
    backgroundColor: '#fafafa',
    marginBottom: 8,
  },
  compactDimsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  compactDimPill: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
  },
  compactDimLabel: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  compactDimValue: {
    color: '#111',
    fontSize: 18,
    fontWeight: '800',
  },

  premiumHeroCard: {
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    borderRadius: 20,
    padding: 16,
    backgroundColor: '#ffffff',
    marginBottom: 10,
  },
  premiumHeroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  topPickPill: {
    backgroundColor: '#1E3A8A',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  topPickPillText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  confidencePill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  confidencePillText: {
    fontSize: 12,
    fontWeight: '800',
  },
  premiumHeroTitle: {
    color: '#111',
    fontSize: 30,
    fontWeight: '800',
    marginBottom: 6,
  },
  premiumHeroSubtitle: {
    color: '#4b5563',
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 14,
  },
  premiumStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  premiumStatCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 10,
    backgroundColor: '#f8fafc',
  },
  premiumStatLabel: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  premiumStatValue: {
    color: '#111827',
    fontSize: 20,
    fontWeight: '800',
  },
  premiumCallout: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 14,
    padding: 12,
    backgroundColor: '#f9fafb',
    marginBottom: 12,
  },
  premiumCalloutTitle: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 6,
  },
  premiumCalloutText: {
    color: '#4b5563',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 4,
  },
  premiumResizeCard: {
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 14,
    padding: 12,
    backgroundColor: '#eff6ff',
    marginBottom: 12,
  },
  premiumResizeTitle: {
    color: '#1d4ed8',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 4,
  },
  premiumResizeText: {
    color: '#1e3a8a',
    fontSize: 14,
    lineHeight: 20,
  },
  premiumSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  sourcePill: {
    backgroundColor: '#f3f4f6',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  sourcePillText: {
    color: '#374151',
    fontSize: 11,
    fontWeight: '800',
  },
  dimensionsPill: {
    backgroundColor: '#dbeafe',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#93c5fd',
  },
  dimensionsPillText: {
    color: '#1d4ed8',
    fontSize: 11,
    fontWeight: '800',
  },
  premiumOptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  premiumOptionRank: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1E3A8A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  premiumOptionRankText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
  premiumOptionTextWrap: {
    flex: 1,
  },
  premiumOptionMetricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
    flexWrap: 'wrap',
  },
  titleCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 6,
    flexWrap: 'wrap',
  },
  miniConfidencePill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  miniConfidencePillText: {
    fontSize: 11,
    fontWeight: '800',
  },
  packageTextInput: {
    borderWidth: 1,
    borderColor: '#d8d8d8',
    borderRadius: 12,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111',
    minHeight: 64,
    textAlignVertical: 'top',
    marginBottom: 10,
  },
  detectedTextPreview: {
    fontSize: 13,
    lineHeight: 19,
    color: '#444',
    marginTop: 4,
  },
  lookupStatusCardInline: {
    flexDirection: 'row',
    alignItems: 'center',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#fafafa',
    marginTop: 10,
    marginBottom: 6,
  },
  lookupStatusInlineText: {
    fontSize: 14,
    color: '#111',
    fontWeight: '600',
  },
  errorBanner: {
    backgroundColor: '#fee2e2',
    borderColor: '#ef4444',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 12,
  },
  errorBannerText: {
    color: '#991b1b',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  processingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    zIndex: 999,
  },
  processingCard: {
    backgroundColor: '#fff',
    paddingVertical: 20,
    paddingHorizontal: 24,
    borderRadius: 16,
    alignItems: 'center',
    minWidth: 220,
  },
  processingText: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    color: '#111',
  },
  feedbackToast: {
    position: 'absolute',
    top: 68,
    left: 16,
    right: 16,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1200,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  feedbackToastSuccess: {
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#86efac',
  },
  feedbackToastError: {
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fca5a5',
  },
  feedbackToastInfo: {
    backgroundColor: '#dbeafe',
    borderWidth: 1,
    borderColor: '#93c5fd',
  },
  feedbackToastText: {
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  feedbackToastTextSuccess: {
    color: '#166534',
  },
  feedbackToastTextError: {
    color: '#991b1b',
  },
  feedbackToastTextInfo: {
    color: '#1d4ed8',
  },
  buttonDisabled: {
    opacity: 0.55,
  },

  amazonButton: {
    backgroundColor: '#f59e0b',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: 6,
  },

  amazonButtonText: {
    color: '#111827',
    fontWeight: '600',
    fontSize: 12,
  },
  mapStickyHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  mapStickyHeaderTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  mapToggleButton: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  mapToggleButtonVisible: {
    backgroundColor: '#e5e7eb',
  },
  mapToggleButtonText: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '600',
  },
  mapHiddenState: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
    minHeight: 92,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  floatingShowMapButton: {
    backgroundColor: '#2563EB',
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  floatingShowMapButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
});
