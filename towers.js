// TOWER BUREAU — a latent signal map
// Raw WebGL renderer: procedural grid + grain, pulsing tower points,
// coverage rings, animated signal ripples. Data: OpenCelliD.
(function () {
    'use strict';

    // ── Constants ──
    const METERS_PER_DEG_LAT = 110540;
    const TECHS = ['5G', '4G', '3G', '2G'];
    const DEFAULT_RANGE = { '5G': 500, '4G': 1000, '3G': 2000, '2G': 5000 };

    function classifyRadio(radio) {
        if (!radio) return '2G';
        radio = radio.toUpperCase();
        if (radio === 'NR') return '5G';
        if (radio === 'LTE') return '4G';
        if (radio === 'UMTS' || radio === 'CDMA') return '3G';
        return '2G';
    }

    const OPERATORS = {
        '286-1': 'TURKCELL', '286-2': 'VODAFONE TR', '286-3': 'TURK TELEKOM',
        '262-1': 'TELEKOM DE', '262-2': 'VODAFONE DE', '262-3': 'O2 DE', '262-7': '1&1',
        '310-260': 'T-MOBILE US', '310-410': 'AT&T', '311-480': 'VERIZON',
    };

    // ── State ──
    let apiKey = '';
    let demoMode = false;
    let started = false;
    let origin = null;          // {lat, lng} — projection origin
    let userWorld = null;       // [x, y] meters from origin
    let towers = [];            // parsed tower records with .wx/.wy
    let selected = null;
    let searchRadiusKm = 3;
    let watchId = null;

    // view
    let center = [0, 0];        // meters
    let scale = 0.15;           // device px per meter
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    // ── DOM ──
    const $ = (id) => document.getElementById(id);
    const canvas = $('gl');
    const statusEl = $('status');
    const apiKeyInput = $('api-key-input');

    const savedKey = localStorage.getItem('opencellid_key');
    if (savedKey) apiKeyInput.value = savedKey;

    function setStatus(msg) {
        statusEl.textContent = msg.toUpperCase();
    }

    // ── Projection ──
    function project(lat, lng) {
        const mPerDegLng = METERS_PER_DEG_LAT * Math.cos(origin.lat * Math.PI / 180);
        return [(lng - origin.lng) * mPerDegLng, (lat - origin.lat) * METERS_PER_DEG_LAT];
    }

    // ══════════════════════════════════════════
    //  WebGL
    // ══════════════════════════════════════════
    const gl = canvas.getContext('webgl', { antialias: true, alpha: false });
    if (!gl) {
        $('gl-error').hidden = false;
    }

    function compile(type, src) {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
            throw new Error(gl.getShaderInfoLog(sh));
        }
        return sh;
    }

    function makeProgram(vsSrc, fsSrc) {
        const p = gl.createProgram();
        gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
        gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
            throw new Error(gl.getProgramInfoLog(p));
        }
        return p;
    }

    // ── Shaders ──
    // Background: procedural survey grid, film grain, vignette, radar sweep.
    const gridVS = `
        attribute vec2 a_pos;
        void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
    `;
    const gridFS = `
        precision mediump float;
        uniform vec2 u_res;
        uniform vec2 u_center;
        uniform float u_scale;
        uniform float u_time;
        uniform vec2 u_user;
        uniform float u_hasUser;

        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }

        void main() {
            vec2 world = (gl_FragCoord.xy - u_res * 0.5) / u_scale + u_center;
            float lw = 1.0 / u_scale;

            // minor grid every 250 m, major every 1 km
            vec2 q1 = abs(fract(world / 250.0) - 0.5) * 250.0;
            vec2 q2 = abs(fract(world / 1000.0) - 0.5) * 1000.0;
            float g = (1.0 - step(lw, min(q1.x, q1.y))) * 0.10
                    + (1.0 - step(lw * 1.5, min(q2.x, q2.y))) * 0.08;

            // radar sweep around the observer
            float sweep = 0.0;
            if (u_hasUser > 0.5) {
                vec2 d = world - u_user;
                float ang = atan(d.y, d.x);
                float beam = fract((ang + 3.14159265) / 6.2831853 - u_time * 0.05);
                float dist = length(d);
                sweep = pow(1.0 - beam, 12.0) * 0.10 * smoothstep(3500.0, 200.0, dist);
            }

            // film grain
            float n = hash(gl_FragCoord.xy + floor(u_time * 9.0)) * 0.05;

            // vignette
            vec2 uv = gl_FragCoord.xy / u_res - 0.5;
            float vig = 1.0 - dot(uv, uv) * 0.85;

            gl_FragColor = vec4(vec3((g + sweep) * vig + n), 1.0);
        }
    `;

    // Towers as pulsing glow points.
    const pointVS = `
        attribute vec2 a_pos;
        attribute float a_size;
        attribute float a_phase;
        uniform vec2 u_res;
        uniform vec2 u_center;
        uniform float u_scale;
        uniform float u_time;
        varying float v_pulse;
        void main() {
            vec2 px = (a_pos - u_center) * u_scale;
            gl_Position = vec4(px / (u_res * 0.5), 0.0, 1.0);
            v_pulse = 0.75 + 0.25 * sin(u_time * 2.5 + a_phase * 6.2831853);
            gl_PointSize = a_size * v_pulse;
        }
    `;
    const pointFS = `
        precision mediump float;
        uniform vec3 u_color;
        uniform float u_alpha;
        varying float v_pulse;
        void main() {
            float r = length(gl_PointCoord - 0.5);
            float core = smoothstep(0.30, 0.12, r);
            float halo = smoothstep(0.5, 0.0, r) * 0.35;
            float a = (core + halo) * u_alpha * v_pulse;
            gl_FragColor = vec4(u_color, a);
        }
    `;

    // Unit circle (line loop), positioned/scaled per draw call.
    const circleVS = `
        attribute vec2 a_unit;
        uniform vec2 u_res;
        uniform vec2 u_center;
        uniform float u_scale;
        uniform vec2 u_world;
        uniform float u_radius;
        void main() {
            vec2 w = u_world + a_unit * u_radius;
            vec2 px = (w - u_center) * u_scale;
            gl_Position = vec4(px / (u_res * 0.5), 0.0, 1.0);
        }
    `;
    const circleFS = `
        precision mediump float;
        uniform float u_alpha;
        void main() { gl_FragColor = vec4(vec3(1.0), u_alpha); }
    `;

    let gridProg, pointProg, circleProg;
    let quadBuf, circleBuf, towerBuf, userBuf;
    const CIRCLE_SEGS = 96;
    let towerVertCount = 0;

    function initGL() {
        gridProg = makeProgram(gridVS, gridFS);
        pointProg = makeProgram(pointVS, pointFS);
        circleProg = makeProgram(circleVS, circleFS);

        quadBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

        const circ = new Float32Array(CIRCLE_SEGS * 2);
        for (let i = 0; i < CIRCLE_SEGS; i++) {
            const a = (i / CIRCLE_SEGS) * Math.PI * 2;
            circ[i * 2] = Math.cos(a);
            circ[i * 2 + 1] = Math.sin(a);
        }
        circleBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, circleBuf);
        gl.bufferData(gl.ARRAY_BUFFER, circ, gl.STATIC_DRAW);

        towerBuf = gl.createBuffer();
        userBuf = gl.createBuffer();
    }

    function resize() {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
        }
    }

    function visibleTowers() {
        const f = {
            '5G': $('f-5g').checked, '4G': $('f-4g').checked,
            '3G': $('f-3g').checked, '2G': $('f-2g').checked,
        };
        return towers.filter((t) => f[t.tech]);
    }

    // Interleaved [x, y, sizePx, phase] per tower.
    function rebuildTowerBuffer() {
        const vis = visibleTowers();
        const data = new Float32Array(vis.length * 4);
        vis.forEach((t, i) => {
            const sampleBoost = Math.min(4, Math.log2(1 + (t.samples || 0)) * 0.6);
            data[i * 4] = t.wx;
            data[i * 4 + 1] = t.wy;
            data[i * 4 + 2] = (5 + sampleBoost) * dpr;
            data[i * 4 + 3] = t.phase;
        });
        gl.bindBuffer(gl.ARRAY_BUFFER, towerBuf);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
        towerVertCount = vis.length;
    }

    function bindPointAttribs(prog, buf, stride) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        const aPos = gl.getAttribLocation(prog, 'a_pos');
        const aSize = gl.getAttribLocation(prog, 'a_size');
        const aPhase = gl.getAttribLocation(prog, 'a_phase');
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0);
        gl.enableVertexAttribArray(aSize);
        gl.vertexAttribPointer(aSize, 1, gl.FLOAT, false, stride, 8);
        gl.enableVertexAttribArray(aPhase);
        gl.vertexAttribPointer(aPhase, 1, gl.FLOAT, false, stride, 12);
    }

    function setViewUniforms(prog) {
        gl.uniform2f(gl.getUniformLocation(prog, 'u_res'), canvas.width, canvas.height);
        gl.uniform2f(gl.getUniformLocation(prog, 'u_center'), center[0], center[1]);
        gl.uniform1f(gl.getUniformLocation(prog, 'u_scale'), scale);
    }

    function drawCircle(world, radius, alpha) {
        gl.uniform2f(gl.getUniformLocation(circleProg, 'u_world'), world[0], world[1]);
        gl.uniform1f(gl.getUniformLocation(circleProg, 'u_radius'), radius);
        gl.uniform1f(gl.getUniformLocation(circleProg, 'u_alpha'), alpha);
        gl.drawArrays(gl.LINE_LOOP, 0, CIRCLE_SEGS);
    }

    let rafStarted = false;
    function startLoop() {
        if (rafStarted) return;
        rafStarted = true;
        requestAnimationFrame(frame);
    }

    function frame(tMs) {
        const t = tMs / 1000;
        resize();
        gl.viewport(0, 0, canvas.width, canvas.height);

        // background pass (opaque)
        gl.disable(gl.BLEND);
        gl.useProgram(gridProg);
        setViewUniforms(gridProg);
        gl.uniform1f(gl.getUniformLocation(gridProg, 'u_time'), t);
        gl.uniform1f(gl.getUniformLocation(gridProg, 'u_hasUser'), userWorld ? 1 : 0);
        gl.uniform2f(gl.getUniformLocation(gridProg, 'u_user'),
            userWorld ? userWorld[0] : 0, userWorld ? userWorld[1] : 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        const aQuad = gl.getAttribLocation(gridProg, 'a_pos');
        gl.enableVertexAttribArray(aQuad);
        gl.vertexAttribPointer(aQuad, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

        // coverage rings
        gl.useProgram(circleProg);
        setViewUniforms(circleProg);
        if ($('f-coverage').checked) {
            for (const tw of visibleTowers()) {
                drawCircle([tw.wx, tw.wy], tw.range, 0.07);
            }
        }

        // animated signal ripples: selected tower + observer
        if (selected) {
            for (let i = 0; i < 3; i++) {
                const prog = (t * 0.45 + i / 3) % 1;
                drawCircle([selected.wx, selected.wy], prog * selected.range, (1 - prog) * 0.7);
            }
        }
        if (userWorld) {
            const prog = (t * 0.3) % 1;
            drawCircle(userWorld, prog * 400, (1 - prog) * 0.4);
        }

        // tower points
        if (towerVertCount > 0) {
            gl.useProgram(pointProg);
            setViewUniforms(pointProg);
            gl.uniform1f(gl.getUniformLocation(pointProg, 'u_time'), t);
            gl.uniform3f(gl.getUniformLocation(pointProg, 'u_color'), 1, 1, 1);
            gl.uniform1f(gl.getUniformLocation(pointProg, 'u_alpha'), 0.95);
            bindPointAttribs(pointProg, towerBuf, 16);
            gl.drawArrays(gl.POINTS, 0, towerVertCount);
        }

        // observer point
        if (userWorld) {
            gl.useProgram(pointProg);
            setViewUniforms(pointProg);
            gl.uniform1f(gl.getUniformLocation(pointProg, 'u_time'), t);
            gl.uniform3f(gl.getUniformLocation(pointProg, 'u_color'), 1, 1, 1);
            gl.uniform1f(gl.getUniformLocation(pointProg, 'u_alpha'), 1.0);
            gl.bindBuffer(gl.ARRAY_BUFFER, userBuf);
            gl.bufferData(gl.ARRAY_BUFFER,
                new Float32Array([userWorld[0], userWorld[1], 11 * dpr, 0]), gl.DYNAMIC_DRAW);
            bindPointAttribs(pointProg, userBuf, 16);
            gl.drawArrays(gl.POINTS, 0, 1);
        }

        requestAnimationFrame(frame);
    }

    // ── Map interaction ──
    function screenToWorld(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const px = (clientX - rect.left) * dpr;
        const py = (rect.bottom - clientY) * dpr; // GL y-up
        return [
            (px - canvas.width / 2) / scale + center[0],
            (py - canvas.height / 2) / scale + center[1],
        ];
    }

    let dragging = false, moved = false, lastXY = null, pinchDist = null;

    canvas.addEventListener('pointerdown', (e) => {
        dragging = true;
        moved = false;
        lastXY = [e.clientX, e.clientY];
        canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - lastXY[0], dy = e.clientY - lastXY[1];
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
        center[0] -= dx * dpr / scale;
        center[1] += dy * dpr / scale;
        lastXY = [e.clientX, e.clientY];
    });

    canvas.addEventListener('pointerup', (e) => {
        dragging = false;
        if (!moved) pick(e.clientX, e.clientY);
    });

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const before = screenToWorld(e.clientX, e.clientY);
        scale = Math.min(8, Math.max(0.01, scale * Math.exp(-e.deltaY * 0.0012)));
        const after = screenToWorld(e.clientX, e.clientY);
        center[0] += before[0] - after[0];
        center[1] += before[1] - after[1];
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            const d = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY);
            if (pinchDist) {
                scale = Math.min(8, Math.max(0.01, scale * (d / pinchDist)));
            }
            pinchDist = d;
        }
    }, { passive: false });
    canvas.addEventListener('touchend', () => { pinchDist = null; });

    function pick(clientX, clientY) {
        const w = screenToWorld(clientX, clientY);
        const maxDist = 16 * dpr / scale; // 16 px hit radius in meters
        let best = null, bestD = maxDist;
        for (const t of visibleTowers()) {
            const d = Math.hypot(t.wx - w[0], t.wy - w[1]);
            if (d < bestD) { bestD = d; best = t; }
        }
        selectTower(best);
    }

    // ══════════════════════════════════════════
    //  Data
    // ══════════════════════════════════════════
    async function fetchTowers(lat, lng) {
        setStatus('Scanning…');

        if (demoMode) {
            towers = generateDemoTowers(lat, lng);
            onTowersLoaded();
            setStatus(`Demo — ${towers.length} towers`);
            return;
        }

        try {
            const bbox = getBBox(lat, lng, searchRadiusKm);
            const url = `https://opencellid.org/cell/getInArea?key=${encodeURIComponent(apiKey)}`
                + `&BBOX=${bbox}&format=json&limit=1000`;
            const resp = await fetch(url);
            if (!resp.ok) {
                setStatus(resp.status === 403 ? 'Invalid API key' : `Error ${resp.status}`);
                return;
            }
            const data = await resp.json();
            towers = (data.cells || []).map(parseCell);
            onTowersLoaded();
            setStatus(`${towers.length} towers registered`);
        } catch (e) {
            console.error(e);
            setStatus('Connection failed');
        }
    }

    function getBBox(lat, lng, km) {
        const dLat = km / 111.32;
        const dLng = km / (111.32 * Math.cos(lat * Math.PI / 180));
        return `${(lat - dLat).toFixed(6)},${(lng - dLng).toFixed(6)},${(lat + dLat).toFixed(6)},${(lng + dLng).toFixed(6)}`;
    }

    function parseCell(cell) {
        const tech = classifyRadio(cell.radio);
        const t = {
            lat: cell.lat, lng: cell.lon,
            tech, radio: cell.radio || 'UNKNOWN',
            mcc: cell.mcc, mnc: cell.mnc, lac: cell.lac,
            cid: cell.cellid || cell.cid,
            range: cell.range || DEFAULT_RANGE[tech],
            samples: cell.samples || cell.measurementCount || 0,
            updated: cell.updated,
            signal: cell.averageSignalStrength || cell.averageSignal,
            phase: Math.random(),
        };
        [t.wx, t.wy] = project(t.lat, t.lng);
        return t;
    }

    function generateDemoTowers(centerLat, centerLng) {
        const ops = [
            { mcc: 262, mnc: 1 }, { mcc: 262, mnc: 2 }, { mcc: 262, mnc: 3 },
        ];
        const techs = ['5G', '4G', '4G', '4G', '3G', '3G', '2G'];
        const radioMap = { '5G': 'NR', '4G': 'LTE', '3G': 'UMTS', '2G': 'GSM' };
        const out = [];
        for (let i = 0; i < 70; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.pow(Math.random(), 0.7) * searchRadiusKm * 0.85;
            const lat = centerLat + (dist / 111.32) * Math.cos(angle);
            const lng = centerLng + (dist / (111.32 * Math.cos(centerLat * Math.PI / 180))) * Math.sin(angle);
            const op = ops[Math.floor(Math.random() * ops.length)];
            const tech = techs[Math.floor(Math.random() * techs.length)];
            const t = {
                lat, lng, tech, radio: radioMap[tech],
                mcc: op.mcc, mnc: op.mnc,
                lac: 1000 + Math.floor(Math.random() * 9000),
                cid: 10000 + Math.floor(Math.random() * 90000),
                range: DEFAULT_RANGE[tech] * (0.4 + Math.random() * 0.8),
                samples: Math.floor(Math.random() * 500) + 10,
                signal: -(Math.floor(Math.random() * 60) + 40),
                phase: Math.random(),
            };
            [t.wx, t.wy] = project(t.lat, t.lng);
            out.push(t);
        }
        return out;
    }

    function onTowersLoaded() {
        selected = null;
        renderDetail();
        rebuildTowerBuffer();
        renderCensus();
        renderStack();
    }

    // ── DOM panels ──
    function renderCensus() {
        const counts = { '5G': 0, '4G': 0, '3G': 0, '2G': 0 };
        towers.forEach((t) => counts[t.tech]++);
        $('c-total').textContent = towers.length;
        $('c-5g').textContent = counts['5G'];
        $('c-4g').textContent = counts['4G'];
        $('c-3g').textContent = counts['3G'];
        $('c-2g').textContent = counts['2G'];
    }

    function distToUser(t) {
        if (!userWorld) return Infinity;
        return Math.hypot(t.wx - userWorld[0], t.wy - userWorld[1]);
    }

    function fmtDist(m) {
        if (!isFinite(m)) return '—';
        return m < 1000 ? `${Math.round(m)} M` : `${(m / 1000).toFixed(2)} KM`;
    }

    function operatorName(t) {
        return OPERATORS[`${t.mcc}-${t.mnc}`] || `MCC ${t.mcc} MNC ${t.mnc}`;
    }

    function renderStack() {
        const list = $('stack-list');
        if (towers.length === 0) {
            list.innerHTML = '<p class="small">No towers registered in this area.</p>';
            return;
        }
        const sorted = [...towers].sort((a, b) => distToUser(a) - distToUser(b));
        list.innerHTML = '';
        sorted.forEach((t) => {
            const row = document.createElement('div');
            row.className = 'stack-row' + (t === selected ? ' selected' : '');
            row.innerHTML =
                `<span>${t.radio} &middot; ${operatorName(t)} &middot; CID ${t.cid}</span>` +
                `<span class="dist">${fmtDist(distToUser(t))}</span>`;
            row.addEventListener('click', () => {
                selectTower(t);
                center = [t.wx, t.wy];
            });
            list.appendChild(row);
        });
    }

    function selectTower(t) {
        selected = t;
        renderDetail();
        document.querySelectorAll('.stack-row').forEach((el) => el.classList.remove('selected'));
        if (t) {
            const sorted = [...towers].sort((a, b) => distToUser(a) - distToUser(b));
            const idx = sorted.indexOf(t);
            const row = $('stack-list').children[idx];
            if (row && row.classList) {
                row.classList.add('selected');
                row.scrollIntoView({ block: 'nearest' });
            }
        }
    }

    function renderDetail() {
        const box = $('detail');
        if (!selected) { box.hidden = true; return; }
        const t = selected;
        const rows = [
            ['RADIO', t.radio],
            ['OPERATOR', operatorName(t)],
            ['LAC / TAC', t.lac],
            ['CELL ID', t.cid],
            ['EST. RANGE', `${Math.round(t.range)} M`],
            ['SAMPLES', t.samples || '—'],
        ];
        if (t.signal) rows.push(['AVG SIGNAL', `${t.signal} DBM`]);
        rows.push(['POSITION', `${t.lat.toFixed(5)}, ${t.lng.toFixed(5)}`]);
        rows.push(['DISTANCE', fmtDist(distToUser(t))]);
        $('detail-table').innerHTML = rows
            .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`)
            .join('');
        box.hidden = false;
    }

    // ── Location ──
    function startLocation() {
        if (demoMode || !navigator.geolocation) {
            useDemoLocation();
            return;
        }
        setStatus('Acquiring position…');
        watchId = navigator.geolocation.watchPosition(
            (pos) => {
                const { latitude, longitude } = pos.coords;
                if (!origin) {
                    origin = { lat: latitude, lng: longitude };
                    userWorld = [0, 0];
                    center = [0, 0];
                    fetchTowers(latitude, longitude);
                } else {
                    userWorld = project(latitude, longitude);
                }
            },
            () => {
                setStatus('Position denied');
                if (!origin) useDemoLocation();
            },
            { enableHighAccuracy: true, maximumAge: 5000 }
        );
    }

    function useDemoLocation() {
        origin = { lat: 52.489, lng: 13.435 }; // Berlin, Barutherstr.
        userWorld = [0, 0];
        center = [0, 0];
        fetchTowers(origin.lat, origin.lng);
    }

    // ── Controls ──
    function start() {
        if (started) {
            // restart scan with current mode
            origin = null;
            if (watchId !== null) navigator.geolocation.clearWatch(watchId);
            startLocation();
            return;
        }
        started = true;
        initGL();
        startLoop();
        startLocation();
    }

    $('btn-access').addEventListener('click', (e) => {
        e.preventDefault();
        const key = apiKeyInput.value.trim();
        if (!key) {
            apiKeyInput.classList.add('invalid');
            apiKeyInput.focus();
            setTimeout(() => apiKeyInput.classList.remove('invalid'), 600);
            return;
        }
        apiKey = key;
        localStorage.setItem('opencellid_key', key);
        demoMode = false;
        start();
    });

    $('btn-demo').addEventListener('click', (e) => {
        e.preventDefault();
        demoMode = true;
        start();
    });

    $('btn-rescan').addEventListener('click', (e) => {
        e.preventDefault();
        if (origin) {
            const lat = origin.lat + (userWorld ? userWorld[1] / METERS_PER_DEG_LAT : 0);
            const lng = origin.lng + (userWorld
                ? userWorld[0] / (METERS_PER_DEG_LAT * Math.cos(origin.lat * Math.PI / 180)) : 0);
            fetchTowers(lat, lng);
        }
    });

    $('btn-locate').addEventListener('click', (e) => {
        e.preventDefault();
        if (userWorld) {
            center = [...userWorld];
            scale = 0.15;
        }
    });

    $('detail-close').addEventListener('click', (e) => {
        e.preventDefault();
        selectTower(null);
    });

    ['f-5g', 'f-4g', 'f-3g', 'f-2g'].forEach((id) => {
        $(id).addEventListener('change', () => {
            if (selected && !$('f-' + selected.tech.toLowerCase()).checked) selectTower(null);
            rebuildTowerBuffer();
        });
    });

    const radiusInput = $('search-radius');
    radiusInput.addEventListener('input', () => {
        searchRadiusKm = parseInt(radiusInput.value, 10);
        $('radius-label').textContent = `${searchRadiusKm} KM`;
    });
    radiusInput.addEventListener('change', () => {
        if (origin) fetchTowers(origin.lat, origin.lng);
    });

})();
