
        import * as THREE from 'three';
        import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
        import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
        import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

        // --- SYNTH AUDIO ENGINE (Procedural 8-bit sounds) ---
        class SynthAudio {
            constructor() {
                this.ctx = null;
                this.enabled = true;
            }
            init() {
                if(!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
                if(this.ctx.state === 'suspended') this.ctx.resume();
            }
            playTone(freq, type, duration, vol=0.1, slideFreq=null) {
                if(!this.enabled || !this.ctx) return;
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = type;
                osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
                if(slideFreq) osc.frequency.exponentialRampToValueAtTime(slideFreq, this.ctx.currentTime + duration);
                
                gain.gain.setValueAtTime(vol, this.ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
                
                osc.connect(gain);
                gain.connect(this.ctx.destination);
                osc.start();
                osc.stop(this.ctx.currentTime + duration);
            }
            playNoise(duration, vol=0.2) {
                if(!this.enabled || !this.ctx) return;
                const bufferSize = this.ctx.sampleRate * duration;
                const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
                const noise = this.ctx.createBufferSource();
                noise.buffer = buffer;
                const filter = this.ctx.createBiquadFilter();
                filter.type = 'lowpass'; filter.frequency.value = 1000;
                const gain = this.ctx.createGain();
                gain.gain.setValueAtTime(vol, this.ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
                noise.connect(filter); filter.connect(gain); gain.connect(this.ctx.destination);
                noise.start();
            }
            coin() { this.playTone(880, 'square', 0.1, 0.1, 1200); }
            shoot() { this.playTone(600, 'sawtooth', 0.15, 0.1, 100); }
            explosion() { this.playNoise(0.4, 0.3); this.playTone(100, 'square', 0.4, 0.2, 20); }
            powerup() { this.playTone(400, 'sine', 0.3, 0.1, 800); setTimeout(()=>this.playTone(600, 'sine', 0.3, 0.1, 1200), 100); }
            crash() { this.playNoise(0.8, 0.5); this.playTone(150, 'sawtooth', 0.8, 0.3, 30); }
        }
        const audio = new SynthAudio();

        // --- GLOBAL VARIABLES & CONFIG ---
        const cfg = {
            laneWidth: 16,
            baseSpeed: 1.0, // Z-speed
            playerSpeedX: 0.5,
            colors: { bg: 0x020005, cyan: 0x00ffff, magenta: 0xff00ff, yellow: 0xffff00, red: 0xff1133, green: 0x00ff00, white: 0xffffff },
            fov: 75,
            powerDuration: 8.0
        };

        let scene, camera, renderer, composer;
        let playerGroup, bikeChassis, bikeNeonMats = [];
        let gridHelper, sun;
        
        // Game State
        let state = {
            isPlaying: false, isPaused: false, score: 0, coins: 0, speedMult: 1.0, currentSpeed: cfg.baseSpeed,
            targetX: 0, frameCount: 0, isImmune: false, immuneTimer: 0, canShoot: false, shootTimer: 0,
            cameraShake: 0
        };
        const keys = { Left: false, Right: false, Space: false };

        // DOM Elements
        const DOM = {
            hud: document.getElementById('ui-hud'), menu: document.getElementById('ui-menu'),
            gameover: document.getElementById('ui-gameover'), pause: document.getElementById('ui-pause'),
            settings: document.getElementById('ui-settings'),
            score: document.getElementById('score-display'), coin: document.getElementById('coin-display'),
            speed: document.getElementById('speed-display'), goScore: document.getElementById('go-score'),
            goCoins: document.getElementById('go-coins'),
            hudShield: document.getElementById('hud-shield'), barShield: document.getElementById('bar-shield'),
            hudLaser: document.getElementById('hud-laser'), barLaser: document.getElementById('bar-laser'),
            touch: document.getElementById('touch-controls')
        };

        // --- OBJECT POOLING SYSTEM ---
        class ObjectPool {
            constructor(createFn, size) {
                this.pool = []; this.createFn = createFn;
                for(let i=0; i<size; i++) {
                    let obj = this.createFn(); obj.visible = false; obj.userData.active = false;
                    scene.add(obj); this.pool.push(obj);
                }
            }
            get() {
                let obj = this.pool.find(o => !o.userData.active);
                if(!obj) { obj = this.createFn(); scene.add(obj); this.pool.push(obj); } // Expand if needed
                obj.userData.active = true; obj.visible = true; return obj;
            }
            release(obj) { obj.userData.active = false; obj.visible = false; }
            releaseAll() { this.pool.forEach(o => this.release(o)); }
            getActive() { return this.pool.filter(o => o.userData.active); }
        }

        let pools = {};

        // --- INITIALIZATION ---
        function init() {
            // Renderer
            renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Limit pixel ratio for performance
            renderer.toneMapping = THREE.ReinhardToneMapping;
            renderer.toneMappingExposure = 1.5;
            document.body.insertBefore(renderer.domElement, document.querySelector('.vignette'));

            // Scene & Camera
            scene = new THREE.Scene();
            scene.background = new THREE.Color(cfg.colors.bg);
            scene.fog = new THREE.FogExp2(cfg.colors.bg, 0.006); // Thicker fog to hide pop-ins

            camera = new THREE.PerspectiveCamera(cfg.fov, window.innerWidth / window.innerHeight, 0.1, 400);
            
            // Post-Processing (Bloom)
            const renderScene = new RenderPass(scene, camera);
            const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.6, 0.5, 0.2); // Strength, radius, threshold
            composer = new EffectComposer(renderer);
            composer.addPass(renderScene);
            composer.addPass(bloomPass);

            setupLights();
            setupEnvironment();
            setupPlayer();
            initPools();

            // Event Listeners
            window.addEventListener('resize', onWindowResize);
            document.addEventListener('keydown', e => handleKey(e, true));
            document.addEventListener('keyup', e => handleKey(e, false));
            
            // UI Listeners
            document.getElementById('btn-start').addEventListener('click', startGame);
            document.getElementById('btn-restart').addEventListener('click', startGame);
            document.getElementById('btn-pause').addEventListener('click', togglePause);
            document.getElementById('btn-resume').addEventListener('click', togglePause);
            document.getElementById('btn-quit').addEventListener('click', quitToMenu);
            
            // Settings
            document.getElementById('btn-settings').addEventListener('click', () => DOM.settings.classList.remove('hide'));
            document.getElementById('btn-close-settings').addEventListener('click', () => DOM.settings.classList.add('hide'));
            const btnAudio = document.getElementById('btn-toggle-audio');
            btnAudio.addEventListener('click', () => {
                audio.enabled = !audio.enabled;
                btnAudio.innerText = audio.enabled ? "ON" : "OFF";
                btnAudio.style.color = audio.enabled ? "#0ff" : "#f00";
            });

            // Touch
            if (navigator.maxTouchPoints > 0) DOM.touch.style.display = 'block';
            const bindTouch = (id, key) => {
                const el = document.getElementById(id);
                el.addEventListener('touchstart', e => { e.preventDefault(); keys[key] = true; if(key==='Space')fireLaser(); }, {passive:false});
                el.addEventListener('touchend', e => { e.preventDefault(); keys[key] = false; }, {passive:false});
                el.addEventListener('touchcancel',()=>{keys[key]=false;});
            };
            bindTouch('zone-left', 'Left'); bindTouch('zone-right', 'Right'); bindTouch('zone-top', 'Space');

            animate();
        }

        function setupLights() {
            scene.add(new THREE.HemisphereLight(cfg.colors.magenta, cfg.colors.cyan, 0.3));
            const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
            dirLight.position.set(0, 20, 10);
            scene.add(dirLight);
        }

        function createSynthwaveSun() {
            const canvas = document.createElement('canvas');
            canvas.width = 1024;
            canvas.height = 1024;
            const ctx = canvas.getContext('2d');

            const cx = 512, cy = 512, r = 500;

            // Gradiente espectacular de atardecer
            const grad = ctx.createLinearGradient(0, cy - r, 0, cy + r);
            grad.addColorStop(0.1, '#fffbc4'); // Amarillo brillante
            grad.addColorStop(0.4, '#ffaa00'); // Naranja
            grad.addColorStop(0.7, '#ff0055'); // Rosa neón
            grad.addColorStop(1.0, '#440088'); // Morado oscuro

            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fill();

            // Cortes horizontales estilo Synthwave (usando Canvas composite)
            ctx.globalCompositeOperation = 'destination-out';
            
            const numLines = 25;
            let startY = cy - 20; 
            
            for (let i = 0; i < numLines; i++) {
                const height = 2 + (i * i * 0.08); // Las líneas se hacen más gruesas hacia abajo
                const gap = 8 + (i * 1.5); // La separación aumenta gradualmente
                
                if (startY < 1024) {
                    ctx.fillRect(0, startY, 1024, height);
                }
                startY += height + gap;
            }

            const texture = new THREE.CanvasTexture(canvas);
            texture.anisotropy = 16;
            return texture;
        }

        function setupEnvironment() {
            // Infinite Grid
            const gridGeo = new THREE.PlaneGeometry(400, 400, 80, 80);
            const gridMat = new THREE.MeshBasicMaterial({ color: cfg.colors.magenta, wireframe: true, transparent: true, opacity: 0.2 });
            gridHelper = new THREE.Mesh(gridGeo, gridMat);
            gridHelper.rotation.x = -Math.PI / 2;
            scene.add(gridHelper);

            // Nuevo Sol Synthwave usando la Textura generada por Canvas
            const sunTex = createSynthwaveSun();
            const sunMat = new THREE.MeshBasicMaterial({ 
                map: sunTex, 
                color: 0xffffff, 
                fog: false,
                transparent: true,
                side: THREE.DoubleSide
            });
            const sunGeo = new THREE.PlaneGeometry(280, 280);
            sun = new THREE.Mesh(sunGeo, sunMat);
            sun.position.set(0, 70, -350); // Más al fondo y elevado para una vista imponente
            sun.renderOrder = -1; // Garantiza que se renderice detrás de las montañas y la niebla
            scene.add(sun);
        }

        function setupPlayer() {
            playerGroup = new THREE.Group();
            
            const darkMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9, metalness: 0.5 });
            const neonMat = new THREE.MeshStandardMaterial({ color: cfg.colors.cyan, emissive: cfg.colors.cyan, emissiveIntensity: 2.0 });
            bikeNeonMats.push(neonMat);

            // Sleeker Tron Bike
            bikeChassis = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 3.2), darkMat);
            bikeChassis.position.y = 0.8;
            playerGroup.add(bikeChassis);

            const neonLine = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.1, 2.8), neonMat);
            neonLine.position.y = 0.9;
            playerGroup.add(neonLine);

            const createWheel = (z) => {
                const w = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.3, 24), darkMat);
                w.rotation.z = Math.PI / 2; w.position.set(0, 0.7, z);
                const rim = new THREE.Mesh(new THREE.TorusGeometry(0.71, 0.05, 8, 32), neonMat);
                rim.rotation.x = Math.PI / 2; w.add(rim);
                return w;
            };
            playerGroup.add(createWheel(-1.5)); // Front
            playerGroup.add(createWheel(1.5));  // Back

            // Point Light under bike
            const pLight = new THREE.PointLight(cfg.colors.cyan, 2.0, 10);
            pLight.position.set(0, 0.5, 0);
            playerGroup.add(pLight);
            bikeNeonMats.push(pLight); // Store light to change color later

            scene.add(playerGroup);
        }

        function setBikeColor(hex) {
            bikeNeonMats.forEach(m => {
                if(m.isMaterial) { m.color.setHex(hex); m.emissive.setHex(hex); }
                if(m.isLight) m.color.setHex(hex);
            });
        }

        function initPools() {
            // Obstacles (Red Cubes)
            pools.obstacles = new ObjectPool(() => {
                const m = new THREE.Mesh(
                    new THREE.BoxGeometry(1.5, 1.5, 1.5),
                    new THREE.MeshStandardMaterial({ color: cfg.colors.red, emissive: cfg.colors.red, emissiveIntensity: 1.5 })
                );
                m.userData.w = 1.5; m.userData.d = 1.5; return m;
            }, 30);

            // Coins
            pools.coins = new ObjectPool(() => {
                const m = new THREE.Mesh(
                    new THREE.TorusGeometry(0.6, 0.15, 8, 16),
                    new THREE.MeshStandardMaterial({ color: cfg.colors.yellow, emissive: 0xaa8800, emissiveIntensity: 1.0 })
                );
                m.userData.w = 1.2; m.userData.d = 1.2; return m;
            }, 20);

            // Powerups (Dodecahedron/Octahedron)
            pools.powerups = new ObjectPool(() => {
                const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.8), new THREE.MeshStandardMaterial());
                m.userData.w = 1.6; m.userData.d = 1.6; return m;
            }, 5);

            // Lasers
            pools.lasers = new ObjectPool(() => {
                const m = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.1, 0.1, 4.0, 8),
                    new THREE.MeshBasicMaterial({ color: cfg.colors.green })
                );
                m.rotation.x = Math.PI / 2;
                m.userData.w = 0.5; m.userData.d = 4.0; return m;
            }, 10);

            // Particles (Explosions/Trail)
            pools.particles = new ObjectPool(() => {
                const m = new THREE.Mesh(
                    new THREE.BoxGeometry(0.2, 0.2, 0.2),
                    new THREE.MeshBasicMaterial({ color: 0xffffff })
                );
                return m;
            }, 100);

            // Mountains
            pools.mountains = new ObjectPool(() => {
                const geom = new THREE.ConeGeometry(20, 40, 4);
                const mat = new THREE.MeshBasicMaterial({ color: cfg.colors.cyan, wireframe: true, transparent: true, opacity: 0.15 });
                return new THREE.Mesh(geom, mat);
            }, 20);

            // Pre-spawn mountains
            for(let i=0; i<15; i++) spawnMountain((Math.random() * -300));
        }

        // --- GAME MECHANICS & LOGIC ---

        function spawnMountain(zPos) {
            const m = pools.mountains.get();
            const isLeft = Math.random() > 0.5;
            const xPos = (isLeft ? -1 : 1) * (40 + Math.random() * 40);
            const scale = 0.8 + Math.random() * 1.5;
            
            m.scale.set(scale, scale, scale);
            m.position.set(xPos, 20 * scale - 5, zPos);
            m.rotation.y = Math.PI / 4;
            m.material.color.setHex(Math.random() > 0.5 ? cfg.colors.magenta : cfg.colors.cyan);
        }

        function createExplosion(pos, colorHex, count=10) {
            for(let i=0; i<count; i++) {
                const p = pools.particles.get();
                if(!p) break;
                p.position.copy(pos);
                p.material.color.setHex(colorHex);
                p.userData.vx = (Math.random() - 0.5) * 0.8;
                p.userData.vy = Math.random() * 0.8 + 0.2;
                p.userData.vz = (Math.random() - 0.5) * 0.8;
                p.userData.life = 1.0;
            }
        }

        function spawnTrail() {
            const p = pools.particles.get();
            if(p) {
                p.position.set(playerGroup.position.x, 0.5, playerGroup.position.z + 1.5);
                p.material.color.setHex(state.isImmune ? cfg.colors.white : (state.canShoot ? cfg.colors.green : cfg.colors.cyan));
                p.userData.vx = 0; p.userData.vy = 0; p.userData.vz = state.currentSpeed;
                p.userData.life = 0.5;
            }
        }

        // Fast 2D AABB Collision (X and Z axis)
        function checkCol(a, aW, aD, b, bW, bD) {
            return Math.abs(a.position.x - b.position.x) < (aW + bW)/2 &&
                   Math.abs(a.position.z - b.position.z) < (aD + bD)/2;
        }

        function updateHUD() {
            DOM.score.innerText = Math.floor(state.score).toString().padStart(6, '0');
            DOM.coin.innerText = state.coins;
            DOM.speed.innerText = state.speedMult.toFixed(1);
        }

        // --- MAIN LOOP ---
        function onWindowResize() {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
            composer.setSize(window.innerWidth, window.innerHeight);
        }

// Las reglas se ejecutan en Python; este módulo conserva la escena original de Gemini.
let token = null, secuencia = 0, ultimoEvento = 0, ultimoEstado = null;
let recibidoEn = 0, medioViaje = 0, enviando = false, disparoPendiente = false;
let pausaPendiente = null, sesionPerdida = false, finTimer = null, generacion = 0, iniciando = false;
const mallasServidor = new Map();
const aviso = document.getElementById('connection-status');
const shieldGeometry = new THREE.DodecahedronGeometry(0.8);
const laserGeometry = new THREE.OctahedronGeometry(0.8);

function conexion(texto, ok = true) {
    aviso.textContent = texto;
    aviso.dataset.estado = ok ? 'lista' : 'error';
    aviso.style.color = ok ? '#8ef5dc' : '#ffbf80';
}

async function peticion(ruta, datos) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6500);
    const inicio = performance.now();
    try {
        const respuesta = await fetch(ruta, {
            method: 'POST', headers: {'Content-Type':'application/json', 'X-Game-Session':token || ''},
            body: JSON.stringify(datos), signal: controller.signal
        });
        const contenido = await respuesta.json();
        medioViaje = Math.min(0.15, (performance.now() - inicio) / 2000);
        if (!respuesta.ok) {
            if (respuesta.status === 404) sesionPerdida = true;
            throw new Error(contenido.error || 'No se pudo conectar');
        }
        return contenido;
    } finally { clearTimeout(timeout); }
}

function actualizarRanking(registros) {
    const lista = document.getElementById('ranking-list');
    lista.replaceChildren();
    if (!registros?.length) {
        const li = document.createElement('li'); li.textContent = 'Tu próxima partida puede ser la primera marca.'; lista.appendChild(li);
    }
    (registros || []).forEach((r, i) => {
        const li = document.createElement('li');
        const nombre = document.createElement('span'); nombre.textContent = `${i + 1}. ${r.alias}`;
        const puntos = document.createElement('strong'); puntos.textContent = r.puntaje.toLocaleString('es');
        li.append(nombre, puntos); lista.appendChild(li);
    });
}

function sincronizar(datos) {
    ultimoEstado = datos.estado; recibidoEn = performance.now();
    state.score = ultimoEstado.puntaje; state.coins = ultimoEstado.monedas;
    state.speedMult = ultimoEstado.multiplicador;
    state.currentSpeed = ultimoEstado.velocidad / 60;
    state.isImmune = ultimoEstado.escudo > 0; state.canShoot = ultimoEstado.laser > 0;
    state.immuneTimer = ultimoEstado.escudo; state.shootTimer = ultimoEstado.laser;
    ultimoEstado.eventos.forEach(e => {
        if (e.id <= ultimoEvento) return;
        ultimoEvento = e.id;
        const posicion = new THREE.Vector3(e.x, 1, e.z);
        if (e.tipo === 'coin') { audio.coin(); createExplosion(posicion, cfg.colors.yellow, 3); }
        if (e.tipo === 'power') { audio.powerup(); createExplosion(posicion, e.poder === 'shield' ? cfg.colors.white : cfg.colors.green, 5); }
        if (e.tipo === 'shoot') { audio.shoot(); state.cameraShake = 0.12; }
        if (e.tipo === 'explosion') { audio.explosion(); createExplosion(posicion, cfg.colors.red, 8); state.cameraShake = 0.25; }
    });
    conexion('En línea');
    if (datos.ranking) actualizarRanking(datos.ranking);
    if (ultimoEstado.terminada && state.isPlaying) gameOver();
    updateHUD();
}

async function tickRed() {
    if (token && !enviando && state.isPlaying && (!state.isPaused || pausaPendiente !== null)) {
        enviando = true;
        const pausa = pausaPendiente;
        const disparar = disparoPendiente; disparoPendiente = false;
        const actualToken = token;
        const entrada = {secuencia: ++secuencia, direccion: Number(keys.Right) - Number(keys.Left),
            disparar, desde_evento: ultimoEvento};
        if (pausa !== null) entrada.pausa = pausa;
        try {
            const datos = await peticion('/api/avanzar', entrada);
            if (token === actualToken) {
                if (pausaPendiente === pausa) pausaPendiente = null;
                sincronizar(datos);
            }
        } catch (error) {
            if (token === actualToken) {
                pausaPendiente = null;
                keys.Left = keys.Right = keys.Space = false;
                state.isPaused = true; DOM.pause.classList.remove('hide');
                document.getElementById('pause-title').textContent = sesionPerdida ? 'SESIÓN FINALIZADA' : 'SIN CONEXIÓN';
                document.getElementById('btn-resume').textContent = sesionPerdida ? 'NUEVA PARTIDA' : 'REINTENTAR';
                conexion(error.message || 'Conexión interrumpida', false);
            }
        } finally { enviando = false; }
    }
    setTimeout(tickRed, 120);
}

async function startGame() {
    if (enviando || iniciando) return;
    iniciando = true;
    const boton = document.getElementById('btn-start'), reinicio = document.getElementById('btn-restart');
    boton.disabled = reinicio.disabled = true;
    conexion('Conectando…');
    try {
        audio.init(); clearTimeout(finTimer); generacion++;
        const datos = await peticion('/api/iniciar', {alias:document.getElementById('pilot-name').value || 'Piloto'});
        token = datos.sesion; secuencia = 0; ultimoEvento = 0;
        pausaPendiente = null; sesionPerdida = false; disparoPendiente = false;
        keys.Left = keys.Right = keys.Space = false;
        DOM.menu.classList.add('hide'); DOM.gameover.classList.add('hide'); DOM.pause.classList.add('hide');
        DOM.hud.classList.remove('hide'); state.targetX = 0; state.frameCount = 0;
        state.isPlaying = true; state.isPaused = false; state.cameraShake = 0;
        playerGroup.position.set(0,0,0); playerGroup.rotation.set(0,0,0);
        Object.keys(pools).forEach(k => { if (k !== 'mountains') pools[k].releaseAll(); });
        mallasServidor.clear(); setBikeColor(cfg.colors.cyan); sincronizar(datos);
    } catch (error) { conexion('No se pudo iniciar. Reintenta en unos segundos.', false); }
    finally { boton.disabled = reinicio.disabled = false; iniciando = false; }
}

function gameOver() {
    state.isPlaying = false; state.isPaused = false;
    audio.crash(); setBikeColor(cfg.colors.red); state.cameraShake = 2;
    createExplosion(playerGroup.position, cfg.colors.red, 30);
    const partidaActual = generacion;
    finTimer = setTimeout(() => {
        if (partidaActual !== generacion) return;
        DOM.hud.classList.add('hide'); DOM.gameover.classList.remove('hide');
        DOM.goScore.textContent = Math.floor(state.score); DOM.goCoins.textContent = state.coins;
    }, 700);
}

function togglePause() {
    if (sesionPerdida) { startGame(); return; }
    if (!state.isPlaying) return;
    state.isPaused = !state.isPaused; pausaPendiente = state.isPaused;
    keys.Left = keys.Right = keys.Space = false;
    DOM.pause.classList.toggle('hide', !state.isPaused);
    document.getElementById('pause-title').textContent = 'PAUSA';
    document.getElementById('btn-resume').textContent = 'CONTINUAR';
}

function quitToMenu() {
    const anterior = token; token = null; generacion++; clearTimeout(finTimer);
    state.isPlaying = false; state.isPaused = false; ultimoEstado = null;
    keys.Left = keys.Right = keys.Space = false;
    DOM.pause.classList.add('hide'); DOM.hud.classList.add('hide'); DOM.gameover.classList.add('hide');
    DOM.menu.classList.remove('hide');
    Object.keys(pools).forEach(k => { if (k !== 'mountains') pools[k].releaseAll(); });
    mallasServidor.clear(); setBikeColor(cfg.colors.cyan);
    if (anterior) fetch('/api/abandonar', {method:'POST',headers:{'X-Game-Session':anterior}}).catch(()=>{});
}

function handleKey(e, isDown) {
    if (document.activeElement?.tagName === 'INPUT') return;
    if (['ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.Left = isDown;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.Right = isDown;
    if (e.code === 'Space') { if (isDown && !keys.Space) fireLaser(); keys.Space = isDown; }
    if ((e.code === 'Escape' || e.code === 'KeyP') && isDown && !e.repeat) togglePause();
}

function fireLaser() {
    if (state.isPlaying && !state.isPaused && state.canShoot) disparoPendiente = true;
}

function representarObjetos() {
    if (!ultimoEstado) return;
    const edad = state.isPaused || !state.isPlaying ? 0 : Math.min(0.24, (performance.now() - recibidoEn) / 1000 + medioViaje);
    const vigentes = new Set();
    for (const entidad of [...ultimoEstado.objetos, ...ultimoEstado.proyectiles]) {
        vigentes.add(entidad.id);
        let registro = mallasServidor.get(entidad.id);
        if (!registro) {
            const categoria = {obstacle:'obstacles',coin:'coins',bullet:'lasers',shield:'powerups',laser:'powerups'}[entidad.tipo];
            const malla = pools[categoria].get();
            if (entidad.tipo === 'shield' || entidad.tipo === 'laser') {
                malla.geometry = entidad.tipo === 'shield' ? shieldGeometry : laserGeometry;
                const color = entidad.tipo === 'shield' ? cfg.colors.white : cfg.colors.green;
                malla.material.color.setHex(color); malla.material.emissive.setHex(color); malla.material.emissiveIntensity = 2;
            }
            registro = {malla, categoria}; mallasServidor.set(entidad.id, registro);
        }
        const m = registro.malla;
        const z = entidad.z + (entidad.tipo === 'bullet' ? -180 : ultimoEstado.velocidad) * edad;
        m.position.set(entidad.x, entidad.tipo === 'obstacle' ? 0.75 : entidad.tipo === 'coin' ? 1.2 : 1.0, z);
        if (entidad.tipo === 'coin') m.rotation.y += 0.06;
        if (entidad.tipo === 'shield' || entidad.tipo === 'laser') {m.rotation.x += 0.025;m.rotation.y += 0.025;}
    }
    for (const [id, registro] of mallasServidor) {
        if (!vigentes.has(id)) { pools[registro.categoria].release(registro.malla); mallasServidor.delete(id); }
    }
}

let instanteAnterior = performance.now(), rastroAcumulado = 0;
function animate() {
    requestAnimationFrame(animate);
    const ahora = performance.now(), dt = Math.min(0.05, (ahora - instanteAnterior) / 1000);
    instanteAnterior = ahora; const frames = dt * 60, time = ahora * 0.001;
    if (state.isPlaying && !state.isPaused) {
        state.targetX = THREE.MathUtils.clamp(state.targetX + (Number(keys.Right)-Number(keys.Left))*30*dt, -8, 8);
        if (!keys.Left && !keys.Right && ultimoEstado) state.targetX = THREE.MathUtils.lerp(state.targetX, ultimoEstado.objetivo_x, 0.07);
        playerGroup.position.x = THREE.MathUtils.lerp(playerGroup.position.x, state.targetX, 1-Math.exp(-9.75*dt));
        playerGroup.position.y = 0;
        const tilt = (state.targetX-playerGroup.position.x)*0.15;
        playerGroup.rotation.z = THREE.MathUtils.lerp(playerGroup.rotation.z,-tilt,0.2);
        playerGroup.rotation.y = THREE.MathUtils.lerp(playerGroup.rotation.y,-tilt*0.5,0.2);
        playerGroup.children[2].rotation.x -= state.currentSpeed*frames;
        playerGroup.children[3].rotation.x -= state.currentSpeed*frames;
        gridHelper.position.z = (gridHelper.position.z+state.currentSpeed*frames)%10;
        pools.mountains.getActive().forEach(m=>{m.position.z+=state.currentSpeed*frames*0.8;if(m.position.z>50){pools.mountains.release(m);spawnMountain(-300);}});
        rastroAcumulado += dt;
        if (rastroAcumulado > 0.05) { spawnTrail(); rastroAcumulado = 0; }
        const edad = Math.min(0.25,(ahora-recibidoEn)/1000);
        const escudo = Math.max(0,state.immuneTimer-edad), laser = Math.max(0,state.shootTimer-edad);
        DOM.hudShield.classList.toggle('hide',escudo<=0); DOM.hudLaser.classList.toggle('hide',laser<=0);
        DOM.barShield.style.width = `${escudo/cfg.powerDuration*100}%`;
        DOM.barLaser.style.width = `${laser/cfg.powerDuration*100}%`;
        setBikeColor(escudo>0?cfg.colors.white:laser>0?cfg.colors.green:cfg.colors.cyan);
        camera.position.x = THREE.MathUtils.lerp(camera.position.x,playerGroup.position.x*0.4,0.1);
        camera.fov = THREE.MathUtils.lerp(camera.fov,Math.min(105,cfg.fov+(state.speedMult-1)*15),0.1);
        camera.updateProjectionMatrix();
    } else if (!state.isPlaying && !DOM.menu.classList.contains('hide')) {
        gridHelper.position.z = (gridHelper.position.z+0.1*frames)%10;
        playerGroup.position.y = Math.sin(time*2)*0.2;
        camera.position.x = Math.sin(time*0.5)*5;
    }
    if (!state.isPaused) {
        representarObjetos();
        pools.particles.getActive().forEach(p=>{
            p.position.x+=p.userData.vx*frames;p.position.y+=p.userData.vy*frames;p.position.z+=p.userData.vz*frames;
            p.userData.vy-=0.02*frames;p.scale.setScalar(Math.max(0,p.userData.life));p.userData.life-=0.03*frames;
            if(p.userData.life<=0)pools.particles.release(p);
        });
    }
    if (state.cameraShake>0.01) {
        camera.position.x+=(Math.random()-0.5)*state.cameraShake;
        camera.position.y+=(Math.random()-0.5)*state.cameraShake;state.cameraShake*=0.9;
    } else {state.cameraShake=0;camera.position.y=THREE.MathUtils.lerp(camera.position.y,4,0.1);}
    camera.position.z=8;camera.lookAt(playerGroup.position.x*0.2,1,-20);composer.render();
}

document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.isPlaying&&!state.isPaused)togglePause();});
window.addEventListener('blur',()=>{keys.Left=keys.Right=keys.Space=false;});
window.addEventListener('error',()=>conexion('No se pudo cargar un recurso. Recarga la página.',false));
window.addEventListener('load',()=>{
    tickRed();
    fetch('/api/info').then(r=>{if(!r.ok)throw Error();return r.json();}).then(()=>conexion('En línea')).catch(()=>conexion('Sin conexión',false));
    fetch('/api/ranking').then(r=>r.json()).then(d=>actualizarRanking(d.ranking)).catch(()=>{});
});

        // Start
        window.onload = init;
    