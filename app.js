'use strict';

// =====================================================================
// CONFIG
// USGS site numbers: verify at https://waterdata.usgs.gov/nwis/inventory
// USBR station codes: verify at https://www.usbr.gov/pn/hydromet/
// =====================================================================

const STATIONS = [
  {
    id:        'easton',
    name:      'Yakima River at Easton',
    shortName: 'Easton',
    usgsId:    null,         // no active IV gauge; USBR is primary
    usbrId:    'EASW',       // confirmed live via API
    lat: 47.2457, lng: -121.1859,
    color: '#7aa2f7',
  },
  {
    id:        'cle_res',
    name:      'Cle Elum Reservoir Outflow',
    shortName: 'CLE Reservoir',
    usgsId:    null,         // no active IV gauge; USBR is primary
    usbrId:    'CLE',        // confirmed live via API
    lat: 47.2318, lng: -121.0604,
    color: '#9d7cd8',
  },
  {
    id:        'cle_elum',
    name:      'Yakima River at Cle Elum',
    shortName: 'Yakima @ Cle Elum',
    usgsId:    null,         // no active IV gauge; USBR is primary
    usbrId:    'YUMW',       // confirmed live via API
    lat: 47.1954, lng: -120.9363,
    color: '#7dcfff',
  },
  {
    id:        'teanaway',
    name:      'Teanaway River at Forks',
    shortName: 'Teanaway',
    usgsId:    null,         // no active IV gauge; USBR is primary
    usbrId:    'TNAW',       // confirmed live via API
    lat: 47.2582, lng: -120.8617,
    color: '#9ece6a',
  },
  {
    id:        'horlick',
    name:      'Yakima River near Horlick',
    shortName: 'Horlick',
    usgsId:    null,         // no USGS gauge — USBR primary
    usbrId:    'YRWW',       // confirmed live via API
    nwrfcId:   'HLKW1',     // NWRFC — provides water temperature data
    lat: 47.0382, lng: -120.7221,
    color: '#e0af68',
  },
  {
    id:        'umtanum',
    name:      'Yakima River at Umtanum',
    shortName: 'Umtanum',
    usgsId:    '12484500',   // confirmed active USGS IV gauge
    usbrId:    'UMTW',       // confirmed live via API
    lat: 46.8615, lng: -120.4715,
    color: '#f7768e',
  },
];

const WEATHER_LOCATIONS = [
  { name: 'Cle Elum',   lat: 47.1954, lng: -120.9363 },
  { name: 'Thorp',      lat: 47.0615, lng: -120.6793 },
  { name: 'Ellensburg', lat: 46.9965, lng: -120.5478 },
];

const REFRESH_MS = 15 * 60 * 1000;  // 15 minutes

// =====================================================================
// STATE
// =====================================================================

const state = {
  currentDays:  7,
  isRefreshing: false,
  lastRefresh:  null,
  stationData:  {},   // { id: {discharge, waterTemp, gageHeight, source} }
  weatherData:  {},   // { name: open-meteo json }
  charts:       {},   // { stationId | 'wx_'+name: Chart }
  map:          null,
  markers:      {},   // { stationId: L.circleMarker }
};

// =====================================================================
// UTILITIES
// =====================================================================

function fmtCfs(v) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return v >= 1000
    ? v.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : v.toFixed(v >= 10 ? 0 : 1);
}

function fmtTemp(v) {
  if (v === null || v === undefined || isNaN(v)) return null;
  return v.toFixed(1) + '\u00b0F';
}

function fmtDateLabel(date) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

function fmtAge(date) {
  if (!date) return 'unknown';
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function getLatestValue(values) {
  if (!values || values.length === 0) return null;
  return values.reduce((best, v) => (v.time > best.time ? v : best));
}

function getTrend(values, hoursBack = 24) {
  if (!values || values.length < 2) return 'stable';
  const latest = getLatestValue(values);
  if (!latest) return 'stable';
  const cutoff = latest.time.getTime() - hoursBack * 3600000;
  const past   = values
    .filter(v => v.time.getTime() <= cutoff)
    .sort((a, b) => b.time - a.time)[0];
  if (!past || past.value === 0) return 'stable';
  const pct = (latest.value - past.value) / past.value;
  if (pct >  0.10) return 'rising';
  if (pct < -0.10) return 'falling';
  return 'stable';
}

/** Thin an array to at most maxCount evenly-spaced points. */
function downsample(arr, maxCount) {
  if (!arr || arr.length <= maxCount) return arr;
  const step = Math.ceil(arr.length / maxCount);
  return arr.filter((_, i) => i % step === 0);
}

function wmoToEmojiSafe(c) {
  // Avoid Unicode escaping issues — just use literal strings
  const MAP = {
    0: '☀', 1: '☀', 2: '⛅', 3: '☁',
    45: '🌫', 48: '🌫',
    51: '🌧', 53: '🌧', 55: '🌧',
    56: '🌧', 57: '🌧',
    61: '🌧', 63: '🌧', 65: '🌧',
    66: '🌧', 67: '🌧',
    71: '❄', 73: '❄', 75: '❄', 77: '❄',
    80: '🌦', 81: '🌦', 82: '🌦',
    85: '🌨', 86: '🌨',
    95: '⛈', 96: '⛈', 99: '⛈',
  };
  return MAP[c] || '🌤';
}

function wmoToDesc(c) {
  if (c === 0)  return 'Clear sky';
  if (c === 1)  return 'Mainly clear';
  if (c === 2)  return 'Partly cloudy';
  if (c === 3)  return 'Overcast';
  if (c <= 48)  return c === 45 ? 'Fog' : 'Freezing fog';
  if (c <= 55)  return 'Drizzle';
  if (c <= 57)  return 'Freezing drizzle';
  if (c <= 65)  return c <= 63 ? 'Rain' : 'Heavy rain';
  if (c <= 67)  return 'Freezing rain';
  if (c <= 75)  return c <= 73 ? 'Snow' : 'Heavy snow';
  if (c === 77) return 'Snow grains';
  if (c <= 82)  return 'Rain showers';
  if (c <= 86)  return 'Snow showers';
  if (c === 95) return 'Thunderstorm';
  return 'Thunderstorm w/ hail';
}

// =====================================================================
// API: USGS NWIS Instantaneous Values
// Docs: https://waterservices.usgs.gov/rest/IV-Service.html
// =====================================================================

async function fetchUSGS(siteId, days) {
  const params = new URLSearchParams({
    sites:       siteId,
    parameterCd: '00060,00010,00065',   // discharge, water temp, gage height
    period:      `P${days}D`,
    format:      'json',
  });
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`https://waterservices.usgs.gov/nwis/iv/?${params}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`USGS ${siteId}: HTTP ${res.status}`);
    const json = await res.json();
    return parseUSGSJSON(json);
  } finally {
    clearTimeout(timer);
  }
}

function parseUSGSJSON(json) {
  const out = { discharge: [], waterTemp: [], gageHeight: [], siteName: null };
  for (const ts of (json?.value?.timeSeries ?? [])) {
    const code = ts?.variable?.variableCode?.[0]?.value;
    if (!out.siteName) out.siteName = ts?.sourceInfo?.siteName ?? null;
    const vals = (ts?.values?.[0]?.value ?? [])
      .filter(v => v.value && v.value !== '-999999')
      .map(v => ({ time: new Date(v.dateTime), value: parseFloat(v.value) }))
      .filter(v => !isNaN(v.value));
    if      (code === '00060') out.discharge  = vals;
    else if (code === '00010') out.waterTemp  = vals.map(v => ({ ...v, value: v.value * 9 / 5 + 32 }));
    else if (code === '00065') out.gageHeight = vals;
  }
  return out;
}

// =====================================================================
// API: USBR HYDROMET (Pacific Northwest Region)
// Docs: https://www.usbr.gov/pn/hydromet/
// Correct format: ?list=STATION%20PARAM&back=HOURS&format=csv
// Returns CSV:  DateTime,station_param\n2026-02-18 17:30,326.57\n...
//
// CORS: USBR does NOT send Access-Control-Allow-Origin headers.
// When served via server.py, requests go to /api/usbr (proxy).
// When opened as file://, direct fetch is attempted (will likely fail).
// =====================================================================

function usbrProxyUrl(queryString) {
  // If running via HTTP (local dev server), use the proxy endpoint.
  // If opened as file://, try direct USBR URL (will likely be CORS-blocked).
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    return `/api/usbr?${queryString}`;
  }
  return `https://www.usbr.gov/pn-bin/instant.pl?${queryString}`;
}

async function fetchUSBR(stationId, days) {
  // back= is in hours; USBR max is typically 8760 (1 year)
  const hours = days * 24;
  const stationLower = stationId.toLowerCase();

  // Fetch discharge (Q) and water temp (TW) in one request.
  // Build query string manually: URLSearchParams encodes space as '+',
  // but USBR requires '%20'. The list param uses comma separator.
  const qCode  = `${stationLower}%20q`;
  const twCode = `${stationLower}%20tw`;
  const qs     = `list=${qCode},${twCode}&back=${hours}&format=csv`;

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(usbrProxyUrl(qs), { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`USBR ${stationId}: HTTP ${res.status}`);
    const text = await res.text();
    return parseUSBRCSV(text, stationLower);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse USBR Hydromet CSV response.
 * Header:  DateTime,easw_q,easw_tw
 * Rows:    2026-02-18 17:30,326.57,
 *
 * Column names follow pattern: {station}_{param}
 * where param is 'q' (discharge cfs) or 'tw' (water temp °C).
 */
function parseUSBRCSV(text, stationLower) {
  const out = { discharge: [], waterTemp: [], gageHeight: [] };
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return out;

  // Find the header line (starts with "DateTime")
  const headerIdx = lines.findIndex(l => l.toLowerCase().startsWith('datetime'));
  if (headerIdx < 0) return out;

  const headers = lines[headerIdx].split(',').map(h => h.trim().toLowerCase());
  const qIdx    = headers.findIndex(h => h === `${stationLower}_q` || h.endsWith('_q'));
  const twIdx   = headers.findIndex(h => h === `${stationLower}_tw` || h.endsWith('_tw'));

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 2) continue;
    const dt = new Date(cols[0].trim());
    if (isNaN(dt.getTime())) continue;

    if (qIdx >= 0) {
      const val = parseFloat(cols[qIdx]);
      if (!isNaN(val) && val >= 0) out.discharge.push({ time: dt, value: val });
    }
    if (twIdx >= 0) {
      const valC = parseFloat(cols[twIdx]);
      if (!isNaN(valC)) {
        // USBR returns °C — convert to °F
        out.waterTemp.push({ time: dt, value: valC * 9 / 5 + 32 });
      }
    }
  }
  return out;
}

// =====================================================================
// API: NWRFC (NW River Forecast Center) — water temperature
// Station HLKW1 (Yakima near Horlick) has TW sensor; no CORS headers.
// Routed through /api/nwrfc proxy when served via HTTP.
// Response is HTML — data rows parsed with regex.
// Temperatures are reported in °F.
// =====================================================================

async function fetchNWRFCTemp(lid, days) {
  const qs  = `id=${lid}&pe=TW`;
  const url = (location.protocol === 'http:' || location.protocol === 'https:')
    ? `/api/nwrfc?${qs}`
    : `https://www.nwrfc.noaa.gov/station/flowplot/textPlot.cgi?${qs}`;

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`NWRFC ${lid}: HTTP ${res.status}`);
    return parseNWRFCTempHTML(await res.text(), days);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse NWRFC textPlot HTML response for temperature.
 * Data rows look like:
 *   <td align="right">2026-02-23 13:30</td><td align="right">41.9</td>
 * Temperatures are already in °F. Times are in PST/PDT (local Pacific).
 */
function parseNWRFCTempHTML(html, days) {
  const cutoff = new Date(Date.now() - days * 86400000);
  const out    = [];
  const re     = /(\d{4}-\d{2}-\d{2} \d{2}:\d{2})<\/td><td align="right">(\d+\.?\d*)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const dt  = new Date(m[1]);
    const val = parseFloat(m[2]);
    if (!isNaN(dt.getTime()) && dt >= cutoff && !isNaN(val)) {
      out.push({ time: dt, value: val });
    }
  }
  return out;
}

// =====================================================================
// API: WEATHER — Open-Meteo (free, no key required)
// Docs: https://open-meteo.com/en/docs
// =====================================================================

async function fetchWeather(lat, lng) {
  const params = new URLSearchParams({
    latitude:  lat,
    longitude: lng,
    current:   [
      'temperature_2m', 'apparent_temperature', 'precipitation',
      'wind_speed_10m', 'weather_code', 'relative_humidity_2m',
    ].join(','),
    daily: [
      'temperature_2m_max', 'temperature_2m_min',
      'precipitation_sum', 'precipitation_probability_max', 'weather_code',
    ].join(','),
    temperature_unit:  'fahrenheit',
    wind_speed_unit:   'mph',
    precipitation_unit: 'inch',
    timezone:          'America/Los_Angeles',
    forecast_days:     '7',
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error(`Open-Meteo: HTTP ${res.status}`);
  return await res.json();
}

// =====================================================================
// API: NWS ALERTS
// =====================================================================

async function fetchNWSAlerts() {
  try {
    const res = await fetch('https://api.weather.gov/alerts/active?area=WA&status=actual', {
      headers: { 'User-Agent': 'YakimaBasinDashboard/1.0 (educational)' },
    });
    if (!res.ok) return [];
    const json = await res.json();
    return (json?.features ?? []).filter(f => {
      const event = (f.properties?.event ?? '').toLowerCase();
      const area  = (f.properties?.areaDesc ?? '').toLowerCase();
      return (event.includes('flood') || event.includes('hydrologic')) &&
             (area.includes('yakima') || area.includes('kittitas') || area.includes('chelan'));
    }).map(f => ({
      event:    f.properties.event,
      headline: f.properties.headline ?? f.properties.event,
    }));
  } catch {
    return [];
  }
}

// =====================================================================
// MAP — Leaflet
// =====================================================================

function initMap() {
  const map = L.map('map', { zoomControl: true });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> &copy; <a href="https://carto.com/" target="_blank">CARTO</a>',
    subdomains:  'abcd',
    maxZoom:     18,
  }).addTo(map);

  // Fit to station bounds with padding
  map.fitBounds(STATIONS.map(s => [s.lat, s.lng]), { padding: [36, 36] });

  for (const station of STATIONS) {
    const marker = L.circleMarker([station.lat, station.lng], {
      radius:      8,
      fillColor:   station.color,
      color:       '#16161e',
      weight:      2.5,
      opacity:     1,
      fillOpacity: 0.88,
    });
    marker.bindPopup(makePopupHTML(station, null), { maxWidth: 240, className: 'yakima-popup' });
    marker.on('mouseover', function() { this.openPopup(); });
    marker.addTo(map);
    state.markers[station.id] = marker;
  }

  // Weather location markers (smaller, cyan)
  for (const loc of WEATHER_LOCATIONS) {
    L.circleMarker([loc.lat, loc.lng], {
      radius:      5,
      fillColor:   '#7dcfff',
      color:       '#16161e',
      weight:      1.5,
      opacity:     0.7,
      fillOpacity: 0.5,
    })
    .bindTooltip(loc.name + ' (weather)', { className: 'leaflet-tooltip' })
    .addTo(map);
  }

  state.map = map;
}

function makePopupHTML(station, data) {
  const q = data?.discharge ? getLatestValue(data.discharge) : null;
  const t = data?.waterTemp ? getLatestValue(data.waterTemp) : null;
  let metrics = '';
  if (q) metrics += `<div class="popup-metric">
    <span class="popup-metric-value" style="color:${station.color}">${fmtCfs(q.value)}</span>
    <span class="popup-metric-label">cfs</span></div>`;
  if (t) metrics += `<div class="popup-metric">
    <span class="popup-metric-value">${fmtTemp(t.value)}</span>
    <span class="popup-metric-label">water temp</span></div>`;
  if (!metrics) metrics = '<span style="color:#565f89;font-size:0.72rem">Loading\u2026</span>';
  return `<div class="popup-station-name">${station.name}</div>
          <div class="popup-metrics">${metrics}</div>`;
}

function updateMapMarkers() {
  for (const station of STATIONS) {
    const marker = state.markers[station.id];
    const data   = state.stationData[station.id];
    if (marker && data) marker.setPopupContent(makePopupHTML(station, data));
  }
}

// =====================================================================
// CHARTS — Chart.js 4
// =====================================================================

/** Gradient fill that scales with the chart area. */
function makeGradientPlugin(color) {
  return function(context) {
    const { chart } = context;
    const { ctx, chartArea } = chart;
    if (!chartArea) return 'transparent';
    const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    gradient.addColorStop(0,   color + 'bb');
    gradient.addColorStop(0.65, color + '33');
    gradient.addColorStop(1,   color + '00');
    return gradient;
  };
}


function createHydrograph(canvasEl, stationData, station) {
  const existing = state.charts[station.id];
  if (existing) { try { existing.destroy(); } catch (_) {} }

  const discharge = (stationData?.discharge ?? []).sort((a, b) => a.time - b.time);
  const waterTemp = stationData?.waterTemp ?? [];

  if (discharge.length === 0) {
    const ctx = canvasEl.getContext('2d');
    ctx.fillStyle = '#565f89';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No data', canvasEl.width / 2, canvasEl.height / 2);
    return null;
  }

  // Downsample — target ~80 points so chart stays crisp
  const ds     = downsample(discharge, 80);
  const labels = ds.map(v => fmtDateLabel(v.time));
  const qData  = ds.map(v => v.value);

  // Align temperature to downsampled discharge timestamps
  let tData = null;
  if (waterTemp.length > 0) {
    const sortedT = [...waterTemp].sort((a, b) => a.time - b.time);
    tData = ds.map(dp => {
      const nearest = sortedT.reduce((best, tv) =>
        Math.abs(tv.time - dp.time) < Math.abs(best.time - dp.time) ? tv : best
      );
      return Math.abs(nearest.time - dp.time) < 4 * 3600000 ? nearest.value : null;
    });
  }

  const datasets = [{
    label:            'Discharge (cfs)',
    data:             qData,
    borderColor:      station.color,
    backgroundColor:  makeGradientPlugin(station.color),
    borderWidth:      2,
    pointRadius:      0,
    pointHoverRadius: 4,
    pointHoverBackgroundColor: station.color,
    tension:          0.35,
    fill:             true,
    yAxisID:          'y',
  }];

  if (tData) {
    datasets.push({
      label:       'Water Temp (\u00b0F)',
      data:        tData,
      borderColor: '#ff9e64',
      borderDash:  [5, 3],
      borderWidth: 1.5,
      pointRadius: 0,
      tension:     0.35,
      fill:        false,
      yAxisID:     'y1',
      spanGaps:    true,
    });
  }

  // Build options directly (no JSON clone — preserves callback functions)
  const scalesY1 = tData ? {
    y1: {
      position: 'right',
      grid:     { drawOnChartArea: false },
      ticks:    { color: 'rgba(255,158,100,0.55)', font: { size: 10 }, maxTicksLimit: 3,
                  callback: v => v.toFixed(0) + '\u00b0' },
      border:   { color: 'transparent' },
    },
  } : {};

  const chart = new Chart(canvasEl.getContext('2d'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      animation:           { duration: 350 },
      interaction:         { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#24283b',
          borderColor:     '#414868',
          borderWidth:     1,
          titleColor:      '#c0caf5',
          bodyColor:       '#a9b1d6',
          padding:         10,
          cornerRadius:    6,
          callbacks: {
            label: ctx => {
              if (ctx.dataset.label.includes('Discharge')) return ` ${fmtCfs(ctx.parsed.y)} cfs`;
              return ` ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(1) : '\u2014'}\u00b0F`;
            },
          },
        },
      },
      scales: {
        x: {
          grid:   { color: 'rgba(41,53,90,0.35)', drawTicks: false },
          ticks:  { color: '#565f89', maxTicksLimit: 6, maxRotation: 0, font: { size: 10 } },
          border: { color: '#29355a' },
        },
        y: {
          position: 'left',
          grid:     { color: 'rgba(41,53,90,0.35)' },
          ticks:    { color: '#565f89', font: { size: 10 }, maxTicksLimit: 4 },
          border:   { color: '#29355a' },
        },
        ...scalesY1,
      },
    },
  });
  state.charts[station.id] = chart;
  return chart;
}

function createWeatherChart(canvasEl, daily, locationKey) {
  const key = 'wx_' + locationKey;
  const existing = state.charts[key];
  if (existing) { try { existing.destroy(); } catch (_) {} }
  if (!daily) return null;

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const labels = daily.time.map(t => {
    const d = new Date(t + 'T12:00:00');
    return `${months[d.getMonth()]} ${d.getDate()}`;
  });

  const chart = new Chart(canvasEl.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label:           'High \u00b0F',
          data:            daily.temperature_2m_max,
          backgroundColor: 'rgba(224,175,104,0.65)',
          borderColor:     '#e0af68',
          borderWidth:     1,
          borderRadius:    3,
          yAxisID:         'y',
          order:           2,
        },
        {
          label:           'Low \u00b0F',
          data:            daily.temperature_2m_min,
          backgroundColor: 'rgba(122,162,247,0.45)',
          borderColor:     '#7aa2f7',
          borderWidth:     1,
          borderRadius:    3,
          yAxisID:         'y',
          order:           3,
        },
        {
          type:            'line',
          label:           'Precip %',
          data:            daily.precipitation_probability_max,
          borderColor:     'rgba(125,207,255,0.7)',
          backgroundColor: 'rgba(125,207,255,0.08)',
          borderWidth:     1.5,
          pointRadius:     2.5,
          pointBackgroundColor: 'rgba(125,207,255,0.9)',
          tension:         0.3,
          fill:            true,
          yAxisID:         'y1',
          order:           1,
        },
      ],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      animation:           { duration: 350 },
      interaction:         { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#24283b',
          borderColor:     '#414868',
          borderWidth:     1,
          titleColor:      '#c0caf5',
          bodyColor:       '#a9b1d6',
          padding:         10,
          cornerRadius:    6,
        },
      },
      scales: {
        x: {
          grid:   { color: 'rgba(41,53,90,0.3)', drawTicks: false },
          ticks:  { color: '#565f89', font: { size: 9 }, maxRotation: 0 },
          border: { color: '#29355a' },
        },
        y: {
          grid:     { color: 'rgba(41,53,90,0.3)' },
          ticks:    { color: '#565f89', font: { size: 9 }, maxTicksLimit: 4,
                      callback: v => v + '\u00b0' },
          border:   { color: '#29355a' },
        },
        y1: {
          position: 'right',
          min: 0, max: 100,
          grid:     { drawOnChartArea: false },
          ticks:    { color: 'rgba(125,207,255,0.4)', font: { size: 9 }, maxTicksLimit: 3,
                      callback: v => v + '%' },
          border:   { color: 'transparent' },
        },
      },
    },
  });

  state.charts[key] = chart;
  return chart;
}

// =====================================================================
// UI — STATION CARDS
// =====================================================================

function destroyAllCharts() {
  for (const [key, chart] of Object.entries(state.charts)) {
    try { chart.destroy(); } catch (_) {}
    delete state.charts[key];
  }
}

function renderStationSkeletons() {
  const grid = document.getElementById('stations-grid');
  grid.innerHTML = STATIONS.map(s => `
    <div class="station-card" id="card-${s.id}">
      <div class="station-accent" style="background:linear-gradient(90deg,${s.color},${s.color}88)"></div>
      <div class="station-header">
        <div class="station-name">${s.name}</div>
      </div>
      <div class="station-metrics" style="padding-top:8px;padding-bottom:10px">
        <div class="skel skel-num" style="position:relative;overflow:hidden;width:110px;height:1.9rem;display:inline-block"></div>
      </div>
      <div class="station-chart-wrap">
        <div class="skel skel-chart" style="position:relative;overflow:hidden;height:110px;border-radius:6px"></div>
      </div>
    </div>
  `).join('');
}

function renderStationCard(station, data) {
  const card = document.getElementById(`card-${station.id}`);
  if (!card) return;

  const discharge  = data?.discharge  ?? [];
  const waterTemp  = data?.waterTemp  ?? [];
  const gageHeight = data?.gageHeight ?? [];
  const source     = data?.source ?? null;

  const latestQ = getLatestValue(discharge);
  const latestT = getLatestValue(waterTemp);
  const latestH = getLatestValue(gageHeight);
  const trend   = getTrend(discharge);

  const trendHtml = {
    rising:  '<span class="trend-arrow rising" title="Rising (>10% vs 24h ago)">\u2191</span>',
    falling: '<span class="trend-arrow falling" title="Falling (>10% vs 24h ago)">\u2193</span>',
    stable:  '<span class="trend-arrow stable" title="Stable">\u2192</span>',
  }[trend] ?? '';

  const badgeCls  = source === 'USGS' ? 'usgs' : source === 'USBR' ? 'usbr' : 'no-data';
  const badgeTxt  = source ?? 'No Data';
  const canvasId  = `chart-${station.id}`;

  if (!latestQ) {
    card.innerHTML = `
      <div class="station-accent" style="background:linear-gradient(90deg,${station.color},${station.color}88)"></div>
      <div class="station-header">
        <span class="station-name">${station.name}</span>
        <span class="station-badge no-data">No Data</span>
      </div>
      <div class="no-data-overlay">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        No streamflow data available
        <span style="font-size:0.6rem;color:#444b6a">USGS ${station.usgsId ?? 'N/A'} &middot; USBR ${station.usbrId}</span>
      </div>`;
    card.classList.add('card-in');
    return;
  }

  const tempHtml = latestT
    ? `<div class="metric-badge">
         <span class="metric-badge-value temp-value">${fmtTemp(latestT.value)}</span>
         <span class="metric-badge-label temp-label">Water Temp</span>
       </div>`
    : '';

  const stageHtml = latestH
    ? `<div class="metric-badge">
         <span class="metric-badge-value">${latestH.value.toFixed(2)} ft</span>
         <span class="metric-badge-label">Stage</span>
       </div>`
    : '';

  card.innerHTML = `
    <div class="station-accent" style="background:linear-gradient(90deg,${station.color},${station.color}88)"></div>
    <div class="station-header">
      <span class="station-name">${station.name}</span>
      <span class="station-badge ${badgeCls}">${badgeTxt}</span>
    </div>
    <div class="station-metrics">
      <div class="flow-group">
        <span class="flow-value" style="color:${station.color}">${fmtCfs(latestQ.value)}</span>
        <span class="flow-unit">cfs</span>
        ${trendHtml}
      </div>
      <div class="secondary-metrics">${tempHtml}${stageHtml}</div>
    </div>
    <div class="station-chart-wrap"><canvas id="${canvasId}"></canvas></div>
    <div class="station-footer">
      <span>Updated ${fmtAge(latestQ.time)}</span>
      <span>${station.usgsId ? 'USGS\u00a0' + station.usgsId : 'USBR\u00a0' + station.usbrId}</span>
    </div>`;

  card.classList.add('card-in');

  requestAnimationFrame(() => {
    const canvas = document.getElementById(canvasId);
    if (canvas) createHydrograph(canvas, data, station);
  });
}

// =====================================================================
// UI — WEATHER CARDS
// =====================================================================

function renderWeatherSkeletons() {
  const grid = document.getElementById('weather-grid');
  grid.innerHTML = WEATHER_LOCATIONS.map(loc => `
    <div class="weather-card" id="wx-${loc.name.replace(/\s+/g, '_')}">
      <div class="weather-header">
        <div class="weather-location">${loc.name}</div>
      </div>
      <div class="weather-main" style="gap:14px;padding-bottom:14px">
        <div class="skel" style="position:relative;overflow:hidden;width:48px;height:48px;border-radius:8px;display:inline-block"></div>
        <div>
          <div class="skel" style="position:relative;overflow:hidden;width:80px;height:1.9rem;display:inline-block;margin-bottom:6px;border-radius:4px"></div>
          <div class="skel" style="position:relative;overflow:hidden;width:120px;height:0.75em;display:block;border-radius:4px"></div>
        </div>
      </div>
    </div>
  `).join('');
}

function renderWeatherCard(loc, data) {
  const id   = `wx-${loc.name.replace(/\s+/g, '_')}`;
  const card = document.getElementById(id);
  if (!card) return;

  if (!data) {
    card.innerHTML = `
      <div class="weather-header"><div class="weather-location">${loc.name}</div></div>
      <div class="no-data-overlay">Weather data unavailable</div>`;
    return;
  }

  const cur    = data.current;
  const daily  = data.daily;
  const emoji  = wmoToEmojiSafe(cur.weather_code);
  const desc   = wmoToDesc(cur.weather_code);
  const canvasId = `wxchart-${loc.name.replace(/\s+/g, '_')}`;

  // Tomorrow's high/low for context
  const tmwHigh = daily?.temperature_2m_max?.[1]?.toFixed(0) ?? '—';
  const tmwLow  = daily?.temperature_2m_min?.[1]?.toFixed(0) ?? '—';

  card.innerHTML = `
    <div class="weather-header">
      <div class="weather-location">${loc.name}</div>
      <span style="font-size:0.65rem;color:#565f89">Tomorrow ${tmwHigh}\u00b0 / ${tmwLow}\u00b0</span>
    </div>
    <div class="weather-main">
      <div class="weather-icon">${emoji}</div>
      <div class="weather-temp-group">
        <span class="weather-temp">${Math.round(cur.temperature_2m)}\u00b0</span>
        <span class="weather-condition">${desc}</span>
        <span class="weather-feels">Feels like ${Math.round(cur.apparent_temperature)}\u00b0F</span>
      </div>
    </div>
    <div class="weather-details">
      <div class="w-detail">
        <span class="w-detail-val">${cur.wind_speed_10m.toFixed(0)} mph</span>
        <span class="w-detail-lbl">Wind</span>
      </div>
      <div class="w-detail">
        <span class="w-detail-val">${cur.relative_humidity_2m}%</span>
        <span class="w-detail-lbl">Humidity</span>
      </div>
      <div class="w-detail">
        <span class="w-detail-val">${cur.precipitation.toFixed(2)}"</span>
        <span class="w-detail-lbl">Precip (1h)</span>
      </div>
    </div>
    <div class="weather-chart-wrap">
      <div class="weather-chart-label">7-Day &mdash; High/Low \u00b0F &amp; Precip Probability</div>
      <canvas id="${canvasId}"></canvas>
    </div>`;

  card.classList.add('card-in');

  requestAnimationFrame(() => {
    const canvas = document.getElementById(canvasId);
    if (canvas) createWeatherChart(canvas, daily, loc.name);
  });
}

// =====================================================================
// UI — ALERTS + STATUS
// =====================================================================

function renderAlerts(alerts) {
  const pill = document.getElementById('alert-pill');
  const text = document.getElementById('alert-text');
  if (!alerts || alerts.length === 0) {
    pill.classList.add('hidden');
    return;
  }
  pill.classList.remove('hidden');
  text.textContent = alerts[0].event;
  pill.title = alerts.map(a => a.headline).join('\n');
}

function setStatus(level, label) {
  const dot = document.getElementById('status-dot');
  const lbl = document.getElementById('status-label');
  dot.className = `status-dot ${level}`;
  lbl.textContent = label;
}

// =====================================================================
// MAIN REFRESH
// =====================================================================

async function refresh() {
  if (state.isRefreshing) return;
  state.isRefreshing = true;

  const refreshBtn = document.getElementById('refresh-btn');
  refreshBtn.classList.add('spinning');
  setStatus('loading', 'Fetching data\u2026');

  const days = state.currentDays;

  try {
    // All station fetches in parallel
    const stationJobs = STATIONS.map(async station => {
      let result = null;
      let source = null;

      if (station.usgsId) {
        try {
          const d = await fetchUSGS(station.usgsId, days);
          if (d.discharge.length > 0) { result = d; source = 'USGS'; }
        } catch (err) {
          console.warn(`[USGS ${station.usgsId}]`, err.message);
        }
      }

      if (!result && station.usbrId) {
        try {
          const d = await fetchUSBR(station.usbrId, days);
          if (d && d.discharge.length > 0) { result = d; source = 'USBR'; }
        } catch (err) {
          console.info(`[USBR ${station.usbrId}] ${err.message} (CORS or unavailable)`);
        }
      }

      // Supplement with NWRFC water temperature if available and not already present
      if (result && station.nwrfcId && result.waterTemp.length === 0) {
        try {
          const twData = await fetchNWRFCTemp(station.nwrfcId, days);
          if (twData.length > 0) result.waterTemp = twData;
        } catch (err) {
          console.info(`[NWRFC ${station.nwrfcId}] ${err.message}`);
        }
      }

      state.stationData[station.id] = { ...(result ?? { discharge: [], waterTemp: [], gageHeight: [] }), source };
      renderStationCard(station, state.stationData[station.id]);
    });

    // All weather fetches in parallel
    const weatherJobs = WEATHER_LOCATIONS.map(async loc => {
      try {
        const d = await fetchWeather(loc.lat, loc.lng);
        state.weatherData[loc.name] = d;
        renderWeatherCard(loc, d);
      } catch (err) {
        console.warn(`[Weather ${loc.name}]`, err.message);
        renderWeatherCard(loc, null);
      }
    });

    // NWS alerts
    const alertJob = fetchNWSAlerts().then(renderAlerts).catch(() => {});

    await Promise.allSettled([...stationJobs, ...weatherJobs, alertJob]);

    updateMapMarkers();
    state.lastRefresh = new Date();

    const loaded = Object.values(state.stationData).filter(d => d.discharge.length > 0).length;
    const total  = STATIONS.length;
    setStatus(
      loaded === 0 ? 'error' : loaded < total ? 'warn' : 'ok',
      loaded === 0
        ? 'No data loaded'
        : `${loaded}/${total} stations \u00b7 ${fmtAge(state.lastRefresh)}`,
    );
  } catch (err) {
    console.error('[refresh]', err);
    setStatus('error', 'Refresh failed');
  } finally {
    // Always clear the spinner, even if something unexpected throws
    state.isRefreshing = false;
    refreshBtn.classList.remove('spinning');
  }
}

// =====================================================================
// WINDY EMBED — overlay switcher
// =====================================================================

function initWindyOverlays() {
  const btns   = document.querySelectorAll('.windy-btn');
  const iframe = document.getElementById('windy-iframe');
  if (!iframe || !btns.length) return;

  function windyUrl(overlay) {
    return 'https://embed.windy.com/embed2.html' +
      '?lat=47.1&lon=-120.9&detailLat=47.1&detailLon=-120.9' +
      '&zoom=8&level=surface&overlay=' + overlay +
      '&product=ecmwf&menu=&message=true&marker=true&calendar=now' +
      '&pressure=&type=map&location=coordinates&detail=true' +
      '&metricWind=mph&metricTemp=%C2%B0F&radarRange=-1';
  }

  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      iframe.src = windyUrl(btn.dataset.overlay);
    });
  });
}

// =====================================================================
// INIT
// =====================================================================

document.addEventListener('DOMContentLoaded', () => {
  // Show loading skeletons immediately
  renderStationSkeletons();
  renderWeatherSkeletons();

  // Initialize Leaflet map
  initMap();

  // Windy overlay switcher
  initWindyOverlays();

  // Time-range buttons
  document.querySelectorAll('.range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentDays = parseInt(btn.dataset.days, 10);
      if (!state.isRefreshing) {
        destroyAllCharts();
        renderStationSkeletons();
        refresh();
      }
    });
  });

  // Manual refresh button
  document.getElementById('refresh-btn').addEventListener('click', () => {
    if (!state.isRefreshing) refresh();
  });

  // Initial data load
  refresh();

  // Auto-refresh every 15 minutes (skip if tab is hidden)
  setInterval(() => {
    if (document.visibilityState !== 'hidden' && !state.isRefreshing) refresh();
  }, REFRESH_MS);

  // Update age label every minute without re-fetching
  setInterval(() => {
    if (state.lastRefresh && !state.isRefreshing) {
      const loaded = Object.values(state.stationData).filter(d => d.discharge.length > 0).length;
      setStatus(
        loaded < STATIONS.length ? 'warn' : 'ok',
        `${loaded}/${STATIONS.length} stations \u00b7 ${fmtAge(state.lastRefresh)}`,
      );
    }
  }, 60000);
});
