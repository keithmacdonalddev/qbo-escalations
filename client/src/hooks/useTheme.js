import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

const STORAGE_KEY = 'qbo-theme-settings';

/**
 * Original color themes — evocative, chromatic, and carefully balanced.
 * Each theme provides a complete set of CSS custom property overrides.
 */
export const COLOR_THEMES = [
  {
    id: 'obsidian-ember',
    name: 'Obsidian Ember',
    description: 'Volcanic warmth — ember glow on obsidian',
    category: 'Warm',
    preview: { accent: '#c76a22', bg: '#f5f2ed', surface: '#fcfaf7', text: '#2a2420' },
    light: {
      '--bg': '#f5f2ed', '--bg-raised': '#fcfaf7', '--bg-sunken': '#ebe7e0', '--bg-sidebar': '#f8f6f2',
      '--ink': '#2a2420', '--ink-secondary': '#6e5f52', '--ink-tertiary': '#9a8b7c',
      '--line': '#d4cbc0', '--line-subtle': '#e4ddd4',
      '--accent': '#c76a22', '--accent-hover': '#a8571a', '--accent-subtle': '#faf0e4', '--accent-muted': '#e8c09a',
      '--success': '#2e7d52', '--success-subtle': '#e4f2ea', '--warning': '#b8860b', '--warning-subtle': '#fdf4de',
      '--danger': '#b33025', '--danger-subtle': '#fbe8e6', '--info': '#c76a22',
      '--bubble-user': '#faf0e4', '--bubble-assistant': '#fcfaf7', '--bubble-system': '#ebe7e0',
      '--status-open-bg': '#fdf4de', '--status-open-text': '#8a6508', '--status-open-dot': '#b8860b',
      '--status-progress-bg': '#f5ebe0', '--status-progress-text': '#a8571a', '--status-progress-dot': '#c76a22',
      '--status-resolved-bg': '#e4f2ea', '--status-resolved-text': '#236040', '--status-resolved-dot': '#2e7d52',
      '--status-escalated-bg': '#fbe8e6', '--status-escalated-text': '#8c251c', '--status-escalated-dot': '#b33025',
    },
    dark: {
      '--bg': '#141210', '--bg-raised': '#1e1b17', '--bg-sunken': '#0e0d0b', '--bg-sidebar': '#1a1714',
      '--ink': '#ede6dc', '--ink-secondary': '#a89a8a', '--ink-tertiary': '#6e6254',
      '--line': '#362f27', '--line-subtle': '#2a2520',
      '--accent': '#db9447', '--accent-hover': '#e5ac62', '--accent-subtle': '#2a1e10', '--accent-muted': '#3e2c18',
      '--success': '#5cb87a', '--success-subtle': '#142a1c', '--warning': '#daa520', '--warning-subtle': '#2a2210',
      '--danger': '#e05a4e', '--danger-subtle': '#2e1714', '--info': '#db9447',
      '--bubble-user': '#2a1e10', '--bubble-assistant': '#1e1b17', '--bubble-system': '#0e0d0b',
      '--status-open-bg': '#2a2210', '--status-open-text': '#daa520', '--status-open-dot': '#daa520',
      '--status-progress-bg': '#2a1e10', '--status-progress-text': '#db9447', '--status-progress-dot': '#db9447',
      '--status-resolved-bg': '#142a1c', '--status-resolved-text': '#5cb87a', '--status-resolved-dot': '#5cb87a',
      '--status-escalated-bg': '#2e1714', '--status-escalated-text': '#e05a4e', '--status-escalated-dot': '#e05a4e',
    },
  },
  {
    id: 'arctic-aurora',
    name: 'Arctic Aurora',
    description: 'Northern lights on polar night',
    category: 'Cool',
    preview: { accent: '#2cb5a0', bg: '#f0f4f8', surface: '#f8fafc', text: '#1a2332' },
    light: {
      '--bg': '#f0f4f8', '--bg-raised': '#f8fafc', '--bg-sunken': '#e4eaf0', '--bg-sidebar': '#f4f7fb',
      '--ink': '#1a2332', '--ink-secondary': '#4a5a6e', '--ink-tertiary': '#8494a6',
      '--line': '#c8d4e0', '--line-subtle': '#dde5ee',
      '--accent': '#2cb5a0', '--accent-hover': '#22907e', '--accent-subtle': '#e2f5f2', '--accent-muted': '#a0ddd3',
      '--success': '#2a9d6e', '--success-subtle': '#e0f5ec', '--warning': '#c48e1a', '--warning-subtle': '#fdf4de',
      '--danger': '#d04560', '--danger-subtle': '#fbe6eb', '--info': '#2cb5a0',
      '--bubble-user': '#e2f5f2', '--bubble-assistant': '#f8fafc', '--bubble-system': '#e4eaf0',
      '--status-open-bg': '#fdf4de', '--status-open-text': '#8a6508', '--status-open-dot': '#c48e1a',
      '--status-progress-bg': '#e2f5f2', '--status-progress-text': '#22907e', '--status-progress-dot': '#2cb5a0',
      '--status-resolved-bg': '#e0f5ec', '--status-resolved-text': '#1f7a54', '--status-resolved-dot': '#2a9d6e',
      '--status-escalated-bg': '#fbe6eb', '--status-escalated-text': '#a8354c', '--status-escalated-dot': '#d04560',
    },
    dark: {
      '--bg': '#0c1222', '--bg-raised': '#151e30', '--bg-sunken': '#080e1a', '--bg-sidebar': '#101828',
      '--ink': '#dce6f0', '--ink-secondary': '#8aa0b8', '--ink-tertiary': '#5a7088',
      '--line': '#1e2e42', '--line-subtle': '#162438',
      '--accent': '#4adbc0', '--accent-hover': '#68e5d0', '--accent-subtle': '#0c2420', '--accent-muted': '#14362e',
      '--success': '#4ed8a0', '--success-subtle': '#0c2a1c', '--warning': '#e8b840', '--warning-subtle': '#222010',
      '--danger': '#f06878', '--danger-subtle': '#2a1218', '--info': '#4adbc0',
      '--bubble-user': '#0c2420', '--bubble-assistant': '#151e30', '--bubble-system': '#080e1a',
      '--status-open-bg': '#222010', '--status-open-text': '#e8b840', '--status-open-dot': '#e8b840',
      '--status-progress-bg': '#0c2420', '--status-progress-text': '#4adbc0', '--status-progress-dot': '#4adbc0',
      '--status-resolved-bg': '#0c2a1c', '--status-resolved-text': '#4ed8a0', '--status-resolved-dot': '#4ed8a0',
      '--status-escalated-bg': '#2a1218', '--status-escalated-text': '#f06878', '--status-escalated-dot': '#f06878',
    },
  },
  {
    id: 'midnight-orchid',
    name: 'Midnight Orchid',
    description: 'Twilight garden — orchid bloom on indigo',
    category: 'Cool',
    preview: { accent: '#a855f7', bg: '#f6f3f9', surface: '#fbf9fd', text: '#2a2035' },
    light: {
      '--bg': '#f6f3f9', '--bg-raised': '#fbf9fd', '--bg-sunken': '#eceaf2', '--bg-sidebar': '#f8f5fb',
      '--ink': '#2a2035', '--ink-secondary': '#5e4e72', '--ink-tertiary': '#9486a5',
      '--line': '#d4ccdf', '--line-subtle': '#e4ddef',
      '--accent': '#a855f7', '--accent-hover': '#8b3ad8', '--accent-subtle': '#f3e8fe', '--accent-muted': '#d0a8f8',
      '--success': '#2e8a62', '--success-subtle': '#e2f3ec', '--warning': '#c8841a', '--warning-subtle': '#fdf2de',
      '--danger': '#e04580', '--danger-subtle': '#fce6ef', '--info': '#a855f7',
      '--bubble-user': '#f3e8fe', '--bubble-assistant': '#fbf9fd', '--bubble-system': '#eceaf2',
      '--status-open-bg': '#fdf2de', '--status-open-text': '#8a6010', '--status-open-dot': '#c8841a',
      '--status-progress-bg': '#f3e8fe', '--status-progress-text': '#8b3ad8', '--status-progress-dot': '#a855f7',
      '--status-resolved-bg': '#e2f3ec', '--status-resolved-text': '#1f6a4a', '--status-resolved-dot': '#2e8a62',
      '--status-escalated-bg': '#fce6ef', '--status-escalated-text': '#b03068', '--status-escalated-dot': '#e04580',
    },
    dark: {
      '--bg': '#12101c', '--bg-raised': '#1c1828', '--bg-sunken': '#0c0a14', '--bg-sidebar': '#16131f',
      '--ink': '#e4ddf0', '--ink-secondary': '#a498b8', '--ink-tertiary': '#6a5e80',
      '--line': '#2a2440', '--line-subtle': '#201c32',
      '--accent': '#c084fc', '--accent-hover': '#d4a8ff', '--accent-subtle': '#1e142e', '--accent-muted': '#2e2048',
      '--success': '#5cd098', '--success-subtle': '#102a1e', '--warning': '#e8a840', '--warning-subtle': '#24200e',
      '--danger': '#f068a0', '--danger-subtle': '#2a1020', '--info': '#c084fc',
      '--bubble-user': '#1e142e', '--bubble-assistant': '#1c1828', '--bubble-system': '#0c0a14',
      '--status-open-bg': '#24200e', '--status-open-text': '#e8a840', '--status-open-dot': '#e8a840',
      '--status-progress-bg': '#1e142e', '--status-progress-text': '#c084fc', '--status-progress-dot': '#c084fc',
      '--status-resolved-bg': '#102a1e', '--status-resolved-text': '#5cd098', '--status-resolved-dot': '#5cd098',
      '--status-escalated-bg': '#2a1020', '--status-escalated-text': '#f068a0', '--status-escalated-dot': '#f068a0',
    },
  },
  {
    id: 'copper-patina',
    name: 'Copper Patina',
    description: 'Aged bronze — patina green on warm copper',
    category: 'Warm',
    preview: { accent: '#2a8a7a', bg: '#f4f0e8', surface: '#faf7f2', text: '#3a2e22' },
    light: {
      '--bg': '#f4f0e8', '--bg-raised': '#faf7f2', '--bg-sunken': '#eae5db', '--bg-sidebar': '#f7f3ec',
      '--ink': '#3a2e22', '--ink-secondary': '#6e5e4e', '--ink-tertiary': '#998878',
      '--line': '#d2c8b8', '--line-subtle': '#e2dace',
      '--accent': '#2a8a7a', '--accent-hover': '#1e6e62', '--accent-subtle': '#e0f2ee', '--accent-muted': '#9ed4ca',
      '--success': '#2a8a5a', '--success-subtle': '#e0f2e6', '--warning': '#b8781a', '--warning-subtle': '#fdf0d8',
      '--danger': '#a84030', '--danger-subtle': '#f8e4e0', '--info': '#2a8a7a',
      '--bubble-user': '#e0f2ee', '--bubble-assistant': '#faf7f2', '--bubble-system': '#eae5db',
      '--status-open-bg': '#fdf0d8', '--status-open-text': '#8a5a10', '--status-open-dot': '#b8781a',
      '--status-progress-bg': '#e0f2ee', '--status-progress-text': '#1e6e62', '--status-progress-dot': '#2a8a7a',
      '--status-resolved-bg': '#e0f2e6', '--status-resolved-text': '#1e6e44', '--status-resolved-dot': '#2a8a5a',
      '--status-escalated-bg': '#f8e4e0', '--status-escalated-text': '#843024', '--status-escalated-dot': '#a84030',
    },
    dark: {
      '--bg': '#151210', '--bg-raised': '#201c17', '--bg-sunken': '#0f0e0c', '--bg-sidebar': '#1a1714',
      '--ink': '#e6ddd0', '--ink-secondary': '#a89880', '--ink-tertiary': '#6e6250',
      '--line': '#342c22', '--line-subtle': '#282218',
      '--accent': '#48b8a0', '--accent-hover': '#68d0b8', '--accent-subtle': '#102820', '--accent-muted': '#1a3a30',
      '--success': '#50c088', '--success-subtle': '#102a1a', '--warning': '#d8a030', '--warning-subtle': '#282010',
      '--danger': '#d86050', '--danger-subtle': '#2a1612', '--info': '#48b8a0',
      '--bubble-user': '#102820', '--bubble-assistant': '#201c17', '--bubble-system': '#0f0e0c',
      '--status-open-bg': '#282010', '--status-open-text': '#d8a030', '--status-open-dot': '#d8a030',
      '--status-progress-bg': '#102820', '--status-progress-text': '#48b8a0', '--status-progress-dot': '#48b8a0',
      '--status-resolved-bg': '#102a1a', '--status-resolved-text': '#50c088', '--status-resolved-dot': '#50c088',
      '--status-escalated-bg': '#2a1612', '--status-escalated-text': '#d86050', '--status-escalated-dot': '#d86050',
    },
  },
  {
    id: 'solar-flare',
    name: 'Solar Flare',
    description: 'Corona gold on deep space',
    category: 'Vibrant',
    preview: { accent: '#d4880a', bg: '#faf8f4', surface: '#fefdfb', text: '#1c1810' },
    light: {
      '--bg': '#faf8f4', '--bg-raised': '#fefdfb', '--bg-sunken': '#f0ede6', '--bg-sidebar': '#fcfaf6',
      '--ink': '#1c1810', '--ink-secondary': '#5a5440', '--ink-tertiary': '#8e8672',
      '--line': '#d8d2c2', '--line-subtle': '#e8e2d6',
      '--accent': '#d4880a', '--accent-hover': '#b07208', '--accent-subtle': '#fdf2da', '--accent-muted': '#ecc87a',
      '--success': '#2c8a48', '--success-subtle': '#e2f4e6', '--warning': '#d4880a', '--warning-subtle': '#fdf2da',
      '--danger': '#c43020', '--danger-subtle': '#fce4e0', '--info': '#d4880a',
      '--bubble-user': '#fdf2da', '--bubble-assistant': '#fefdfb', '--bubble-system': '#f0ede6',
      '--status-open-bg': '#fdf2da', '--status-open-text': '#8a6008', '--status-open-dot': '#d4880a',
      '--status-progress-bg': '#fdf2da', '--status-progress-text': '#b07208', '--status-progress-dot': '#d4880a',
      '--status-resolved-bg': '#e2f4e6', '--status-resolved-text': '#1e6e34', '--status-resolved-dot': '#2c8a48',
      '--status-escalated-bg': '#fce4e0', '--status-escalated-text': '#982418', '--status-escalated-dot': '#c43020',
    },
    dark: {
      '--bg': '#0e0c08', '--bg-raised': '#1a1710', '--bg-sunken': '#080706', '--bg-sidebar': '#14120c',
      '--ink': '#ede6d4', '--ink-secondary': '#a89e84', '--ink-tertiary': '#6e6650',
      '--line': '#302a1a', '--line-subtle': '#242012',
      '--accent': '#f0a830', '--accent-hover': '#f4be58', '--accent-subtle': '#282008', '--accent-muted': '#3a2e10',
      '--success': '#50c070', '--success-subtle': '#102a16', '--warning': '#f0a830', '--warning-subtle': '#282008',
      '--danger': '#e85040', '--danger-subtle': '#2a1410', '--info': '#f0a830',
      '--bubble-user': '#282008', '--bubble-assistant': '#1a1710', '--bubble-system': '#080706',
      '--status-open-bg': '#282008', '--status-open-text': '#f0a830', '--status-open-dot': '#f0a830',
      '--status-progress-bg': '#282008', '--status-progress-text': '#f0a830', '--status-progress-dot': '#f0a830',
      '--status-resolved-bg': '#102a16', '--status-resolved-text': '#50c070', '--status-resolved-dot': '#50c070',
      '--status-escalated-bg': '#2a1410', '--status-escalated-text': '#e85040', '--status-escalated-dot': '#e85040',
    },
  },
  {
    id: 'deep-biolume',
    name: 'Deep Biolume',
    description: 'Bioluminescent glow in ocean depths',
    category: 'Cool',
    preview: { accent: '#0ea5c8', bg: '#eef3f8', surface: '#f6f9fc', text: '#152030' },
    light: {
      '--bg': '#eef3f8', '--bg-raised': '#f6f9fc', '--bg-sunken': '#e2eaf2', '--bg-sidebar': '#f2f6fa',
      '--ink': '#152030', '--ink-secondary': '#3e5468', '--ink-tertiary': '#7a8e9e',
      '--line': '#c4d2de', '--line-subtle': '#d8e2ec',
      '--accent': '#0ea5c8', '--accent-hover': '#0a849e', '--accent-subtle': '#dff2f8', '--accent-muted': '#90d4e8',
      '--success': '#20906a', '--success-subtle': '#dcf2ea', '--warning': '#c08a18', '--warning-subtle': '#fdf2d8',
      '--danger': '#c84838', '--danger-subtle': '#fce4e0', '--info': '#0ea5c8',
      '--bubble-user': '#dff2f8', '--bubble-assistant': '#f6f9fc', '--bubble-system': '#e2eaf2',
      '--status-open-bg': '#fdf2d8', '--status-open-text': '#886210', '--status-open-dot': '#c08a18',
      '--status-progress-bg': '#dff2f8', '--status-progress-text': '#0a849e', '--status-progress-dot': '#0ea5c8',
      '--status-resolved-bg': '#dcf2ea', '--status-resolved-text': '#166e50', '--status-resolved-dot': '#20906a',
      '--status-escalated-bg': '#fce4e0', '--status-escalated-text': '#9e3428', '--status-escalated-dot': '#c84838',
    },
    dark: {
      '--bg': '#0a1018', '--bg-raised': '#121e28', '--bg-sunken': '#06090e', '--bg-sidebar': '#0e1620',
      '--ink': '#d4e2ee', '--ink-secondary': '#80a0b8', '--ink-tertiary': '#4e6e84',
      '--line': '#182838', '--line-subtle': '#10202e',
      '--accent': '#22d3ee', '--accent-hover': '#48e0f4', '--accent-subtle': '#081e24', '--accent-muted': '#102e38',
      '--success': '#40c890', '--success-subtle': '#0a2a1a', '--warning': '#e0a830', '--warning-subtle': '#221e08',
      '--danger': '#f06858', '--danger-subtle': '#281210', '--info': '#22d3ee',
      '--bubble-user': '#081e24', '--bubble-assistant': '#121e28', '--bubble-system': '#06090e',
      '--status-open-bg': '#221e08', '--status-open-text': '#e0a830', '--status-open-dot': '#e0a830',
      '--status-progress-bg': '#081e24', '--status-progress-text': '#22d3ee', '--status-progress-dot': '#22d3ee',
      '--status-resolved-bg': '#0a2a1a', '--status-resolved-text': '#40c890', '--status-resolved-dot': '#40c890',
      '--status-escalated-bg': '#281210', '--status-escalated-text': '#f06858', '--status-escalated-dot': '#f06858',
    },
  },
  {
    id: 'rosewood',
    name: 'Rosewood',
    description: 'Library warmth — rose gold on mahogany',
    category: 'Warm',
    preview: { accent: '#c4596a', bg: '#f8f4f2', surface: '#fdfbfa', text: '#2e2024' },
    light: {
      '--bg': '#f8f4f2', '--bg-raised': '#fdfbfa', '--bg-sunken': '#eee8e4', '--bg-sidebar': '#faf6f4',
      '--ink': '#2e2024', '--ink-secondary': '#6e525a', '--ink-tertiary': '#9e8890',
      '--line': '#d8ccc8', '--line-subtle': '#e8deda',
      '--accent': '#c4596a', '--accent-hover': '#a04455', '--accent-subtle': '#fce8ec', '--accent-muted': '#e4a8b4',
      '--success': '#3a8a5a', '--success-subtle': '#e2f2e8', '--warning': '#b88820', '--warning-subtle': '#fdf2da',
      '--danger': '#b83840', '--danger-subtle': '#fce2e4', '--info': '#c4596a',
      '--bubble-user': '#fce8ec', '--bubble-assistant': '#fdfbfa', '--bubble-system': '#eee8e4',
      '--status-open-bg': '#fdf2da', '--status-open-text': '#886218', '--status-open-dot': '#b88820',
      '--status-progress-bg': '#fce8ec', '--status-progress-text': '#a04455', '--status-progress-dot': '#c4596a',
      '--status-resolved-bg': '#e2f2e8', '--status-resolved-text': '#266a42', '--status-resolved-dot': '#3a8a5a',
      '--status-escalated-bg': '#fce2e4', '--status-escalated-text': '#8e2a30', '--status-escalated-dot': '#b83840',
    },
    dark: {
      '--bg': '#161012', '--bg-raised': '#221a1e', '--bg-sunken': '#0e0a0c', '--bg-sidebar': '#1c1418',
      '--ink': '#ecdee2', '--ink-secondary': '#a88e96', '--ink-tertiary': '#6e5860',
      '--line': '#382830', '--line-subtle': '#2a2026',
      '--accent': '#d6828f', '--accent-hover': '#dea0a9', '--accent-subtle': '#2a1418', '--accent-muted': '#3e2028',
      '--success': '#58c080', '--success-subtle': '#122a1a', '--warning': '#d8a830', '--warning-subtle': '#262010',
      '--danger': '#e05060', '--danger-subtle': '#2a1214', '--info': '#d6828f',
      '--bubble-user': '#2a1418', '--bubble-assistant': '#221a1e', '--bubble-system': '#0e0a0c',
      '--status-open-bg': '#262010', '--status-open-text': '#d8a830', '--status-open-dot': '#d8a830',
      '--status-progress-bg': '#2a1418', '--status-progress-text': '#d6828f', '--status-progress-dot': '#d6828f',
      '--status-resolved-bg': '#122a1a', '--status-resolved-text': '#58c080', '--status-resolved-dot': '#58c080',
      '--status-escalated-bg': '#2a1214', '--status-escalated-text': '#e05060', '--status-escalated-dot': '#e05060',
    },
  },
  {
    id: 'neon-drift',
    name: 'Neon Drift',
    description: 'Electric pulse — neon on midnight',
    category: 'Vibrant',
    preview: { accent: '#d946ef', bg: '#f8f8fa', surface: '#fefeff', text: '#18141e' },
    light: {
      '--bg': '#f8f8fa', '--bg-raised': '#fefeff', '--bg-sunken': '#eeeef2', '--bg-sidebar': '#fafafc',
      '--ink': '#18141e', '--ink-secondary': '#504860', '--ink-tertiary': '#8a82a0',
      '--line': '#d4d0de', '--line-subtle': '#e4e0ee',
      '--accent': '#d946ef', '--accent-hover': '#b830c8', '--accent-subtle': '#fae6fe', '--accent-muted': '#e8a0f4',
      '--success': '#20a048', '--success-subtle': '#def4e4', '--warning': '#c8a008', '--warning-subtle': '#fdf6d8',
      '--danger': '#d82828', '--danger-subtle': '#fce2e2', '--info': '#d946ef',
      '--bubble-user': '#fae6fe', '--bubble-assistant': '#fefeff', '--bubble-system': '#eeeef2',
      '--status-open-bg': '#fdf6d8', '--status-open-text': '#8a7008', '--status-open-dot': '#c8a008',
      '--status-progress-bg': '#fae6fe', '--status-progress-text': '#b830c8', '--status-progress-dot': '#d946ef',
      '--status-resolved-bg': '#def4e4', '--status-resolved-text': '#168036', '--status-resolved-dot': '#20a048',
      '--status-escalated-bg': '#fce2e2', '--status-escalated-text': '#a81e1e', '--status-escalated-dot': '#d82828',
    },
    dark: {
      '--bg': '#0e0a14', '--bg-raised': '#1a1424', '--bg-sunken': '#08060c', '--bg-sidebar': '#12101c',
      '--ink': '#e8e0f2', '--ink-secondary': '#a89cc0', '--ink-tertiary': '#6a5e82',
      '--line': '#28203a', '--line-subtle': '#1e182e',
      '--accent': '#e281f1', '--accent-hover': '#eca0f8', '--accent-subtle': '#221030', '--accent-muted': '#341a48',
      '--success': '#40e870', '--success-subtle': '#0a2a12', '--warning': '#f0d030', '--warning-subtle': '#222008',
      '--danger': '#f84848', '--danger-subtle': '#2a0e0e', '--info': '#e281f1',
      '--bubble-user': '#221030', '--bubble-assistant': '#1a1424', '--bubble-system': '#08060c',
      '--status-open-bg': '#222008', '--status-open-text': '#f0d030', '--status-open-dot': '#f0d030',
      '--status-progress-bg': '#221030', '--status-progress-text': '#e281f1', '--status-progress-dot': '#e281f1',
      '--status-resolved-bg': '#0a2a12', '--status-resolved-text': '#40e870', '--status-resolved-dot': '#40e870',
      '--status-escalated-bg': '#2a0e0e', '--status-escalated-text': '#f84848', '--status-escalated-dot': '#f84848',
    },
  },
  {
    id: 'moss-stone',
    name: 'Moss & Stone',
    description: 'Forest floor — sage moss on wet stone',
    category: 'Neutral',
    preview: { accent: '#5a8a5c', bg: '#f2f3f0', surface: '#f9faf8', text: '#2a2c28' },
    light: {
      '--bg': '#f2f3f0', '--bg-raised': '#f9faf8', '--bg-sunken': '#e8eae4', '--bg-sidebar': '#f5f6f3',
      '--ink': '#2a2c28', '--ink-secondary': '#585c54', '--ink-tertiary': '#8a8e84',
      '--line': '#cdd0c8', '--line-subtle': '#dde0d8',
      '--accent': '#5a8a5c', '--accent-hover': '#467048', '--accent-subtle': '#e4f0e4', '--accent-muted': '#a8cca8',
      '--success': '#2e8040', '--success-subtle': '#e0f2e2', '--warning': '#b08818', '--warning-subtle': '#fdf2d8',
      '--danger': '#b04030', '--danger-subtle': '#f8e4e0', '--info': '#5a8a5c',
      '--bubble-user': '#e4f0e4', '--bubble-assistant': '#f9faf8', '--bubble-system': '#e8eae4',
      '--status-open-bg': '#fdf2d8', '--status-open-text': '#806010', '--status-open-dot': '#b08818',
      '--status-progress-bg': '#e4f0e4', '--status-progress-text': '#467048', '--status-progress-dot': '#5a8a5c',
      '--status-resolved-bg': '#e0f2e2', '--status-resolved-text': '#1e6430', '--status-resolved-dot': '#2e8040',
      '--status-escalated-bg': '#f8e4e0', '--status-escalated-text': '#883024', '--status-escalated-dot': '#b04030',
    },
    dark: {
      '--bg': '#121412', '--bg-raised': '#1c1e1a', '--bg-sunken': '#0c0e0c', '--bg-sidebar': '#171a16',
      '--ink': '#dce0d8', '--ink-secondary': '#90968a', '--ink-tertiary': '#5c625a',
      '--line': '#2a2e28', '--line-subtle': '#20241e',
      '--accent': '#86ac87', '--accent-hover': '#9cc49e', '--accent-subtle': '#142018', '--accent-muted': '#1e3020',
      '--success': '#50b060', '--success-subtle': '#102a14', '--warning': '#d8a830', '--warning-subtle': '#222010',
      '--danger': '#d85840', '--danger-subtle': '#281410', '--info': '#86ac87',
      '--bubble-user': '#142018', '--bubble-assistant': '#1c1e1a', '--bubble-system': '#0c0e0c',
      '--status-open-bg': '#222010', '--status-open-text': '#d8a830', '--status-open-dot': '#d8a830',
      '--status-progress-bg': '#142018', '--status-progress-text': '#86ac87', '--status-progress-dot': '#86ac87',
      '--status-resolved-bg': '#102a14', '--status-resolved-text': '#50b060', '--status-resolved-dot': '#50b060',
      '--status-escalated-bg': '#281410', '--status-escalated-text': '#d85840', '--status-escalated-dot': '#d85840',
    },
  },
  {
    id: 'starlight',
    name: 'Starlight',
    description: 'Quiet evening — silver glow, periwinkle sky',
    category: 'Neutral',
    preview: { accent: '#6366f1', bg: '#f4f4f8', surface: '#fafafe', text: '#22222e' },
    light: {
      '--bg': '#f4f4f8', '--bg-raised': '#fafafe', '--bg-sunken': '#eaeaef', '--bg-sidebar': '#f7f7fb',
      '--ink': '#22222e', '--ink-secondary': '#52525e', '--ink-tertiary': '#8888a0',
      '--line': '#ceced8', '--line-subtle': '#dedee8',
      '--accent': '#6366f1', '--accent-hover': '#4f50d0', '--accent-subtle': '#ebebfe', '--accent-muted': '#b0b0f8',
      '--success': '#2e8a50', '--success-subtle': '#e0f4e8', '--warning': '#c09018', '--warning-subtle': '#fdf4d8',
      '--danger': '#c03838', '--danger-subtle': '#fce2e2', '--info': '#6366f1',
      '--bubble-user': '#ebebfe', '--bubble-assistant': '#fafafe', '--bubble-system': '#eaeaef',
      '--status-open-bg': '#fdf4d8', '--status-open-text': '#886810', '--status-open-dot': '#c09018',
      '--status-progress-bg': '#ebebfe', '--status-progress-text': '#4f50d0', '--status-progress-dot': '#6366f1',
      '--status-resolved-bg': '#e0f4e8', '--status-resolved-text': '#1e6a38', '--status-resolved-dot': '#2e8a50',
      '--status-escalated-bg': '#fce2e2', '--status-escalated-text': '#982a2a', '--status-escalated-dot': '#c03838',
    },
    dark: {
      '--bg': '#111118', '--bg-raised': '#1a1a24', '--bg-sunken': '#0a0a10', '--bg-sidebar': '#14141e',
      '--ink': '#dcdce8', '--ink-secondary': '#9090a8', '--ink-tertiary': '#5c5c72',
      '--line': '#28283a', '--line-subtle': '#1e1e2e',
      '--accent': '#818cf8', '--accent-hover': '#a0a8ff', '--accent-subtle': '#181830', '--accent-muted': '#242448',
      '--success': '#50c878', '--success-subtle': '#0e2a18', '--warning': '#e0b030', '--warning-subtle': '#22200e',
      '--danger': '#e85050', '--danger-subtle': '#2a1010', '--info': '#818cf8',
      '--bubble-user': '#181830', '--bubble-assistant': '#1a1a24', '--bubble-system': '#0a0a10',
      '--status-open-bg': '#22200e', '--status-open-text': '#e0b030', '--status-open-dot': '#e0b030',
      '--status-progress-bg': '#181830', '--status-progress-text': '#818cf8', '--status-progress-dot': '#818cf8',
      '--status-resolved-bg': '#0e2a18', '--status-resolved-text': '#50c878', '--status-resolved-dot': '#50c878',
      '--status-escalated-bg': '#2a1010', '--status-escalated-text': '#e85050', '--status-escalated-dot': '#e85050',
    },
  },
  // === Classic essentials ===
  {
    id: 'paper-light',
    name: 'Paper',
    description: 'Clean and bright — pure, airy workspace',
    category: 'Classic',
    preview: { accent: '#2563eb', bg: '#ffffff', surface: '#ffffff', text: '#111827' },
    light: {
      '--bg': '#f9fafb', '--bg-raised': '#ffffff', '--bg-sunken': '#f3f4f6', '--bg-sidebar': '#ffffff',
      '--ink': '#111827', '--ink-secondary': '#4b5563', '--ink-tertiary': '#9ca3af',
      '--line': '#e5e7eb', '--line-subtle': '#f3f4f6',
      '--accent': '#2563eb', '--accent-hover': '#1d4ed8', '--accent-subtle': '#eff6ff', '--accent-muted': '#93c5fd',
      '--success': '#059669', '--success-subtle': '#ecfdf5', '--warning': '#d97706', '--warning-subtle': '#fffbeb',
      '--danger': '#dc2626', '--danger-subtle': '#fef2f2', '--info': '#2563eb',
      '--bubble-user': '#eff6ff', '--bubble-assistant': '#ffffff', '--bubble-system': '#f3f4f6',
      '--status-open-bg': '#fffbeb', '--status-open-text': '#92400e', '--status-open-dot': '#d97706',
      '--status-progress-bg': '#eff6ff', '--status-progress-text': '#1d4ed8', '--status-progress-dot': '#2563eb',
      '--status-resolved-bg': '#ecfdf5', '--status-resolved-text': '#065f46', '--status-resolved-dot': '#059669',
      '--status-escalated-bg': '#fef2f2', '--status-escalated-text': '#991b1b', '--status-escalated-dot': '#dc2626',
    },
    dark: {
      '--bg': '#111827', '--bg-raised': '#1f2937', '--bg-sunken': '#0d1117', '--bg-sidebar': '#111827',
      '--ink': '#f9fafb', '--ink-secondary': '#9ca3af', '--ink-tertiary': '#6b7280',
      '--line': '#374151', '--line-subtle': '#1f2937',
      '--accent': '#4785ea', '--accent-hover': '#6ca0f2', '--accent-subtle': '#172554', '--accent-muted': '#1e3a5f',
      '--success': '#34d399', '--success-subtle': '#064e3b', '--warning': '#fbbf24', '--warning-subtle': '#78350f',
      '--danger': '#f87171', '--danger-subtle': '#7f1d1d', '--info': '#4785ea',
      '--bubble-user': '#172554', '--bubble-assistant': '#1f2937', '--bubble-system': '#0d1117',
      '--status-open-bg': '#78350f', '--status-open-text': '#fbbf24', '--status-open-dot': '#fbbf24',
      '--status-progress-bg': '#172554', '--status-progress-text': '#4785ea', '--status-progress-dot': '#4785ea',
      '--status-resolved-bg': '#064e3b', '--status-resolved-text': '#34d399', '--status-resolved-dot': '#34d399',
      '--status-escalated-bg': '#7f1d1d', '--status-escalated-text': '#f87171', '--status-escalated-dot': '#f87171',
    },
  },
  {
    id: 'carbon',
    name: 'Carbon',
    description: 'Pure dark mode — zero distractions',
    category: 'Classic',
    preview: { accent: '#a78bfa', bg: '#18181b', surface: '#27272a', text: '#fafafa' },
    light: {
      '--bg': '#fafafa', '--bg-raised': '#ffffff', '--bg-sunken': '#f4f4f5', '--bg-sidebar': '#fafafa',
      '--ink': '#18181b', '--ink-secondary': '#52525b', '--ink-tertiary': '#a1a1aa',
      '--line': '#d4d4d8', '--line-subtle': '#e4e4e7',
      '--accent': '#7c3aed', '--accent-hover': '#6d28d9', '--accent-subtle': '#f5f3ff', '--accent-muted': '#c4b5fd',
      '--success': '#16a34a', '--success-subtle': '#f0fdf4', '--warning': '#ca8a04', '--warning-subtle': '#fefce8',
      '--danger': '#dc2626', '--danger-subtle': '#fef2f2', '--info': '#7c3aed',
      '--bubble-user': '#f5f3ff', '--bubble-assistant': '#ffffff', '--bubble-system': '#f4f4f5',
      '--status-open-bg': '#fefce8', '--status-open-text': '#854d0e', '--status-open-dot': '#ca8a04',
      '--status-progress-bg': '#f5f3ff', '--status-progress-text': '#6d28d9', '--status-progress-dot': '#7c3aed',
      '--status-resolved-bg': '#f0fdf4', '--status-resolved-text': '#15803d', '--status-resolved-dot': '#16a34a',
      '--status-escalated-bg': '#fef2f2', '--status-escalated-text': '#b91c1c', '--status-escalated-dot': '#dc2626',
    },
    dark: {
      '--bg': '#09090b', '--bg-raised': '#18181b', '--bg-sunken': '#050505', '--bg-sidebar': '#0e0e10',
      '--ink': '#fafafa', '--ink-secondary': '#a1a1aa', '--ink-tertiary': '#52525b',
      '--line': '#27272a', '--line-subtle': '#1c1c1f',
      '--accent': '#ab92f3', '--accent-hover': '#c4b5fd', '--accent-subtle': '#1e1535', '--accent-muted': '#2e2050',
      '--success': '#4ade80', '--success-subtle': '#052e16', '--warning': '#facc15', '--warning-subtle': '#422006',
      '--danger': '#f87171', '--danger-subtle': '#450a0a', '--info': '#ab92f3',
      '--bubble-user': '#1e1535', '--bubble-assistant': '#18181b', '--bubble-system': '#050505',
      '--status-open-bg': '#422006', '--status-open-text': '#facc15', '--status-open-dot': '#facc15',
      '--status-progress-bg': '#1e1535', '--status-progress-text': '#ab92f3', '--status-progress-dot': '#ab92f3',
      '--status-resolved-bg': '#052e16', '--status-resolved-text': '#4ade80', '--status-resolved-dot': '#4ade80',
      '--status-escalated-bg': '#450a0a', '--status-escalated-text': '#f87171', '--status-escalated-dot': '#f87171',
    },
  },
  // === Brand-inspired originals ===
  {
    id: 'titanium',
    name: 'Titanium',
    description: 'Industrial precision — brushed metal, red accents',
    category: 'Vibrant',
    preview: { accent: '#ef4444', bg: '#fafafa', surface: '#ffffff', text: '#0a0a0a' },
    light: {
      '--bg': '#f5f5f5', '--bg-raised': '#ffffff', '--bg-sunken': '#ebebeb', '--bg-sidebar': '#f5f5f5',
      '--ink': '#0a0a0a', '--ink-secondary': '#404040', '--ink-tertiary': '#8a8a8a',
      '--line': '#d4d4d4', '--line-subtle': '#e5e5e5',
      '--accent': '#dc2626', '--accent-hover': '#b91c1c', '--accent-subtle': '#fef2f2', '--accent-muted': '#fca5a5',
      '--success': '#16a34a', '--success-subtle': '#f0fdf4', '--warning': '#ea580c', '--warning-subtle': '#fff7ed',
      '--danger': '#dc2626', '--danger-subtle': '#fef2f2', '--info': '#dc2626',
      '--bubble-user': '#fef2f2', '--bubble-assistant': '#ffffff', '--bubble-system': '#ebebeb',
      '--status-open-bg': '#fff7ed', '--status-open-text': '#9a3412', '--status-open-dot': '#ea580c',
      '--status-progress-bg': '#fef2f2', '--status-progress-text': '#b91c1c', '--status-progress-dot': '#dc2626',
      '--status-resolved-bg': '#f0fdf4', '--status-resolved-text': '#15803d', '--status-resolved-dot': '#16a34a',
      '--status-escalated-bg': '#fef2f2', '--status-escalated-text': '#991b1b', '--status-escalated-dot': '#dc2626',
    },
    dark: {
      '--bg': '#0c0c0c', '--bg-raised': '#171717', '--bg-sunken': '#050505', '--bg-sidebar': '#0f0f0f',
      '--ink': '#e5e5e5', '--ink-secondary': '#8a8a8a', '--ink-tertiary': '#525252',
      '--line': '#262626', '--line-subtle': '#1a1a1a',
      '--accent': '#e35050', '--accent-hover': '#ee7272', '--accent-subtle': '#2a0e0e', '--accent-muted': '#451010',
      '--success': '#4ade80', '--success-subtle': '#052e16', '--warning': '#fb923c', '--warning-subtle': '#431407',
      '--danger': '#e35050', '--danger-subtle': '#2a0e0e', '--info': '#e35050',
      '--bubble-user': '#2a0e0e', '--bubble-assistant': '#171717', '--bubble-system': '#050505',
      '--status-open-bg': '#431407', '--status-open-text': '#fb923c', '--status-open-dot': '#fb923c',
      '--status-progress-bg': '#2a0e0e', '--status-progress-text': '#e35050', '--status-progress-dot': '#e35050',
      '--status-resolved-bg': '#052e16', '--status-resolved-text': '#4ade80', '--status-resolved-dot': '#4ade80',
      '--status-escalated-bg': '#2a0e0e', '--status-escalated-text': '#e35050', '--status-escalated-dot': '#e35050',
    },
  },
  {
    id: 'cupertino',
    name: 'Cupertino',
    description: 'Refined clarity — precision blue, perfect whites',
    category: 'Classic',
    preview: { accent: '#007aff', bg: '#f2f2f7', surface: '#ffffff', text: '#1c1c1e' },
    light: {
      '--bg': '#f2f2f7', '--bg-raised': '#ffffff', '--bg-sunken': '#e5e5ea', '--bg-sidebar': '#f2f2f7',
      '--ink': '#1c1c1e', '--ink-secondary': '#3a3a3c', '--ink-tertiary': '#aeaeb2',
      '--line': '#c7c7cc', '--line-subtle': '#d1d1d6',
      '--accent': '#007aff', '--accent-hover': '#0055d4', '--accent-subtle': '#e8f2ff', '--accent-muted': '#80bcff',
      '--success': '#34c759', '--success-subtle': '#e8faf0', '--warning': '#ff9500', '--warning-subtle': '#fff5e5',
      '--danger': '#ff3b30', '--danger-subtle': '#ffe8e6', '--info': '#007aff',
      '--bubble-user': '#007aff', '--bubble-assistant': '#e5e5ea', '--bubble-system': '#f2f2f7',
      '--status-open-bg': '#fff5e5', '--status-open-text': '#a35f00', '--status-open-dot': '#ff9500',
      '--status-progress-bg': '#e8f2ff', '--status-progress-text': '#0055d4', '--status-progress-dot': '#007aff',
      '--status-resolved-bg': '#e8faf0', '--status-resolved-text': '#1b8a38', '--status-resolved-dot': '#34c759',
      '--status-escalated-bg': '#ffe8e6', '--status-escalated-text': '#cc2e25', '--status-escalated-dot': '#ff3b30',
    },
    dark: {
      '--bg': '#050507', '--bg-raised': '#1c1c1e', '--bg-sunken': '#020204', '--bg-sidebar': '#0a0a0a',
      '--ink': '#ffffff', '--ink-secondary': '#aeaeb2', '--ink-tertiary': '#636366',
      '--line': '#38383a', '--line-subtle': '#2c2c2e',
      '--accent': '#0a84ff', '--accent-hover': '#409cff', '--accent-subtle': '#001a33', '--accent-muted': '#003566',
      '--success': '#30d158', '--success-subtle': '#0a2e14', '--warning': '#ff9f0a', '--warning-subtle': '#332000',
      '--danger': '#ff453a', '--danger-subtle': '#330e0c', '--info': '#0a84ff',
      '--bubble-user': '#0a84ff', '--bubble-assistant': '#1c1c1e', '--bubble-system': '#050507',
      '--status-open-bg': '#332000', '--status-open-text': '#ff9f0a', '--status-open-dot': '#ff9f0a',
      '--status-progress-bg': '#001a33', '--status-progress-text': '#0a84ff', '--status-progress-dot': '#0a84ff',
      '--status-resolved-bg': '#0a2e14', '--status-resolved-text': '#30d158', '--status-resolved-dot': '#30d158',
      '--status-escalated-bg': '#330e0c', '--status-escalated-text': '#ff453a', '--status-escalated-dot': '#ff453a',
    },
  },
  {
    id: 'material-jade',
    name: 'Material Jade',
    description: 'Dynamic surfaces — tonal depth, jade energy',
    category: 'Cool',
    preview: { accent: '#009688', bg: '#fafbfc', surface: '#ffffff', text: '#1d1b20' },
    light: {
      '--bg': '#f7faf9', '--bg-raised': '#ffffff', '--bg-sunken': '#e8f0ee', '--bg-sidebar': '#f0f5f4',
      '--ink': '#1d1b20', '--ink-secondary': '#49454f', '--ink-tertiary': '#79747e',
      '--line': '#c4cdc9', '--line-subtle': '#dde5e2',
      '--accent': '#009688', '--accent-hover': '#00796b', '--accent-subtle': '#e0f2f1', '--accent-muted': '#80cbc4',
      '--success': '#2e7d32', '--success-subtle': '#e8f5e9', '--warning': '#f57f17', '--warning-subtle': '#fff8e1',
      '--danger': '#c62828', '--danger-subtle': '#ffebee', '--info': '#009688',
      '--bubble-user': '#e0f2f1', '--bubble-assistant': '#ffffff', '--bubble-system': '#e8f0ee',
      '--status-open-bg': '#fff8e1', '--status-open-text': '#a86200', '--status-open-dot': '#f57f17',
      '--status-progress-bg': '#e0f2f1', '--status-progress-text': '#00796b', '--status-progress-dot': '#009688',
      '--status-resolved-bg': '#e8f5e9', '--status-resolved-text': '#1b5e20', '--status-resolved-dot': '#2e7d32',
      '--status-escalated-bg': '#ffebee', '--status-escalated-text': '#b71c1c', '--status-escalated-dot': '#c62828',
    },
    dark: {
      '--bg': '#0f1512', '--bg-raised': '#1a2420', '--bg-sunken': '#080e0b', '--bg-sidebar': '#121c18',
      '--ink': '#e6ede9', '--ink-secondary': '#8a9e94', '--ink-tertiary': '#546e62',
      '--line': '#2a3e36', '--line-subtle': '#1e302a',
      '--accent': '#4db6ac', '--accent-hover': '#80cbc4', '--accent-subtle': '#0a2420', '--accent-muted': '#153830',
      '--success': '#66bb6a', '--success-subtle': '#0e2a12', '--warning': '#ffb74d', '--warning-subtle': '#2a1e08',
      '--danger': '#ef5350', '--danger-subtle': '#2a0e0e', '--info': '#4db6ac',
      '--bubble-user': '#0a2420', '--bubble-assistant': '#1a2420', '--bubble-system': '#080e0b',
      '--status-open-bg': '#2a1e08', '--status-open-text': '#ffb74d', '--status-open-dot': '#ffb74d',
      '--status-progress-bg': '#0a2420', '--status-progress-text': '#4db6ac', '--status-progress-dot': '#4db6ac',
      '--status-resolved-bg': '#0e2a12', '--status-resolved-text': '#66bb6a', '--status-resolved-dot': '#66bb6a',
      '--status-escalated-bg': '#2a0e0e', '--status-escalated-text': '#ef5350', '--status-escalated-dot': '#ef5350',
    },
  },
  {
    id: 'monochrome',
    name: 'Monochrome',
    description: 'Zero color — absolute content focus',
    category: 'Classic',
    preview: { accent: '#525252', bg: '#fafafa', surface: '#ffffff', text: '#0a0a0a' },
    light: {
      '--bg': '#fafafa', '--bg-raised': '#ffffff', '--bg-sunken': '#f0f0f0', '--bg-sidebar': '#f5f5f5',
      '--ink': '#0a0a0a', '--ink-secondary': '#525252', '--ink-tertiary': '#a3a3a3',
      '--line': '#d4d4d4', '--line-subtle': '#e5e5e5',
      '--accent': '#171717', '--accent-hover': '#000000', '--accent-subtle': '#f5f5f5', '--accent-muted': '#a3a3a3',
      '--success': '#16a34a', '--success-subtle': '#f0fdf4', '--warning': '#d97706', '--warning-subtle': '#fffbeb',
      '--danger': '#dc2626', '--danger-subtle': '#fef2f2', '--info': '#525252',
      '--bubble-user': '#f0f0f0', '--bubble-assistant': '#ffffff', '--bubble-system': '#f5f5f5',
      '--status-open-bg': '#fffbeb', '--status-open-text': '#92400e', '--status-open-dot': '#d97706',
      '--status-progress-bg': '#f0f0f0', '--status-progress-text': '#171717', '--status-progress-dot': '#525252',
      '--status-resolved-bg': '#f0fdf4', '--status-resolved-text': '#15803d', '--status-resolved-dot': '#16a34a',
      '--status-escalated-bg': '#fef2f2', '--status-escalated-text': '#991b1b', '--status-escalated-dot': '#dc2626',
    },
    dark: {
      '--bg': '#0a0a0a', '--bg-raised': '#141414', '--bg-sunken': '#050505', '--bg-sidebar': '#0e0e0e',
      '--ink': '#e5e5e5', '--ink-secondary': '#a3a3a3', '--ink-tertiary': '#525252',
      '--line': '#262626', '--line-subtle': '#1a1a1a',
      '--accent': '#d4d4d4', '--accent-hover': '#e5e5e5', '--accent-subtle': '#1a1a1a', '--accent-muted': '#333333',
      '--success': '#4ade80', '--success-subtle': '#052e16', '--warning': '#fbbf24', '--warning-subtle': '#422006',
      '--danger': '#f87171', '--danger-subtle': '#450a0a', '--info': '#a3a3a3',
      '--bubble-user': '#1a1a1a', '--bubble-assistant': '#141414', '--bubble-system': '#050505',
      '--status-open-bg': '#422006', '--status-open-text': '#fbbf24', '--status-open-dot': '#fbbf24',
      '--status-progress-bg': '#1a1a1a', '--status-progress-text': '#d4d4d4', '--status-progress-dot': '#d4d4d4',
      '--status-resolved-bg': '#052e16', '--status-resolved-text': '#4ade80', '--status-resolved-dot': '#4ade80',
      '--status-escalated-bg': '#450a0a', '--status-escalated-text': '#f87171', '--status-escalated-dot': '#f87171',
    },
  },
  {
    id: 'dracula',
    name: 'Dracula',
    description: 'The classic — purple night, green glow',
    category: 'Vibrant',
    preview: { accent: '#bd93f9', bg: '#282a36', surface: '#44475a', text: '#f8f8f2' },
    light: {
      '--bg': '#f8f8f2', '--bg-raised': '#ffffff', '--bg-sunken': '#eeeee8', '--bg-sidebar': '#f2f2ec',
      '--ink': '#282a36', '--ink-secondary': '#44475a', '--ink-tertiary': '#6272a4',
      '--line': '#c8c8c0', '--line-subtle': '#ddddd8',
      '--accent': '#8b5cf6', '--accent-hover': '#7c3aed', '--accent-subtle': '#f0ebff', '--accent-muted': '#c4b5fd',
      '--success': '#50fa7b', '--success-subtle': '#e8ffe8', '--warning': '#f1fa8c', '--warning-subtle': '#fafae0',
      '--danger': '#ff5555', '--danger-subtle': '#ffe8e8', '--info': '#8be9fd',
      '--bubble-user': '#f0ebff', '--bubble-assistant': '#ffffff', '--bubble-system': '#eeeee8',
      '--status-open-bg': '#fafae0', '--status-open-text': '#8a8a0e', '--status-open-dot': '#c0c040',
      '--status-progress-bg': '#e8f8ff', '--status-progress-text': '#4da8c0', '--status-progress-dot': '#8be9fd',
      '--status-resolved-bg': '#e8ffe8', '--status-resolved-text': '#2a8a3e', '--status-resolved-dot': '#50fa7b',
      '--status-escalated-bg': '#ffe8e8', '--status-escalated-text': '#cc3333', '--status-escalated-dot': '#ff5555',
    },
    dark: {
      '--bg': '#282a36', '--bg-raised': '#44475a', '--bg-sunken': '#1e1f2e', '--bg-sidebar': '#21222c',
      '--ink': '#f8f8f2', '--ink-secondary': '#bfbfb6', '--ink-tertiary': '#6272a4',
      '--line': '#555770', '--line-subtle': '#3a3c4e',
      '--accent': '#bd93f9', '--accent-hover': '#d4b8ff', '--accent-subtle': '#2e2548', '--accent-muted': '#3e3060',
      '--success': '#50fa7b', '--success-subtle': '#18382a', '--warning': '#f1fa8c', '--warning-subtle': '#303018',
      '--danger': '#ff5555', '--danger-subtle': '#3a1818', '--info': '#8be9fd',
      '--bubble-user': '#2e2548', '--bubble-assistant': '#44475a', '--bubble-system': '#1e1f2e',
      '--status-open-bg': '#303018', '--status-open-text': '#f1fa8c', '--status-open-dot': '#f1fa8c',
      '--status-progress-bg': '#182838', '--status-progress-text': '#8be9fd', '--status-progress-dot': '#8be9fd',
      '--status-resolved-bg': '#18382a', '--status-resolved-text': '#50fa7b', '--status-resolved-dot': '#50fa7b',
      '--status-escalated-bg': '#3a1818', '--status-escalated-text': '#ff5555', '--status-escalated-dot': '#ff5555',
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    description: 'Polar frost — cool blue-gray serenity',
    category: 'Cool',
    preview: { accent: '#88c0d0', bg: '#2e3440', surface: '#3b4252', text: '#eceff4' },
    light: {
      '--bg': '#eceff4', '--bg-raised': '#ffffff', '--bg-sunken': '#d8dee9', '--bg-sidebar': '#e5e9f0',
      '--ink': '#2e3440', '--ink-secondary': '#434c5e', '--ink-tertiary': '#7b88a1',
      '--line': '#c0c8d8', '--line-subtle': '#d8dee9',
      '--accent': '#5e81ac', '--accent-hover': '#4c6e96', '--accent-subtle': '#e8f0f8', '--accent-muted': '#a3bdd5',
      '--success': '#a3be8c', '--success-subtle': '#eef4e8', '--warning': '#ebcb8b', '--warning-subtle': '#faf4e5',
      '--danger': '#bf616a', '--danger-subtle': '#f6e5e7', '--info': '#88c0d0',
      '--bubble-user': '#e8f0f8', '--bubble-assistant': '#ffffff', '--bubble-system': '#d8dee9',
      '--status-open-bg': '#faf4e5', '--status-open-text': '#9a7c3a', '--status-open-dot': '#ebcb8b',
      '--status-progress-bg': '#e0f0f5', '--status-progress-text': '#4c7a8a', '--status-progress-dot': '#88c0d0',
      '--status-resolved-bg': '#eef4e8', '--status-resolved-text': '#6a8a58', '--status-resolved-dot': '#a3be8c',
      '--status-escalated-bg': '#f6e5e7', '--status-escalated-text': '#904850', '--status-escalated-dot': '#bf616a',
    },
    dark: {
      '--bg': '#2e3440', '--bg-raised': '#3b4252', '--bg-sunken': '#272c36', '--bg-sidebar': '#2e3440',
      '--ink': '#eceff4', '--ink-secondary': '#b0b8c8', '--ink-tertiary': '#7b88a1',
      '--line': '#434c5e', '--line-subtle': '#3b4252',
      '--accent': '#88c0d0', '--accent-hover': '#a3d4e0', '--accent-subtle': '#1e2830', '--accent-muted': '#2a3a44',
      '--success': '#a3be8c', '--success-subtle': '#1e2a18', '--warning': '#ebcb8b', '--warning-subtle': '#2e2818',
      '--danger': '#bf616a', '--danger-subtle': '#2e1a1c', '--info': '#88c0d0',
      '--bubble-user': '#1e2830', '--bubble-assistant': '#3b4252', '--bubble-system': '#272c36',
      '--status-open-bg': '#2e2818', '--status-open-text': '#ebcb8b', '--status-open-dot': '#ebcb8b',
      '--status-progress-bg': '#1e2830', '--status-progress-text': '#88c0d0', '--status-progress-dot': '#88c0d0',
      '--status-resolved-bg': '#1e2a18', '--status-resolved-text': '#a3be8c', '--status-resolved-dot': '#a3be8c',
      '--status-escalated-bg': '#2e1a1c', '--status-escalated-text': '#bf616a', '--status-escalated-dot': '#bf616a',
    },
  },
  // === Apple macOS ===
  {
    id: 'apple',
    name: 'Apple',
    description: 'macOS aesthetic — frosted aluminum, warm graphite',
    category: 'Classic',
    preview: { accent: '#0071e3', bg: '#1d1d1f', surface: '#2c2c2e', text: '#f5f5f7' },
    light: {
      '--bg': '#f5f5f7', '--bg-raised': '#ffffff', '--bg-sunken': '#e8e8ed', '--bg-sidebar': '#f0f0f5',
      '--ink': '#1d1d1f', '--ink-secondary': '#6e6e73', '--ink-tertiary': '#aeaeb2',
      '--line': '#d2d2d7', '--line-subtle': '#e8e8ed',
      '--accent': '#0071e3', '--accent-hover': '#0077ed', '--accent-subtle': '#e8f2ff', '--accent-muted': '#68a9f0',
      '--success': '#2db84b', '--success-subtle': '#e5f8eb', '--warning': '#f7821b', '--warning-subtle': '#fff3e6',
      '--danger': '#e3362d', '--danger-subtle': '#fde8e7', '--info': '#0071e3',
      '--bubble-user': '#0071e3', '--bubble-assistant': '#e8e8ed', '--bubble-system': '#f5f5f7',
      '--status-open-bg': '#fff3e6', '--status-open-text': '#a35e0a', '--status-open-dot': '#f7821b',
      '--status-progress-bg': '#e8f2ff', '--status-progress-text': '#005bb5', '--status-progress-dot': '#0071e3',
      '--status-resolved-bg': '#e5f8eb', '--status-resolved-text': '#1a8a35', '--status-resolved-dot': '#2db84b',
      '--status-escalated-bg': '#fde8e7', '--status-escalated-text': '#b52b24', '--status-escalated-dot': '#e3362d',
    },
    dark: {
      '--bg': '#1d1d1f', '--bg-raised': '#2c2c2e', '--bg-sunken': '#161617', '--bg-sidebar': '#1d1d1f',
      '--ink': '#f5f5f7', '--ink-secondary': '#a1a1a6', '--ink-tertiary': '#636366',
      '--line': '#38383a', '--line-subtle': '#2c2c2e',
      '--accent': '#2997ff', '--accent-hover': '#5ab3ff', '--accent-subtle': '#0a1a2e', '--accent-muted': '#0d3566',
      '--success': '#30d158', '--success-subtle': '#0a2e14', '--warning': '#ff9f0a', '--warning-subtle': '#332000',
      '--danger': '#ff453a', '--danger-subtle': '#330e0c', '--info': '#2997ff',
      '--bubble-user': '#0a1a2e', '--bubble-assistant': '#2c2c2e', '--bubble-system': '#161617',
      '--status-open-bg': '#332000', '--status-open-text': '#ff9f0a', '--status-open-dot': '#ff9f0a',
      '--status-progress-bg': '#0a1a2e', '--status-progress-text': '#2997ff', '--status-progress-dot': '#2997ff',
      '--status-resolved-bg': '#0a2e14', '--status-resolved-text': '#30d158', '--status-resolved-dot': '#30d158',
      '--status-escalated-bg': '#330e0c', '--status-escalated-text': '#ff453a', '--status-escalated-dot': '#ff453a',
    },
  },
];

const THEME_CATEGORIES = ['All', 'Classic', 'Warm', 'Cool', 'Vibrant', 'Neutral'];

function getSystemColorScheme() {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage full or unavailable
  }
}

/**
 * Adjust a hex color's brightness and contrast using HSL manipulation.
 * brightness: -100 to +100 (darkens/lightens)
 * contrast: -100 to +100 (reduces/increases contrast from midpoint)
 */
function adjustColor(hex, brightness, contrast) {
  if (!hex || hex === 'none' || hex.startsWith('var(')) return hex;
  // Handle rgba
  if (hex.startsWith('rgba') || hex.startsWith('rgb')) return hex;

  let r, g, b;
  const clean = hex.replace('#', '');
  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16);
    g = parseInt(clean[1] + clean[1], 16);
    b = parseInt(clean[2] + clean[2], 16);
  } else {
    r = parseInt(clean.slice(0, 2), 16);
    g = parseInt(clean.slice(2, 4), 16);
    b = parseInt(clean.slice(4, 6), 16);
  }

  // Guard against malformed hex producing NaN
  if (isNaN(r) || isNaN(g) || isNaN(b)) return hex;

  // Convert to HSL
  const rf = r / 255, gf = g / 255, bf = b / 255;
  const max = Math.max(rf, gf, bf), min = Math.min(rf, gf, bf);
  let h, s, l = (max + min) / 2;

  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rf) h = ((gf - bf) / d + (gf < bf ? 6 : 0)) / 6;
    else if (max === gf) h = ((bf - rf) / d + 2) / 6;
    else h = ((rf - gf) / d + 4) / 6;
  }

  // Apply brightness: proportional shift (light colors shift less, dark shift more)
  if (brightness > 0) {
    // Brighten: scale remaining headroom proportionally
    l = l + (1 - l) * (brightness / 100);
  } else if (brightness < 0) {
    // Darken: scale existing lightness proportionally
    l = l * (1 + brightness / 100);
  }
  l = Math.max(0, Math.min(1, l));

  // Apply contrast: push L away from 0.5 (capped to prevent total collapse)
  if (contrast !== 0) {
    // Clamp factor so contrast -100 still preserves ~20% differentiation
    const factor = 1 + (contrast / 125);
    l = 0.5 + (l - 0.5) * factor;
    l = Math.max(0, Math.min(1, l));
  }

  // HSL back to RGB
  let r2, g2, b2;
  if (s === 0) {
    r2 = g2 = b2 = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r2 = hue2rgb(p, q, h + 1/3);
    g2 = hue2rgb(p, q, h);
    b2 = hue2rgb(p, q, h - 1/3);
  }

  const toHex = v => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${toHex(r2)}${toHex(g2)}${toHex(b2)}`;
}

// Default typography sizes (px) — matches :root in App.css
const BASE_TEXT_SIZES = {
  '--text-xs': 11,
  '--text-sm': 13,
  '--text-base': 14.5,
  '--text-md': 15.5,
  '--text-lg': 18,
  '--text-xl': 22,
  '--text-2xl': 28,
};

const TEXT_SIZE_PROPS = Object.keys(BASE_TEXT_SIZES);

// Text color properties that textBrightness adjusts
const TEXT_COLOR_PROPS = ['--ink', '--ink-secondary', '--ink-tertiary'];

/**
 * Apply text size scaling to CSS custom properties.
 * textSize: -4 to +4 steps. Each step adds/removes ~1.5px from base sizes,
 * scaled proportionally (larger sizes change more).
 */
function applyTextSize(textSize) {
  const root = document.documentElement;
  if (textSize === 0) {
    TEXT_SIZE_PROPS.forEach(prop => root.style.removeProperty(prop));
    return;
  }
  const scaleFactor = 1 + (textSize * 0.08); // ±8% per step
  TEXT_SIZE_PROPS.forEach(prop => {
    const base = BASE_TEXT_SIZES[prop];
    const scaled = Math.round(base * scaleFactor * 10) / 10;
    root.style.setProperty(prop, `${scaled}px`);
  });
}

/**
 * Apply text brightness adjustment with aggressive lightness shifting.
 * Uses direct HSL lightness interpolation for a much wider effective range
 * than the main adjustColor function.
 * textBrightness: -100 to +100.
 *   +100 pushes text toward pure white (L=1.0)
 *   -100 pushes text toward pure black (L=0.0)
 */
function adjustTextColor(hex, amount) {
  if (!hex || !hex.startsWith('#')) return hex;
  const clean = hex.replace('#', '');
  let r, g, b;
  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16);
    g = parseInt(clean[1] + clean[1], 16);
    b = parseInt(clean[2] + clean[2], 16);
  } else {
    r = parseInt(clean.slice(0, 2), 16);
    g = parseInt(clean.slice(2, 4), 16);
    b = parseInt(clean.slice(4, 6), 16);
  }
  if (isNaN(r) || isNaN(g) || isNaN(b)) return hex;

  const rf = r / 255, gf = g / 255, bf = b / 255;
  const max = Math.max(rf, gf, bf), min = Math.min(rf, gf, bf);
  let h, s, l = (max + min) / 2;

  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rf) h = ((gf - bf) / d + (gf < bf ? 6 : 0)) / 6;
    else if (max === gf) h = ((bf - rf) / d + 2) / 6;
    else h = ((rf - gf) / d + 4) / 6;
  }

  // Interpolate L toward target: +100 → L=1.0, -100 → L=0.0
  const t = Math.abs(amount) / 100;
  const target = amount > 0 ? 1.0 : 0.0;
  l = l + (target - l) * t;
  l = Math.max(0, Math.min(1, l));

  let r2, g2, b2;
  if (s === 0) {
    r2 = g2 = b2 = l;
  } else {
    const hue2rgb = (p, q, tv) => {
      if (tv < 0) tv += 1;
      if (tv > 1) tv -= 1;
      if (tv < 1/6) return p + (q - p) * 6 * tv;
      if (tv < 1/2) return q;
      if (tv < 2/3) return p + (q - p) * (2/3 - tv) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r2 = hue2rgb(p, q, h + 1/3);
    g2 = hue2rgb(p, q, h);
    b2 = hue2rgb(p, q, h - 1/3);
  }

  const toHex = v => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${toHex(r2)}${toHex(g2)}${toHex(b2)}`;
}

function applyTextBrightness(textBrightness, themeId, schemeFn) {
  const root = document.documentElement;
  if (textBrightness === 0) {
    TEXT_COLOR_PROPS.forEach(prop => root.style.removeProperty(prop));
    return;
  }
  const theme = COLOR_THEMES.find(t => t.id === themeId);
  if (!theme) return;
  const scheme = schemeFn();
  const baseValues = scheme === 'dark' ? theme.dark : theme.light;

  TEXT_COLOR_PROPS.forEach(prop => {
    const base = baseValues[prop];
    if (base) {
      root.style.setProperty(prop, adjustTextColor(base, textBrightness));
    }
  });
}

// Properties that should receive brightness/contrast adjustments
const ADJUSTABLE_PROPS = [
  '--bg', '--bg-raised', '--bg-sunken', '--bg-sidebar',
  '--ink', '--ink-secondary', '--ink-tertiary',
  '--line', '--line-subtle',
  '--accent', '--accent-hover', '--accent-subtle', '--accent-muted',
  '--success', '--success-subtle', '--warning', '--warning-subtle',
  '--danger', '--danger-subtle', '--info',
  '--bubble-user', '--bubble-assistant', '--bubble-system',
  '--status-open-bg', '--status-open-text', '--status-open-dot',
  '--status-progress-bg', '--status-progress-text', '--status-progress-dot',
  '--status-resolved-bg', '--status-resolved-text', '--status-resolved-dot',
  '--status-escalated-bg', '--status-escalated-text', '--status-escalated-dot',
];

function applyTheme(themeId, brightness, contrast) {
  const theme = COLOR_THEMES.find(t => t.id === themeId);
  if (!theme) return;

  const root = document.documentElement;
  const scheme = getSystemColorScheme();
  const baseValues = scheme === 'dark' ? theme.dark : theme.light;
  const isDefault = themeId === 'obsidian-ember';
  const hasAdjustments = brightness !== 0 || contrast !== 0;

  // Default theme with no adjustments — clear all inline overrides
  if (isDefault && !hasAdjustments) {
    ADJUSTABLE_PROPS.forEach(prop => root.style.removeProperty(prop));
    root.removeAttribute('data-theme');
    return;
  }

  root.setAttribute('data-theme', themeId);

  // Always apply from the theme's stored baseline values (never from
  // getComputedStyle, which would read back already-adjusted inline
  // values and compound the adjustment on every slider tick).
  ADJUSTABLE_PROPS.forEach(prop => {
    const base = baseValues[prop];
    if (base) {
      if (hasAdjustments) {
        root.style.setProperty(prop, adjustColor(base, brightness, contrast));
      } else {
        root.style.setProperty(prop, base);
      }
    } else {
      // Property not defined by this theme — remove inline so stylesheet default applies
      root.style.removeProperty(prop);
    }
  });
}

/** Validate a saved themeId still exists in the theme list */
function validateThemeId(id) {
  if (!id) return 'obsidian-ember';
  return COLOR_THEMES.some(t => t.id === id) ? id : 'obsidian-ember';
}

/** Load initial settings synchronously to avoid FOUC */
function getInitialSettings() {
  const saved = loadSettings();
  if (!saved) return { themeId: 'obsidian-ember', brightness: 0, contrast: 0, textSize: 0, textBrightness: 0 };
  return {
    themeId: validateThemeId(saved.themeId),
    brightness: Math.max(-50, Math.min(50, saved.brightness ?? 0)),
    contrast: Math.max(-50, Math.min(50, saved.contrast ?? 0)),
    textSize: Math.max(-4, Math.min(4, saved.textSize ?? 0)),
    textBrightness: Math.max(-100, Math.min(100, saved.textBrightness ?? 0)),
  };
}

const _initial = getInitialSettings();

export default function useTheme() {
  const [themeId, setThemeIdRaw] = useState(_initial.themeId);
  const [brightness, setBrightness] = useState(_initial.brightness);
  const [contrast, setContrast] = useState(_initial.contrast);
  const [textSize, setTextSize] = useState(_initial.textSize);
  const [textBrightness, setTextBrightness] = useState(_initial.textBrightness);
  const [filterCategory, setFilterCategory] = useState('All');
  const [previewThemeId, setPreviewThemeId] = useState(null);
  const saveTimerRef = useRef(null);

  // Wrap setThemeId to always validate
  const setThemeId = useCallback((id) => {
    setThemeIdRaw(validateThemeId(id));
  }, []);

  // Debounced save to localStorage (avoid writes on every slider tick)
  const debouncedSave = useCallback((settings) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveSettings(settings), 300);
  }, []);

  // Apply color theme whenever settings change
  useEffect(() => {
    if (!previewThemeId) {
      applyTheme(themeId, brightness, contrast);
    }
    debouncedSave({ themeId, brightness, contrast, textSize, textBrightness });
  }, [themeId, brightness, contrast, previewThemeId, debouncedSave, textSize, textBrightness]);

  // Apply text size whenever it changes
  useEffect(() => {
    applyTextSize(textSize);
  }, [textSize]);

  // Apply text brightness whenever it or the theme changes
  useEffect(() => {
    // Text brightness applies after main theme to override ink colors
    applyTextBrightness(textBrightness, previewThemeId || themeId, getSystemColorScheme);
  }, [textBrightness, themeId, previewThemeId]);

  // Listen for system color scheme changes
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme(themeId, brightness, contrast);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [themeId, brightness, contrast]);

  // Live preview: temporarily apply a theme on hover
  const previewTimerRef = useRef(null);

  const startPreview = useCallback((id) => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(() => {
      setPreviewThemeId(id);
      applyTheme(id, brightness, contrast);
    }, 60);
  }, [brightness, contrast]);

  const stopPreview = useCallback(() => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    setPreviewThemeId(null);
    applyTheme(themeId, brightness, contrast);
  }, [themeId, brightness, contrast]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    };
  }, []);

  const resetToDefault = useCallback(() => {
    setThemeId('obsidian-ember');
    setBrightness(0);
    setContrast(0);
    setTextSize(0);
    setTextBrightness(0);
  }, [setThemeId]);

  const filteredThemes = useMemo(() => {
    if (filterCategory === 'All') return COLOR_THEMES;
    return COLOR_THEMES.filter(t => t.category === filterCategory);
  }, [filterCategory]);

  const currentTheme = useMemo(
    () => COLOR_THEMES.find(t => t.id === themeId),
    [themeId]
  );

  const isModified = themeId !== 'obsidian-ember' || brightness !== 0 || contrast !== 0 || textSize !== 0 || textBrightness !== 0;

  return {
    themeId,
    setThemeId,
    brightness,
    setBrightness,
    contrast,
    setContrast,
    textSize,
    setTextSize,
    textBrightness,
    setTextBrightness,
    resetToDefault,
    isModified,
    filterCategory,
    setFilterCategory,
    filteredThemes,
    categories: THEME_CATEGORIES,
    currentTheme,
    // Live preview
    previewThemeId,
    startPreview,
    stopPreview,
  };
}
