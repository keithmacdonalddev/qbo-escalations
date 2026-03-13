// ─── Theme Data ──────────────────────────────────────────────
const THEMES = [
  // Warm
  { name: 'Obsidian Ember', category: 'warm', colors: ['#1a1110', '#ff6b35', '#e8dcd0'] },
  { name: 'Copper Patina',  category: 'warm', colors: ['#1a1f1e', '#b87333', '#7ec8a4'] },
  { name: 'Rosewood',       category: 'warm', colors: ['#1c1215', '#c46b7c', '#e8d0d5'] },
  // Cool
  { name: 'Arctic Aurora',   category: 'cool', colors: ['#0d1520', '#7dd3fc', '#34d399'] },
  { name: 'Midnight Orchid', category: 'cool', colors: ['#150d20', '#c084fc', '#818cf8'] },
  { name: 'Deep Biolume',    category: 'cool', colors: ['#0a1a1a', '#00ffaa', '#006b5a'] },
  { name: 'Material Jade',   category: 'cool', colors: ['#0f1a16', '#4ade80', '#86efac'] },
  { name: 'Nord',            category: 'cool', colors: ['#2e3440', '#88c0d0', '#81a1c1'] },
  // Vibrant
  { name: 'Solar Flare', category: 'vibrant', colors: ['#1a1000', '#ffaa00', '#ff6600'] },
  { name: 'Neon Drift',  category: 'vibrant', colors: ['#0a0a1a', '#ff00ff', '#00ffff'] },
  { name: 'Titanium',    category: 'vibrant', colors: ['#1a1a2e', '#7c7cf0', '#a0a0ff'] },
  { name: 'Dracula',     category: 'vibrant', colors: ['#282a36', '#bd93f9', '#ff79c6'] },
  // Neutral
  { name: 'Moss & Stone', category: 'neutral', colors: ['#1a1c18', '#8b9a6b', '#c4b99a'] },
  { name: 'Starlight',    category: 'neutral', colors: ['#141420', '#d4d4ff', '#9090c0'] },
  // Classic
  { name: 'Paper',      category: 'classic', colors: ['#faf9f6', '#333333', '#666666'] },
  { name: 'Carbon',     category: 'classic', colors: ['#1e1e1e', '#e0e0e0', '#888888'] },
  { name: 'Cupertino',  category: 'classic', colors: ['#000000', '#ffffff', '#0a84ff'] },
  { name: 'Monochrome', category: 'classic', colors: ['#1a1a1a', '#f0f0f0', '#808080'] },
  { name: 'Apple',      category: 'classic', colors: ['#f5f5f7', '#1d1d1f', '#0066cc'] },
];

const CATEGORIES = ['warm', 'cool', 'vibrant', 'neutral', 'classic'];

const CATEGORY_LABELS = {
  warm:    'Warm',
  cool:    'Cool',
  vibrant: 'Vibrant',
  neutral: 'Neutral',
  classic: 'Classic',
};

const CATEGORY_DESCRIPTIONS = {
  warm:    'Soft sine clicks, 220 Hz, downward bend',
  cool:    'Crisp sine taps, 440 Hz, clean',
  vibrant: 'Square wave synth blips, 660\u2192330 Hz sweep',
  neutral: 'Triangle wave muted tones, 330 Hz',
  classic: 'Minimal sine click, 1000 Hz, very short',
};

// ─── Sound Profiles ──────────────────────────────────────────
const SOUND_PROFILES = {
  warm: {
    type: 'sine',
    freq: 220,
    freqEnd: 210,
    attack: 0.005,
    decay: 0.08,
    gain: 0.3,
  },
  cool: {
    type: 'sine',
    freq: 440,
    freqEnd: 440,
    attack: 0.002,
    decay: 0.05,
    gain: 0.25,
  },
  vibrant: {
    type: 'square',
    freq: 660,
    freqEnd: 330,
    attack: 0.001,
    decay: 0.1,
    gain: 0.15,
  },
  neutral: {
    type: 'triangle',
    freq: 330,
    freqEnd: 330,
    attack: 0.003,
    decay: 0.06,
    gain: 0.25,
  },
  classic: {
    type: 'sine',
    freq: 1000,
    freqEnd: 1000,
    attack: 0.001,
    decay: 0.02,
    gain: 0.15,
  },
};

// Action-specific pitch multipliers for variety
const ACTION_PITCH = {
  send:     1.0,
  navigate: 1.12,
  toggle:   0.88,
  menu:     1.25,
  close:    0.75,
  save:     1.5,
};

// ─── State ───────────────────────────────────────────────────
let audioCtx = null;
let analyser = null;
let masterGain = null;
let activeThemeIndex = 0;
let soundEnabled = true;
let volume = 0.3;
let animFrameId = null;
let audioReady = false;

// ─── DOM References ──────────────────────────────────────────
const audioGate       = document.getElementById('audioGate');
const enableAudioBtn  = document.getElementById('enableAudioBtn');
const soundToggle     = document.getElementById('soundToggle');
const volumeSlider    = document.getElementById('volumeSlider');
const volumeValue     = document.getElementById('volumeValue');
const waveformCanvas  = document.getElementById('waveformCanvas');
const themesCard      = document.getElementById('themesCard');
const profileInfo     = document.getElementById('profileInfo');
const lastPlayed      = document.getElementById('lastPlayed');
const techOsc         = document.getElementById('techOsc');
const techFreq        = document.getElementById('techFreq');
const techAttack      = document.getElementById('techAttack');
const techDecay       = document.getElementById('techDecay');
const techGain        = document.getElementById('techGain');
const techCtxState    = document.getElementById('techCtxState');

// ─── Audio Init ──────────────────────────────────────────────
function initAudio() {
  if (audioCtx) return;

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  // Master gain
  masterGain = audioCtx.createGain();
  masterGain.gain.value = volume;

  // Analyser for waveform
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.8;

  masterGain.connect(analyser);
  analyser.connect(audioCtx.destination);

  audioReady = true;
  startWaveformLoop();
  updateTechInfo();
}

async function ensureAudioResumed() {
  if (audioCtx && audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }
}

// ─── Sound Playback ──────────────────────────────────────────
function playUISound(category, volumeOverride, pitchMult = 1.0) {
  if (!audioReady || !soundEnabled) return;
  ensureAudioResumed();

  const profile = SOUND_PROFILES[category];
  if (!profile) return;

  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = profile.type;
  osc.frequency.setValueAtTime(profile.freq * pitchMult, now);
  osc.frequency.linearRampToValueAtTime(profile.freqEnd * pitchMult, now + profile.attack + profile.decay);

  const peakGain = profile.gain * (volumeOverride !== undefined ? volumeOverride : volume);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peakGain, now + profile.attack);
  gain.gain.exponentialRampToValueAtTime(0.001, now + profile.attack + profile.decay);

  osc.connect(gain);
  gain.connect(masterGain);

  osc.start(now);
  osc.stop(now + profile.attack + profile.decay + 0.01);

  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
}

function playThemeSwitch(fromCategory, toCategory) {
  if (!audioReady || !soundEnabled) return;
  ensureAudioResumed();

  const fromProfile = SOUND_PROFILES[fromCategory];
  const toProfile = SOUND_PROFILES[toCategory];
  if (!fromProfile || !toProfile) return;

  const now = audioCtx.currentTime;
  const gap = 0.08;
  const decay = 0.15;

  // First note: departing theme
  const osc1 = audioCtx.createOscillator();
  const gain1 = audioCtx.createGain();
  osc1.type = fromProfile.type;
  osc1.frequency.setValueAtTime(fromProfile.freq, now);
  osc1.frequency.linearRampToValueAtTime(fromProfile.freqEnd, now + decay);
  gain1.gain.setValueAtTime(0, now);
  gain1.gain.linearRampToValueAtTime(fromProfile.gain * volume * 0.7, now + 0.005);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + decay);
  osc1.connect(gain1);
  gain1.connect(masterGain);
  osc1.start(now);
  osc1.stop(now + decay + 0.01);
  osc1.onended = () => { osc1.disconnect(); gain1.disconnect(); };

  // Second note: arriving theme
  const startTime = now + gap + decay * 0.4;
  const osc2 = audioCtx.createOscillator();
  const gain2 = audioCtx.createGain();
  osc2.type = toProfile.type;
  osc2.frequency.setValueAtTime(toProfile.freq, startTime);
  osc2.frequency.linearRampToValueAtTime(toProfile.freqEnd, startTime + decay);
  gain2.gain.setValueAtTime(0, startTime);
  gain2.gain.linearRampToValueAtTime(toProfile.gain * volume, startTime + 0.005);
  gain2.gain.exponentialRampToValueAtTime(0.001, startTime + decay);
  osc2.connect(gain2);
  gain2.connect(masterGain);
  osc2.start(startTime);
  osc2.stop(startTime + decay + 0.01);
  osc2.onended = () => { osc2.disconnect(); gain2.disconnect(); };
}

// ─── Waveform Visualization ─────────────────────────────────
function startWaveformLoop() {
  const ctx = waveformCanvas.getContext('2d');
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function draw() {
    animFrameId = requestAnimationFrame(draw);

    // Resize canvas to actual display size
    const rect = waveformCanvas.getBoundingClientRect();
    if (waveformCanvas.width !== rect.width * devicePixelRatio ||
        waveformCanvas.height !== rect.height * devicePixelRatio) {
      waveformCanvas.width = rect.width * devicePixelRatio;
      waveformCanvas.height = rect.height * devicePixelRatio;
      ctx.scale(devicePixelRatio, devicePixelRatio);
    }

    const width = rect.width;
    const height = rect.height;

    analyser.getByteTimeDomainData(dataArray);

    ctx.clearRect(0, 0, width, height);

    // Grab the current accent color
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();

    // Draw center line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    // Draw waveform
    ctx.lineWidth = 2;
    ctx.strokeStyle = accent;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 8;
    ctx.beginPath();

    const sliceWidth = width / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * height) / 2;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      x += sliceWidth;
    }

    ctx.lineTo(width, height / 2);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Draw a subtle glow fill under the waveform
    ctx.globalAlpha = 0.08;
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.globalAlpha = 1.0;
  }

  draw();
}

// ─── Theme Rendering ────────────────────────────────────────
function buildThemeUI() {
  themesCard.innerHTML = '<h2>Themes</h2>';

  CATEGORIES.forEach(cat => {
    const group = document.createElement('div');
    group.className = 'theme-group';

    const label = document.createElement('div');
    label.className = 'theme-group-label';
    label.textContent = CATEGORY_LABELS[cat];
    group.appendChild(label);

    const items = document.createElement('div');
    items.className = 'theme-group-items';

    THEMES.forEach((theme, idx) => {
      if (theme.category !== cat) return;

      const btn = document.createElement('button');
      btn.className = 'theme-btn' + (idx === activeThemeIndex ? ' active' : '');
      btn.dataset.index = idx;
      btn.setAttribute('type', 'button');

      const swatch = document.createElement('span');
      swatch.className = 'theme-swatch';
      swatch.style.background = theme.colors[1];
      btn.appendChild(swatch);

      const nameSpan = document.createElement('span');
      nameSpan.textContent = theme.name;
      btn.appendChild(nameSpan);

      btn.addEventListener('click', () => selectTheme(idx));
      items.appendChild(btn);
    });

    group.appendChild(items);
    themesCard.appendChild(group);
  });
}

function selectTheme(index) {
  if (index === activeThemeIndex) {
    // Play click sound for same theme
    playUISound(THEMES[activeThemeIndex].category, undefined, 1.0);
    updateLastPlayed();
    return;
  }

  const prevTheme = THEMES[activeThemeIndex];
  const nextTheme = THEMES[index];

  // Play theme switch sound
  playThemeSwitch(prevTheme.category, nextTheme.category);

  activeThemeIndex = index;
  applyThemeVisuals(nextTheme);
  updateActiveButton();
  updateTechInfo();
  updateProfileInfo();
  updateLastPlayed();
}

function applyThemeVisuals(theme) {
  const [bg, accent, tertiary] = theme.colors;

  // Determine if this is a light theme
  const bgLuminance = relativeLuminance(hexToRgb(bg));
  const isLight = bgLuminance > 0.4;

  document.body.classList.toggle('light-theme', isLight);

  const textColor = isLight ? '#1a1a1a' : '#f0f0f0';
  const textMuted = isLight ? 'rgba(0, 0, 0, 0.5)' : 'rgba(255, 255, 255, 0.5)';
  const accentDim = hexToRgba(accent, 0.25);

  const root = document.documentElement;
  root.style.setProperty('--bg', bg);
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-dim', accentDim);
  root.style.setProperty('--text', textColor);
  root.style.setProperty('--text-muted', textMuted);
}

function updateActiveButton() {
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.index, 10) === activeThemeIndex);
  });
}

// ─── Demo Buttons ────────────────────────────────────────────
function setupDemoButtons() {
  document.querySelectorAll('.demo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      const mult = ACTION_PITCH[action] || 1.0;
      const theme = THEMES[activeThemeIndex];
      playUISound(theme.category, undefined, mult);
      updateLastPlayed();

      // Button press animation
      btn.style.transform = 'scale(0.95)';
      setTimeout(() => { btn.style.transform = ''; }, 100);
    });
  });
}

// ─── Controls ────────────────────────────────────────────────
function setupControls() {
  soundToggle.addEventListener('change', () => {
    soundEnabled = soundToggle.checked;
  });

  volumeSlider.addEventListener('input', () => {
    volume = parseInt(volumeSlider.value, 10) / 100;
    volumeValue.textContent = volumeSlider.value + '%';
    if (masterGain) {
      masterGain.gain.setValueAtTime(volume, audioCtx.currentTime);
    }
  });
}

// ─── Audio Gate ──────────────────────────────────────────────
function setupAudioGate() {
  enableAudioBtn.addEventListener('click', () => {
    initAudio();
    audioGate.classList.add('hidden');
    // Play a welcome sound with the initial theme
    setTimeout(() => {
      playUISound(THEMES[activeThemeIndex].category);
      updateLastPlayed();
    }, 100);
  });
}

// ─── Info Updates ────────────────────────────────────────────
function updateTechInfo() {
  const theme = THEMES[activeThemeIndex];
  const profile = SOUND_PROFILES[theme.category];
  if (!profile) return;

  techOsc.textContent = profile.type;
  techFreq.textContent = profile.freq + ' \u2192 ' + profile.freqEnd + ' Hz';
  techAttack.textContent = profile.attack + 's';
  techDecay.textContent = profile.decay + 's';
  techGain.textContent = profile.gain.toFixed(2);
  techCtxState.textContent = audioCtx ? audioCtx.state : 'not started';

  // Update context state periodically
  if (audioCtx) {
    audioCtx.onstatechange = () => {
      techCtxState.textContent = audioCtx.state;
    };
  }
}

function updateProfileInfo() {
  const theme = THEMES[activeThemeIndex];
  const profile = SOUND_PROFILES[theme.category];
  profileInfo.textContent = 'Sound profile: ' + CATEGORY_LABELS[theme.category] +
    ' \u2014 ' + profile.type + ' @ ' + profile.freq + ' Hz';
}

function updateLastPlayed() {
  lastPlayed.textContent = 'Last played: ' + new Date().toLocaleTimeString();
}

// ─── Color Utilities ─────────────────────────────────────────
function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  const num = parseInt(hex, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function hexToRgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
}

function relativeLuminance({ r, g, b }) {
  const srgb = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

// ─── Init ────────────────────────────────────────────────────
function init() {
  buildThemeUI();
  setupDemoButtons();
  setupControls();
  setupAudioGate();
  applyThemeVisuals(THEMES[activeThemeIndex]);
  updateTechInfo();
  updateProfileInfo();
}

init();
