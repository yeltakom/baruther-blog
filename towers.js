// TOWER BUREAU — a latent signal map
// Experimental WebGL 3D renderer: perspective camera orbiting a procedural
// ground grid, towers as glowing signal beams, animated ripples and sweep.
// Falls back to a Canvas 2D top-down view when WebGL is unavailable.
// Data: OpenCelliD.
(function () {
    'use strict';

    // ── Constants ──
    const METERS_PER_DEG_LAT = 110540;
    const DEFAULT_RANGE = { '5G': 500, '4G': 1000, '3G': 2000, '2G': 5000 };
    const TAU = Math.PI * 2;

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
    let origin = null;          // {lat, lng} projection origin
    let userWorld = null;       // [x, y] meters
    let towers = [];
    let selected = null;
    let searchRadiusKm = 3;
    let watchId = null;

    // shared view target (3D camera target / 2D pan center)
    let center = [0, 0];
    // 3D camera
    let camAz = 0.7;            // azimuth, rad
    let camEl = 0.85;           // elevation, rad
    let camDist = 4200;         // meters
    // 2D fallback view
    let scale2d = 0.15;         // device px per meter

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

    function project(lat, lng) {
        const mPerDegLng = METERS_PER_DEG_LAT * Math.cos(origin.lat * Math.PI / 180);
        return [(lng - origin.lng) * mPerDegLng, (lat - origin.lat) * METERS_PER_DEG_LAT];
    }

    function beamHeight(t) {
        return 80 + Math.min(900, (t.range || 500) * 0.18);
    }

    // ══════════════════════════════════════════
    //  Context
    // ══════════════════════════════════════════
    const glOpts = { antialias: true, alpha: false };
    function tryContext(type) {
        try { return canvas.getContext(type, glOpts); } catch (e) { return null; }
    }
    const gl = tryContext('webgl') || tryContext('webgl2') || tryContext('experimental-webgl');

    let ctx2d = null;
    if (!gl) {
        try { ctx2d = canvas.getContext('2d'); } catch (e) { /* nothing */ }
    }
    $('gl-error').hidden = !!(gl || ctx2d);
    setStatus(gl ? 'Standby — WebGL 3D' : (ctx2d ? 'Standby — 2D mode' : 'No canvas support'));

    // ══════════════════════════════════════════
    //  Mat4 helpers (column-major)
    // ══════════════════════════════════════════
    function mat4Mul(a, b) {
        const o = new Float32Array(16);
        for (let c = 0; c < 4; c++) {
            for (let r = 0; r < 4; r++) {
                o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1]
                    + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
            }
        }
        return o;
    }

    function mat4Perspective(fovy, aspect, near, far) {
        const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
        return new Float32Array([
            f / aspect, 0, 0, 0,
            0, f, 0, 0,
            0, 0, (far + near) * nf, -1,
            0, 0, 2 * far * near * nf, 0,
        ]);
    }

    function mat4LookAt(eye, target, up) {
        let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
        let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
        let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
        l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
        const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
        return new Float32Array([
            xx, yx, zx, 0,
            xy, yy, zy, 0,
            xz, yz, zz, 0,
            -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
            -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
            -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
            1,
        ]);
    }

    // ══════════════════════════════════════════
    //  Shaders
    // ══════════════════════════════════════════
    const groundVS = `
        attribute vec2 a_q;
        uniform mat4 u_vp;
        uniform vec2 u_target;
        uniform float u_extent;
        varying vec2 v_world;
        void main() {
            v_world = u_target + a_q * u_extent;
            gl_Position = u_vp * vec4(v_world, 0.0, 1.0);
        }
    `;
    const groundFS = `
        precision mediump float;
        varying vec2 v_world;
        uniform vec2 u_target;
        uniform float u_time;
        uniform vec2 u_user;
        uniform float u_hasUser;

        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }

        void main() {
            // survey grid: minor 250 m, major 1 km
            vec2 q1 = abs(fract(v_world / 250.0) - 0.5) * 250.0;
            vec2 q2 = abs(fract(v_world / 1000.0) - 0.5) * 1000.0;
            float g = (1.0 - smoothstep(0.0, 6.0, min(q1.x, q1.y))) * 0.10
                    + (1.0 - smoothstep(0.0, 10.0, min(q2.x, q2.y))) * 0.10;

            // radar sweep around the observer
            float sweep = 0.0;
            if (u_hasUser > 0.5) {
                vec2 d = v_world - u_user;
                float ang = atan(d.y, d.x);
                float beam = fract((ang + 3.14159265) / 6.2831853 - u_time * 0.05);
                sweep = pow(1.0 - beam, 14.0) * 0.12 * smoothstep(4000.0, 200.0, length(d));
            }

            // grain
            float n = hash(floor(v_world * 0.5) + floor(u_time * 9.0)) * 0.04;

            // distance fade toward horizon
            float fade = 1.0 - smoothstep(3500.0, 16000.0, length(v_world - u_target));

            gl_FragColor = vec4(vec3((g + sweep + n) * fade), 1.0);
        }
    `;

    // beams: vertical signal columns
    const beamVS = `
        attribute vec3 a_pos;
        attribute float a_phase;
        attribute float a_t;
        uniform mat4 u_vp;
        uniform float u_time;
        varying float v_t;
        varying float v_pulse;
        void main() {
            gl_Position = u_vp * vec4(a_pos, 1.0);
            v_t = a_t;
            v_pulse = 0.7 + 0.3 * sin(u_time * 2.0 + a_phase * 6.2831853);
        }
    `;
    const beamFS = `
        precision mediump float;
        varying float v_t;
        varying float v_pulse;
        uniform float u_alpha;
        void main() {
            float a = (1.0 - v_t * 0.85) * u_alpha * v_pulse;
            gl_FragColor = vec4(vec3(1.0), a);
        }
    `;

    // points with perspective size attenuation
    const pointVS = `
        attribute vec3 a_pos;
        attribute float a_size;
        attribute float a_phase;
        uniform mat4 u_vp;
        uniform float u_time;
        uniform float u_pscale;
        varying float v_pulse;
        void main() {
            vec4 p = u_vp * vec4(a_pos, 1.0);
            gl_Position = p;
            v_pulse = 0.75 + 0.25 * sin(u_time * 2.5 + a_phase * 6.2831853);
            gl_PointSize = clamp(a_size * u_pscale / max(p.w, 1.0), 2.0, 48.0) * v_pulse;
        }
    `;
    const pointFS = `
        precision mediump float;
        uniform float u_alpha;
        varying float v_pulse;
        void main() {
            float r = length(gl_PointCoord - 0.5);
            float core = smoothstep(0.30, 0.10, r);
            float halo = smoothstep(0.5, 0.0, r) * 0.35;
            gl_FragColor = vec4(vec3(1.0), (core + halo) * u_alpha * v_pulse);
        }
    `;

    // ground circles (coverage / ripples)
    const circleVS = `
        attribute vec2 a_unit;
        uniform mat4 u_vp;
        uniform vec2 u_world;
        uniform float u_radius;
        void main() {
            gl_Position = u_vp * vec4(u_world + a_unit * u_radius, 0.0, 1.0);
        }
    `;
    const circleFS = `
        precision mediump float;
        uniform float u_alpha;
        void main() { gl_FragColor = vec4(vec3(1.0), u_alpha); }
    `;

    // ══════════════════════════════════════════
    //  GL setup
    // ══════════════════════════════════════════
    let groundProg, beamProg, pointProg, circleProg;
    let quadBuf, circleBuf, beamBuf, pointBuf, userBuf;
    const CIRCLE_SEGS = 96;
    let beamVertCount = 0, pointVertCount = 0;
    let glReady = false;
    let vpMat = null;

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

    function initGL() {
        if (!gl || glReady) return;
        glReady = true;

        groundProg = makeProgram(groundVS, groundFS);
        beamProg = makeProgram(beamVS, beamFS);
        pointProg = makeProgram(pointVS, pointFS);
        circleProg = makeProgram(circleVS, circleFS);

        quadBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        gl.bufferData(gl.ARRAY_BUFFER,
            new Float32Array([-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);

        const circ = new Float32Array(CIRCLE_SEGS * 2);
        for (let i = 0; i < CIRCLE_SEGS; i++) {
            const a = (i / CIRCLE_SEGS) * TAU;
            circ[i * 2] = Math.cos(a);
            circ[i * 2 + 1] = Math.sin(a);
        }
        circleBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, circleBuf);
        gl.bufferData(gl.ARRAY_BUFFER, circ, gl.STATIC_DRAW);

        beamBuf = gl.createBuffer();
        pointBuf = gl.createBuffer();
        userBuf = gl.createBuffer();

        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
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

    function rebuildBuffers() {
        if (!glReady) return;
        const vis = visibleTowers();

        // beams: 2 verts each — [x, y, z, phase, t]
        const beams = new Float32Array(vis.length * 2 * 5);
        // points: base + top per tower — [x, y, z, size, phase]
        const pts = new Float32Array(vis.length * 2 * 5);

        vis.forEach((t, i) => {
            const h = beamHeight(t);
            const sampleBoost = Math.min(4, Math.log2(1 + (t.samples || 0)) * 0.6);
            let o = i * 10;
            beams[o] = t.wx; beams[o + 1] = t.wy; beams[o + 2] = 0; beams[o + 3] = t.phase; beams[o + 4] = 0;
            beams[o + 5] = t.wx; beams[o + 6] = t.wy; beams[o + 7] = h; beams[o + 8] = t.phase; beams[o + 9] = 1;

            o = i * 10;
            pts[o] = t.wx; pts[o + 1] = t.wy; pts[o + 2] = 0; pts[o + 3] = (5 + sampleBoost); pts[o + 4] = t.phase;
            pts[o + 5] = t.wx; pts[o + 6] = t.wy; pts[o + 7] = h; pts[o + 8] = 3.5; pts[o + 9] = t.phase;
        });

        gl.bindBuffer(gl.ARRAY_BUFFER, beamBuf);
        gl.bufferData(gl.ARRAY_BUFFER, beams, gl.DYNAMIC_DRAW);
        beamVertCount = vis.length * 2;

        gl.bindBuffer(gl.ARRAY_BUFFER, pointBuf);
        gl.bufferData(gl.ARRAY_BUFFER, pts, gl.DYNAMIC_DRAW);
        pointVertCount = vis.length * 2;
    }

    function cameraEye() {
        const ce = Math.cos(camEl), se = Math.sin(camEl);
        return [
            center[0] + camDist * ce * Math.sin(camAz),
            center[1] - camDist * ce * Math.cos(camAz),
            camDist * se,
        ];
    }

    function computeVP() {
        const aspect = canvas.width / Math.max(1, canvas.height);
        const proj = mat4Perspective(0.9, aspect, 10, 80000);
        const view = mat4LookAt(cameraEye(), [center[0], center[1], 0], [0, 0, 1]);
        vpMat = mat4Mul(proj, view);
    }

    function worldToScreen(x, y, z) {
        const m = vpMat;
        const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
        const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
        const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
        if (cw <= 0) return null;
        return [(cx / cw * 0.5 + 0.5) * canvas.width, (1 - (cy / cw * 0.5 + 0.5)) * canvas.height];
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
        if (gl) frameGL(t);
        else if (ctx2d) frame2D(t);
        requestAnimationFrame(frame);
    }

    function frameGL(t) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        computeVP();

        // ground (opaque, writes depth)
        gl.disable(gl.BLEND);
        gl.depthMask(true);
        gl.useProgram(groundProg);
        gl.uniformMatrix4fv(gl.getUniformLocation(groundProg, 'u_vp'), false, vpMat);
        gl.uniform2f(gl.getUniformLocation(groundProg, 'u_target'), center[0], center[1]);
        gl.uniform1f(gl.getUniformLocation(groundProg, 'u_extent'), 20000);
        gl.uniform1f(gl.getUniformLocation(groundProg, 'u_time'), t);
        gl.uniform1f(gl.getUniformLocation(groundProg, 'u_hasUser'), userWorld ? 1 : 0);
        gl.uniform2f(gl.getUniformLocation(groundProg, 'u_user'),
            userWorld ? userWorld[0] : 0, userWorld ? userWorld[1] : 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        const aQ = gl.getAttribLocation(groundProg, 'a_q');
        gl.enableVertexAttribArray(aQ);
        gl.vertexAttribPointer(aQ, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // transparent passes: additive, no depth write
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.depthMask(false);

        // ground circles
        gl.useProgram(circleProg);
        gl.uniformMatrix4fv(gl.getUniformLocation(circleProg, 'u_vp'), false, vpMat);
        gl.bindBuffer(gl.ARRAY_BUFFER, circleBuf);
        const aU = gl.getAttribLocation(circleProg, 'a_unit');
        gl.enableVertexAttribArray(aU);
        gl.vertexAttribPointer(aU, 2, gl.FLOAT, false, 0, 0);

        if ($('f-coverage').checked) {
            for (const tw of visibleTowers()) {
                drawCircle([tw.wx, tw.wy], tw.range, 0.06);
            }
        }
        if (selected) {
            for (let i = 0; i < 3; i++) {
                const p = (t * 0.45 + i / 3) % 1;
                drawCircle([selected.wx, selected.wy], p * selected.range, (1 - p) * 0.7);
            }
        }
        if (userWorld) {
            const p = (t * 0.3) % 1;
            drawCircle(userWorld, p * 400, (1 - p) * 0.4);
        }

        // beams
        if (beamVertCount > 0) {
            gl.useProgram(beamProg);
            gl.uniformMatrix4fv(gl.getUniformLocation(beamProg, 'u_vp'), false, vpMat);
            gl.uniform1f(gl.getUniformLocation(beamProg, 'u_time'), t);
            gl.uniform1f(gl.getUniformLocation(beamProg, 'u_alpha'), 0.5);
            gl.bindBuffer(gl.ARRAY_BUFFER, beamBuf);
            const aP = gl.getAttribLocation(beamProg, 'a_pos');
            const aPh = gl.getAttribLocation(beamProg, 'a_phase');
            const aT = gl.getAttribLocation(beamProg, 'a_t');
            gl.enableVertexAttribArray(aP);
            gl.vertexAttribPointer(aP, 3, gl.FLOAT, false, 20, 0);
            gl.enableVertexAttribArray(aPh);
            gl.vertexAttribPointer(aPh, 1, gl.FLOAT, false, 20, 12);
            gl.enableVertexAttribArray(aT);
            gl.vertexAttribPointer(aT, 1, gl.FLOAT, false, 20, 16);
            gl.drawArrays(gl.LINES, 0, beamVertCount);
        }

        // tower points (base + beacon)
        if (pointVertCount > 0) {
            drawPoints(pointBuf, pointVertCount, t, 0.9);
        }

        // observer
        if (userWorld) {
            gl.bindBuffer(gl.ARRAY_BUFFER, userBuf);
            gl.bufferData(gl.ARRAY_BUFFER,
                new Float32Array([userWorld[0], userWorld[1], 0, 9, 0]), gl.DYNAMIC_DRAW);
            drawPoints(userBuf, 1, t, 1.0);
        }

        gl.depthMask(true);
    }

    function drawPoints(buf, count, t, alpha) {
        gl.useProgram(pointProg);
        gl.uniformMatrix4fv(gl.getUniformLocation(pointProg, 'u_vp'), false, vpMat);
        gl.uniform1f(gl.getUniformLocation(pointProg, 'u_time'), t);
        gl.uniform1f(gl.getUniformLocation(pointProg, 'u_alpha'), alpha);
        gl.uniform1f(gl.getUniformLocation(pointProg, 'u_pscale'), canvas.height * 0.9);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        const aP = gl.getAttribLocation(pointProg, 'a_pos');
        const aS = gl.getAttribLocation(pointProg, 'a_size');
        const aPh = gl.getAttribLocation(pointProg, 'a_phase');
        gl.enableVertexAttribArray(aP);
        gl.vertexAttribPointer(aP, 3, gl.FLOAT, false, 20, 0);
        gl.enableVertexAttribArray(aS);
        gl.vertexAttribPointer(aS, 1, gl.FLOAT, false, 20, 12);
        gl.enableVertexAttribArray(aPh);
        gl.vertexAttribPointer(aPh, 1, gl.FLOAT, false, 20, 16);
        gl.drawArrays(gl.POINTS, 0, count);
    }

    // ── Canvas 2D fallback (top-down) ──
    function frame2D(t) {
        const c = ctx2d, W = canvas.width, H = canvas.height;
        const toX = (wx) => (wx - center[0]) * scale2d + W / 2;
        const toY = (wy) => H / 2 - (wy - center[1]) * scale2d;

        c.fillStyle = '#000';
        c.fillRect(0, 0, W, H);

        drawGrid2D(c, W, H, 250, 'rgba(255,255,255,0.10)');
        drawGrid2D(c, W, H, 1000, 'rgba(255,255,255,0.08)');

        const vis = visibleTowers();
        c.lineWidth = 1;

        if ($('f-coverage').checked) {
            c.strokeStyle = 'rgba(255,255,255,0.07)';
            for (const tw of vis) {
                c.beginPath();
                c.arc(toX(tw.wx), toY(tw.wy), tw.range * scale2d, 0, TAU);
                c.stroke();
            }
        }

        if (selected) {
            for (let i = 0; i < 3; i++) {
                const p = (t * 0.45 + i / 3) % 1;
                c.strokeStyle = `rgba(255,255,255,${(1 - p) * 0.7})`;
                c.beginPath();
                c.arc(toX(selected.wx), toY(selected.wy), p * selected.range * scale2d, 0, TAU);
                c.stroke();
            }
        }

        if (userWorld) {
            const p = (t * 0.3) % 1;
            c.strokeStyle = `rgba(255,255,255,${(1 - p) * 0.4})`;
            c.beginPath();
            c.arc(toX(userWorld[0]), toY(userWorld[1]), p * 400 * scale2d, 0, TAU);
            c.stroke();
        }

        for (const tw of vis) {
            const pulse = 0.75 + 0.25 * Math.sin(t * 2.5 + tw.phase * TAU);
            const x = toX(tw.wx), y = toY(tw.wy);
            const r = (2.5 + Math.min(2, Math.log2(1 + (tw.samples || 0)) * 0.3)) * dpr * pulse;
            c.fillStyle = 'rgba(255,255,255,0.25)';
            c.beginPath(); c.arc(x, y, r * 2.2, 0, TAU); c.fill();
            c.fillStyle = '#fff';
            c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
        }

        if (userWorld) {
            c.fillStyle = '#fff';
            c.beginPath();
            c.arc(toX(userWorld[0]), toY(userWorld[1]), 5 * dpr, 0, TAU);
            c.fill();
        }
    }

    function drawGrid2D(c, W, H, stepM, style) {
        const step = stepM * scale2d;
        if (step < 8) return;
        c.strokeStyle = style;
        c.lineWidth = 1;
        const x0 = ((W / 2 - center[0] * scale2d) % step + step) % step;
        for (let x = x0; x < W; x += step) {
            c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke();
        }
        const y0 = ((H / 2 + center[1] * scale2d) % step + step) % step;
        for (let y = y0; y < H; y += step) {
            c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
        }
    }

    // ══════════════════════════════════════════
    //  Interaction
    // ══════════════════════════════════════════
    let dragging = false, dragMode = 'orbit', moved = false, lastXY = null, pinchDist = null;

    canvas.addEventListener('pointerdown', (e) => {
        dragging = true;
        moved = false;
        dragMode = (e.shiftKey || !gl) ? 'pan' : 'orbit';
        lastXY = [e.clientX, e.clientY];
        canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - lastXY[0], dy = e.clientY - lastXY[1];
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;

        if (gl) {
            if (dragMode === 'orbit') {
                camAz += dx * 0.005;
                camEl = Math.min(1.5, Math.max(0.15, camEl + dy * 0.005));
            } else {
                // pan along camera-aligned ground axes
                const k = camDist / canvas.clientHeight * 1.4;
                const right = [Math.cos(camAz), Math.sin(camAz)];
                const fwd = [-Math.sin(camAz), Math.cos(camAz)];
                center[0] += (-dx * right[0] + dy * fwd[0]) * k;
                center[1] += (-dx * right[1] + dy * fwd[1]) * k;
            }
        } else {
            center[0] -= dx * dpr / scale2d;
            center[1] += dy * dpr / scale2d;
        }
        lastXY = [e.clientX, e.clientY];
    });

    canvas.addEventListener('pointerup', (e) => {
        dragging = false;
        if (!moved) pick(e.clientX, e.clientY);
    });

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (gl) {
            camDist = Math.min(30000, Math.max(300, camDist * Math.exp(e.deltaY * 0.0012)));
        } else {
            scale2d = Math.min(8, Math.max(0.01, scale2d * Math.exp(-e.deltaY * 0.0012)));
        }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            const d = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY);
            if (pinchDist) {
                const f = d / pinchDist;
                if (gl) camDist = Math.min(30000, Math.max(300, camDist / f));
                else scale2d = Math.min(8, Math.max(0.01, scale2d * f));
            }
            pinchDist = d;
        }
    }, { passive: false });
    canvas.addEventListener('touchend', () => { pinchDist = null; });

    function pick(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const px = (clientX - rect.left) * dpr;
        const py = (clientY - rect.top) * dpr;
        let best = null, bestD = 18 * dpr;

        if (gl && vpMat) {
            for (const t of visibleTowers()) {
                for (const z of [0, beamHeight(t)]) {
                    const s = worldToScreen(t.wx, t.wy, z);
                    if (!s) continue;
                    const d = Math.hypot(s[0] - px, s[1] - py);
                    if (d < bestD) { bestD = d; best = t; }
                }
            }
        } else {
            const wx = (px - canvas.width / 2) / scale2d + center[0];
            const wy = (canvas.height / 2 - py) / scale2d + center[1];
            const maxM = 18 * dpr / scale2d;
            let bd = maxM;
            for (const t of visibleTowers()) {
                const d = Math.hypot(t.wx - wx, t.wy - wy);
                if (d < bd) { bd = d; best = t; }
            }
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
            const data = await fetchJSON(url);
            towers = (data.cells || []).map(parseCell);
            onTowersLoaded();
            setStatus(`${towers.length} towers registered`);
        } catch (e) {
            console.error(e);
            if (e.status === 403) setStatus('Invalid API key');
            else if (e.status) setStatus(`Error ${e.status}`);
            else setStatus('Connection failed');
        }
    }

    // Direct fetch first; if blocked by CORS/network, retry through a proxy.
    async function fetchJSON(url) {
        try {
            const r = await fetch(url);
            if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
            return await r.json();
        } catch (e) {
            if (e.status) throw e;
            const r = await fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(url));
            if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
            return await r.json();
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
            const angle = Math.random() * TAU;
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
        rebuildBuffers();
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
            origin = null;
            if (watchId !== null) navigator.geolocation.clearWatch(watchId);
            startLocation();
            return;
        }
        started = true;
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
            camDist = 4200;
            scale2d = 0.15;
        }
    });

    $('detail-close').addEventListener('click', (e) => {
        e.preventDefault();
        selectTower(null);
    });

    ['f-5g', 'f-4g', 'f-3g', 'f-2g'].forEach((id) => {
        $(id).addEventListener('change', () => {
            if (selected && !$('f-' + selected.tech.toLowerCase()).checked) selectTower(null);
            rebuildBuffers();
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

    // The latent map renders from the first frame — access only adds data.
    initGL();
    if (gl || ctx2d) startLoop();

})();
