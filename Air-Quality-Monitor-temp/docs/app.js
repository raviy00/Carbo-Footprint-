/* 
   CO Trip Distance Calculator  Application Logic
   Google Maps integration, Geolocation, Trip History
    */

//  State 
const APP = {
  map: null,
  directionsService: null,
  directionsRenderer: null,
  originAutocomplete: null,
  destAutocomplete: null,
  originPlace: null,
  destPlace: null,
  lastResult: null,
  CO2_PER_KM: 0.21, // kg CO per km (average car)

  // Live tracking state
  tracking: false,
  watchId: null,
  trackMarker: null,
  trackPath: [],
  trackPolyline: null,
  trackAccuracyCircle: null,

  // GPS state
  lastGPS: null,
};

//  Initialize Google Maps 
function initMap() {
  const mapEl = document.getElementById('map');

  // Dark-styled map matching our theme
  const darkStyle = [
    { elementType: 'geometry', stylers: [{ color: '#1a1a2e' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1a2e' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#64748b' }] },
    {
      featureType: 'administrative',
      elementType: 'geometry.stroke',
      stylers: [{ color: '#334155' }],
    },
    {
      featureType: 'road',
      elementType: 'geometry',
      stylers: [{ color: '#2a2a4a' }],
    },
    {
      featureType: 'road',
      elementType: 'geometry.stroke',
      stylers: [{ color: '#1e293b' }],
    },
    {
      featureType: 'road.highway',
      elementType: 'geometry',
      stylers: [{ color: '#3b3b6b' }],
    },
    {
      featureType: 'water',
      elementType: 'geometry',
      stylers: [{ color: '#0c1929' }],
    },
    {
      featureType: 'water',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#3b82f6' }],
    },
    {
      featureType: 'poi',
      elementType: 'geometry',
      stylers: [{ color: '#1e293b' }],
    },
    {
      featureType: 'poi',
      elementType: 'labels.text.fill',
      stylers: [{ color: '#64748b' }],
    },
    {
      featureType: 'transit',
      elementType: 'geometry',
      stylers: [{ color: '#1e293b' }],
    },
  ];

  // Default center: India (based on user's timezone IST)
  APP.map = new google.maps.Map(mapEl, {
    center: { lat: 20.5937, lng: 78.9629 },
    zoom: 5,
    styles: darkStyle,
    disableDefaultUI: true,
    zoomControl: true,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
  });

  APP.directionsService = new google.maps.DirectionsService();
  APP.directionsRenderer = new google.maps.DirectionsRenderer({
    map: APP.map,
    suppressMarkers: false,
    polylineOptions: {
      strokeColor: '#3b82f6',
      strokeWeight: 5,
      strokeOpacity: 0.85,
    },
    markerOptions: {
      // Will be overridden per marker below
    },
  });

  //  Places Autocomplete 
  const originInput = document.getElementById('origin-input');
  const destInput = document.getElementById('dest-input');

  APP.originAutocomplete = new google.maps.places.Autocomplete(originInput, {
    fields: ['formatted_address', 'geometry', 'name'],
  });

  APP.destAutocomplete = new google.maps.places.Autocomplete(destInput, {
    fields: ['formatted_address', 'geometry', 'name'],
  });

  APP.originAutocomplete.addListener('place_changed', () => {
    const place = APP.originAutocomplete.getPlace();
    if (place.geometry) {
      APP.originPlace = place;
      originInput.value = place.formatted_address || place.name;
    }
  });

  APP.destAutocomplete.addListener('place_changed', () => {
    const place = APP.destAutocomplete.getPlace();
    if (place.geometry) {
      APP.destPlace = place;
      destInput.value = place.formatted_address || place.name;
    }
  });

  // Load trip history on init
  renderHistory();
}


//  Get GPS Location (Browser Geolocation) 
function getMyLocation() {
  const btn = document.getElementById('gps-btn');
  const originInput = document.getElementById('origin-input');

  if (!navigator.geolocation) {
    showStatus('GPS not supported on this browser.', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner spinner--sm"></span> Locating';

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const acc = pos.coords.accuracy;
      
      // Store GPS for ESP32 push
      APP.lastGPS = { lat, lng, acc };
      const pushBtn = document.getElementById('push-gps-btn');
      if (pushBtn) pushBtn.disabled = false;

      // Reverse geocode to get address
      const geocoder = new google.maps.Geocoder();
      geocoder.geocode({ location: { lat, lng } }, (results, status) => {
        btn.disabled = false;
        btn.innerHTML = ' Use My Location';

        if (status === 'OK' && results[0]) {
          originInput.value = results[0].formatted_address;
          APP.originPlace = {
            formatted_address: results[0].formatted_address,
            geometry: { location: new google.maps.LatLng(lat, lng) },
            name: results[0].formatted_address,
          };
          showStatus(' Location found: ' + results[0].formatted_address, 'success');

          // Pan map to location
          APP.map.panTo({ lat, lng });
          APP.map.setZoom(12);
        } else {
          // Fallback: just use coordinates
          const coordStr = lat.toFixed(6) + ', ' + lng.toFixed(6);
          originInput.value = coordStr;
          APP.originPlace = {
            formatted_address: coordStr,
            geometry: { location: new google.maps.LatLng(lat, lng) },
            name: coordStr,
          };
          showStatus(' Location found (coordinates)', 'success');
        }
      });
    },
    (err) => {
      btn.disabled = false;
      btn.innerHTML = ' Use My Location';
      const msgs = {
        1: 'Permission denied  please allow location access.',
        2: 'Position unavailable. Try moving outdoors.',
        3: 'Timed out. Please try again.',
      };
      showStatus(' ' + (msgs[err.code] || err.message), 'error');
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}


//  Calculate Distance 
function calculateDistance() {
  const originInput = document.getElementById('origin-input');
  const destInput = document.getElementById('dest-input');
  const calcBtn = document.getElementById('calc-btn');

  const originVal = originInput.value.trim();
  const destVal = destInput.value.trim();

  if (!originVal) {
    showStatus('️ Please enter an origin location.', 'error');
    originInput.focus();
    return;
  }

  if (!destVal) {
    showStatus('️ Please enter a destination.', 'error');
    destInput.focus();
    return;
  }

  // Show loading state
  calcBtn.disabled = true;
  calcBtn.innerHTML = '<span class="spinner"></span> Calculating';
  clearStatus();

  // Use Directions API for both distance AND route polyline
  const origin = APP.originPlace
    ? APP.originPlace.geometry.location
    : originVal;
  const dest = APP.destPlace
    ? APP.destPlace.geometry.location
    : destVal;

  APP.directionsService.route(
    {
      origin: origin,
      destination: dest,
      travelMode: google.maps.TravelMode.DRIVING,
    },
    (result, status) => {
      calcBtn.disabled = false;
      calcBtn.innerHTML = ' Calculate Distance';

      if (status === 'OK') {
        const leg = result.routes[0].legs[0];
        const distMeters = leg.distance.value;
        const distKm = distMeters / 1000;
        const durationSec = leg.duration.value;
        const durationText = leg.duration.text;
        const co2Kg = distKm * APP.CO2_PER_KM;

        // Store origin/dest addresses from the result
        const originAddr = leg.start_address;
        const destAddr = leg.end_address;

        // Update the input fields with the resolved addresses
        originInput.value = originAddr;
        destInput.value = destAddr;

        // Display route on map
        APP.directionsRenderer.setDirections(result);

        // Show results with animation
        displayResults(distKm, durationText, durationSec, co2Kg);

        // Show map card
        showMapCard();

        // Show sensor card
        showSensorCard(co2Kg);

        // Save to history
        const trip = {
          origin: shortenAddress(originAddr),
          destination: shortenAddress(destAddr),
          distanceKm: distKm,
          duration: durationText,
          co2Est: co2Kg,
          timestamp: Date.now(),
        };
        saveTrip(trip);

        APP.lastResult = trip;

        showStatus(' Route calculated successfully!', 'success');
      } else {
        handleDirectionsError(status);
      }
    }
  );
}


//  Display Results 
function displayResults(distKm, durationText, durationSec, co2Kg) {
  const resultsCard = document.getElementById('results-card');
  resultsCard.classList.add('results-card--visible');

  // Animate values
  animateValue('stat-distance', 0, distKm, 1000, (v) => formatDistance(v));
  animateValue('stat-duration', 0, durationSec, 1000, (v) => formatDuration(v));
  animateValue('stat-co2', 0, co2Kg, 1000, (v) => v.toFixed(1) + ' kg');

  // Scroll into view
  setTimeout(() => {
    resultsCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 200);
}

function animateValue(elementId, start, end, duration, formatter) {
  const el = document.getElementById(elementId);
  if (!el) return;

  el.style.animation = 'none';
  el.offsetHeight; // trigger reflow
  el.style.animation = 'countUp 0.4s ease';

  const startTime = performance.now();

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);

    // Ease-out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = start + (end - start) * eased;

    el.textContent = formatter(current);

    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }

  requestAnimationFrame(update);
}


//  Map Card 
function showMapCard() {
  // Map is always visible; just trigger resize to fix rendering
  setTimeout(() => {
    google.maps.event.trigger(APP.map, 'resize');
  }, 100);
}


//  Sensor Comparison 
function showSensorCard(co2Kg) {
  const card = document.getElementById('sensor-card');
  card.classList.add('sensor-card--visible');

  document.getElementById('est-co2-display').textContent = co2Kg.toFixed(1) + ' kg';

  // Check if there's already a sensor value
  const sensorInput = document.getElementById('sensor-input');
  if (sensorInput.value) {
    updateComparison();
  }
}

function updateComparison() {
  const sensorVal = parseFloat(document.getElementById('sensor-input').value);
  const estEl = document.getElementById('est-co2-display');
  const estVal = APP.lastResult ? APP.lastResult.co2Est : 0;

  if (isNaN(sensorVal) || sensorVal <= 0 || estVal <= 0) {
    document.getElementById('comparison-visual').style.display = 'none';
    return;
  }

  document.getElementById('comparison-visual').style.display = 'block';

  const total = sensorVal + estVal;
  const estPct = (estVal / total) * 100;
  const actualPct = (sensorVal / total) * 100;

  document.getElementById('bar-est').style.width = estPct + '%';
  document.getElementById('bar-est').textContent = estVal.toFixed(1) + ' kg';
  document.getElementById('bar-actual').style.width = actualPct + '%';
  document.getElementById('bar-actual').textContent = sensorVal.toFixed(1) + ' ppm';

  // Difference
  const diff = ((sensorVal - estVal) / estVal) * 100;
  const diffEl = document.getElementById('diff-value');
  const diffSign = diff > 0 ? '+' : '';
  diffEl.textContent = diffSign + diff.toFixed(1) + '%';
  diffEl.className = 'comparison-diff__value';
  if (diff > 5) diffEl.classList.add('comparison-diff__value--higher');
  else if (diff < -5) diffEl.classList.add('comparison-diff__value--lower');
  else diffEl.classList.add('comparison-diff__value--equal');
}

async function fetchLiveSensorData() {
  const btn = document.getElementById('fetch-sensor-btn');
  const input = document.getElementById('sensor-input');
  const espIpInput = document.getElementById('esp-ip');
  const espIp = espIpInput ? espIpInput.value.trim() : '10.152.167.144';

  if (!espIp) {
    showStatus('️ Please enter the ESP32 IP address.', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner spinner--sm"></span> Fetching';

  try {
    // Fetch JSON from ESP32 API
    const response = await fetch(`http://${espIp}/api/data`);
    if (!response.ok) throw new Error('Network response was not ok');
    
    const data = await response.json();
    
    // Set value and trigger update
    input.value = data.co2.toFixed(1);
    updateComparison();
    
    showStatus(` Successfully fetched live reading: ${data.co2.toFixed(1)} PPM`, 'success');
  } catch (error) {
    showStatus(' Could not connect to Air Quality Monitor. Ensure it is powered on and on the same network.', 'error');
    console.error('Fetch error:', error);
  } finally {
    btn.disabled = false;
    btn.innerHTML = ' Get Live Reading';
  }
}

//  ESP32 Integration 
function pushGPSToESP32() {
  if (!APP.lastGPS) {
    showStatus('️ No GPS location available. Click "Use My Location" first.', 'error');
    return;
  }

  const espIpInput = document.getElementById('esp-ip');
  const espIp = espIpInput ? espIpInput.value.trim() : '';

  if (!espIp) {
    showStatus('️ Please enter the ESP32 IP address.', 'error');
    return;
  }

  const { lat, lng, acc } = APP.lastGPS;
  const url = `http://${espIp}/setgps?lat=${lat}&lng=${lng}&acc=${Math.round(acc)}`;
  
  // Use top-level navigation (opens in new tab) to avoid Mixed Content / CORS blocks
  // from HTTPS GitHub Pages to local HTTP IP.
  window.open(url, '_blank');
  showStatus('️ GPS coordinates sent to Air Quality Monitor!', 'success');
}


//  Swap Origin  Destination 
function swapLocations() {
  const originInput = document.getElementById('origin-input');
  const destInput = document.getElementById('dest-input');

  const tempVal = originInput.value;
  originInput.value = destInput.value;
  destInput.value = tempVal;

  const tempPlace = APP.originPlace;
  APP.originPlace = APP.destPlace;
  APP.destPlace = tempPlace;
}


//  Trip History (localStorage) 
const HISTORY_KEY = 'co2_trip_history';
const MAX_HISTORY = 15;

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

function saveTrip(trip) {
  const history = getHistory();
  history.unshift(trip);
  if (history.length > MAX_HISTORY) history.pop();
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  renderHistory();
}

function clearHistory() {
  if (!confirm('Clear all trip history?')) return;
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
}

function renderHistory() {
  const list = document.getElementById('history-list');
  const emptyMsg = document.getElementById('history-empty');
  const actionsRow = document.getElementById('history-actions');
  const history = getHistory();

  if (history.length === 0) {
    list.innerHTML = '';
    emptyMsg.style.display = 'block';
    actionsRow.style.display = 'none';
    return;
  }

  emptyMsg.style.display = 'none';
  actionsRow.style.display = 'flex';

  list.innerHTML = history
    .map(
      (trip, i) => `
    <li class="history-item" style="animation-delay: ${i * 0.05}s">
      <span class="history-item__icon">️</span>
      <div class="history-item__details">
        <div class="history-item__route">${escapeHtml(trip.origin)}  ${escapeHtml(trip.destination)}</div>
        <div class="history-item__meta">
          <span class="history-item__stat"> ${formatDistance(trip.distanceKm)}</span>
          <span class="history-item__stat">️ ${escapeHtml(trip.duration)}</span>
          <span class="history-item__stat"> ${trip.co2Est.toFixed(1)} kg</span>
        </div>
      </div>
      <span class="history-item__time">${formatTimeAgo(trip.timestamp)}</span>
    </li>
  `
    )
    .join('');
}

function exportCSV() {
  const history = getHistory();
  if (history.length === 0) return;

  const header = 'Origin,Destination,Distance (km),Duration,CO Estimate (kg),Date\n';
  const rows = history
    .map(
      (t) =>
        `"${t.origin}","${t.destination}",${t.distanceKm.toFixed(1)},"${t.duration}",${t.co2Est.toFixed(1)},"${new Date(t.timestamp).toLocaleString()}"`
    )
    .join('\n');

  const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'co2_trip_history_' + new Date().toISOString().slice(0, 10) + '.csv';
  link.click();
  URL.revokeObjectURL(url);

  showStatus(' CSV exported successfully!', 'success');
}


//  Status Messages 
function showStatus(msg, type) {
  const container = document.getElementById('status-container');
  container.innerHTML = `<div class="status-msg status-msg--${type}">${msg}</div>`;

  // Auto-clear after 5 seconds
  setTimeout(() => {
    const msgEl = container.querySelector('.status-msg');
    if (msgEl) {
      msgEl.style.opacity = '0';
      msgEl.style.transition = 'opacity 0.3s';
      setTimeout(() => container.innerHTML = '', 300);
    }
  }, 5000);
}

function clearStatus() {
  document.getElementById('status-container').innerHTML = '';
}


//  Error Handling 
function handleDirectionsError(status) {
  const errors = {
    NOT_FOUND: ' One or both locations could not be found. Please check your input.',
    ZERO_RESULTS: ' No route found between these locations.',
    MAX_WAYPOINTS_EXCEEDED: '️ Too many waypoints.',
    INVALID_REQUEST: '️ Invalid request. Please check your inputs.',
    OVER_QUERY_LIMIT: ' Too many requests. Please wait a moment.',
    REQUEST_DENIED: ' API request denied. Check your API key.',
    UNKNOWN_ERROR: ' An unknown error occurred. Please try again.',
  };
  showStatus(errors[status] || ' Error: ' + status, 'error');
}


//  Formatting Helpers 
function formatDistance(km) {
  if (km >= 1000) return (km / 1000).toFixed(1) + 'k km';
  if (km >= 100) return Math.round(km) + ' km';
  return km.toFixed(1) + ' km';
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return m + ' min';
  if (m === 0) return h + 'h';
  return h + 'h ' + m + 'm';
}

function formatTimeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'Just now';
  if (mins < 60) return mins + 'm ago';
  if (hours < 24) return hours + 'h ago';
  if (days < 7) return days + 'd ago';
  return new Date(timestamp).toLocaleDateString();
}

function shortenAddress(address) {
  // Take first two meaningful parts
  const parts = address.split(',').map((s) => s.trim());
  if (parts.length <= 2) return address;
  return parts.slice(0, 2).join(', ');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}


//  Keyboard Shortcuts 
document.addEventListener('keydown', (e) => {
  // Enter key triggers calculate from either input
  if (e.key === 'Enter') {
    const active = document.activeElement;
    if (active && (active.id === 'origin-input' || active.id === 'dest-input')) {
      e.preventDefault();
      // Small delay to let autocomplete selection complete
      setTimeout(() => calculateDistance(), 200);
    }
  }
});


// 
//  LIVE GPS TRACKING 
// Uses watchPosition to continuously track the user's location
// and display a moving marker + breadcrumb trail on the map.
// 

function toggleTracking() {
  if (APP.tracking) {
    stopTracking();
  } else {
    startTracking();
  }
}

function startTracking() {
  if (!navigator.geolocation) {
    showStatus('GPS not supported on this browser.', 'error');
    return;
  }

  const btn = document.getElementById('track-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner spinner--sm"></span> Acquiring GPS';

  APP.watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const accuracy = pos.coords.accuracy;
      const speed = pos.coords.speed; // m/s, can be null
      const latlng = new google.maps.LatLng(lat, lng);

      // Mark as tracking on first fix
      if (!APP.tracking) {
        APP.tracking = true;
        btn.disabled = false;
        btn.innerHTML = '️ Stop Tracking';
        btn.classList.add('btn--track-stop');
        document.getElementById('live-badge').style.display = 'inline-flex';
        document.getElementById('tracking-info').style.display = 'flex';

        // Center and zoom map on first fix
        APP.map.setCenter(latlng);
        APP.map.setZoom(16);
      }

      //  Update / create marker 
      if (!APP.trackMarker) {
        APP.trackMarker = new google.maps.Marker({
          position: latlng,
          map: APP.map,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: '#3b82f6',
            fillOpacity: 1,
            strokeColor: '#fff',
            strokeWeight: 3,
          },
          title: 'Your location',
          zIndex: 999,
        });
      } else {
        APP.trackMarker.setPosition(latlng);
      }

      //  Accuracy circle 
      if (!APP.trackAccuracyCircle) {
        APP.trackAccuracyCircle = new google.maps.Circle({
          map: APP.map,
          center: latlng,
          radius: accuracy,
          fillColor: '#3b82f6',
          fillOpacity: 0.08,
          strokeColor: '#3b82f6',
          strokeOpacity: 0.25,
          strokeWeight: 1,
        });
      } else {
        APP.trackAccuracyCircle.setCenter(latlng);
        APP.trackAccuracyCircle.setRadius(accuracy);
      }

      //  Breadcrumb trail polyline 
      APP.trackPath.push(latlng);

      if (!APP.trackPolyline) {
        APP.trackPolyline = new google.maps.Polyline({
          path: APP.trackPath,
          map: APP.map,
          strokeColor: '#4ade80',
          strokeWeight: 4,
          strokeOpacity: 0.8,
        });
      } else {
        APP.trackPolyline.setPath(APP.trackPath);
      }

      //  Pan map to follow 
      APP.map.panTo(latlng);

      //  Update info bar 
      const speedKmh = speed != null ? (speed * 3.6).toFixed(1) + ' km/h' : '—';
      document.getElementById('track-speed').textContent = speedKmh;
      document.getElementById('track-accuracy').textContent = '±' + Math.round(accuracy) + 'm';
      document.getElementById('track-coords').textContent =
        lat.toFixed(5) + ', ' + lng.toFixed(5);
    },
    (err) => {
      const btn = document.getElementById('track-btn');
      btn.disabled = false;
      btn.innerHTML = ' Start Live Tracking';
      btn.classList.remove('btn--track-stop');

      const msgs = {
        1: 'Permission denied  please allow location access.',
        2: 'Position unavailable. Try outdoors or enable GPS.',
        3: 'GPS timed out. Please try again.',
      };
      showStatus(' ' + (msgs[err.code] || err.message), 'error');
    },
    {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0,
    }
  );
}

function stopTracking() {
  if (APP.watchId !== null) {
    navigator.geolocation.clearWatch(APP.watchId);
    APP.watchId = null;
  }

  APP.tracking = false;

  const btn = document.getElementById('track-btn');
  btn.innerHTML = ' Start Live Tracking';
  btn.classList.remove('btn--track-stop');
  document.getElementById('live-badge').style.display = 'none';
  document.getElementById('tracking-info').style.display = 'none';

  // Clean up map overlays
  if (APP.trackMarker) {
    APP.trackMarker.setMap(null);
    APP.trackMarker = null;
  }
  if (APP.trackAccuracyCircle) {
    APP.trackAccuracyCircle.setMap(null);
    APP.trackAccuracyCircle = null;
  }
  if (APP.trackPolyline) {
    APP.trackPolyline.setMap(null);
    APP.trackPolyline = null;
  }
  APP.trackPath = [];

  showStatus(' Tracking stopped.', 'info');
}
