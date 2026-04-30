/* API configuration air quality data from OpenAQ */
const OPENAQ_KEY = 'fbe1fb46d589fb2f4c1ab59f430045fa91ef7cf0bee64245b5347b8ca6b814ca';
const PROXY          = '';
const OPENAQ_HEADERS = {};

/* Map configuration */
const BOGOTA_COORDS = [4.624, -74.063];
const SEARCH_RADIUS = 30000;
const REFRESH_MS    = 10 * 60 * 1000;
 
/* AQI calculation based on US EPA for PM2.5, PM10, and NO₂ */

const AQI_BREAKPOINTS = {
  pm25: [
    { lo: 0,     hi: 12.0,   aqiLo: 0,   aqiHi: 50  },
    { lo: 12.1,  hi: 35.4,   aqiLo: 51,  aqiHi: 100 },
    { lo: 35.5,  hi: 55.4,   aqiLo: 101, aqiHi: 150 },
    { lo: 55.5,  hi: 150.4,  aqiLo: 151, aqiHi: 200 },
    { lo: 150.5, hi: 250.4,  aqiLo: 201, aqiHi: 300 },
    { lo: 250.5, hi: 500,    aqiLo: 301, aqiHi: 500 },
  ],
  pm10: [
    { lo: 0,   hi: 54,   aqiLo: 0,   aqiHi: 50  },
    { lo: 55,  hi: 154,  aqiLo: 51,  aqiHi: 100 },
    { lo: 155, hi: 254,  aqiLo: 101, aqiHi: 150 },
    { lo: 255, hi: 354,  aqiLo: 151, aqiHi: 200 },
    { lo: 355, hi: 424,  aqiLo: 201, aqiHi: 300 },
    { lo: 425, hi: 604,  aqiLo: 301, aqiHi: 500 },
  ],
  no2: [
    { lo: 0,    hi: 53,   aqiLo: 0,   aqiHi: 50  },
    { lo: 54,   hi: 100,  aqiLo: 51,  aqiHi: 100 },
    { lo: 101,  hi: 360,  aqiLo: 101, aqiHi: 150 },
    { lo: 361,  hi: 649,  aqiLo: 151, aqiHi: 200 },
    { lo: 650,  hi: 1249, aqiLo: 201, aqiHi: 300 },
    { lo: 1250, hi: 2049, aqiLo: 301, aqiHi: 500 },
  ]
};

/* Calculation of AQI based on pollutan concetrations */
function calcAQI(value, pollutant) {
  const bp = AQI_BREAKPOINTS[pollutant];
  if (!bp || value == null) return null;
  for (const b of bp) {
    if (value >= b.lo && value <= b.hi) {
      return Math.round(((b.aqiHi - b.aqiLo) / (b.hi - b.lo)) * (value - b.lo) + b.aqiLo);
    }
  }
  return 500;
}
 
/* Color based on the result - AQI scale */
function aqiColor(aqi) {
  if (aqi == null) return '#aaa';
  if (aqi <= 50)  return '#2d9c3a';
  if (aqi <= 100) return '#c8960a';
  if (aqi <= 150) return '#d45f00';
  if (aqi <= 200) return '#c0272d';
  if (aqi <= 300) return '#8b1a5e';
  return '#5c0014';
}

/* AQI label based on the result */

function aqiLabel(aqi) {
  if (aqi == null) return 'No data';
  if (aqi <= 50)  return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Unhealthy for Sensitive Groups';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very Unhealthy';
  return 'Hazardous';
}
 
let currentLayer    = 'pm25';
let selectedStation = null;
let markers         = {};
let chartInstance   = null;
let map             = null;
let STATIONS        = [];
let refreshTimer    = null;
 
/* Ferch locations from OpenAQ in Bogota */
async function fetchLocations() {
  const target = `https://two02023509-ortega-webgis.onrender.com/api/v3/locations?coordinates=${BOGOTA_COORDS[0]},${BOGOTA_COORDS[1]}&radius=25000&limit=100`;
  const res    = await fetch(target);
  if (!res.ok) throw new Error(`Locations fetch failed: ${res.status}`);
  const data   = await res.json();
  return data.results || [];
}

async function fetchLatestReadings(locationId) {
  const target = `https://two02023509-ortega-webgis.onrender.com/api/v3/locations/${locationId}/sensors`;
  const res    = await fetch(target);
  if (!res.ok) return [];
  const data   = await res.json();
  return data.results || [];
}
 
/* Loads all stations and their readings in parallel */
async function loadAllStations() {
  setStatus('loading');
  const locations = await fetchLocations();
  if (!locations.length) throw new Error('No locations found near Bogotá');
 
  const stationData = await Promise.all(
    locations.map(async loc => {
      const sensors = await fetchLatestReadings(loc.id);
      const getValue = (paramName) => {
        const sensor = sensors.find(s =>
          s.parameter?.name?.toLowerCase() === paramName ||
          s.parameter?.displayName?.toLowerCase() === paramName
        );
        return sensor?.latest?.value ?? null;
      };
      const pm25 = getValue('pm25');
      const pm10 = getValue('pm10');
      const no2  = getValue('no2');
      const timestamps = sensors.map(s => s.latest?.datetime?.local).filter(Boolean);
      const lastUpdated = timestamps.length ? timestamps.sort().reverse()[0] : null;
      return {
        id:          String(loc.id),
        name:        loc.name || `Station ${loc.id}`,
        locality:    loc.locality || loc.city || 'Bogotá',
        lat:         loc.coordinates?.latitude,
        lng:         loc.coordinates?.longitude,
        pm25, pm10, no2, lastUpdated,
        description: `Monitoring station operated by ${loc.owner?.name || 'RMCAB / IDEAM'}. Provider: ${loc.provider?.name || 'OpenAQ'}.`
      };
    })
  );
 
  STATIONS = stationData.filter(s =>
    s.lat && s.lng && (s.pm25 !== null || s.pm10 !== null || s.no2 !== null)
  );
  if (!STATIONS.length) throw new Error('No stations with valid data found');
  return STATIONS;
}
 
/* Updates the live status badge in the header */
function setStatus(state, msg) {
  const dot   = document.getElementById('live-dot');
  const label = document.getElementById('live-label');
  if (!dot || !label) return;
  if (state === 'loading') { dot.style.background = '#c8960a'; label.textContent = 'Connecting…'; }
  else if (state === 'live') { dot.style.background = '#2d9c3a'; label.textContent = msg || 'LIVE'; }
  else if (state === 'error') { dot.style.background = '#c0272d'; label.textContent = 'Offline'; }
}
 
/* Put the local time */
function formatTime(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}
 
/* Initialize the Leaflet map */
function initMap() {
  const mapEl = document.getElementById('map');
  if (!mapEl) return;
  map = L.map('map', { center: BOGOTA_COORDS, zoom: 12, zoomControl: false });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a> | Air quality: <a href="https://openaq.org">OpenAQ</a>',
    subdomains: 'abcd', maxZoom: 20
  }).addTo(map);
  L.control.zoom({ position: 'bottomleft' }).addTo(map);
  setTimeout(() => map.invalidateSize(), 200);
}
 
/* Add shapes and inteaction to the map based on the station data */
function getMarkerProps(station, layer) {
  const val    = station[layer];
  const aqi    = val !== null ? calcAQI(val, layer) : null;
  const color  = aqiColor(aqi);
  const radius = val !== null ? 10 + Math.min(val / 3, 22) : 8;
  return { val, aqi, color, radius };
}
 
function buildMarker(station) {
  const { color, radius } = getMarkerProps(station, currentLayer);
  const marker = L.circleMarker([station.lat, station.lng], {
    radius, fillColor: color, fillOpacity: 0.85, color: '#fff', weight: 2
  }).addTo(map);
  marker.bindTooltip(station.name, { permanent: false, direction: 'top', offset: [0, -radius - 4] });
  marker.on('click', () => { selectStation(station); map.panTo([station.lat, station.lng], { animate: true }); });
  markers[station.id] = marker;
}
 
function updateMarkers() {
  STATIONS.forEach(station => {
    const { color, radius } = getMarkerProps(station, currentLayer);
    const m = markers[station.id];
    if (m) { m.setStyle({ fillColor: color }); m.setRadius(radius); }
  });
}
 
/* Build the station list in the sidebar */
function buildStationList() {
  const container = document.getElementById('station-list');
  if (!container) return;
  container.innerHTML = '';
  STATIONS.forEach(station => {
    const { val, aqi, color } = getMarkerProps(station, currentLayer);
    const isSelected = selectedStation && selectedStation.id === station.id;
    const div = document.createElement('div');
    div.className = 'station-card' + (isSelected ? ' selected' : '');
    div.innerHTML = `
      <div class="station-name">${station.name}</div>
      <div class="station-meta">${station.locality}</div>
      <div class="station-reading">
        ${aqi !== null ? `<span class="reading-pill" style="background:${color}22;color:${color};border:1.5px solid ${color}55">AQI ${aqi}</span>` : ''}
        ${val !== null
          ? `<span class="reading-pill" style="background:#f0ebe3;color:#7a7468;border:1.5px solid #d9d3c8">${val.toFixed(1)} μg/m³</span>`
          : `<span class="reading-pill" style="background:#f0ebe3;color:#aaa;border:1.5px solid #d9d3c8">No data</span>`}
      </div>
      ${station.lastUpdated ? `<div style="font-size:.62rem;color:var(--muted);margin-top:.3rem;">Updated ${formatTime(station.lastUpdated)}</div>` : ''}
    `;
    div.addEventListener('click', () => { selectStation(station); if (map) map.panTo([station.lat, station.lng], { animate: true }); });
    container.appendChild(div);
  });
}
 
function selectStation(station) {
  selectedStation = station;
  buildStationList();
  const pm25aqi = station.pm25 !== null ? calcAQI(station.pm25, 'pm25') : null;
  const { color } = getMarkerProps(station, currentLayer);
  if (map) {
    L.popup({ maxWidth: 270, closeButton: true })
      .setLatLng([station.lat, station.lng])
      .setContent(`
        <div class="popup-title">${station.name}</div>
        <div class="popup-locality">${station.locality}</div>
        <div class="popup-row"><span>PM2.5</span><span>${station.pm25 !== null ? station.pm25.toFixed(1) + ' μg/m³' : '—'}</span></div>
        <div class="popup-row"><span>PM10</span><span>${station.pm10 !== null ? station.pm10.toFixed(1) + ' μg/m³' : '—'}</span></div>
        <div class="popup-row"><span>NO₂</span><span>${station.no2 !== null ? station.no2.toFixed(1) + ' ppb' : '—'}</span></div>
        ${pm25aqi !== null ? `<div class="popup-aqi" style="color:${color}">${pm25aqi}</div><div class="popup-aqi-label">${aqiLabel(pm25aqi)}</div>` : ''}
        <div class="popup-desc">${station.description}</div>
        ${station.lastUpdated ? `<div style="font-size:.65rem;color:var(--muted);margin-top:.5rem;">Last reading: ${formatTime(station.lastUpdated)}</div>` : ''}
      `)
      .openOn(map);
  }
}
 
/* Handle layer changes and update the map and station list*/
 
function setLayer(layer, btn) {
  currentLayer = layer;
  document.querySelectorAll('.layer-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  updateMarkers();
  buildStationList();
  if (selectedStation) updateChart(selectedStation);
}
 
function showView(view, linkEl) {
  event.preventDefault();
  document.querySelectorAll('nav a').forEach(a => a.classList.remove('active'));
  linkEl.classList.add('active');
  const mapView = document.getElementById('view-map');
  if (mapView) mapView.style.display = view === 'map' ? 'grid' : 'none';
  ['about', 'methodology'].forEach(v => {
    const el = document.getElementById('view-' + v);
    if (el) el.classList.toggle('visible', v === view);
  });
  if (view === 'map' && map) setTimeout(() => map.invalidateSize(), 60);
}
 
/* Refresh and update all data, markers, and the station list */
async function refresh() {
  try {
    setStatus('loading');
    await loadAllStations();
    Object.values(markers).forEach(m => m.remove());
    markers = {};
    STATIONS.forEach(buildMarker);
    buildStationList();
    if (selectedStation) {
      const updated = STATIONS.find(s => s.id === selectedStation.id);
      if (updated) selectStation(updated);
    } else if (STATIONS.length) {
      selectStation(STATIONS[0]);
    }
    const now = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    setStatus('live', `LIVE · ${now}`);
  } catch (err) {
    console.error('OpenAQ fetch error:', err);
    setStatus('error');
    const container = document.getElementById('station-list');
    if (container) {
      container.innerHTML = `<div style="padding:1rem;color:var(--muted);font-size:.82rem;line-height:1.6">⚠️ Could not load live data.<br>Check network connection.<br><br><small>${err.message}</small></div>`;
    }
  }
}
 
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => { initMap(); refresh(); refreshTimer = setInterval(refresh, REFRESH_MS); }, 100);
});