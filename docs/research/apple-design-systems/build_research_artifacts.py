#!/usr/bin/env python3
"""Build the standalone HTML and research PDF from the canonical Markdown paper."""

from __future__ import annotations

import html
import re
import sys
from pathlib import Path

from bs4 import BeautifulSoup, NavigableString, Tag
from markdown import Markdown
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    HRFlowable,
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents


ROOT = Path(__file__).resolve().parent
MARKDOWN_PATH = ROOT / "apple-design-systems-research.md"
HTML_PATH = ROOT / "apple-design-systems-visual.html"
PDF_PATH = ROOT.parents[2] / "output" / "pdf" / "apple-design-systems-research-2026.pdf"

INK = colors.HexColor("#142033")
INK_SOFT = colors.HexColor("#506078")
BLUE = colors.HexColor("#1167D8")
BLUE_SOFT = colors.HexColor("#EAF3FF")
GREEN = colors.HexColor("#0E8A6B")
GREEN_SOFT = colors.HexColor("#EAF8F4")
GOLD = colors.HexColor("#A56B00")
LINE = colors.HexColor("#D7DFE9")
PAPER = colors.HexColor("#FBFCFE")


def register_fonts() -> tuple[str, str, str, str]:
    regular = Path("C:/Windows/Fonts/segoeui.ttf")
    bold = Path("C:/Windows/Fonts/segoeuib.ttf")
    italic = Path("C:/Windows/Fonts/segoeuii.ttf")
    mono = Path("C:/Windows/Fonts/CascadiaMono.ttf")
    if regular.exists() and bold.exists():
        pdfmetrics.registerFont(TTFont("ResearchSans", str(regular)))
        pdfmetrics.registerFont(TTFont("ResearchSans-Bold", str(bold)))
        if italic.exists():
            pdfmetrics.registerFont(TTFont("ResearchSans-Italic", str(italic)))
        if mono.exists():
            pdfmetrics.registerFont(TTFont("ResearchMono", str(mono)))
        pdfmetrics.registerFontFamily(
            "ResearchSans",
            normal="ResearchSans",
            bold="ResearchSans-Bold",
            italic="ResearchSans-Italic" if italic.exists() else "ResearchSans",
            boldItalic="ResearchSans-Bold",
        )
        return (
            "ResearchSans",
            "ResearchSans-Bold",
            "ResearchSans-Italic" if italic.exists() else "ResearchSans",
            "ResearchMono" if mono.exists() else "Courier",
        )
    return "Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Courier"


FONT, FONT_BOLD, FONT_ITALIC, FONT_MONO = register_fonts()


HTML_CSS = r"""
:root {
  color-scheme: light dark;
  --paper: #f6f8fb;
  --surface: rgba(255,255,255,.78);
  --surface-solid: #ffffff;
  --ink: #121c2c;
  --ink-2: #4d5c72;
  --ink-3: #718096;
  --line: rgba(18,28,44,.12);
  --line-strong: rgba(18,28,44,.22);
  --blue: #0b67d8;
  --blue-soft: #e7f1ff;
  --green: #087c63;
  --green-soft: #e7f7f2;
  --amber: #9c6700;
  --amber-soft: #fff5d9;
  --red: #b94343;
  --shadow: 0 18px 50px rgba(31,48,74,.10);
  --radius: 18px;
  --content: 760px;
  --rail: 272px;
}
html[data-theme="dark"] {
  --paper: #0d121b;
  --surface: rgba(23,31,45,.80);
  --surface-solid: #171f2d;
  --ink: #eef3fa;
  --ink-2: #b7c1d0;
  --ink-3: #8794a8;
  --line: rgba(238,243,250,.12);
  --line-strong: rgba(238,243,250,.23);
  --blue: #70adff;
  --blue-soft: #162f50;
  --green: #5dd1ad;
  --green-soft: #12372f;
  --amber: #efbd58;
  --amber-soft: #3e3116;
  --red: #ff8585;
  --shadow: 0 20px 60px rgba(0,0,0,.28);
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background:
    radial-gradient(circle at 8% 2%, color-mix(in srgb, var(--blue) 12%, transparent), transparent 28rem),
    radial-gradient(circle at 92% 12%, color-mix(in srgb, var(--green) 9%, transparent), transparent 26rem),
    var(--paper);
  color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 17px;
  line-height: 1.68;
  text-rendering: optimizeLegibility;
}
a { color: var(--blue); text-underline-offset: .18em; }
a:hover { text-decoration-thickness: 2px; }
a:focus-visible, button:focus-visible, summary:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--blue) 70%, white);
  outline-offset: 3px;
  border-radius: 5px;
}
.skip-link {
  position: fixed; left: 16px; top: -60px; z-index: 100;
  padding: 10px 14px; border-radius: 9px; background: var(--ink); color: var(--paper);
}
.skip-link:focus { top: 16px; }
.progress { position: fixed; inset: 0 0 auto; height: 3px; z-index: 60; background: transparent; }
.progress > span { display: block; width: 0; height: 100%; background: linear-gradient(90deg,var(--blue),var(--green)); }
.topbar {
  position: fixed; z-index: 50; top: 18px; right: 20px; display: flex; gap: 8px;
}
.icon-button {
  width: 44px; height: 44px; border: 1px solid var(--line); border-radius: 12px;
  color: var(--ink); background: var(--surface); backdrop-filter: blur(18px) saturate(1.25);
  box-shadow: 0 8px 24px rgba(0,0,0,.08); cursor: pointer; font: inherit;
  transition: transform 180ms ease, border-color 180ms ease, background 180ms ease;
}
.icon-button:hover { transform: translateY(-2px); border-color: var(--line-strong); }
.icon-button:active { transform: translateY(0) scale(.97); }
.hero {
  min-height: 76vh; padding: 90px 24px 64px; display: grid; place-items: center;
  overflow: hidden; position: relative;
}
.hero-inner { width: min(1120px, 100%); display: grid; grid-template-columns: minmax(0,1.15fr) minmax(300px,.85fr); gap: 56px; align-items: center; }
.eyebrow { color: var(--blue); font-size: .76rem; font-weight: 760; letter-spacing: .12em; text-transform: uppercase; }
.hero h1 { max-width: 780px; margin: 12px 0 18px; font-size: clamp(2.7rem, 7vw, 6.4rem); line-height: .94; letter-spacing: -.065em; }
.hero .dek { max-width: 680px; color: var(--ink-2); font-size: clamp(1.05rem, 2vw, 1.3rem); line-height: 1.52; }
.hero-meta { margin-top: 26px; display: flex; flex-wrap: wrap; gap: 8px; }
.chip { padding: 7px 10px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--ink-2); font-size: .78rem; }
.hero-visual { min-height: 420px; display: grid; place-items: center; position: relative; }
.orbit { width: min(390px, 88vw); aspect-ratio: 1; border: 1px solid var(--line); border-radius: 50%; position: relative; box-shadow: inset 0 0 90px color-mix(in srgb,var(--blue) 7%,transparent); }
.orbit::before, .orbit::after { content: ""; position: absolute; inset: 17%; border: 1px solid var(--line-strong); border-radius: 50%; }
.orbit::after { inset: 34%; background: linear-gradient(145deg,var(--blue-soft),var(--green-soft)); box-shadow: var(--shadow); }
.orbit-label { position: absolute; z-index: 2; width: 130px; text-align: center; font-weight: 760; line-height: 1.15; top: 50%; left: 50%; transform: translate(-50%,-50%); }
.orbit-node { position: absolute; z-index: 3; padding: 7px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface-solid); box-shadow: 0 8px 18px rgba(20,32,51,.08); font-size: .72rem; font-weight: 700; }
.n1{top:-2%;left:41%}.n2{top:14%;right:-5%}.n3{top:49%;right:-11%}.n4{bottom:8%;right:2%}.n5{bottom:-3%;left:35%}.n6{bottom:13%;left:-4%}.n7{top:46%;left:-10%}.n8{top:12%;left:0}
.shell { width: min(1180px, calc(100% - 32px)); margin: 0 auto 120px; display: grid; grid-template-columns: var(--rail) minmax(0,var(--content)); gap: 70px; justify-content: center; align-items: start; }
.rail { position: sticky; top: 32px; max-height: calc(100vh - 64px); overflow: auto; padding: 18px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); backdrop-filter: blur(20px) saturate(1.2); box-shadow: var(--shadow); }
.rail-title { margin: 0 0 10px; font-size: .72rem; letter-spacing: .1em; color: var(--ink-3); text-transform: uppercase; }
.rail ul { list-style: none; padding: 0; margin: 0; }
.rail ul ul { padding-left: 10px; }
.rail li { margin: 2px 0; }
.rail a { display: block; padding: 6px 8px; border-radius: 8px; color: var(--ink-2); text-decoration: none; font-size: .78rem; line-height: 1.28; }
.rail a:hover, .rail a.active { color: var(--ink); background: var(--blue-soft); }
.mobile-toc { display:none; margin: -30px 16px 32px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface-solid); }
.mobile-toc summary { padding: 13px 15px; font-weight: 720; cursor: pointer; }
.mobile-toc nav { padding: 0 14px 14px; max-height: 50vh; overflow: auto; }
.mobile-toc ul { margin: 0; padding-left: 20px; }
main { min-width: 0; }
.paper { padding: 0 0 80px; }
.paper > h1, .paper > h1 + h2, .paper > h1 + h2 + p { display: none; }
.paper h2 { margin: 5.4rem 0 1.2rem; padding-top: 1rem; font-size: clamp(1.8rem,4vw,2.45rem); line-height: 1.08; letter-spacing: -.035em; }
.paper h3 { margin: 3rem 0 .8rem; font-size: 1.35rem; line-height: 1.2; letter-spacing: -.018em; }
.paper h4 { margin: 2rem 0 .55rem; font-size: 1.08rem; }
.paper p { margin: 0 0 1.18rem; color: var(--ink-2); }
.paper strong { color: var(--ink); }
.paper blockquote { margin: 2rem 0; padding: 20px 22px; border-left: 4px solid var(--blue); border-radius: 0 14px 14px 0; background: var(--blue-soft); color: var(--ink); }
.paper blockquote p { color: var(--ink); margin: 0; }
.paper hr { margin: 3.5rem 0; border: 0; height: 1px; background: var(--line); }
.paper li { margin: .4rem 0; color: var(--ink-2); }
.table-wrap { margin: 1.8rem calc((min(94vw, 1040px) - min(94vw, var(--content)))/-2); overflow-x: auto; border: 1px solid var(--line); border-radius: 15px; background: var(--surface-solid); box-shadow: 0 10px 30px rgba(20,32,51,.055); }
.paper table { width: 100%; border-collapse: collapse; min-width: 660px; font-size: .82rem; line-height: 1.45; }
.paper th { text-align: left; color: var(--ink); background: var(--blue-soft); }
.paper th, .paper td { padding: 12px 14px; border-bottom: 1px solid var(--line); vertical-align: top; }
.paper tr:last-child td { border-bottom: 0; }
.paper code { font-family: ui-monospace, "Cascadia Code", monospace; font-size: .88em; background: var(--blue-soft); padding: .1em .28em; border-radius: 4px; }
.visual { margin: 2.5rem 0 3.6rem; border: 1px solid var(--line); border-radius: 22px; background: linear-gradient(145deg,var(--surface-solid),var(--surface)); box-shadow: var(--shadow); overflow: hidden; }
.visual-head { padding: 18px 20px 0; }
.visual-kicker { color: var(--green); font-size: .68rem; letter-spacing: .11em; font-weight: 800; text-transform: uppercase; }
.visual h3 { margin: 5px 0 4px; }
.visual p { margin: 0; }
.evidence-strip { display:grid; grid-template-columns:repeat(4,1fr); gap:1px; background:var(--line); }
.evidence-strip div { padding:18px; background:var(--surface-solid); }
.evidence-strip strong { display:block; font-size:1.45rem; color:var(--ink); }
.evidence-strip span { color:var(--ink-3); font-size:.75rem; }
.principle-grid { padding: 18px; display: grid; grid-template-columns: repeat(4,1fr); gap: 10px; }
.principle { min-height: 128px; padding: 14px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); }
.principle b { display:block; margin-bottom:6px; }
.principle span { color:var(--ink-2); font-size:.78rem; line-height:1.4; }
.system-stack { padding: 20px; display:grid; gap:8px; }
.layer { display:grid; grid-template-columns:120px 1fr; gap:14px; align-items:center; padding:13px 15px; border-radius:12px; border:1px solid var(--line); }
.layer:nth-child(1){background:var(--green-soft)}.layer:nth-child(2){margin-inline:16px;background:color-mix(in srgb,var(--green-soft) 55%,var(--blue-soft))}.layer:nth-child(3){margin-inline:32px;background:var(--blue-soft)}.layer:nth-child(4){margin-inline:48px}.layer:nth-child(5){margin-inline:64px;background:var(--surface-solid)}
.layer b { font-size:.8rem; }.layer span{color:var(--ink-2);font-size:.76rem;line-height:1.35}
.device-band { padding: 20px; display:grid; grid-template-columns:repeat(7,1fr); gap:8px; align-items:end; }
.device { display:grid; place-items:center; gap:8px; text-align:center; color:var(--ink-2); font-size:.7rem; }
.device-shape { width:100%; max-width:76px; min-height:72px; border:2px solid var(--ink-3); border-radius:13px; display:grid; place-items:center; background:linear-gradient(145deg,var(--surface-solid),var(--blue-soft)); font-size:.6rem; font-weight:800; color:var(--ink); }
.device:nth-child(3) .device-shape{min-height:58px;border-radius:8px}.device:nth-child(4) .device-shape{max-width:58px;min-height:68px;border-radius:18px}.device:nth-child(5) .device-shape{max-width:92px;min-height:54px;border-radius:9px}.device:nth-child(6) .device-shape{max-width:90px;min-height:54px;border-radius:25px}.device:nth-child(7) .device-shape{max-width:62px;min-height:62px;border-radius:50%}
.tensions { padding:18px; display:grid; grid-template-columns:repeat(2,1fr); gap:10px; }
.tension { padding:14px; border:1px solid var(--line); border-radius:14px; }
.tension-top { display:flex; justify-content:space-between; gap:12px; font-weight:760; font-size:.78rem; }
.tension-line { height:6px; margin:11px 0; border-radius:999px; background:linear-gradient(90deg,var(--blue),var(--amber)); position:relative; }
.tension-line::after { content:""; position:absolute; width:12px; height:12px; border:3px solid var(--surface-solid); border-radius:50%; background:var(--ink); top:50%; left:var(--mark,50%); transform:translate(-50%,-50%); box-shadow:0 0 0 1px var(--line); }
.tension small { color:var(--ink-3); }
.closing-model { padding: 26px; display:grid; grid-template-columns: 210px 1fr; gap:26px; align-items:center; }
.mini-orbit { aspect-ratio:1;border:1px solid var(--line);border-radius:50%;display:grid;place-items:center;box-shadow:inset 0 0 0 28px var(--blue-soft), inset 0 0 0 56px var(--green-soft);font-weight:800;text-align:center;line-height:1.2; }
.closing-model ol { margin:0; padding-left:22px; color:var(--ink-2); }
.source-note { margin:5rem 0 0; padding:18px; border:1px solid var(--line); border-radius:14px; color:var(--ink-3); font-size:.78rem; }
footer { padding: 36px 20px 60px; border-top: 1px solid var(--line); text-align: center; color: var(--ink-3); font-size: .76rem; }
@media (max-width: 980px) {
  .hero-inner { grid-template-columns: 1fr; }
  .hero-visual { min-height: 350px; }
  .shell { display:block; width:min(760px,calc(100% - 28px)); }
  .rail { display:none; }
  .mobile-toc { display:block; }
  .table-wrap { margin-inline:0; }
  .principle-grid { grid-template-columns:repeat(2,1fr); }
  .device-band { grid-template-columns:repeat(4,1fr); }
}
@media (max-width: 620px) {
  body { font-size:16px; }
  .hero { min-height:auto; padding-top:96px; }
  .hero h1 { font-size:clamp(2.65rem,15vw,4rem); }
  .hero-visual { min-height:300px; }
  .orbit { width:270px; }
  .orbit-node { font-size:.62rem; padding:5px 7px; }
  .evidence-strip { grid-template-columns:repeat(2,1fr); }
  .principle-grid, .tensions { grid-template-columns:1fr; }
  .system-stack { padding:14px; }
  .layer { grid-template-columns:1fr; gap:4px; margin-inline:0 !important; }
  .device-band { grid-template-columns:repeat(3,1fr); }
  .closing-model { grid-template-columns:1fr; }
  .mini-orbit { width:190px; margin:auto; }
  .paper h2 { margin-top:4.2rem; }
}
@media print {
  .topbar,.progress,.rail,.mobile-toc,.hero-visual { display:none !important; }
  body { background:white; color:#111; }
  .hero { min-height:auto; padding:30px 0; }
  .hero-inner,.shell { display:block; width:100%; }
  .visual,.table-wrap { box-shadow:none; break-inside:avoid; }
  .paper h2 { break-after:avoid; }
}
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior:auto; }
  *,*::before,*::after { animation-duration:.01ms !important; transition-duration:.01ms !important; }
}
"""


HTML_JS = r"""
(() => {
  const root = document.documentElement;
  const button = document.querySelector('[data-theme-toggle]');
  const saved = localStorage.getItem('apple-design-paper-theme');
  if (saved) root.dataset.theme = saved;
  const sync = () => {
    const dark = root.dataset.theme === 'dark' || (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    button.setAttribute('aria-pressed', String(dark));
    button.textContent = dark ? '☀' : '◐';
    button.title = dark ? 'Use light theme' : 'Use dark theme';
  };
  button.addEventListener('click', () => {
    const currentDark = root.dataset.theme === 'dark' || (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    root.dataset.theme = currentDark ? 'light' : 'dark';
    localStorage.setItem('apple-design-paper-theme', root.dataset.theme);
    sync();
  });
  sync();
  const bar = document.querySelector('.progress > span');
  const update = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.width = `${max > 0 ? (scrollY / max) * 100 : 0}%`;
  };
  addEventListener('scroll', update, {passive:true}); update();
  const links = [...document.querySelectorAll('.rail a[href^="#"]')];
  const map = new Map(links.map(a => [a.getAttribute('href').slice(1), a]));
  const observer = new IntersectionObserver(entries => {
    const visible = entries.filter(e => e.isIntersecting).sort((a,b) => a.boundingClientRect.top-b.boundingClientRect.top)[0];
    if (!visible) return;
    links.forEach(a => a.classList.remove('active'));
    map.get(visible.target.id)?.classList.add('active');
  }, {rootMargin:'-12% 0px -75% 0px'});
  document.querySelectorAll('.paper h2[id],.paper h3[id]').forEach(h => observer.observe(h));
})();
"""


EVIDENCE_VISUAL = """
<section class="visual" aria-label="Evidence profile">
  <div class="visual-head"><span class="visual-kicker">Evidence profile</span><h3>Broad source base, explicit confidence limits</h3></div>
  <div class="evidence-strip">
    <div><strong>56</strong><span>numbered references</span></div>
    <div><strong>10 + 1</strong><span>device families plus CarPlay</span></div>
    <div><strong>6 + 1</strong><span>operating systems plus CarPlay</span></div>
    <div><strong>4 tiers</strong><span>current, historical, product, external</span></div>
  </div>
</section>
"""


PRINCIPLES_VISUAL = """
<section class="visual" aria-label="Apple's eight 2026 design principles">
  <div class="visual-head"><span class="visual-kicker">Decision framework</span><h3>Eight principles govern the visible system</h3><p>Expression is downstream from human intent.</p></div>
  <div class="principle-grid">
    <div class="principle"><b>Purpose</b><span>Make something meaningful and focus on what people value.</span></div>
    <div class="principle"><b>Agency</b><span>Support freedom, informed action, and recovery.</span></div>
    <div class="principle"><b>Responsibility</b><span>Protect safety, privacy, and trust.</span></div>
    <div class="principle"><b>Familiarity</b><span>Build on learned physical and digital patterns.</span></div>
    <div class="principle"><b>Flexibility</b><span>Adapt to people, platforms, inputs, and contexts.</span></div>
    <div class="principle"><b>Simplicity</b><span>Be clear and direct without hiding necessary meaning.</span></div>
    <div class="principle"><b>Craft</b><span>Care for every visual, tactile, verbal, and technical detail.</span></div>
    <div class="principle"><b>Delight</b><span>Create an appropriate human feeling through the whole experience.</span></div>
  </div>
</section>
"""


STACK_VISUAL = """
<section class="visual" aria-label="Five layers of Apple's design system">
  <div class="visual-head"><span class="visual-kicker">System anatomy</span><h3>One direction of justification</h3><p>Each lower layer must support the human purpose above it.</p></div>
  <div class="system-stack">
    <div class="layer"><b>1. Human intent</b><span>Purpose, agency, responsibility, familiarity, flexibility, simplicity, craft, delight</span></div>
    <div class="layer"><b>2. Context</b><span>Body, distance, posture, attention, motion, duration, safety, shared or private use</span></div>
    <div class="layer"><b>3. Interaction</b><span>Touch, pointer, keyboard, Crown, Pencil, remote focus, gaze, voice, haptics, recovery</span></div>
    <div class="layer"><b>4. Expression</b><span>Hierarchy, typography, symbols, semantic color, material, geometry, layout, motion</span></div>
    <div class="layer"><b>5. Delivery</b><span>Hardware, sensors, silicon, frameworks, privacy, accessibility, continuity, repair</span></div>
  </div>
</section>
"""


DEVICE_VISUAL = """
<section class="visual" aria-label="Device contexts">
  <div class="visual-head"><span class="visual-kicker">Unified, not uniform</span><h3>The body and environment change the answer</h3></div>
  <div class="device-band">
    <div class="device"><div class="device-shape">iPhone</div><span>thumb + touch</span></div>
    <div class="device"><div class="device-shape">iPad</div><span>touch + Pencil</span></div>
    <div class="device"><div class="device-shape">Mac</div><span>pointer + keys</span></div>
    <div class="device"><div class="device-shape">Watch</div><span>glance + Crown</span></div>
    <div class="device"><div class="device-shape">TV</div><span>distance + focus</span></div>
    <div class="device"><div class="device-shape">Vision</div><span>gaze + pinch</span></div>
    <div class="device"><div class="device-shape">AirPods</div><span>sound + sensing</span></div>
    <div class="device"><div class="device-shape">HomePod</div><span>room + voice</span></div>
    <div class="device"><div class="device-shape">AirTag</div><span>find + recover</span></div>
    <div class="device"><div class="device-shape">CarPlay</div><span>drive + constrain</span></div>
    <div class="device"><div class="device-shape">Input</div><span>precision + feedback</span></div>
  </div>
</section>
"""


TENSIONS_VISUAL = """
<section class="visual" aria-label="Design tensions">
  <div class="visual-head"><span class="visual-kicker">Critical reading</span><h3>Apple's principles are competing constraints</h3><p>The marker shows where design judgment, not a fixed rule, is required.</p></div>
  <div class="tensions">
    <div class="tension"><div class="tension-top"><span>Deference</span><span>Discoverability</span></div><div class="tension-line" style="--mark:58%"></div><small>Quiet content still needs visible ways to act.</small></div>
    <div class="tension"><div class="tension-top"><span>Harmony</span><span>Platform fitness</span></div><div class="tension-line" style="--mark:66%"></div><small>Family resemblance cannot erase device ergonomics.</small></div>
    <div class="tension"><div class="tension-top"><span>Delight</span><span>Legibility</span></div><div class="tension-line" style="--mark:67%"></div><small>Expressive material must remain subordinate to reading.</small></div>
    <div class="tension"><div class="tension-top"><span>Integration</span><span>Openness</span></div><div class="tension-line" style="--mark:47%"></div><small>Seamless defaults can narrow equivalent alternatives.</small></div>
    <div class="tension"><div class="tension-top"><span>Thinness</span><span>Repairability</span></div><div class="tension-line" style="--mark:55%"></div><small>Lifecycle quality must be measured per product generation.</small></div>
    <div class="tension"><div class="tension-top"><span>Natural input</span><span>Physical comfort</span></div><div class="tension-line" style="--mark:62%"></div><small>Gaze and gesture remain task- and body-dependent.</small></div>
  </div>
</section>
"""


CLOSING_VISUAL = """
<section class="visual" aria-label="Research synthesis">
  <div class="closing-model">
    <div class="mini-orbit">Design the<br>relationship</div>
    <ol>
      <li>Begin with human intent.</li>
      <li>Study the body, environment, and consequence.</li>
      <li>Choose the interaction that fits.</li>
      <li>Make state, feedback, and recovery clear.</li>
      <li>Let expression reinforce the structure.</li>
    </ol>
  </div>
</section>
"""


def convert_markdown(markdown_text: str) -> tuple[str, str]:
    md = Markdown(extensions=["extra", "sane_lists", "toc"], extension_configs={"toc": {"permalink": False}})
    article_html = md.convert(markdown_text)
    soup = BeautifulSoup(article_html, "html.parser")

    # Wide tables stay readable instead of forcing the whole page to overflow.
    for table in soup.find_all("table"):
        wrapper = soup.new_tag("div", attrs={"class": "table-wrap", "role": "region", "aria-label": "Scrollable table"})
        table.wrap(wrapper)

    def insert_after_heading(text: str, fragment: str) -> None:
        heading = next((h for h in soup.find_all(["h2", "h3"]) if h.get_text(" ", strip=True) == text), None)
        if heading:
            heading.insert_after(BeautifulSoup(fragment, "html.parser"))

    first_quote = soup.find("blockquote")
    if first_quote:
        first_quote.insert_after(BeautifulSoup(EVIDENCE_VISUAL, "html.parser"))
    insert_after_heading("4. Apple's stated philosophy in 2026", PRINCIPLES_VISUAL)
    insert_after_heading("5. The current design system", STACK_VISUAL)
    insert_after_heading("6. Platform adaptations", DEVICE_VISUAL)
    insert_after_heading("9. Critical assessment", TENSIONS_VISUAL)
    insert_after_heading("10. Synthesis: a five-layer model of Apple design", CLOSING_VISUAL)
    return str(soup), md.toc


def build_html(markdown_text: str) -> None:
    article_html, toc = convert_markdown(markdown_text)
    document = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="description" content="Research-grade analysis of Apple's design systems, philosophy, and device-specific principles through August 5, 2026.">
  <title>One language, many contexts - Apple design systems research</title>
  <style>{HTML_CSS}</style>
</head>
<body>
  <a class="skip-link" href="#research-paper">Skip to the paper</a>
  <div class="progress" aria-hidden="true"><span></span></div>
  <div class="topbar"><button class="icon-button" type="button" data-theme-toggle aria-label="Toggle color theme" aria-pressed="false">◐</button></div>
  <header class="hero">
    <div class="hero-inner">
      <div>
        <div class="eyebrow">Cross-platform research paper - 2026</div>
        <h1>One language,<br>many contexts.</h1>
        <p class="dek">Apple's design system is not a single look. It is a coordinated method for translating purpose, agency, responsibility, and craft across the hand, desk, wrist, room, road, and spatial field.</p>
        <div class="hero-meta"><span class="chip">56 references</span><span class="chip">10 device families + CarPlay</span><span class="chip">Historical + current</span><span class="chip">Critical analysis</span></div>
      </div>
      <div class="hero-visual" aria-label="Eight principles arranged around human context">
        <div class="orbit"><div class="orbit-label">Human<br>context</div><span class="orbit-node n1">Purpose</span><span class="orbit-node n2">Agency</span><span class="orbit-node n3">Responsibility</span><span class="orbit-node n4">Familiarity</span><span class="orbit-node n5">Flexibility</span><span class="orbit-node n6">Simplicity</span><span class="orbit-node n7">Craft</span><span class="orbit-node n8">Delight</span></div>
      </div>
    </div>
  </header>
  <details class="mobile-toc"><summary>Contents</summary><nav aria-label="Mobile table of contents">{toc}</nav></details>
  <div class="shell">
    <aside class="rail" aria-label="Table of contents"><p class="rail-title">Contents</p>{toc}</aside>
    <main id="research-paper" class="paper" tabindex="-1">{article_html}<div class="source-note"><strong>Source note.</strong> Apple documentation establishes what Apple prescribes and claims. Standards, peer-reviewed studies, and independent repair analysis are used to test the interpretation. Evidence is current through August 5, 2026.</div></main>
  </div>
  <footer>Independent research synthesis for local project use. No Apple trademarks, logos, product imagery, or proprietary interface assets are reproduced.</footer>
  <script>{HTML_JS}</script>
</body>
</html>"""
    HTML_PATH.write_text(document, encoding="utf-8")


class ConcentricDiagram(Flowable):
    def __init__(self, width: float = 160, height: float = 160):
        super().__init__()
        self.width = width
        self.height = height

    def draw(self) -> None:
        c = self.canv
        cx, cy = self.width / 2, self.height / 2
        c.saveState()
        for radius, color, line_width in [
            (74, colors.HexColor("#D7E8FF"), 1.2),
            (53, colors.HexColor("#B9D4F7"), 1.2),
            (32, colors.HexColor("#E2F4EE"), 1.2),
        ]:
            c.setStrokeColor(color)
            c.setLineWidth(line_width)
            c.circle(cx, cy, radius, stroke=1, fill=0)
        c.setFillColor(BLUE_SOFT)
        c.circle(cx, cy, 25, stroke=0, fill=1)
        c.setFillColor(INK)
        c.setFont(FONT_BOLD, 9)
        c.drawCentredString(cx, cy + 2, "HUMAN")
        c.drawCentredString(cx, cy - 10, "CONTEXT")
        labels = ["Purpose", "Agency", "Responsibility", "Familiarity", "Flexibility", "Simplicity", "Craft", "Delight"]
        positions = [(80,151),(131,128),(151,79),(128,28),(80,7),(30,29),(7,80),(31,130)]
        c.setFont(FONT_BOLD, 6.8)
        for label, (x, y) in zip(labels, positions):
            c.setFillColor(colors.white)
            c.roundRect(x - 23, y - 7, 46, 14, 7, stroke=0, fill=1)
            c.setStrokeColor(LINE)
            c.roundRect(x - 23, y - 7, 46, 14, 7, stroke=1, fill=0)
            c.setFillColor(INK_SOFT)
            c.drawCentredString(x, y - 2.3, label)
        c.restoreState()


class ResearchDocTemplate(BaseDocTemplate):
    def __init__(self, filename: str, **kwargs):
        super().__init__(filename, **kwargs)
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="body")
        self.addPageTemplates(PageTemplate(id="research", frames=frame, onPage=self._draw_page))
        self.section_title = "Apple design systems research"
        self._bookmark_id = 0

    def beforeDocument(self):
        # multiBuild lays the document out more than once so that the table of
        # contents can learn its final page numbers. Reset pass-local state or
        # the bookmark keys change on every pass and the index never resolves.
        self.section_title = "Apple design systems research"
        self._bookmark_id = 0

    def _draw_page(self, canvas, doc):
        if doc.page == 1:
            canvas.saveState()
            canvas.setFillColor(BLUE)
            canvas.rect(0, A4[1] - 8 * mm, A4[0], 8 * mm, fill=1, stroke=0)
            canvas.setStrokeColor(colors.HexColor("#D9E8FA"))
            for r in (22, 36, 50):
                canvas.circle(A4[0] - 28 * mm, A4[1] - 31 * mm, r, stroke=1, fill=0)
            canvas.restoreState()
            return
        canvas.saveState()
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(.5)
        canvas.line(self.leftMargin, A4[1] - 18 * mm, A4[0] - self.rightMargin, A4[1] - 18 * mm)
        canvas.setFont(FONT, 7.5)
        canvas.setFillColor(INK_SOFT)
        header = self.section_title[:88]
        canvas.drawString(self.leftMargin, A4[1] - 15 * mm, header)
        canvas.drawRightString(A4[0] - self.rightMargin, 12 * mm, f"{doc.page}")
        canvas.setFillColor(BLUE)
        canvas.rect(self.leftMargin, 10.6 * mm, 18 * mm, 1.2, fill=1, stroke=0)
        canvas.restoreState()

    def afterFlowable(self, flowable):
        if not isinstance(flowable, Paragraph):
            return
        name = flowable.style.name
        level_map = {"PDF-H1": 0, "PDF-H2": 1, "PDF-H3": 2}
        if name not in level_map:
            return
        text = flowable.getPlainText()
        self.section_title = text
        self._bookmark_id += 1
        key = f"heading-{self._bookmark_id}"
        self.canv.bookmarkPage(key)
        self.canv.addOutlineEntry(text, key, level=level_map[name], closed=False)
        self.notify("TOCEntry", (level_map[name], text, self.page, key))


def pdf_styles():
    styles = getSampleStyleSheet()
    return {
        "cover_kicker": ParagraphStyle("CoverKicker", fontName=FONT_BOLD, fontSize=8.5, leading=11, textColor=BLUE, tracking=1.6, spaceAfter=12),
        "cover_title": ParagraphStyle("CoverTitle", fontName=FONT_BOLD, fontSize=31, leading=31, textColor=INK, spaceAfter=14),
        "cover_subtitle": ParagraphStyle("CoverSubtitle", fontName=FONT, fontSize=14, leading=19, textColor=INK_SOFT, spaceAfter=24),
        "cover_meta": ParagraphStyle("CoverMeta", fontName=FONT, fontSize=8.7, leading=13, textColor=INK_SOFT, spaceAfter=4),
        "finding": ParagraphStyle("Finding", fontName=FONT_BOLD, fontSize=11, leading=16, textColor=INK, backColor=BLUE_SOFT, borderColor=colors.HexColor("#BCD5F5"), borderWidth=.8, borderPadding=12, borderRadius=7, spaceBefore=16, spaceAfter=16),
        "h1": ParagraphStyle("PDF-H1", fontName=FONT_BOLD, fontSize=19, leading=23, textColor=INK, spaceBefore=20, spaceAfter=9, keepWithNext=True),
        "h2": ParagraphStyle("PDF-H2", fontName=FONT_BOLD, fontSize=14, leading=18, textColor=BLUE, spaceBefore=16, spaceAfter=7, keepWithNext=True),
        "h3": ParagraphStyle("PDF-H3", fontName=FONT_BOLD, fontSize=11, leading=14, textColor=INK, spaceBefore=12, spaceAfter=5, keepWithNext=True),
        "body": ParagraphStyle("PDF-Body", fontName=FONT, fontSize=8.7, leading=13.2, textColor=INK_SOFT, alignment=TA_LEFT, spaceAfter=7.5, splitLongWords=True),
        "body_bold": ParagraphStyle("PDF-BodyBold", fontName=FONT_BOLD, fontSize=8.7, leading=13.2, textColor=INK, spaceAfter=7),
        "quote": ParagraphStyle("PDF-Quote", fontName=FONT_BOLD, fontSize=9.2, leading=14, textColor=INK, backColor=BLUE_SOFT, borderColor=BLUE, borderWidth=0, borderPadding=10, leftIndent=8, rightIndent=5, spaceBefore=8, spaceAfter=11),
        "caption": ParagraphStyle("PDF-Caption", fontName=FONT, fontSize=7.2, leading=10, textColor=INK_SOFT, spaceAfter=6),
        "table_head": ParagraphStyle("PDF-TableHead", fontName=FONT_BOLD, fontSize=6.7, leading=8.3, textColor=INK),
        "table_cell": ParagraphStyle("PDF-TableCell", fontName=FONT, fontSize=6.5, leading=8.2, textColor=INK_SOFT),
        "toc_title": ParagraphStyle("TOCTitle", fontName=FONT_BOLD, fontSize=19, leading=23, textColor=INK, spaceAfter=12),
        "toc0": ParagraphStyle("TOC0", fontName=FONT_BOLD, fontSize=9, leading=12, textColor=INK, leftIndent=0, firstLineIndent=0, spaceBefore=4),
        "toc1": ParagraphStyle("TOC1", fontName=FONT, fontSize=8, leading=11, textColor=INK_SOFT, leftIndent=12, firstLineIndent=0, spaceBefore=2),
        "toc2": ParagraphStyle("TOC2", fontName=FONT, fontSize=7.3, leading=9.6, textColor=INK_SOFT, leftIndent=24, firstLineIndent=0, spaceBefore=1),
    }


def clean_inline(node: Tag | NavigableString) -> str:
    if isinstance(node, NavigableString):
        return html.escape(str(node))
    name = node.name.lower()
    inner = "".join(clean_inline(child) for child in node.children)
    if name in {"strong", "b"}:
        return f"<b>{inner}</b>"
    if name in {"em", "i"}:
        return f"<i>{inner}</i>"
    if name == "code":
        return f'<font name="{FONT_MONO}" backColor="#EAF3FF">{inner}</font>'
    if name == "a":
        href = html.escape(node.get("href", ""), quote=True)
        return f'<a href="{href}" color="#1167D8">{inner}</a>'
    if name == "br":
        return "<br/>"
    return inner


def paragraph_from_tag(tag: Tag, style: ParagraphStyle) -> Paragraph:
    content = "".join(clean_inline(child) for child in tag.children).strip()
    return Paragraph(content or " ", style)


def make_pdf_table(tag: Tag, styles: dict, available_width: float) -> Table:
    rows = []
    for row_index, tr in enumerate(tag.find_all("tr", recursive=True)):
        cells = tr.find_all(["th", "td"], recursive=False)
        rows.append([
            Paragraph("".join(clean_inline(child) for child in cell.children), styles["table_head"] if row_index == 0 else styles["table_cell"])
            for cell in cells
        ])
    if not rows:
        return Table([[""]], colWidths=[available_width])
    count = max(len(row) for row in rows)
    if count == 2:
        widths = [available_width * .25, available_width * .75]
    elif count == 3:
        widths = [available_width * .23, available_width * .37, available_width * .40]
    elif count == 4:
        widths = [available_width * .18, available_width * .24, available_width * .30, available_width * .28]
    elif count == 5:
        widths = [available_width * .15, available_width * .22, available_width * .21, available_width * .21, available_width * .21]
    else:
        widths = [available_width / count] * count
    table = Table(rows, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE_SOFT),
        ("TEXTCOLOR", (0, 0), (-1, 0), INK),
        ("GRID", (0, 0), (-1, -1), .35, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PAPER]),
    ]))
    return table


def list_flowable(tag: Tag, styles: dict, ordered: bool) -> ListFlowable:
    items = []
    for li in tag.find_all("li", recursive=False):
        # Nested lists are handled as readable inline text to keep pagination stable.
        text = "".join(clean_inline(child) for child in li.children if not (isinstance(child, Tag) and child.name in {"ul", "ol"}))
        items.append(ListItem(Paragraph(text, styles["body"]), leftIndent=12))
    return ListFlowable(items, bulletType="1" if ordered else "bullet", start="1", leftIndent=18, bulletFontName=FONT, bulletFontSize=7.5, spaceAfter=7)


def html_to_story(markdown_text: str, styles: dict, available_width: float):
    md = Markdown(extensions=["extra", "sane_lists"])
    soup = BeautifulSoup(md.convert(markdown_text), "html.parser")
    children = list(soup.children)
    # The cover owns the title metadata. Begin the article at the Abstract.
    start = next((i for i, node in enumerate(children) if isinstance(node, Tag) and node.name == "h2" and node.get_text(" ", strip=True) == "Abstract"), 0)
    story = []
    for node in children[start:]:
        if isinstance(node, NavigableString) or not isinstance(node, Tag):
            continue
        if node.name == "h1":
            story.extend([paragraph_from_tag(node, styles["h1"]), Spacer(1, 2)])
        elif node.name == "h2":
            story.extend([paragraph_from_tag(node, styles["h1"]), HRFlowable(width="100%", thickness=.6, color=LINE, spaceAfter=6)])
        elif node.name == "h3":
            story.append(paragraph_from_tag(node, styles["h2"]))
        elif node.name == "h4":
            story.append(paragraph_from_tag(node, styles["h3"]))
        elif node.name == "p":
            story.append(paragraph_from_tag(node, styles["body"]))
        elif node.name == "blockquote":
            p = node.find("p") or node
            story.append(paragraph_from_tag(p, styles["quote"]))
        elif node.name in {"ul", "ol"}:
            story.append(list_flowable(node, styles, node.name == "ol"))
        elif node.name == "table":
            story.extend([Spacer(1, 4), make_pdf_table(node, styles, available_width), Spacer(1, 9)])
        elif node.name == "hr":
            story.append(HRFlowable(width="100%", thickness=.6, color=LINE, spaceBefore=8, spaceAfter=8))
    return story


def build_pdf(markdown_text: str) -> None:
    PDF_PATH.parent.mkdir(parents=True, exist_ok=True)
    styles = pdf_styles()
    doc = ResearchDocTemplate(
        str(PDF_PATH),
        pagesize=A4,
        pageCompression=1,
        rightMargin=21 * mm,
        leftMargin=21 * mm,
        topMargin=23 * mm,
        bottomMargin=19 * mm,
        title="One language, many contexts: Apple's design systems, philosophies, and principles",
        author="OpenAI Codex research synthesis",
        subject="Cross-platform Apple design systems research current through August 5, 2026",
        creator="ReportLab",
    )
    story = [
        Spacer(1, 20 * mm),
        Paragraph("CROSS-PLATFORM RESEARCH PAPER - 2026", styles["cover_kicker"]),
        Paragraph("One language,<br/>many contexts.", styles["cover_title"]),
        Paragraph("Apple's design systems, philosophies, and principles across its device ecosystem", styles["cover_subtitle"]),
        Table(
            [[ConcentricDiagram(), Paragraph(
                "<b>Central finding</b><br/><br/>Apple pursues a recognizable family resemblance across products, but changes interaction density, control placement, input, feedback, and even the meaning of depth according to the body, environment, and task. The operative rule is <b>unified, not uniform</b>.",
                styles["finding"],
            )]],
            colWidths=[170, doc.width - 170],
            style=TableStyle([("VALIGN", (0,0), (-1,-1), "MIDDLE"), ("LEFTPADDING", (0,0), (-1,-1), 0), ("RIGHTPADDING", (0,0), (-1,-1), 8)]),
        ),
        Spacer(1, 18 * mm),
        Paragraph("Evidence current through August 5, 2026", styles["cover_meta"]),
        Paragraph("56 numbered references - 10 device families plus CarPlay - 6 operating systems", styles["cover_meta"]),
        Paragraph("Primary Apple sources triangulated with standards, peer-reviewed HCI research, and independent repair analysis", styles["cover_meta"]),
        PageBreak(),
    ]

    article_story = html_to_story(markdown_text, styles, doc.width)
    abstract_end = next((i for i, item in enumerate(article_story) if isinstance(item, Paragraph) and item.getPlainText() == "1. Introduction"), 0)
    if abstract_end:
        story.extend(article_story[:abstract_end])
        story.extend([PageBreak(), Paragraph("Contents", styles["toc_title"])])
        toc = TableOfContents()
        toc.levelStyles = [styles["toc0"], styles["toc1"], styles["toc2"]]
        story.extend([toc, PageBreak()])
        story.extend(article_story[abstract_end:])
    else:
        story.extend([Paragraph("Contents", styles["toc_title"]), TableOfContents(), PageBreak()])
        story.extend(article_story)
    doc.multiBuild(story)


def main() -> int:
    if not MARKDOWN_PATH.exists():
        print(f"Missing source: {MARKDOWN_PATH}", file=sys.stderr)
        return 1
    markdown_text = MARKDOWN_PATH.read_text(encoding="utf-8")
    build_html(markdown_text)
    build_pdf(markdown_text)
    print(f"HTML: {HTML_PATH}")
    print(f"PDF:  {PDF_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
