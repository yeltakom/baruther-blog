// Kule Radar - Baz Istasyonu Gorsellestiricisi
(function () {
    'use strict';

    // ── Config ──
    const TECH_CONFIG = {
        '5G':  { color: '#e74c3c', label: '5G / NR',   radius: 500,  radioTypes: ['NR', 'LTE'] },
        '4G':  { color: '#3498db', label: '4G / LTE',  radius: 1000, radioTypes: ['LTE'] },
        '3G':  { color: '#f39c12', label: '3G / UMTS', radius: 2000, radioTypes: ['UMTS', 'CDMA'] },
        '2G':  { color: '#95a5a6', label: '2G / GSM',  radius: 5000, radioTypes: ['GSM'] },
    };

    // Map OpenCelliD radio type to our tech category
    function classifyRadio(radio) {
        if (!radio) return '2G';
        radio = radio.toUpperCase();
        if (radio === 'NR') return '5G';
        if (radio === 'LTE') return '4G';
        if (radio === 'UMTS' || radio === 'CDMA') return '3G';
        return '2G';
    }

    // ── State ──
    let map = null;
    let apiKey = '';
    let demoMode = false;
    let userLatLng = null;
    let userMarker = null;
    let userCircle = null;
    let towerMarkers = [];
    let coverageCircles = [];
    let towers = [];
    let watchId = null;
    let searchRadiusKm = 3;

    // ── DOM refs ──
    const setupScreen = document.getElementById('setup-screen');
    const apiKeyInput = document.getElementById('api-key-input');
    const startBtn = document.getElementById('start-btn');
    const demoBtn = document.getElementById('demo-btn');
    const appEl = document.getElementById('app');
    const statusText = document.getElementById('status-text');
    const btnRefresh = document.getElementById('btn-refresh');
    const btnLocate = document.getElementById('btn-locate');
    const btnLayers = document.getElementById('btn-layers');
    const layerPanel = document.getElementById('layer-panel');
    const detailPanel = document.getElementById('detail-panel');
    const detailClose = document.getElementById('detail-close');
    const searchRadiusInput = document.getElementById('search-radius');
    const radiusLabel = document.getElementById('radius-label');

    // ── Init ──
    const savedKey = localStorage.getItem('opencellid_key');
    if (savedKey) apiKeyInput.value = savedKey;

    startBtn.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        if (!key) {
            apiKeyInput.style.borderColor = '#e74c3c';
            apiKeyInput.focus();
            return;
        }
        apiKey = key;
        localStorage.setItem('opencellid_key', key);
        launch();
    });

    demoBtn.addEventListener('click', () => {
        demoMode = true;
        launch();
    });

    function launch() {
        setupScreen.classList.add('fade-out');
        setTimeout(() => {
            setupScreen.style.display = 'none';
            appEl.classList.remove('app-hidden');
            appEl.style.display = 'block';
            initMap();
            startLocationWatch();
        }, 500);
    }

    // ── Map ──
    function initMap() {
        map = L.map('map', {
            zoomControl: false,
            attributionControl: false,
        }).setView([52.489, 13.435], 14); // Default: Berlin

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            maxZoom: 19,
        }).addTo(map);

        // Remove the desaturation filter since we use a dark tile
        document.querySelector('.leaflet-tile-pane').style.filter = 'none';

        map.on('click', () => {
            closeDetail();
            closeLayerPanel();
        });
    }

    // ── Location ──
    function startLocationWatch() {
        if (!navigator.geolocation) {
            statusText.textContent = 'Konum desteklenmiyor';
            if (demoMode) useDemoLocation();
            return;
        }

        statusText.innerHTML = '<span class="spinner"></span> Konum aliniyor...';

        watchId = navigator.geolocation.watchPosition(
            (pos) => {
                const { latitude, longitude, accuracy } = pos.coords;
                userLatLng = [latitude, longitude];
                updateUserMarker(latitude, longitude, accuracy);
                statusText.textContent = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
            },
            (err) => {
                console.warn('Geolocation error:', err);
                statusText.textContent = 'Konum alinamadi';
                if (demoMode) useDemoLocation();
            },
            { enableHighAccuracy: true, maximumAge: 5000 }
        );
    }

    function useDemoLocation() {
        // Demo: Berlin - Barutherstr area
        userLatLng = [52.489, 13.435];
        updateUserMarker(52.489, 13.435, 50);
        statusText.textContent = 'Demo Mod - Berlin';
    }

    let firstLocate = true;
    function updateUserMarker(lat, lng, accuracy) {
        if (!userMarker) {
            const icon = L.divIcon({
                className: 'tower-marker',
                html: '<div class="user-marker"></div>',
                iconSize: [18, 18],
                iconAnchor: [9, 9],
            });
            userMarker = L.marker([lat, lng], { icon, zIndexOffset: 9999 }).addTo(map);
            userCircle = L.circle([lat, lng], {
                radius: accuracy || 50,
                color: '#3498db',
                fillColor: '#3498db',
                fillOpacity: 0.08,
                weight: 1,
                opacity: 0.3,
            }).addTo(map);
        } else {
            userMarker.setLatLng([lat, lng]);
            userCircle.setLatLng([lat, lng]);
            if (accuracy) userCircle.setRadius(accuracy);
        }

        if (firstLocate) {
            firstLocate = false;
            map.setView([lat, lng], 14);
            fetchTowers(lat, lng);
        }
    }

    // ── Fetch Towers ──
    async function fetchTowers(lat, lng) {
        statusText.innerHTML = '<span class="spinner"></span> Kuleler aranıyor...';

        if (demoMode) {
            towers = generateDemoTowers(lat, lng);
            renderTowers();
            statusText.textContent = `Demo - ${towers.length} kule bulundu`;
            return;
        }

        try {
            // OpenCelliD API - get cells in area
            const bbox = getBBox(lat, lng, searchRadiusKm);
            const url = `https://opencellid.org/cell/getInArea?key=${encodeURIComponent(apiKey)}`
                + `&BBOX=${bbox}&format=json&limit=1000`;

            const resp = await fetch(url);
            if (!resp.ok) {
                if (resp.status === 403) {
                    statusText.textContent = 'API anahtari gecersiz';
                } else {
                    statusText.textContent = `Hata: ${resp.status}`;
                }
                return;
            }
            const data = await resp.json();
            towers = (data.cells || []).map(parseCellTower);
            renderTowers();
            statusText.textContent = `${towers.length} kule bulundu`;
        } catch (e) {
            console.error('Fetch error:', e);
            statusText.textContent = 'Baglanti hatasi';
        }
    }

    function getBBox(lat, lng, kmRadius) {
        const latDelta = kmRadius / 111.32;
        const lngDelta = kmRadius / (111.32 * Math.cos(lat * Math.PI / 180));
        return `${(lat - latDelta).toFixed(6)},${(lng - lngDelta).toFixed(6)},${(lat + latDelta).toFixed(6)},${(lng + lngDelta).toFixed(6)}`;
    }

    function parseCellTower(cell) {
        const tech = classifyRadio(cell.radio);
        return {
            lat: cell.lat,
            lng: cell.lon,
            tech,
            radio: cell.radio || 'Unknown',
            mcc: cell.mcc,
            mnc: cell.mnc,
            lac: cell.lac,
            cid: cell.cellid || cell.cid,
            range: cell.range || TECH_CONFIG[tech].radius,
            samples: cell.samples || cell.measurementCount || 0,
            created: cell.created,
            updated: cell.updated,
            averageSignal: cell.averageSignalStrength || cell.averageSignal,
        };
    }

    // ── Demo Data ──
    function generateDemoTowers(centerLat, centerLng) {
        const operators = [
            { mcc: 262, mnc: 1, name: 'Telekom' },
            { mcc: 262, mnc: 2, name: 'Vodafone' },
            { mcc: 262, mnc: 3, name: 'O2' },
        ];
        const techs = ['5G', '4G', '4G', '4G', '3G', '3G', '2G'];
        const radioMap = { '5G': 'NR', '4G': 'LTE', '3G': 'UMTS', '2G': 'GSM' };
        const demoTowers = [];

        for (let i = 0; i < 60; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * searchRadiusKm * 0.8;
            const lat = centerLat + (dist / 111.32) * Math.cos(angle);
            const lng = centerLng + (dist / (111.32 * Math.cos(centerLat * Math.PI / 180))) * Math.sin(angle);
            const op = operators[Math.floor(Math.random() * operators.length)];
            const tech = techs[Math.floor(Math.random() * techs.length)];

            demoTowers.push({
                lat,
                lng,
                tech,
                radio: radioMap[tech],
                mcc: op.mcc,
                mnc: op.mnc,
                lac: 1000 + Math.floor(Math.random() * 9000),
                cid: 10000 + Math.floor(Math.random() * 90000),
                range: TECH_CONFIG[tech].radius * (0.4 + Math.random() * 0.8),
                samples: Math.floor(Math.random() * 500) + 10,
                averageSignal: -(Math.floor(Math.random() * 60) + 40),
            });
        }
        return demoTowers;
    }

    // ── Render ──
    function renderTowers() {
        clearMarkers();

        const showCoverage = document.getElementById('layer-coverage').checked;
        const layerFilters = {
            '5G': document.getElementById('layer-5g').checked,
            '4G': document.getElementById('layer-4g').checked,
            '3G': document.getElementById('layer-3g').checked,
            '2G': document.getElementById('layer-2g').checked,
        };

        const counts = { '5G': 0, '4G': 0, '3G': 0, '2G': 0 };

        towers.forEach((t) => {
            counts[t.tech]++;
            if (!layerFilters[t.tech]) return;

            const cfg = TECH_CONFIG[t.tech];

            // Coverage circle
            if (showCoverage) {
                const circle = L.circle([t.lat, t.lng], {
                    radius: t.range || cfg.radius,
                    color: cfg.color,
                    fillColor: cfg.color,
                    fillOpacity: 0.06,
                    weight: 0.5,
                    opacity: 0.25,
                }).addTo(map);
                coverageCircles.push(circle);
            }

            // Marker
            const icon = L.divIcon({
                className: 'tower-marker',
                html: `<div class="tower-marker-inner" style="background:${cfg.color}"></div>`,
                iconSize: [14, 14],
                iconAnchor: [7, 7],
            });

            const marker = L.marker([t.lat, t.lng], { icon })
                .addTo(map)
                .on('click', (e) => {
                    L.DomEvent.stopPropagation(e);
                    showDetail(t);
                });
            towerMarkers.push(marker);
        });

        updateStats(counts);
    }

    function clearMarkers() {
        towerMarkers.forEach((m) => map.removeLayer(m));
        coverageCircles.forEach((c) => map.removeLayer(c));
        towerMarkers = [];
        coverageCircles = [];
    }

    function updateStats(counts) {
        document.getElementById('stat-total').textContent = towers.length;
        document.getElementById('stat-5g').textContent = counts['5G'];
        document.getElementById('stat-4g').textContent = counts['4G'];
        document.getElementById('stat-3g').textContent = counts['3G'];
        document.getElementById('stat-2g').textContent = counts['2G'];
    }

    // ── Detail Panel ──
    function showDetail(tower) {
        const cfg = TECH_CONFIG[tower.tech];
        const techClass = 't-' + tower.tech.toLowerCase();
        document.getElementById('detail-title').innerHTML =
            `<span class="tech-badge ${techClass}">${tower.radio}</span> Kule Detayi`;

        const operatorName = getOperatorName(tower.mcc, tower.mnc);

        const rows = [
            ['Teknoloji', cfg.label],
            ['Operator', operatorName || `MCC ${tower.mcc} / MNC ${tower.mnc}`],
            ['MCC', tower.mcc],
            ['MNC', tower.mnc],
            ['LAC / TAC', tower.lac],
            ['Cell ID', tower.cid],
            ['Kapsama', `~${Math.round(tower.range || cfg.radius)} m`],
            ['Ornek Sayisi', tower.samples || '-'],
        ];

        if (tower.averageSignal) {
            rows.push(['Ort. Sinyal', `${tower.averageSignal} dBm`]);
        }

        rows.push(['Koordinat', `${tower.lat.toFixed(6)}, ${tower.lng.toFixed(6)}`]);

        if (tower.updated) {
            rows.push(['Son Guncelleme', formatDate(tower.updated)]);
        }

        // Distance from user
        if (userLatLng) {
            const dist = haversine(userLatLng[0], userLatLng[1], tower.lat, tower.lng);
            rows.push(['Uzaklik', dist < 1000 ? `${Math.round(dist)} m` : `${(dist / 1000).toFixed(2)} km`]);
        }

        document.getElementById('detail-body').innerHTML = rows
            .map(([k, v]) => `<div class="detail-row"><span class="detail-key">${k}</span><span class="detail-val">${v}</span></div>`)
            .join('');

        detailPanel.classList.remove('panel-hidden');

        // Highlight on map
        map.setView([tower.lat, tower.lng], Math.max(map.getZoom(), 15));
    }

    function closeDetail() {
        detailPanel.classList.add('panel-hidden');
    }

    function closeLayerPanel() {
        layerPanel.classList.add('panel-hidden');
    }

    // ── Operator lookup (Turkey + Germany common) ──
    function getOperatorName(mcc, mnc) {
        const operators = {
            '286-1': 'Turkcell', '286-2': 'Vodafone TR', '286-3': 'Turk Telekom',
            '262-1': 'Telekom DE', '262-2': 'Vodafone DE', '262-3': 'O2 DE', '262-7': '1&1',
            '310-260': 'T-Mobile US', '310-410': 'AT&T', '311-480': 'Verizon',
        };
        return operators[`${mcc}-${mnc}`] || null;
    }

    function formatDate(timestamp) {
        if (!timestamp) return '-';
        const d = new Date(typeof timestamp === 'number' ? timestamp * 1000 : timestamp);
        return d.toLocaleDateString('tr-TR');
    }

    function haversine(lat1, lng1, lat2, lng2) {
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // ── Event Listeners ──
    btnRefresh.addEventListener('click', () => {
        if (userLatLng) fetchTowers(userLatLng[0], userLatLng[1]);
    });

    btnLocate.addEventListener('click', () => {
        if (userLatLng) map.setView(userLatLng, 15);
    });

    btnLayers.addEventListener('click', (e) => {
        e.stopPropagation();
        layerPanel.classList.toggle('panel-hidden');
    });

    layerPanel.addEventListener('click', (e) => e.stopPropagation());

    detailClose.addEventListener('click', closeDetail);

    // Layer toggles
    ['layer-coverage', 'layer-5g', 'layer-4g', 'layer-3g', 'layer-2g'].forEach((id) => {
        document.getElementById(id).addEventListener('change', () => renderTowers());
    });

    searchRadiusInput.addEventListener('input', () => {
        searchRadiusKm = parseInt(searchRadiusInput.value, 10);
        radiusLabel.textContent = `${searchRadiusKm} km`;
    });

    searchRadiusInput.addEventListener('change', () => {
        if (userLatLng) fetchTowers(userLatLng[0], userLatLng[1]);
    });

})();
