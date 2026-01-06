document.addEventListener('DOMContentLoaded', () => {
    // === State & Constants ===
    const state = {
        screen: 'home',
        running: false,
        t: 0,
        temp: { val: 25, noise: false, history: new Array(50).fill(0), particles: [] },
        ctrl: { input: 0, output: 0, rpm: 0, angle: 0, historyIn: new Array(100).fill(0), particles: [], windParticles: [] },
        int:  { mode: 'polling', isrLen: 10, events: [], cursor: 0, isrActive: false },
        dl:   { max: 100, current: 0, load: 30, status: 'idle' },
        mem:  { stack: 1, heap: 0, crashed: false }
    };

    const C = {
        primary: '#6c5ce7', secondary: '#00cec9', secondaryGlow: '#00cec9',
        accent: '#ff0055', accentGlow: '#ff0055', danger: '#ff7675', 
        grid: 'rgba(255, 255, 255, 0.1)', text: '#2d3436'
    };

    function loop() {
        if (state.running) {
            state.t++;
            updateLogic();
        }
        draw();
        requestAnimationFrame(loop);
    }
    
    function updateLogic() {
        // Temp
        // TMP36-like characteristic: 0.5V at 0C, 10mV/C.
        // V = 0.5 + T * 0.01
        let rawV = 0.5 + (state.temp.val * 0.01);
        
        if (state.temp.noise) rawV += (Math.random() - 0.5) * 0.1;
        // Clamp to 0-3.3V (ADC range)
        rawV = Math.max(0, Math.min(3.3, rawV));
        state.temp.history.push(rawV); state.temp.history.shift();

        // Control
        const targetRpm = state.ctrl.input * 0.5;
        state.ctrl.rpm += (targetRpm - state.ctrl.rpm) * 0.05;
        state.ctrl.angle += state.ctrl.rpm;
        state.ctrl.output = Math.abs(state.ctrl.input);
        
        // Interrupt
        state.int.cursor = (state.int.cursor + 2) % 800;
        const triggerX = state.int.cursor;
        state.int.events = state.int.events.filter(e => e.x > state.int.cursor - 800);
        const activeEvt = state.int.events.find(e => e.state === 'running');
        if (activeEvt) {
            if (state.int.cursor >= activeEvt.endX) { activeEvt.state = 'done'; state.int.isrActive = false; }
        } else {
            state.int.events.forEach(e => {
                if (e.state === 'pending') {
                    if (state.int.mode === 'interrupt') {
                        if (triggerX >= e.startX) { e.state = 'running'; e.endX = e.startX + (state.int.isrLen * 4); state.int.isrActive = true; }
                    } else {
                        if (triggerX % 200 < 5 && triggerX >= e.startX) { e.state = 'running'; e.endX = triggerX + (state.int.isrLen * 4); state.int.isrActive = true; }
                    }
                }
            });
        }
        // Deadline
        if (state.dl.status === 'running') {
            state.dl.current += 1;
            if (state.dl.current >= state.dl.load) state.dl.status = (state.dl.current <= state.dl.max) ? 'success' : 'crash';
        }
    }

    function resize(c) {
        const r = c.getBoundingClientRect();
        if (c.width !== r.width || c.height !== r.height) { c.width = r.width; c.height = r.height; }
    }

    function drawScopeGrid(ctx, w, h) {
        ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.beginPath();
        for (let x = 0; x <= w; x += w / 10) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
        for (let y = 0; y <= h; y += h / 4) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
        ctx.stroke();
    }

    function draw() {
        if (state.screen === 'temperature') drawTemp();
        if (state.screen === 'control') drawControl();
        if (state.screen === 'interrupt') drawInterrupt();
        if (state.screen === 'deadline') drawDeadline();
        if (state.screen === 'memory') drawMemory();
    }

    // === 1. Temperature ===
    function drawTemp() {
        const v = state.temp.history[state.temp.history.length-1];
        document.getElementById('disp-volt').textContent = v.toFixed(2);
        document.getElementById('disp-adc').textContent = Math.floor((v/3.3)*4095);
        // Reverse calc for display (Sensor spec: T = (V - 0.5) * 100)
        document.getElementById('disp-temp').textContent = ((v - 0.5) * 100).toFixed(1);
        
        // Update Human Face
        updateHumanFace(state.temp.val);

        // Update Reference Graph
        drawTempGraph();

        // Particles
        const tRatio = (state.temp.val + 20) / 120; // range -20 to 100 normalized
        const color = `rgb(${tRatio*255}, ${50}, ${(1-tRatio)*255})`;
        const cvs = document.getElementById('temp-flow-canvas');
        const ctx = cvs.getContext('2d');
        resize(cvs); ctx.clearRect(0,0,cvs.width, cvs.height);
        
        if (state.t % 5 === 0) state.temp.particles.push({x: 100, y: cvs.height/2, life: 1.0});
        ctx.fillStyle = color;
        state.temp.particles.forEach((p, i) => {
            p.x += 5; p.life -= 0.005; ctx.globalAlpha = p.life;
            ctx.beginPath(); ctx.arc(p.x, p.y + Math.sin(p.x*0.05)*10, 4, 0, Math.PI*2); ctx.fill();
            if (p.x > cvs.width) state.temp.particles.splice(i, 1);
        });

        // Mini Graph
        const gCvs = document.getElementById('canvas-volt');
        const gCtx = gCvs.getContext('2d');
        resize(gCvs); gCtx.clearRect(0,0,gCvs.width, gCvs.height);
        gCtx.beginPath(); gCtx.strokeStyle = C.secondary; gCtx.lineWidth=2;
        state.temp.history.forEach((h, i) => {
            const x = (i/50)*gCvs.width; const y = gCvs.height - (h/3.3)*gCvs.height;
            i==0 ? gCtx.moveTo(x,y) : gCtx.lineTo(x,y);
        });
        gCtx.stroke();
    }

    function updateHumanFace(temp) {
        const wrapper = document.getElementById('human-wrapper');
        const valText = document.getElementById('human-temp-val');
        valText.textContent = temp;
        
        wrapper.classList.remove('human-cold', 'human-hot');
        if (temp < 10) {
            wrapper.classList.add('human-cold');
        } else if (temp > 35) {
            wrapper.classList.add('human-hot');
        }
    }

    function drawTempGraph() {
        const charCvs = document.getElementById('canvas-temp-char');
        const charCtx = charCvs.getContext('2d');
        resize(charCvs); const w = charCvs.width; const h = charCvs.height;
        charCtx.clearRect(0,0,w,h);
        
        const mL = 30, mR = 10, mT = 10, mB = 20; const gW = w - mL - mR; const gH = h - mT - mB;
        charCtx.strokeStyle = '#333'; charCtx.lineWidth = 2; charCtx.beginPath();
        charCtx.moveTo(mL, mT); charCtx.lineTo(mL, h - mB); charCtx.lineTo(w - mR, h - mB); charCtx.stroke();
        
        charCtx.fillStyle = '#333'; charCtx.font = '10px sans-serif'; charCtx.textAlign = 'right';
        charCtx.fillText('2.0V', mL - 4, mT + 10); charCtx.fillText('0.0V', mL - 4, h - mB);
        charCtx.textAlign = 'center'; charCtx.fillText('-20', mL, h - mB + 14); charCtx.fillText('100°C', w - mR, h - mB + 14);

        const mapX = (t) => mL + ((t + 20) / 120) * gW; const mapY = (val) => (h - mB) - (val / 2.0) * gH;
        charCtx.strokeStyle = '#2ecc71'; charCtx.lineWidth = 3; charCtx.beginPath();
        charCtx.moveTo(mapX(-20), mapY(0.5 + -20*0.01)); charCtx.lineTo(mapX(100), mapY(0.5 + 100*0.01)); charCtx.stroke();
        
        const curT = state.temp.val; const curV = 0.5 + curT*0.01; const pX = mapX(curT); const pY = mapY(curV);
        charCtx.fillStyle = '#e74c3c'; charCtx.beginPath(); charCtx.arc(pX, pY, 5, 0, Math.PI*2); charCtx.fill();
    }

    // === 2. Control (Fan) ===
    function drawControl() {
        const input = state.ctrl.input;
        const isRev = input < 0;
        const duty = Math.abs(input) / 100;
        const lineColor = isRev ? C.accent : C.secondary;
        const glowColor = isRev ? C.accentGlow : C.secondaryGlow;

        // Particles Flow
        const cvs = document.getElementById('ctrl-flow-canvas');
        const ctx = cvs.getContext('2d');
        resize(cvs); ctx.clearRect(0,0,cvs.width, cvs.height);
        
        if (Math.abs(input) > 5 && state.t % Math.max(1, 10 - Math.floor(duty*8)) === 0) {
            state.ctrl.particles.push({x: 50, y: cvs.height/2, life: 1.0, color: lineColor});
        }
        state.ctrl.particles.forEach((p, i) => {
            p.x += 5; p.life -= 0.005; ctx.fillStyle = p.color; ctx.globalAlpha = p.life;
            ctx.beginPath(); ctx.arc(p.x, p.y + (Math.random()-0.5)*10, 3, 0, Math.PI*2); ctx.fill();
            if (p.x > cvs.width) state.ctrl.particles.splice(i, 1);
        });

        // FAN Rotation & Wind
        const blades = document.getElementById('fan-blades');
        blades.style.transform = `rotate(${state.ctrl.angle}deg)`;
        
        document.getElementById('disp-rpm').textContent = Math.round(Math.abs(state.ctrl.rpm) * 10);
        document.getElementById('disp-stick').textContent = input;
        
        const dirText = document.getElementById('disp-dir-text');
        if (Math.abs(input) > 5) {
            dirText.textContent = isRev ? "⏪ 吸気 (REV)" : "送風 (FWD) ⏩";
            dirText.style.color = lineColor;
            // Generate Wind Particles
            createWind(isRev, duty, lineColor);
        } else { dirText.textContent = "STOP"; dirText.style.color = '#aaa'; }

        // Scope Config
        const setupScopeCtx = (ctx) => {
            ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.shadowBlur = 8;
            ctx.shadowColor = glowColor; ctx.strokeStyle = lineColor; ctx.lineWidth = 2;
        };

        // PWM Scope
        const cvsPwm = document.getElementById('canvas-ctrl-pwm');
        const ctxPwm = cvsPwm.getContext('2d');
        resize(cvsPwm); ctxPwm.clearRect(0,0,cvsPwm.width, cvsPwm.height);
        drawScopeGrid(ctxPwm, cvsPwm.width, cvsPwm.height);
        ctxPwm.beginPath(); setupScopeCtx(ctxPwm);
        const cycles = 4; const periodW = cvsPwm.width / cycles;
        const highW = periodW * duty; const highY = 8; const lowY = cvsPwm.height - 8;
        
        if (duty < 0.02) { ctxPwm.moveTo(0, lowY); ctxPwm.lineTo(cvsPwm.width, lowY); }
        else if (duty > 0.98) { ctxPwm.moveTo(0, highY); ctxPwm.lineTo(cvsPwm.width, highY); }
        else {
            const offset = -(state.t * 2) % periodW;
            for(let i=-1; i<=cycles; i++) {
                let startX = i * periodW + offset;
                ctxPwm.moveTo(startX, lowY); ctxPwm.lineTo(startX, highY);
                ctxPwm.lineTo(startX + highW, highY); ctxPwm.lineTo(startX + highW, lowY);
                ctxPwm.lineTo(startX + periodW, lowY);
            }
        }
        ctxPwm.stroke();

        // DIR Scope
        const cvsDir = document.getElementById('canvas-ctrl-dir');
        const ctxDir = cvsDir.getContext('2d');
        resize(cvsDir); ctxDir.clearRect(0,0,cvsDir.width, cvsDir.height);
        drawScopeGrid(ctxDir, cvsDir.width, cvsDir.height);
        const dLowY = cvsDir.height - 10; const dHighY = 10; const dY = isRev ? dHighY : dLowY;
        ctxDir.beginPath(); setupScopeCtx(ctxDir); ctxDir.moveTo(0, dY); ctxDir.lineTo(cvsDir.width, dY); ctxDir.stroke();
    }

    function createWind(isRev, intensity, color) {
        const container = document.getElementById('wind-effect');
        // Limit creation rate
        if (Math.random() > intensity) return;

        const el = document.createElement('div');
        el.className = 'wind-line';
        el.style.background = color;
        el.style.width = (10 + Math.random() * 20) + 'px';
        el.style.top = (Math.random() * 100) + '%';
        el.style.left = isRev ? '100%' : '0%';
        container.appendChild(el);

        // Animate via WAAPI
        const keyframes = isRev 
            ? [{ transform: 'translateX(0) scaleX(1)', opacity: 0.8 }, { transform: 'translateX(-150px) scaleX(1.5)', opacity: 0 }]
            : [{ transform: 'translateX(0) scaleX(1)', opacity: 0.8 }, { transform: 'translateX(150px) scaleX(1.5)', opacity: 0 }];
        
        const anim = el.animate(keyframes, { duration: 500 - (intensity*300), easing: 'ease-out' });
        anim.onfinish = () => el.remove();
    }

    // === Other Sections (Unchanged Logic) ===
    function drawInterrupt() {
        const cvs = document.getElementById('canvas-int');
        const ctx = cvs.getContext('2d');
        resize(cvs); ctx.clearRect(0,0,cvs.width, cvs.height);
        const H = cvs.height;
        ctx.fillStyle = '#f5f6fa'; ctx.fillRect(0, H/2 - 20, cvs.width, 40);
        state.int.events.forEach(e => {
            let x = e.startX - state.int.cursor + 100;
            if (state.int.mode === 'polling') { ctx.fillStyle = C.accent; ctx.beginPath(); ctx.arc(x, H/2, 6, 0, Math.PI*2); ctx.fill(); }
            if (e.state === 'running') { ctx.fillStyle = C.secondary; ctx.fillRect(100, H/2 - 20, 20, 40); ctx.fillStyle = '#fff'; ctx.fillText('ISR', 102, H/2+4); }
        });
        if (!state.int.isrActive) { ctx.fillStyle = C.primary; ctx.beginPath(); ctx.arc(110, H/2, 10, 0, Math.PI*2); ctx.fill(); }
        if (state.int.mode === 'polling') {
            ctx.fillStyle = '#ccc';
            for(let i=0; i<cvs.width; i+=200) { let checkX = i - (state.int.cursor % 200) + 100; ctx.fillRect(checkX, H/2 + 25, 2, 10); }
        }
    }

    function drawDeadline() {
        const bar = document.getElementById('task-bar');
        const msg = document.getElementById('deadline-msg');
        const pct = Math.min(120, (state.dl.current / state.dl.max) * 100);
        bar.style.width = `${pct}%`;
        if (state.dl.status === 'running') {
            bar.style.background = C.primary; msg.textContent = `Running: ${state.dl.current}ms`;
            if (state.dl.current > state.dl.max) { bar.style.background = C.danger; msg.textContent = 'OVERRUN!'; }
        } else if (state.dl.status === 'success') { bar.style.background = C.secondary; msg.textContent = '✅ Success'; } 
        else if (state.dl.status === 'crash') { bar.style.background = C.danger; msg.textContent = '❌ DEADLINE MISSED'; }
    }

    function drawMemory() {
        const stackH = state.mem.stack * 40; const heapH = state.mem.heap / 5; 
        const bStack = document.getElementById('block-stack'); const bHeap = document.getElementById('block-heap');
        bStack.style.height = `${stackH}px`; bHeap.style.height = `${heapH}px`;
        document.getElementById('val-stack').textContent = Math.round((state.mem.stack/10)*100);
        document.getElementById('val-heap').textContent = state.mem.heap;
        const totalH = 340 - 40; 
        if (!state.mem.crashed && (stackH + heapH > totalH)) { state.mem.crashed = true; document.querySelector('.memory-tower').classList.add('crash-shake'); }
    }

    window.addEventListener('hashchange', () => {
        const h = location.hash.substring(1) || 'home';
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        (document.getElementById(h) || document.getElementById('home')).classList.add('active');
        state.screen = h;
    });

    document.getElementById('input-temp').oninput = (e) => state.temp.val = parseFloat(e.target.value);
    document.getElementById('input-noise').onchange = (e) => state.temp.noise = e.target.checked;
    document.getElementById('input-stick').oninput = (e) => state.ctrl.input = parseInt(e.target.value);
    document.querySelectorAll('.mode-btn').forEach(b => {
        b.onclick = () => { document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active')); b.classList.add('active'); state.int.mode = b.dataset.mode; }
    });
    document.getElementById('btn-trigger-event').onclick = () => state.int.events.push({ startX: state.int.cursor + 200, state: 'pending', endX: 0 });
    document.getElementById('sel-isr-time').onchange = (e) => state.int.isrLen = parseInt(e.target.value);
    document.querySelectorAll('.preset').forEach(b => {
        b.onclick = () => { state.dl.status = 'running'; state.dl.current = 0; state.dl.load = parseInt(b.dataset.load); }
    });
    document.getElementById('input-stack').oninput = (e) => { state.mem.stack = parseInt(e.target.value); if(state.mem.crashed) state.mem.crashed = false; };
    document.getElementById('btn-malloc').onclick = () => { if(!state.mem.crashed) state.mem.heap += 256; };
    
    document.querySelectorAll('.action-bar').forEach(bar => {
        const btn = document.createElement('button'); btn.className = 'ctrl-btn'; btn.textContent = '🔄 Reset';
        btn.onclick = () => {
            state.temp.history.fill(0); state.ctrl.rpm = 0; state.ctrl.angle = 0;
            state.int.cursor = 0; state.int.events = []; state.dl.status = 'idle'; state.mem.heap = 0; state.mem.crashed = false;
            document.querySelector('.memory-tower').classList.remove('crash-shake');
            document.getElementById('task-bar').style.width = '0%';
        };
        bar.appendChild(btn);
    });

    state.running = true;
    loop();
    window.dispatchEvent(new Event('hashchange'));
});