export function buildSampleEscalationScreenshotDataUrl() {
  const lines = [
    ['Attempting to', 'Run unscheduled payroll for terminated employee in CA'],
    ['Expected outcome', 'Issue final paycheque dated 05/16'],
    ['Actual outcome', 'Wizard blocks at step 3 — term date after pay period'],
    ['Customer', 'Larkspur Roasters LLC · realm 9341 0027 5512'],
    ['Phone agent', 'Maya R. (T2, badge 4419)'],
    ['Steps tried', '1) Verified term date  2) Period change blocked  3) Cache clear  4) New browser'],
    ['Error / message', 'PSE_TERM_DATE_AFTER_PERIOD'],
    ['QBO product', 'QuickBooks Online Payroll'],
    ['Tier', 'Payroll Premium'],
  ];
  const rowHeight = 44;
  const padding = 28;
  const width = 760;
  const headerHeight = 88;
  const height = headerHeight + padding + lines.length * rowHeight + padding;
  const rows = lines
    .map(([k, v], i) => {
      const y = headerHeight + padding + i * rowHeight;
      return `
        <text x="${padding}" y="${y + 14}" fill="#7a7a7a" font-family="Inter, system-ui" font-size="11" font-weight="600" letter-spacing="0.6">${k.toUpperCase()}</text>
        <text x="${padding}" y="${y + 32}" fill="#1f2528" font-family="Inter, system-ui" font-size="14">${escapeXml(v)}</text>
        <line x1="${padding}" y1="${y + 40}" x2="${width - padding}" y2="${y + 40}" stroke="#e6e2d9" stroke-width="1"/>
      `;
    })
    .join('');
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="${width}" height="${height}" fill="#faf8f4"/>
      <rect x="0" y="0" width="${width}" height="${headerHeight}" fill="#17494d"/>
      <text x="${padding}" y="36" fill="#ffffff" font-family="Inter, system-ui" font-size="18" font-weight="700">QuickBooks Escalation Template</text>
      <text x="${padding}" y="60" fill="#d4e9eb" font-family="Inter, system-ui" font-size="13">Case ESC-2026-0516-A4 · captured 11:42</text>
      <rect x="${width - 140}" y="22" width="118" height="44" rx="6" fill="#d9531e"/>
      <text x="${width - 81}" y="48" fill="#ffffff" font-family="Inter, system-ui" font-size="13" font-weight="700" text-anchor="middle">PAYROLL · P2</text>
      ${rows}
    </svg>
  `;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
