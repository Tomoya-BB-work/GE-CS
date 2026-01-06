document.addEventListener('DOMContentLoaded', () => {
    // === State & Constants ===
    const state = {
        screen: 'home',
        running: false,
        t: 0,
        temp: { val: 25, noise: false, history: new Array(50).fill(0), particles: [] },
        ctrl: { input: 0, output: 0, rpm: 0, angle: 0, historyIn: new Array(100).fill(0), historyOut: new Array(100).fill(0) },
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
        let rawV = (state.temp.val / 100) * 3.3; // Using simple linear for now: 0-100C -> 0-3.3V range roughly
        // To match image 0.5 offset: 
        rawV = 0.5 + (state.temp.val / 100.0); // 0C=0.5V, 100C=1.5V
        
        if (state.temp.noise) rawV += (Math.random() - 0.5) * 0.1;
        rawV = Math.max(0, Math.min(3.3, rawV));
        state.temp.history.push(rawV); state.temp.history.shift();

        // Control
        const targetRpm = state.ctrl.input * 0.5;
        state.ctrl.rpm += (targetRpm - state.ctrl.rpm) * 0.05;
        state.ctrl.angle += state.ctrl.rpm;
        state.ctrl.output = Math.abs(state.ctrl.input);
        state.ctrl.historyIn.push(state.ctrl.input); state.ctrl.historyIn.shift();
        
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
        // Check if size changed to avoid flicker
        if (c.width !== r.width || c.height !== r.height) {
            c.width = r.width; c.height = r.height;
        }
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

    // === Temperature (Updated with Characteristics Graph) ===
    function drawTemp() {
        const v = state.temp.history[state.temp.history.length-1];
        document.getElementById('disp-volt').textContent = v.toFixed(2);
        document.getElementById('disp-adc').textContent = Math.floor((v/3.3)*4095);
        document.getElementById('disp-temp').textContent = ((v - 0.5) * 100).toFixed(1);
        
        // --- 1. Draw Characteristics Graph (DataSheet Style) ---
        const charCvs = document.getElementById('canvas-temp-char');
        const charCtx = charCvs.getContext('2d');
        resize(charCvs); 
        const w = charCvs.width; const h = charCvs.height;
        charCtx.clearRect(0,0,w,h);
        
        // Margins for axes
        const mL = 30, mR = 10, mT = 10, mB = 20;
        const gW = w - mL - mR; const gH = h - mT - mB;
        
        // Axes
        charCtx.strokeStyle = '#333'; charCtx.lineWidth = 2; charCtx.beginPath();
        charCtx.moveTo(mL, mT); charCtx.lineTo(mL, h - mB); charCtx.lineTo(w - mR, h - mB); charCtx.stroke();
        
        // Labels
        charCtx.fillStyle = '#333'; charCtx.font = '10px sans-serif'; charCtx.textAlign = 'right';
        charCtx.fillText('2.0V', mL - 4, mT + 10);
        charCtx.fillText('0.0V', mL - 4, h - mB);
        charCtx.textAlign = 'center';
        charCtx.fillText('-20', mL, h - mB + 14);
        charCtx.fillText('100°C', w - mR, h - mB + 14);

        // Map functions
        const mapX = (t) => mL + ((t + 20) / 120) * gW; // Range -20 to 100
        const mapY = (v) => (h - mB) - (v / 2.0) * gH;  // Range 0 to 2.0V
        
        // Green Characteristic Line (V = 0.5 + T/100)
        charCtx.strokeStyle = '#2ecc71'; charCtx.lineWidth = 3; charCtx.beginPath();
        charCtx.moveTo(mapX(-20), mapY(0.5 + -20/100));
        charCtx.lineTo(mapX(100), mapY(0.5 + 100/100));
        charCtx.stroke();
        
        // Dashed tolerance lines
        charCtx.setLineDash([4, 4]); charCtx.strokeStyle = '#a9dfbf'; charCtx.lineWidth = 1;
        charCtx.beginPath(); // Upper
        charCtx.moveTo(mapX(-20), mapY(0.55 + -20/100)); charCtx.lineTo(mapX(100), mapY(0.55 + 100/100));
        charCtx.stroke();
        charCtx.beginPath(); // Lower
        charCtx.moveTo(mapX(-20), mapY(0.45 + -20/100)); charCtx.lineTo(mapX(100), mapY(0.45 + 100/100));
        charCtx.stroke();
        charCtx.setLineDash([]);

        // Current Operating Point (Red Dot)
        const curT = state.temp.val;
        const curV = 0.5 + curT/100;
        const pX = mapX(curT); const pY = mapY(curV);

        // Drop lines
        charCtx.strokeStyle = '#e74c3c'; charCtx.lineWidth = 1; charCtx.setLineDash([2, 2]);
        charCtx.beginPath();
        charCtx.moveTo(pX, pY); charCtx.lineTo(pX, h - mB); // to X axis
        charCtx.moveTo(pX, pY); charCtx.lineTo(mL, pY);     // to Y axis
        charCtx.stroke(); charCtx.setLineDash([]);

        // Point
        charCtx.fillStyle = '#e74c3c'; charCtx.beginPath(); charCtx.arc(pX, pY, 4, 0, Math.PI*2); charCtx.fill();

        // --- 2. Flow Particles ---
        const tRatio = state.temp.val / 100;
        const color = `rgb(${tRatio*255}, ${100}, ${(1-tRatio)*255})`;
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

        // --- 3. Mini Graph ---
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

    function drawControl() {
        const input = state.ctrl.input;
        const isRev = input < 0;
        const duty = Math.abs(input) / 100;
        const lineColor = isRev ? C.accent : C.secondary;
        const glowColor = isRev ? C.accentGlow : C.secondaryGlow;

        const wrapper = document.getElementById('motor-wrapper');
        document.getElementById('motor-body').style.transform = `rotate(${state.ctrl.angle}deg)`;
        document.getElementById('disp-rpm').textContent = Math.round(Math.abs(state.ctrl.rpm) * 10);
        
        wrapper.classList.remove('motor-state-fwd', 'motor-state-rev');
        const dirText = document.getElementById('disp-dir-text');
        if (Math.abs(input) > 5) {
            wrapper.classList.add(isRev ? 'motor-state-rev' : 'motor-state-fwd');
            dirText.textContent = isRev ? "⏪ REVERSE" : "FORWARD ⏩";
            dirText.style.color = lineColor;
        } else {
            dirText.textContent = "STOP"; dirText.style.color = '#aaa';
        }

        const setupScopeCtx = (ctx) => {
            ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.shadowBlur = 10;
            ctx.shadowColor = glowColor; ctx.strokeStyle = lineColor; ctx.lineWidth = 2;
        };

        const cvsIn = document.getElementById('canvas-ctrl-in');
        const ctxIn = cvsIn.getContext('2d');
        resize(cvsIn); ctxIn.clearRect(0,0,cvsIn.width, cvsIn.height);
        drawScopeGrid(ctxIn, cvsIn.width, cvsIn.height);
        const midY = cvsIn.height / 2;
        ctxIn.beginPath(); ctxIn.strokeStyle = 'rgba(255,255,255,0.2)'; ctxIn.lineWidth = 1; ctxIn.shadowBlur=0;
        ctxIn.moveTo(0, midY); ctxIn.lineTo(cvsIn.width, midY); ctxIn.stroke();

        ctxIn.beginPath(); setupScopeCtx(ctxIn);
        state.ctrl.historyIn.forEach((val, i) => {
            const x = (i / 100) * cvsIn.width; const y = midY - (val / 100) * (midY - 10);
            if (i === 0) ctxIn.moveTo(x, y); else ctxIn.lineTo(x, y);
        });
        ctxIn.stroke();

        const cvsPwm = document.getElementById('canvas-ctrl-pwm');
        const ctxPwm = cvsPwm.getContext('2d');
        resize(cvsPwm); ctxPwm.clearRect(0,0,cvsPwm.width, cvsPwm.height);
        drawScopeGrid(ctxPwm, cvsPwm.width, cvsPwm.height);
        ctxPwm.beginPath(); setupScopeCtx(ctxPwm);
        const cycles = 5; const periodW = cvsPwm.width / cycles;
        const highW = periodW * duty; const highY = 10; const lowY = cvsPwm.height - 10;
        for(let i=0; i<cycles; i++) {
            let startX = i * periodW;
            if (duty <= 0.02) { ctxPwm.moveTo(startX, lowY); ctxPwm.lineTo(startX + periodW, lowY); }
            else if (duty >= 0.98) { ctxPwm.moveTo(startX, highY); ctxPwm.lineTo(startX + periodW, highY); }
            else {
                ctxPwm.moveTo(startX, lowY); ctxPwm.lineTo(startX, highY);
                ctxPwm.lineTo(startX + highW, highY); ctxPwm.lineTo(startX + highW, lowY);
                ctxPwm.lineTo(startX + periodW, lowY);
            }
        }
        ctxPwm.stroke();

        const cvsDir = document.getElementById('canvas-ctrl-dir');
        const ctxDir = cvsDir.getContext('2d');
        resize(cvsDir); ctxDir.clearRect(0,0,cvsDir.width, cvsDir.height);
        drawScopeGrid(ctxDir, cvsDir.width, cvsDir.height);
        const dLowY = cvsDir.height - 15; const dHighY = 15; const dY = isRev ? dHighY : dLowY;
        ctxDir.beginPath(); setupScopeCtx(ctxDir); ctxDir.moveTo(0, dY); ctxDir.lineTo(cvsDir.width, dY); ctxDir.stroke();
        ctxDir.shadowBlur = 0; ctxDir.fillStyle = "rgba(255,255,255,0.5)"; ctxDir.font = "10px monospace";
        ctxDir.fillText("HIGH (REV)", 5, dHighY + 12); ctxDir.fillText("LOW (FWD)", 5, dLowY - 5);
        ctxDir.fillStyle = lineColor; ctxDir.shadowBlur = 10; ctxDir.beginPath(); ctxDir.arc(cvsDir.width - 10, dY, 4, 0, Math.PI*2); ctxDir.fill();
    }

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
        const totalH = 300 - 40; 
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