/* ============================================
   Phantom Typist — Script
   Procedural keyboard audio + streaming sync
   ============================================ */

(() => {
  'use strict';

  // ---- Demo Texts ----
  const DEMO_TEXTS = [
    // 0: Escalation
    `COID/MID: 9130346689679296
CASE: 15155621543
CLIENT/CONTACT: Joé Charest
CX IS ATTEMPTING TO: Import Classes under Products and Services
EXPECTED OUTCOME: To be able to import classes without errors
ACTUAL OUTCOME: Getting error when attempting CSV import
KB/TOOLS USED: Help panel, KB articles on class import
TRIED TEST ACCOUNT: Yes
TS STEPS: Tried changing classes on customer CSV file and naming them under category. Getting error "no option for classes importation." Verified account settings, classes are enabled.

NOTES: Customer has QBO Plus subscription. Classes feature is enabled under Account and Settings > Advanced. The CSV template was downloaded from Intuit's help article but does not include a column for classes. This appears to be a known limitation — CSV import for Products and Services does not currently support the Class field.

RECOMMENDATION: Advise customer that class assignment during P&S import is not supported via CSV. Classes must be assigned individually after import, or customer can use the API integration for bulk assignment. Consider submitting a feature request through the feedback portal.`,

    // 1: Resolution
    `RESOLUTION SUMMARY
===========================

Issue: Bank feed disconnection — TD Canada Trust
Root Cause: OAuth token expiration due to MFA policy change
Steps Taken:
  1. Verified bank feed status in Banking tab — showing "Action Required"
  2. Attempted manual reconnection — failed with error code BF-1042
  3. Cleared browser cache and cookies for intuit.com domain
  4. Disconnected existing bank connection completely
  5. Re-authenticated with TD EasyWeb credentials
  6. Completed MFA challenge via TD app notification
  7. Selected correct accounts for feed (Chequing + Business Visa)
  8. Confirmed transactions pulling in — verified last 5 transactions match

Customer Verified: All recent transactions now appearing correctly.
Follow-up: Monitor for 48 hours. If disconnection recurs, escalate to bank feed engineering team with BF-1042 code reference.

Time to Resolution: 22 minutes
Customer Satisfaction: Confirmed resolved, happy with outcome.`,

    // 2: Technical
    `TECHNICAL INVESTIGATION — INV-441826

Platform: QuickBooks Online Advanced
Browser: Chrome 132.0.6834.110 (Windows 11)
Account Region: en_CA

ISSUE DESCRIPTION:
Recurring journal entries created via Automation are posting with incorrect currency conversion rates. The automation rule references USD vendor bills but posts to CAD accounts. Expected behavior is to use the exchange rate from the bill date, but the system appears to be using the rate from the automation execution date instead.

REPRODUCTION STEPS:
1. Create a USD vendor bill dated March 1 (rate: 1.3542)
2. Set up recurring journal entry automation for the 15th of each month
3. Automation runs March 15 — posts with rate 1.3687 (March 15 rate)
4. Manual journal entry for same transaction uses 1.3542 (correct)

IMPACT: Affects all multicurrency accounts using automation rules.
WORKAROUND: Create journal entries manually until fix is deployed.
PRIORITY: P2 — Financial accuracy impact, no data loss.

ENGINEERING NOTES:
The automation scheduler pulls exchange rates from /v3/exchangerate endpoint at execution time rather than referencing the source transaction date. This is a regression introduced in the Q1 automation refactor (commit ref: auto-sched-v2.4.1). Fix requires passing source_date parameter to the rate lookup call.`
  ];

  // ---- Keyboard Profiles ----
  // Each profile defines how sounds are generated for that switch type
  const PROFILES = {
    blue: {
      name: 'Cherry MX Blue',
      // Regular key parameters
      key: {
        clickFreq: [3800, 4200, 4600, 5000, 3600, 4400, 4800, 5200],
        clickGain: 0.18,
        clickDuration: 0.008,
        noiseGain: 0.12,
        noiseDuration: 0.025,
        noiseDecay: 0.06,
        releaseDelay: 0.04,
        releaseFreq: [3200, 3600, 4000],
        releaseGain: 0.07,
        releaseDuration: 0.005,
        pitchVariation: 0.15,
        bodyResonance: 1800,
        bodyQ: 2,
        bodyGain: 0.04,
      },
      space: {
        clickFreq: [1200, 1400, 1600],
        clickGain: 0.20,
        clickDuration: 0.012,
        noiseGain: 0.16,
        noiseDuration: 0.04,
        noiseDecay: 0.10,
        bodyResonance: 600,
        bodyQ: 3,
        bodyGain: 0.08,
      },
      enter: {
        clickFreq: [2200, 2600, 3000],
        clickGain: 0.22,
        clickDuration: 0.010,
        noiseGain: 0.18,
        noiseDuration: 0.035,
        noiseDecay: 0.09,
        bodyResonance: 900,
        bodyQ: 2.5,
        bodyGain: 0.06,
      },
      modifier: {
        clickFreq: [4800, 5200],
        clickGain: 0.08,
        clickDuration: 0.006,
        noiseGain: 0.06,
        noiseDuration: 0.018,
        noiseDecay: 0.04,
      },
    },
    brown: {
      name: 'Cherry MX Brown',
      key: {
        clickFreq: [2800, 3200, 3600, 2600, 3000, 3400, 2400, 3800],
        clickGain: 0.10,
        clickDuration: 0.006,
        noiseGain: 0.15,
        noiseDuration: 0.030,
        noiseDecay: 0.08,
        releaseDelay: 0.05,
        releaseFreq: [2400, 2800, 3200],
        releaseGain: 0.04,
        releaseDuration: 0.004,
        pitchVariation: 0.12,
        bodyResonance: 1400,
        bodyQ: 3,
        bodyGain: 0.06,
      },
      space: {
        clickFreq: [900, 1100, 1300],
        clickGain: 0.14,
        clickDuration: 0.010,
        noiseGain: 0.18,
        noiseDuration: 0.045,
        noiseDecay: 0.12,
        bodyResonance: 500,
        bodyQ: 4,
        bodyGain: 0.10,
      },
      enter: {
        clickFreq: [1800, 2200, 2600],
        clickGain: 0.16,
        clickDuration: 0.008,
        noiseGain: 0.18,
        noiseDuration: 0.040,
        noiseDecay: 0.10,
        bodyResonance: 700,
        bodyQ: 3,
        bodyGain: 0.08,
      },
      modifier: {
        clickFreq: [3600, 4000],
        clickGain: 0.05,
        clickDuration: 0.005,
        noiseGain: 0.05,
        noiseDuration: 0.015,
        noiseDecay: 0.03,
      },
    },
    red: {
      name: 'Cherry MX Red',
      key: {
        clickFreq: [2000, 2400, 2800, 1800, 2200, 2600, 3000, 3200],
        clickGain: 0.05,
        clickDuration: 0.004,
        noiseGain: 0.10,
        noiseDuration: 0.020,
        noiseDecay: 0.07,
        releaseDelay: 0.06,
        releaseFreq: [1800, 2200],
        releaseGain: 0.03,
        releaseDuration: 0.003,
        pitchVariation: 0.10,
        bodyResonance: 1200,
        bodyQ: 4,
        bodyGain: 0.08,
      },
      space: {
        clickFreq: [700, 900, 1100],
        clickGain: 0.08,
        clickDuration: 0.008,
        noiseGain: 0.14,
        noiseDuration: 0.035,
        noiseDecay: 0.10,
        bodyResonance: 400,
        bodyQ: 5,
        bodyGain: 0.12,
      },
      enter: {
        clickFreq: [1400, 1800, 2200],
        clickGain: 0.10,
        clickDuration: 0.007,
        noiseGain: 0.14,
        noiseDuration: 0.030,
        noiseDecay: 0.08,
        bodyResonance: 600,
        bodyQ: 3.5,
        bodyGain: 0.08,
      },
      modifier: {
        clickFreq: [3000, 3400],
        clickGain: 0.03,
        clickDuration: 0.003,
        noiseGain: 0.04,
        noiseDuration: 0.012,
        noiseDecay: 0.03,
      },
    },
    buckling: {
      name: 'Buckling Spring',
      key: {
        clickFreq: [1600, 2000, 2400, 1400, 1800, 2200, 2600, 2800],
        clickGain: 0.25,
        clickDuration: 0.010,
        noiseGain: 0.22,
        noiseDuration: 0.040,
        noiseDecay: 0.10,
        releaseDelay: 0.05,
        releaseFreq: [1200, 1600, 2000],
        releaseGain: 0.12,
        releaseDuration: 0.008,
        pitchVariation: 0.18,
        bodyResonance: 800,
        bodyQ: 2,
        bodyGain: 0.10,
        // Buckling spring has a secondary resonance — the spring buckle
        springFreq: [600, 800, 1000],
        springGain: 0.08,
        springDuration: 0.015,
      },
      space: {
        clickFreq: [600, 800, 1000],
        clickGain: 0.28,
        clickDuration: 0.015,
        noiseGain: 0.24,
        noiseDuration: 0.055,
        noiseDecay: 0.14,
        bodyResonance: 300,
        bodyQ: 2,
        bodyGain: 0.14,
      },
      enter: {
        clickFreq: [1000, 1400, 1800],
        clickGain: 0.30,
        clickDuration: 0.012,
        noiseGain: 0.24,
        noiseDuration: 0.050,
        noiseDecay: 0.12,
        bodyResonance: 500,
        bodyQ: 2,
        bodyGain: 0.12,
      },
      modifier: {
        clickFreq: [2200, 2600],
        clickGain: 0.12,
        clickDuration: 0.008,
        noiseGain: 0.10,
        noiseDuration: 0.025,
        noiseDecay: 0.05,
      },
    },
  };

  // ---- Speed Configs ----
  const SPEEDS = {
    slow:   { minDelay: 60,  maxDelay: 120, burstChance: 0.05, thinkChance: 0.03, thinkMin: 800,  thinkMax: 2000 },
    normal: { minDelay: 25,  maxDelay: 55,  burstChance: 0.10, thinkChance: 0.05, thinkMin: 500,  thinkMax: 1500 },
    fast:   { minDelay: 10,  maxDelay: 30,  burstChance: 0.15, thinkChance: 0.07, thinkMin: 400,  thinkMax: 1200 },
    turbo:  { minDelay: 4,   maxDelay: 16,  burstChance: 0.25, thinkChance: 0.08, thinkMin: 300,  thinkMax: 1000 },
  };

  // ---- State ----
  let audioCtx = null;
  let analyserNode = null;
  let masterGain = null;
  let currentProfile = 'blue';
  let currentSpeed = 'normal';
  let currentTextIdx = 0;
  let isPlaying = false;
  let isMasterOn = true;
  let volume = 0.6;
  let streamTimeout = null;
  let totalChars = 0;
  let charTimestamps = [];
  let animFrameId = null;

  // ---- DOM Refs ----
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const outputText = $('#output-text');
  const outputPanel = $('#output-panel');
  const cursorEl = $('#cursor');
  const statusMode = $('#status-mode');
  const statusCps = $('#status-cps');
  const statusTotal = $('#status-total');
  const volumeSlider = $('#volume-slider');
  const volumeValue = $('#volume-value');
  const masterToggle = $('#master-toggle');
  const btnStart = $('#btn-start');
  const btnStop = $('#btn-stop');
  const btnReset = $('#btn-reset');
  const waveformCanvas = $('#waveform-canvas');
  const waveformCtx = waveformCanvas.getContext('2d');

  // ---- Audio Engine ----

  function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Master gain
    masterGain = audioCtx.createGain();
    masterGain.gain.value = volume;

    // Analyser for waveform visualization
    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 2048;
    analyserNode.smoothingTimeConstant = 0.85;

    masterGain.connect(analyserNode);
    analyserNode.connect(audioCtx.destination);
  }

  function createNoiseBuffer(duration) {
    const sampleRate = audioCtx.sampleRate;
    const length = Math.floor(sampleRate * duration);
    const buffer = audioCtx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1);
    }
    return buffer;
  }

  // Attempt to get a slightly colored noise by filtering
  function playFilteredNoise(time, duration, decay, gain, filterFreq, filterQ) {
    const noise = audioCtx.createBufferSource();
    noise.buffer = createNoiseBuffer(duration + decay);

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq || 2000;
    filter.Q.value = filterQ || 1;

    const env = audioCtx.createGain();
    env.gain.setValueAtTime(gain, time);
    env.gain.setValueAtTime(gain, time + duration);
    env.gain.exponentialRampToValueAtTime(0.001, time + duration + decay);

    noise.connect(filter);
    filter.connect(env);
    env.connect(masterGain);

    noise.start(time);
    noise.stop(time + duration + decay + 0.01);
  }

  function playClick(time, freq, gain, duration) {
    const osc = audioCtx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;

    const env = audioCtx.createGain();
    // Sharp attack
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(gain, time + 0.002);
    env.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc.connect(env);
    env.connect(masterGain);

    osc.start(time);
    osc.stop(time + duration + 0.01);
  }

  function playBody(time, resonanceFreq, Q, gain, duration) {
    if (!resonanceFreq) return;
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = resonanceFreq * (0.9 + Math.random() * 0.2);

    const env = audioCtx.createGain();
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(gain, time + 0.003);
    env.gain.exponentialRampToValueAtTime(0.001, time + duration);

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = resonanceFreq * 2;
    filter.Q.value = Q || 1;

    osc.connect(filter);
    filter.connect(env);
    env.connect(masterGain);

    osc.start(time);
    osc.stop(time + duration + 0.01);
  }

  function playKeySound(char) {
    if (!audioCtx || !isMasterOn) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const profile = PROFILES[currentProfile];
    const now = audioCtx.currentTime;
    // Small random jitter
    const jitter = (Math.random() - 0.5) * 0.012;
    const t = now + Math.max(0, jitter);

    let params;
    let type = 'key';

    if (char === ' ') {
      params = profile.space;
      type = 'space';
    } else if (char === '\n') {
      params = profile.enter;
      type = 'enter';
    } else if (char === ':' || char === '/' || char === '-') {
      // Modifiers / special chars — lighter sound
      params = profile.modifier;
      type = 'modifier';
    } else {
      params = profile.key;
      type = 'key';
    }

    // Pitch variation
    const pitchVar = params.pitchVariation || 0.1;
    const pitchMult = 1 + (Math.random() - 0.5) * 2 * pitchVar;

    // Pick random frequency from the array
    const freqArr = params.clickFreq;
    const freq = freqArr[Math.floor(Math.random() * freqArr.length)] * pitchMult;

    // Gain variation
    const gainVar = 0.85 + Math.random() * 0.3;

    // 1. Click transient
    playClick(t, freq, params.clickGain * gainVar, params.clickDuration);

    // 2. Noise burst (body)
    const noiseFilterFreq = type === 'space' ? 1200 : type === 'enter' ? 1800 : 3000;
    playFilteredNoise(t, params.noiseDuration, params.noiseDecay, params.noiseGain * gainVar, noiseFilterFreq, 1.5);

    // 3. Body resonance
    if (params.bodyResonance) {
      playBody(t + 0.002, params.bodyResonance, params.bodyQ, params.bodyGain * gainVar, params.noiseDecay + 0.05);
    }

    // 4. Release click (for switches that have one)
    if (params.releaseDelay && params.releaseFreq) {
      const relFreq = params.releaseFreq[Math.floor(Math.random() * params.releaseFreq.length)] * pitchMult;
      playClick(t + params.releaseDelay, relFreq, params.releaseGain * gainVar, params.releaseDuration);
      playFilteredNoise(t + params.releaseDelay, 0.008, 0.03, params.releaseGain * 0.5 * gainVar, 4000, 2);
    }

    // 5. Buckling spring secondary resonance
    if (params.springFreq) {
      const springF = params.springFreq[Math.floor(Math.random() * params.springFreq.length)] * pitchMult;
      playClick(t + 0.005, springF, params.springGain * gainVar, params.springDuration);
    }
  }

  // ---- Keyboard Visualization ----

  const keyMap = {};
  function buildKeyMap() {
    document.querySelectorAll('.kb-key').forEach(el => {
      const k = el.getAttribute('data-key');
      if (k) keyMap[k.toLowerCase()] = el;
    });
  }

  function flashKey(char) {
    let key = char.toLowerCase();
    // Map some chars to keys
    if (key === '\n') key = 'Enter'.toLowerCase();
    if (key === ' ') key = ' ';

    const el = keyMap[key];
    if (!el) return;

    el.classList.add('active');
    setTimeout(() => el.classList.remove('active'), 100);
  }

  // ---- Waveform Visualizer ----

  function resizeCanvas() {
    const rect = waveformCanvas.parentElement.getBoundingClientRect();
    waveformCanvas.width = rect.width * window.devicePixelRatio;
    waveformCanvas.height = rect.height * window.devicePixelRatio;
    waveformCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
  }

  function drawWaveform() {
    if (!analyserNode) {
      animFrameId = requestAnimationFrame(drawWaveform);
      return;
    }

    const rect = waveformCanvas.parentElement.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserNode.getByteTimeDomainData(dataArray);

    waveformCtx.clearRect(0, 0, w, h);

    // Background line
    waveformCtx.strokeStyle = '#2a2a3a';
    waveformCtx.lineWidth = 1;
    waveformCtx.beginPath();
    waveformCtx.moveTo(0, h / 2);
    waveformCtx.lineTo(w, h / 2);
    waveformCtx.stroke();

    // Waveform
    waveformCtx.lineWidth = 1.5;
    waveformCtx.strokeStyle = isPlaying ? '#7c6af0' : '#3a3a4a';
    waveformCtx.beginPath();

    const sliceWidth = w / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * h) / 2;

      if (i === 0) {
        waveformCtx.moveTo(x, y);
      } else {
        waveformCtx.lineTo(x, y);
      }
      x += sliceWidth;
    }

    waveformCtx.stroke();

    // Glow effect when active
    if (isPlaying) {
      waveformCtx.strokeStyle = 'rgba(124, 106, 240, 0.3)';
      waveformCtx.lineWidth = 4;
      waveformCtx.beginPath();
      x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * h) / 2;
        if (i === 0) waveformCtx.moveTo(x, y);
        else waveformCtx.lineTo(x, y);
        x += sliceWidth;
      }
      waveformCtx.stroke();
    }

    animFrameId = requestAnimationFrame(drawWaveform);
  }

  // ---- Streaming Simulation Engine ----

  function setMode(mode) {
    statusMode.textContent = mode;
    statusMode.className = 'status-pill';
    if (mode === 'Streaming') statusMode.classList.add('streaming');
    else if (mode === 'Thinking') statusMode.classList.add('thinking');
  }

  function updateCps() {
    const now = Date.now();
    // Only count chars in the last second
    const recent = charTimestamps.filter(t => now - t < 1000);
    charTimestamps = recent;
    statusCps.textContent = recent.length + ' ch/s';
    if (recent.length > 0) {
      statusCps.classList.add('streaming');
    } else {
      statusCps.classList.remove('streaming');
    }
  }

  function updateTotal() {
    statusTotal.textContent = totalChars + ' chars';
  }

  function scrollToBottom() {
    outputPanel.scrollTop = outputPanel.scrollHeight;
  }

  async function startStreaming() {
    if (isPlaying) return;
    initAudio();
    isPlaying = true;

    btnStart.disabled = true;
    btnStop.disabled = false;
    cursorEl.classList.add('active', 'typing');

    const text = DEMO_TEXTS[currentTextIdx];
    const speed = SPEEDS[currentSpeed];

    let idx = 0;
    let inBurst = false;
    let burstRemaining = 0;
    let postPauseRampUp = 0;

    function typeNext() {
      if (!isPlaying || idx >= text.length) {
        if (idx >= text.length) stopStreaming();
        return;
      }

      const char = text[idx];
      idx++;
      totalChars++;

      // Append character
      outputText.textContent += char;
      charTimestamps.push(Date.now());
      updateTotal();
      updateCps();
      scrollToBottom();

      // Play sound
      playKeySound(char);
      flashKey(char);

      setMode('Streaming');

      // Calculate next delay
      let delay;

      if (postPauseRampUp > 0) {
        // Slow ramp-up after a thinking pause
        delay = speed.maxDelay * 1.5 * (postPauseRampUp / 3);
        postPauseRampUp--;
      } else if (inBurst) {
        delay = speed.minDelay * (0.5 + Math.random() * 0.5);
        burstRemaining--;
        if (burstRemaining <= 0) inBurst = false;
      } else {
        delay = speed.minDelay + Math.random() * (speed.maxDelay - speed.minDelay);
      }

      // Natural variation: slight pause after punctuation
      if (char === '.' || char === '!' || char === '?') {
        delay += 40 + Math.random() * 80;
      } else if (char === ',' || char === ';') {
        delay += 20 + Math.random() * 40;
      } else if (char === '\n') {
        delay += 60 + Math.random() * 100;
      }

      // Random thinking pause
      if (!inBurst && Math.random() < speed.thinkChance && idx < text.length - 10) {
        const thinkDuration = speed.thinkMin + Math.random() * (speed.thinkMax - speed.thinkMin);
        setMode('Thinking');
        cursorEl.classList.remove('typing');
        streamTimeout = setTimeout(() => {
          if (!isPlaying) return;
          cursorEl.classList.add('typing');
          postPauseRampUp = 3; // first 3 chars slower
          typeNext();
        }, thinkDuration);
        return;
      }

      // Random burst trigger
      if (!inBurst && Math.random() < speed.burstChance) {
        inBurst = true;
        burstRemaining = 10 + Math.floor(Math.random() * 20);
      }

      streamTimeout = setTimeout(typeNext, delay);
    }

    typeNext();
  }

  function stopStreaming() {
    isPlaying = false;
    clearTimeout(streamTimeout);
    streamTimeout = null;

    btnStart.disabled = false;
    btnStop.disabled = true;
    cursorEl.classList.remove('typing');

    setMode('Idle');
    updateCps();
  }

  function resetOutput() {
    stopStreaming();
    outputText.textContent = '';
    totalChars = 0;
    charTimestamps = [];
    updateTotal();
    updateCps();
    cursorEl.classList.remove('active');
    setMode('Idle');
  }

  // ---- Event Handlers ----

  // Master toggle
  masterToggle.addEventListener('change', () => {
    isMasterOn = masterToggle.checked;
  });

  // Volume
  volumeSlider.addEventListener('input', () => {
    volume = volumeSlider.value / 100;
    volumeValue.textContent = Math.round(volume * 100) + '%';
    if (masterGain) masterGain.gain.value = volume;
  });

  // Speed buttons
  $$('#speed-group .btn-option').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('#speed-group .btn-option').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSpeed = btn.dataset.speed;
    });
  });

  // Keyboard style cards
  $$('#keyboard-styles .style-card').forEach(card => {
    card.addEventListener('click', () => {
      $$('#keyboard-styles .style-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      currentProfile = card.dataset.style;
    });
  });

  // Text selection
  $$('#text-group .btn-option').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('#text-group .btn-option').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTextIdx = parseInt(btn.dataset.text);
      resetOutput();
    });
  });

  // Action buttons
  btnStart.addEventListener('click', startStreaming);
  btnStop.addEventListener('click', stopStreaming);
  btnReset.addEventListener('click', resetOutput);

  // CPS update interval
  setInterval(updateCps, 200);

  // Canvas resize
  window.addEventListener('resize', resizeCanvas);

  // ---- Init ----
  buildKeyMap();
  resizeCanvas();
  drawWaveform();

  // Allow keyboard interaction: typing a key plays its sound
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    initAudio();
    const char = e.key.length === 1 ? e.key : e.key === 'Enter' ? '\n' : e.key === ' ' ? ' ' : null;
    if (char) {
      playKeySound(char);
      flashKey(char);
    }
  });

})();
