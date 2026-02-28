import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

const STORAGE_KEY = 'qbo-theme-settings';

/**
 * Color themes inspired by major brand design systems.
 * Each theme provides a complete set of CSS custom property overrides.
 */
export const COLOR_THEMES = [
  {
    id: 'warm-authority',
    name: 'Warm Authority',
    description: 'Default — calm, warm tones for long shifts',
    category: 'Neutral',
    preview: { accent: '#1a7a6d', bg: '#f6f4f1', surface: '#ffffff', text: '#2c2620' },
    light: {
      '--bg': '#f6f4f1', '--bg-raised': '#ffffff', '--bg-sunken': '#edeae5', '--bg-sidebar': '#faf8f6',
      '--ink': '#2c2620', '--ink-secondary': '#6b5f53', '--ink-tertiary': '#9e9184',
      '--line': '#d6cfc6', '--line-subtle': '#e8e3dc',
      '--accent': '#1a7a6d', '--accent-hover': '#145f55', '--accent-subtle': '#e5f3f0', '--accent-muted': '#b0d9d2',
      '--success': '#3a8a5c', '--success-subtle': '#e6f4ec', '--warning': '#c47c1e', '--warning-subtle': '#fdf3e3',
      '--danger': '#c0392b', '--danger-subtle': '#fceae8', '--info': '#1a7a6d',
      '--bubble-user': '#e5f3f0', '--bubble-assistant': '#ffffff', '--bubble-system': '#edeae5',
      '--status-open-bg': '#fdf0d5', '--status-open-text': '#8b5e14', '--status-open-dot': '#d4941a',
      '--status-progress-bg': '#d5eee9', '--status-progress-text': '#145f55', '--status-progress-dot': '#1a7a6d',
      '--status-resolved-bg': '#ddeee3', '--status-resolved-text': '#2d6b42', '--status-resolved-dot': '#3a8a5c',
      '--status-escalated-bg': '#f5ddd9', '--status-escalated-text': '#943124', '--status-escalated-dot': '#c0392b',
    },
    dark: {
      '--bg': '#1a1714', '--bg-raised': '#242019', '--bg-sunken': '#13110e', '--bg-sidebar': '#1e1b17',
      '--ink': '#ede8e1', '--ink-secondary': '#a89d91', '--ink-tertiary': '#6e6358',
      '--line': '#3a342c', '--line-subtle': '#2e2922',
      '--accent': '#4ec9b5', '--accent-hover': '#6fd9c8', '--accent-subtle': '#1a2f2b', '--accent-muted': '#2a4a43',
      '--success': '#5cb87a', '--success-subtle': '#1a2e22', '--warning': '#e8a33a', '--warning-subtle': '#2e2418',
      '--danger': '#e8574a', '--danger-subtle': '#2e1a17', '--info': '#4ec9b5',
      '--bubble-user': '#1a2f2b', '--bubble-assistant': '#242019', '--bubble-system': '#13110e',
      '--status-open-bg': '#3a2e14', '--status-open-text': '#e8a33a', '--status-open-dot': '#e8a33a',
      '--status-progress-bg': '#14302b', '--status-progress-text': '#4ec9b5', '--status-progress-dot': '#4ec9b5',
      '--status-resolved-bg': '#1a2e22', '--status-resolved-text': '#5cb87a', '--status-resolved-dot': '#5cb87a',
      '--status-escalated-bg': '#2e1a17', '--status-escalated-text': '#e8574a', '--status-escalated-dot': '#e8574a',
    },
  },
  {
    id: 'ocean-depth',
    name: 'Ocean Depth',
    description: 'Deep blue — trustworthy and focused',
    category: 'Cool',
    preview: { accent: '#2563eb', bg: '#f8fafc', surface: '#ffffff', text: '#1e293b' },
    light: {
      '--bg': '#f8fafc', '--bg-raised': '#ffffff', '--bg-sunken': '#f1f5f9', '--bg-sidebar': '#f8fafc',
      '--ink': '#1e293b', '--ink-secondary': '#475569', '--ink-tertiary': '#94a3b8',
      '--line': '#cbd5e1', '--line-subtle': '#e2e8f0',
      '--accent': '#2563eb', '--accent-hover': '#1d4ed8', '--accent-subtle': '#eff6ff', '--accent-muted': '#93c5fd',
      '--success': '#16a34a', '--success-subtle': '#f0fdf4', '--warning': '#d97706', '--warning-subtle': '#fffbeb',
      '--danger': '#dc2626', '--danger-subtle': '#fef2f2', '--info': '#2563eb',
      '--bubble-user': '#eff6ff', '--bubble-assistant': '#ffffff', '--bubble-system': '#f1f5f9',
      '--status-open-bg': '#fffbeb', '--status-open-text': '#92400e', '--status-open-dot': '#d97706',
      '--status-progress-bg': '#eff6ff', '--status-progress-text': '#1d4ed8', '--status-progress-dot': '#2563eb',
      '--status-resolved-bg': '#f0fdf4', '--status-resolved-text': '#15803d', '--status-resolved-dot': '#16a34a',
      '--status-escalated-bg': '#fef2f2', '--status-escalated-text': '#b91c1c', '--status-escalated-dot': '#dc2626',
    },
    dark: {
      '--bg': '#0f172a', '--bg-raised': '#1e293b', '--bg-sunken': '#0a0f1e', '--bg-sidebar': '#131c31',
      '--ink': '#e2e8f0', '--ink-secondary': '#94a3b8', '--ink-tertiary': '#64748b',
      '--line': '#334155', '--line-subtle': '#1e293b',
      '--accent': '#60a5fa', '--accent-hover': '#93c5fd', '--accent-subtle': '#172554', '--accent-muted': '#1e3a5f',
      '--success': '#4ade80', '--success-subtle': '#14271d', '--warning': '#fbbf24', '--warning-subtle': '#27200a',
      '--danger': '#f87171', '--danger-subtle': '#2e1212', '--info': '#60a5fa',
      '--bubble-user': '#172554', '--bubble-assistant': '#1e293b', '--bubble-system': '#0a0f1e',
      '--status-open-bg': '#27200a', '--status-open-text': '#fbbf24', '--status-open-dot': '#fbbf24',
      '--status-progress-bg': '#172554', '--status-progress-text': '#60a5fa', '--status-progress-dot': '#60a5fa',
      '--status-resolved-bg': '#14271d', '--status-resolved-text': '#4ade80', '--status-resolved-dot': '#4ade80',
      '--status-escalated-bg': '#2e1212', '--status-escalated-text': '#f87171', '--status-escalated-dot': '#f87171',
    },
  },
  {
    id: 'stripe-indigo',
    name: 'Stripe Indigo',
    description: 'Refined violet-blue — precision and polish',
    category: 'Cool',
    preview: { accent: '#635bff', bg: '#f6f9fc', surface: '#ffffff', text: '#1a1f36' },
    light: {
      '--bg': '#f6f9fc', '--bg-raised': '#ffffff', '--bg-sunken': '#edf1f7', '--bg-sidebar': '#f6f9fc',
      '--ink': '#1a1f36', '--ink-secondary': '#4f566b', '--ink-tertiary': '#8792a2',
      '--line': '#c4cdd5', '--line-subtle': '#e3e8ee',
      '--accent': '#635bff', '--accent-hover': '#5149e0', '--accent-subtle': '#f0efff', '--accent-muted': '#b1adff',
      '--success': '#3ecf8e', '--success-subtle': '#e8fbf1', '--warning': '#f5a623', '--warning-subtle': '#fef6e6',
      '--danger': '#e25950', '--danger-subtle': '#fde8e6', '--info': '#635bff',
      '--bubble-user': '#f0efff', '--bubble-assistant': '#ffffff', '--bubble-system': '#edf1f7',
      '--status-open-bg': '#fef6e6', '--status-open-text': '#a87117', '--status-open-dot': '#f5a623',
      '--status-progress-bg': '#f0efff', '--status-progress-text': '#5149e0', '--status-progress-dot': '#635bff',
      '--status-resolved-bg': '#e8fbf1', '--status-resolved-text': '#2b9e6a', '--status-resolved-dot': '#3ecf8e',
      '--status-escalated-bg': '#fde8e6', '--status-escalated-text': '#c13b33', '--status-escalated-dot': '#e25950',
    },
    dark: {
      '--bg': '#0a0c1a', '--bg-raised': '#1a1f36', '--bg-sunken': '#060814', '--bg-sidebar': '#10132a',
      '--ink': '#e3e8ee', '--ink-secondary': '#8792a2', '--ink-tertiary': '#5a6072',
      '--line': '#2e3348', '--line-subtle': '#1f2438',
      '--accent': '#7a73ff', '--accent-hover': '#9d98ff', '--accent-subtle': '#1a1740', '--accent-muted': '#2e2a5e',
      '--success': '#5fe0a0', '--success-subtle': '#132a1f', '--warning': '#f7b84e', '--warning-subtle': '#2a2010',
      '--danger': '#f07068', '--danger-subtle': '#2e1515', '--info': '#7a73ff',
      '--bubble-user': '#1a1740', '--bubble-assistant': '#1a1f36', '--bubble-system': '#060814',
      '--status-open-bg': '#2a2010', '--status-open-text': '#f7b84e', '--status-open-dot': '#f7b84e',
      '--status-progress-bg': '#1a1740', '--status-progress-text': '#7a73ff', '--status-progress-dot': '#7a73ff',
      '--status-resolved-bg': '#132a1f', '--status-resolved-text': '#5fe0a0', '--status-resolved-dot': '#5fe0a0',
      '--status-escalated-bg': '#2e1515', '--status-escalated-text': '#f07068', '--status-escalated-dot': '#f07068',
    },
  },
  {
    id: 'github-slate',
    name: 'GitHub Slate',
    description: 'Clean gray — familiar and no-nonsense',
    category: 'Neutral',
    preview: { accent: '#1f6feb', bg: '#f6f8fa', surface: '#ffffff', text: '#24292f' },
    light: {
      '--bg': '#f6f8fa', '--bg-raised': '#ffffff', '--bg-sunken': '#eaeef2', '--bg-sidebar': '#f6f8fa',
      '--ink': '#24292f', '--ink-secondary': '#57606a', '--ink-tertiary': '#8b949e',
      '--line': '#d0d7de', '--line-subtle': '#d8dee4',
      '--accent': '#1f6feb', '--accent-hover': '#0969da', '--accent-subtle': '#ddf4ff', '--accent-muted': '#80ccff',
      '--success': '#1a7f37', '--success-subtle': '#dafbe1', '--warning': '#9a6700', '--warning-subtle': '#fff8c5',
      '--danger': '#cf222e', '--danger-subtle': '#ffebe9', '--info': '#1f6feb',
      '--bubble-user': '#ddf4ff', '--bubble-assistant': '#ffffff', '--bubble-system': '#eaeef2',
      '--status-open-bg': '#fff8c5', '--status-open-text': '#735c0f', '--status-open-dot': '#9a6700',
      '--status-progress-bg': '#ddf4ff', '--status-progress-text': '#0969da', '--status-progress-dot': '#1f6feb',
      '--status-resolved-bg': '#dafbe1', '--status-resolved-text': '#116329', '--status-resolved-dot': '#1a7f37',
      '--status-escalated-bg': '#ffebe9', '--status-escalated-text': '#a40e26', '--status-escalated-dot': '#cf222e',
    },
    dark: {
      '--bg': '#0d1117', '--bg-raised': '#161b22', '--bg-sunken': '#010409', '--bg-sidebar': '#0d1117',
      '--ink': '#c9d1d9', '--ink-secondary': '#8b949e', '--ink-tertiary': '#6e7681',
      '--line': '#30363d', '--line-subtle': '#21262d',
      '--accent': '#58a6ff', '--accent-hover': '#79c0ff', '--accent-subtle': '#0d2344', '--accent-muted': '#143d6e',
      '--success': '#3fb950', '--success-subtle': '#0f2d17', '--warning': '#d29922', '--warning-subtle': '#2a1f07',
      '--danger': '#f85149', '--danger-subtle': '#2a1011', '--info': '#58a6ff',
      '--bubble-user': '#0d2344', '--bubble-assistant': '#161b22', '--bubble-system': '#010409',
      '--status-open-bg': '#2a1f07', '--status-open-text': '#d29922', '--status-open-dot': '#d29922',
      '--status-progress-bg': '#0d2344', '--status-progress-text': '#58a6ff', '--status-progress-dot': '#58a6ff',
      '--status-resolved-bg': '#0f2d17', '--status-resolved-text': '#3fb950', '--status-resolved-dot': '#3fb950',
      '--status-escalated-bg': '#2a1011', '--status-escalated-text': '#f85149', '--status-escalated-dot': '#f85149',
    },
  },
  {
    id: 'linear-dark',
    name: 'Linear Minimal',
    description: 'Ultraclean violet — modern and focused',
    category: 'Cool',
    preview: { accent: '#5e6ad2', bg: '#f9f9fb', surface: '#ffffff', text: '#1b1d2a' },
    light: {
      '--bg': '#f9f9fb', '--bg-raised': '#ffffff', '--bg-sunken': '#f0f0f5', '--bg-sidebar': '#f9f9fb',
      '--ink': '#1b1d2a', '--ink-secondary': '#5a5c72', '--ink-tertiary': '#8e8fa8',
      '--line': '#d4d4de', '--line-subtle': '#e6e6ee',
      '--accent': '#5e6ad2', '--accent-hover': '#4f59b9', '--accent-subtle': '#eef0ff', '--accent-muted': '#b0b5e8',
      '--success': '#4cb782', '--success-subtle': '#e6f9f0', '--warning': '#e09b37', '--warning-subtle': '#fdf5e6',
      '--danger': '#d94f4f', '--danger-subtle': '#fde8e8', '--info': '#5e6ad2',
      '--bubble-user': '#eef0ff', '--bubble-assistant': '#ffffff', '--bubble-system': '#f0f0f5',
      '--status-open-bg': '#fdf5e6', '--status-open-text': '#9a6b22', '--status-open-dot': '#e09b37',
      '--status-progress-bg': '#eef0ff', '--status-progress-text': '#4f59b9', '--status-progress-dot': '#5e6ad2',
      '--status-resolved-bg': '#e6f9f0', '--status-resolved-text': '#2d8a5e', '--status-resolved-dot': '#4cb782',
      '--status-escalated-bg': '#fde8e8', '--status-escalated-text': '#b83b3b', '--status-escalated-dot': '#d94f4f',
    },
    dark: {
      '--bg': '#101118', '--bg-raised': '#1b1d2a', '--bg-sunken': '#090a10', '--bg-sidebar': '#13141f',
      '--ink': '#e2e3ef', '--ink-secondary': '#8e8fa8', '--ink-tertiary': '#5a5c72',
      '--line': '#2d2e3e', '--line-subtle': '#222332',
      '--accent': '#7c85e2', '--accent-hover': '#a0a7ee', '--accent-subtle': '#1c1e38', '--accent-muted': '#2e3058',
      '--success': '#6cd4a0', '--success-subtle': '#112a1f', '--warning': '#edb85c', '--warning-subtle': '#2a2010',
      '--danger': '#f06565', '--danger-subtle': '#2e1414', '--info': '#7c85e2',
      '--bubble-user': '#1c1e38', '--bubble-assistant': '#1b1d2a', '--bubble-system': '#090a10',
      '--status-open-bg': '#2a2010', '--status-open-text': '#edb85c', '--status-open-dot': '#edb85c',
      '--status-progress-bg': '#1c1e38', '--status-progress-text': '#7c85e2', '--status-progress-dot': '#7c85e2',
      '--status-resolved-bg': '#112a1f', '--status-resolved-text': '#6cd4a0', '--status-resolved-dot': '#6cd4a0',
      '--status-escalated-bg': '#2e1414', '--status-escalated-text': '#f06565', '--status-escalated-dot': '#f06565',
    },
  },
  {
    id: 'notion-sand',
    name: 'Notion Sand',
    description: 'Warm minimal — clean and content-first',
    category: 'Warm',
    preview: { accent: '#eb5757', bg: '#ffffff', surface: '#ffffff', text: '#37352f' },
    light: {
      '--bg': '#ffffff', '--bg-raised': '#ffffff', '--bg-sunken': '#f7f6f3', '--bg-sidebar': '#fbfaf8',
      '--ink': '#37352f', '--ink-secondary': '#787774', '--ink-tertiary': '#9b9a97',
      '--line': '#e3e2de', '--line-subtle': '#eeedea',
      '--accent': '#eb5757', '--accent-hover': '#d44040', '--accent-subtle': '#fdecec', '--accent-muted': '#f4aaaa',
      '--success': '#4daa57', '--success-subtle': '#e8f5ea', '--warning': '#cb7a2a', '--warning-subtle': '#fdf2e5',
      '--danger': '#eb5757', '--danger-subtle': '#fdecec', '--info': '#2f80ed',
      '--bubble-user': '#fdecec', '--bubble-assistant': '#ffffff', '--bubble-system': '#f7f6f3',
      '--status-open-bg': '#fdf2e5', '--status-open-text': '#905418', '--status-open-dot': '#cb7a2a',
      '--status-progress-bg': '#e6f2fd', '--status-progress-text': '#2065be', '--status-progress-dot': '#2f80ed',
      '--status-resolved-bg': '#e8f5ea', '--status-resolved-text': '#347a3d', '--status-resolved-dot': '#4daa57',
      '--status-escalated-bg': '#fdecec', '--status-escalated-text': '#c13b3b', '--status-escalated-dot': '#eb5757',
    },
    dark: {
      '--bg': '#191919', '--bg-raised': '#252525', '--bg-sunken': '#111111', '--bg-sidebar': '#1e1e1e',
      '--ink': '#e3e2de', '--ink-secondary': '#9b9a97', '--ink-tertiary': '#6b6a67',
      '--line': '#373737', '--line-subtle': '#2d2d2d',
      '--accent': '#ff6b6b', '--accent-hover': '#ff8f8f', '--accent-subtle': '#3a1a1a', '--accent-muted': '#4a2222',
      '--success': '#68c474', '--success-subtle': '#1a2e1d', '--warning': '#e09545', '--warning-subtle': '#2e2310',
      '--danger': '#ff6b6b', '--danger-subtle': '#3a1a1a', '--info': '#5c9eff',
      '--bubble-user': '#3a1a1a', '--bubble-assistant': '#252525', '--bubble-system': '#111111',
      '--status-open-bg': '#2e2310', '--status-open-text': '#e09545', '--status-open-dot': '#e09545',
      '--status-progress-bg': '#142240', '--status-progress-text': '#5c9eff', '--status-progress-dot': '#5c9eff',
      '--status-resolved-bg': '#1a2e1d', '--status-resolved-text': '#68c474', '--status-resolved-dot': '#68c474',
      '--status-escalated-bg': '#3a1a1a', '--status-escalated-text': '#ff6b6b', '--status-escalated-dot': '#ff6b6b',
    },
  },
  {
    id: 'slack-aubergine',
    name: 'Slack Aubergine',
    description: 'Rich plum — warm and collaborative',
    category: 'Warm',
    preview: { accent: '#611f69', bg: '#f8f5f2', surface: '#ffffff', text: '#1d1c1d' },
    light: {
      '--bg': '#f8f5f2', '--bg-raised': '#ffffff', '--bg-sunken': '#ede8e3', '--bg-sidebar': '#f8f5f2',
      '--ink': '#1d1c1d', '--ink-secondary': '#616061', '--ink-tertiary': '#969596',
      '--line': '#d4cfc8', '--line-subtle': '#e4dfda',
      '--accent': '#611f69', '--accent-hover': '#4a154b', '--accent-subtle': '#f5e8f6', '--accent-muted': '#cda0d0',
      '--success': '#2eb67d', '--success-subtle': '#e3f8ef', '--warning': '#e8912d', '--warning-subtle': '#fef3e2',
      '--danger': '#e01e5a', '--danger-subtle': '#fde5ec', '--info': '#36c5f0',
      '--bubble-user': '#f5e8f6', '--bubble-assistant': '#ffffff', '--bubble-system': '#ede8e3',
      '--status-open-bg': '#fef3e2', '--status-open-text': '#a86518', '--status-open-dot': '#e8912d',
      '--status-progress-bg': '#e0f5fd', '--status-progress-text': '#1e8fb5', '--status-progress-dot': '#36c5f0',
      '--status-resolved-bg': '#e3f8ef', '--status-resolved-text': '#1e8a5c', '--status-resolved-dot': '#2eb67d',
      '--status-escalated-bg': '#fde5ec', '--status-escalated-text': '#b01547', '--status-escalated-dot': '#e01e5a',
    },
    dark: {
      '--bg': '#1a141a', '--bg-raised': '#2b1e2c', '--bg-sunken': '#120e12', '--bg-sidebar': '#1e171f',
      '--ink': '#e8e5e8', '--ink-secondary': '#969596', '--ink-tertiary': '#616061',
      '--line': '#3e2f40', '--line-subtle': '#2e2230',
      '--accent': '#c87fd0', '--accent-hover': '#dba2e0', '--accent-subtle': '#2e1830', '--accent-muted': '#4a2550',
      '--success': '#52dea0', '--success-subtle': '#122a1f', '--warning': '#f0a855', '--warning-subtle': '#2a2010',
      '--danger': '#f04e7e', '--danger-subtle': '#2e1018', '--info': '#60d5f5',
      '--bubble-user': '#2e1830', '--bubble-assistant': '#2b1e2c', '--bubble-system': '#120e12',
      '--status-open-bg': '#2a2010', '--status-open-text': '#f0a855', '--status-open-dot': '#f0a855',
      '--status-progress-bg': '#0e2530', '--status-progress-text': '#60d5f5', '--status-progress-dot': '#60d5f5',
      '--status-resolved-bg': '#122a1f', '--status-resolved-text': '#52dea0', '--status-resolved-dot': '#52dea0',
      '--status-escalated-bg': '#2e1018', '--status-escalated-text': '#f04e7e', '--status-escalated-dot': '#f04e7e',
    },
  },
  {
    id: 'vercel-noir',
    name: 'Vercel Noir',
    description: 'Pure contrast — bold black and white',
    category: 'Neutral',
    preview: { accent: '#000000', bg: '#fafafa', surface: '#ffffff', text: '#171717' },
    light: {
      '--bg': '#fafafa', '--bg-raised': '#ffffff', '--bg-sunken': '#f5f5f5', '--bg-sidebar': '#fafafa',
      '--ink': '#171717', '--ink-secondary': '#525252', '--ink-tertiary': '#a3a3a3',
      '--line': '#d4d4d4', '--line-subtle': '#e5e5e5',
      '--accent': '#171717', '--accent-hover': '#000000', '--accent-subtle': '#f5f5f5', '--accent-muted': '#a3a3a3',
      '--success': '#15803d', '--success-subtle': '#f0fdf4', '--warning': '#a16207', '--warning-subtle': '#fefce8',
      '--danger': '#dc2626', '--danger-subtle': '#fef2f2', '--info': '#171717',
      '--bubble-user': '#f5f5f5', '--bubble-assistant': '#ffffff', '--bubble-system': '#f5f5f5',
      '--status-open-bg': '#fefce8', '--status-open-text': '#854d0e', '--status-open-dot': '#a16207',
      '--status-progress-bg': '#f5f5f5', '--status-progress-text': '#000000', '--status-progress-dot': '#171717',
      '--status-resolved-bg': '#f0fdf4', '--status-resolved-text': '#15803d', '--status-resolved-dot': '#15803d',
      '--status-escalated-bg': '#fef2f2', '--status-escalated-text': '#b91c1c', '--status-escalated-dot': '#dc2626',
    },
    dark: {
      '--bg': '#000000', '--bg-raised': '#111111', '--bg-sunken': '#000000', '--bg-sidebar': '#0a0a0a',
      '--ink': '#ededed', '--ink-secondary': '#a3a3a3', '--ink-tertiary': '#525252',
      '--line': '#2e2e2e', '--line-subtle': '#1a1a1a',
      '--accent': '#ffffff', '--accent-hover': '#ededed', '--accent-subtle': '#1a1a1a', '--accent-muted': '#3a3a3a',
      '--success': '#4ade80', '--success-subtle': '#0a1f0e', '--warning': '#fbbf24', '--warning-subtle': '#1a1505',
      '--danger': '#f87171', '--danger-subtle': '#1f0a0a', '--info': '#ffffff',
      '--bubble-user': '#1a1a1a', '--bubble-assistant': '#111111', '--bubble-system': '#000000',
      '--status-open-bg': '#1a1505', '--status-open-text': '#fbbf24', '--status-open-dot': '#fbbf24',
      '--status-progress-bg': '#1a1a1a', '--status-progress-text': '#ffffff', '--status-progress-dot': '#ffffff',
      '--status-resolved-bg': '#0a1f0e', '--status-resolved-text': '#4ade80', '--status-resolved-dot': '#4ade80',
      '--status-escalated-bg': '#1f0a0a', '--status-escalated-text': '#f87171', '--status-escalated-dot': '#f87171',
    },
  },
  {
    id: 'spotify-green',
    name: 'Spotify Pulse',
    description: 'Vibrant green — energetic and alive',
    category: 'Vibrant',
    preview: { accent: '#1db954', bg: '#f5f5f5', surface: '#ffffff', text: '#191414' },
    light: {
      '--bg': '#f5f5f5', '--bg-raised': '#ffffff', '--bg-sunken': '#ebebeb', '--bg-sidebar': '#f5f5f5',
      '--ink': '#191414', '--ink-secondary': '#535353', '--ink-tertiary': '#a7a7a7',
      '--line': '#d1d1d1', '--line-subtle': '#e0e0e0',
      '--accent': '#1db954', '--accent-hover': '#1aa34a', '--accent-subtle': '#e6f9ee', '--accent-muted': '#82daa1',
      '--success': '#1db954', '--success-subtle': '#e6f9ee', '--warning': '#f59b23', '--warning-subtle': '#fef5e3',
      '--danger': '#e22134', '--danger-subtle': '#fde6e8', '--info': '#1db954',
      '--bubble-user': '#e6f9ee', '--bubble-assistant': '#ffffff', '--bubble-system': '#ebebeb',
      '--status-open-bg': '#fef5e3', '--status-open-text': '#a36a10', '--status-open-dot': '#f59b23',
      '--status-progress-bg': '#e6f9ee', '--status-progress-text': '#1aa34a', '--status-progress-dot': '#1db954',
      '--status-resolved-bg': '#e6f9ee', '--status-resolved-text': '#1aa34a', '--status-resolved-dot': '#1db954',
      '--status-escalated-bg': '#fde6e8', '--status-escalated-text': '#b01825', '--status-escalated-dot': '#e22134',
    },
    dark: {
      '--bg': '#121212', '--bg-raised': '#1e1e1e', '--bg-sunken': '#0a0a0a', '--bg-sidebar': '#181818',
      '--ink': '#e0e0e0', '--ink-secondary': '#a7a7a7', '--ink-tertiary': '#535353',
      '--line': '#333333', '--line-subtle': '#282828',
      '--accent': '#1ed760', '--accent-hover': '#4ae17c', '--accent-subtle': '#0d2e18', '--accent-muted': '#1a4a2a',
      '--success': '#1ed760', '--success-subtle': '#0d2e18', '--warning': '#f7ad42', '--warning-subtle': '#2a2010',
      '--danger': '#f15e6c', '--danger-subtle': '#2e1114', '--info': '#1ed760',
      '--bubble-user': '#0d2e18', '--bubble-assistant': '#1e1e1e', '--bubble-system': '#0a0a0a',
      '--status-open-bg': '#2a2010', '--status-open-text': '#f7ad42', '--status-open-dot': '#f7ad42',
      '--status-progress-bg': '#0d2e18', '--status-progress-text': '#1ed760', '--status-progress-dot': '#1ed760',
      '--status-resolved-bg': '#0d2e18', '--status-resolved-text': '#1ed760', '--status-resolved-dot': '#1ed760',
      '--status-escalated-bg': '#2e1114', '--status-escalated-text': '#f15e6c', '--status-escalated-dot': '#f15e6c',
    },
  },
  {
    id: 'figma-coral',
    name: 'Figma Coral',
    description: 'Warm coral — creative and approachable',
    category: 'Warm',
    preview: { accent: '#f24e1e', bg: '#faf8f6', surface: '#ffffff', text: '#2c2c2c' },
    light: {
      '--bg': '#faf8f6', '--bg-raised': '#ffffff', '--bg-sunken': '#f0ece8', '--bg-sidebar': '#faf8f6',
      '--ink': '#2c2c2c', '--ink-secondary': '#6e6e6e', '--ink-tertiary': '#a0a0a0',
      '--line': '#d5d0cb', '--line-subtle': '#e8e3dd',
      '--accent': '#f24e1e', '--accent-hover': '#d94318', '--accent-subtle': '#fde9e3', '--accent-muted': '#f9a88e',
      '--success': '#14ae5c', '--success-subtle': '#e2f8ec', '--warning': '#ff8c00', '--warning-subtle': '#fff3e0',
      '--danger': '#f24e1e', '--danger-subtle': '#fde9e3', '--info': '#0d99ff',
      '--bubble-user': '#fde9e3', '--bubble-assistant': '#ffffff', '--bubble-system': '#f0ece8',
      '--status-open-bg': '#fff3e0', '--status-open-text': '#a35c00', '--status-open-dot': '#ff8c00',
      '--status-progress-bg': '#e0f0ff', '--status-progress-text': '#0a7acc', '--status-progress-dot': '#0d99ff',
      '--status-resolved-bg': '#e2f8ec', '--status-resolved-text': '#0d8a48', '--status-resolved-dot': '#14ae5c',
      '--status-escalated-bg': '#fde9e3', '--status-escalated-text': '#c03a15', '--status-escalated-dot': '#f24e1e',
    },
    dark: {
      '--bg': '#1a1614', '--bg-raised': '#282420', '--bg-sunken': '#110f0d', '--bg-sidebar': '#1e1a17',
      '--ink': '#ede8e3', '--ink-secondary': '#a09890', '--ink-tertiary': '#6e6660',
      '--line': '#3a342e', '--line-subtle': '#2e2822',
      '--accent': '#ff7043', '--accent-hover': '#ff9670', '--accent-subtle': '#3a1a10', '--accent-muted': '#5a2818',
      '--success': '#38d97a', '--success-subtle': '#102a18', '--warning': '#ffa040', '--warning-subtle': '#2e2010',
      '--danger': '#ff7043', '--danger-subtle': '#3a1a10', '--info': '#40b0ff',
      '--bubble-user': '#3a1a10', '--bubble-assistant': '#282420', '--bubble-system': '#110f0d',
      '--status-open-bg': '#2e2010', '--status-open-text': '#ffa040', '--status-open-dot': '#ffa040',
      '--status-progress-bg': '#0e2035', '--status-progress-text': '#40b0ff', '--status-progress-dot': '#40b0ff',
      '--status-resolved-bg': '#102a18', '--status-resolved-text': '#38d97a', '--status-resolved-dot': '#38d97a',
      '--status-escalated-bg': '#3a1a10', '--status-escalated-text': '#ff7043', '--status-escalated-dot': '#ff7043',
    },
  },
  {
    id: 'discord-blurple',
    name: 'Discord Blurple',
    description: 'Bold blue-violet — playful and modern',
    category: 'Vibrant',
    preview: { accent: '#5865f2', bg: '#f2f3f5', surface: '#ffffff', text: '#2e3338' },
    light: {
      '--bg': '#f2f3f5', '--bg-raised': '#ffffff', '--bg-sunken': '#e3e5e8', '--bg-sidebar': '#f2f3f5',
      '--ink': '#2e3338', '--ink-secondary': '#6d6f78', '--ink-tertiary': '#96989d',
      '--line': '#c7c8cd', '--line-subtle': '#dfe0e4',
      '--accent': '#5865f2', '--accent-hover': '#4752c4', '--accent-subtle': '#eef0fe', '--accent-muted': '#a5ade8',
      '--success': '#57f287', '--success-subtle': '#e6fded', '--warning': '#fee75c', '--warning-subtle': '#fffbe6',
      '--danger': '#ed4245', '--danger-subtle': '#fde7e7', '--info': '#5865f2',
      '--bubble-user': '#eef0fe', '--bubble-assistant': '#ffffff', '--bubble-system': '#e3e5e8',
      '--status-open-bg': '#fffbe6', '--status-open-text': '#8a7a00', '--status-open-dot': '#c9b200',
      '--status-progress-bg': '#eef0fe', '--status-progress-text': '#4752c4', '--status-progress-dot': '#5865f2',
      '--status-resolved-bg': '#e6fded', '--status-resolved-text': '#248045', '--status-resolved-dot': '#57f287',
      '--status-escalated-bg': '#fde7e7', '--status-escalated-text': '#c83538', '--status-escalated-dot': '#ed4245',
    },
    dark: {
      '--bg': '#1e1f22', '--bg-raised': '#2b2d31', '--bg-sunken': '#111214', '--bg-sidebar': '#1e1f22',
      '--ink': '#dbdee1', '--ink-secondary': '#96989d', '--ink-tertiary': '#6d6f78',
      '--line': '#3f4147', '--line-subtle': '#2e3035',
      '--accent': '#5865f2', '--accent-hover': '#7983f5', '--accent-subtle': '#1a1c3a', '--accent-muted': '#2c2f5a',
      '--success': '#57f287', '--success-subtle': '#0f2e1a', '--warning': '#fee75c', '--warning-subtle': '#2e2a05',
      '--danger': '#ed4245', '--danger-subtle': '#2e1011', '--info': '#5865f2',
      '--bubble-user': '#1a1c3a', '--bubble-assistant': '#2b2d31', '--bubble-system': '#111214',
      '--status-open-bg': '#2e2a05', '--status-open-text': '#fee75c', '--status-open-dot': '#fee75c',
      '--status-progress-bg': '#1a1c3a', '--status-progress-text': '#5865f2', '--status-progress-dot': '#5865f2',
      '--status-resolved-bg': '#0f2e1a', '--status-resolved-text': '#57f287', '--status-resolved-dot': '#57f287',
      '--status-escalated-bg': '#2e1011', '--status-escalated-text': '#ed4245', '--status-escalated-dot': '#ed4245',
    },
  },
  {
    id: 'salesforce-cloud',
    name: 'Salesforce Cloud',
    description: 'Cloud blue — professional and enterprise',
    category: 'Cool',
    preview: { accent: '#0176d3', bg: '#f3f3f3', surface: '#ffffff', text: '#181818' },
    light: {
      '--bg': '#f3f3f3', '--bg-raised': '#ffffff', '--bg-sunken': '#e5e5e5', '--bg-sidebar': '#f3f3f3',
      '--ink': '#181818', '--ink-secondary': '#444444', '--ink-tertiary': '#939393',
      '--line': '#c9c9c9', '--line-subtle': '#dddddd',
      '--accent': '#0176d3', '--accent-hover': '#014486', '--accent-subtle': '#eaf4fd', '--accent-muted': '#7ec0ee',
      '--success': '#2e844a', '--success-subtle': '#e6f4ea', '--warning': '#dd7a01', '--warning-subtle': '#fef3e0',
      '--danger': '#ba0517', '--danger-subtle': '#fde6e8', '--info': '#0176d3',
      '--bubble-user': '#eaf4fd', '--bubble-assistant': '#ffffff', '--bubble-system': '#e5e5e5',
      '--status-open-bg': '#fef3e0', '--status-open-text': '#8a4e00', '--status-open-dot': '#dd7a01',
      '--status-progress-bg': '#eaf4fd', '--status-progress-text': '#014486', '--status-progress-dot': '#0176d3',
      '--status-resolved-bg': '#e6f4ea', '--status-resolved-text': '#1e5c31', '--status-resolved-dot': '#2e844a',
      '--status-escalated-bg': '#fde6e8', '--status-escalated-text': '#8c030f', '--status-escalated-dot': '#ba0517',
    },
    dark: {
      '--bg': '#16161d', '--bg-raised': '#22222c', '--bg-sunken': '#0d0d12', '--bg-sidebar': '#1a1a24',
      '--ink': '#e0e0e5', '--ink-secondary': '#939398', '--ink-tertiary': '#5c5c62',
      '--line': '#36363e', '--line-subtle': '#28282f',
      '--accent': '#1b96ff', '--accent-hover': '#57b0ff', '--accent-subtle': '#0a2240', '--accent-muted': '#103460',
      '--success': '#45c65a', '--success-subtle': '#102a16', '--warning': '#fe9339', '--warning-subtle': '#2e2008',
      '--danger': '#ea001e', '--danger-subtle': '#2e0a0d', '--info': '#1b96ff',
      '--bubble-user': '#0a2240', '--bubble-assistant': '#22222c', '--bubble-system': '#0d0d12',
      '--status-open-bg': '#2e2008', '--status-open-text': '#fe9339', '--status-open-dot': '#fe9339',
      '--status-progress-bg': '#0a2240', '--status-progress-text': '#1b96ff', '--status-progress-dot': '#1b96ff',
      '--status-resolved-bg': '#102a16', '--status-resolved-text': '#45c65a', '--status-resolved-dot': '#45c65a',
      '--status-escalated-bg': '#2e0a0d', '--status-escalated-text': '#ea001e', '--status-escalated-dot': '#ea001e',
    },
  },
  {
    id: 'hubspot-orange',
    name: 'HubSpot Energy',
    description: 'Bold orange — growth and momentum',
    category: 'Vibrant',
    preview: { accent: '#ff7a59', bg: '#f5f8fa', surface: '#ffffff', text: '#33475b' },
    light: {
      '--bg': '#f5f8fa', '--bg-raised': '#ffffff', '--bg-sunken': '#eaf0f6', '--bg-sidebar': '#f5f8fa',
      '--ink': '#33475b', '--ink-secondary': '#516f90', '--ink-tertiary': '#7c98b6',
      '--line': '#cbd6e2', '--line-subtle': '#dfe3eb',
      '--accent': '#ff7a59', '--accent-hover': '#e86840', '--accent-subtle': '#fff0ec', '--accent-muted': '#ffb89e',
      '--success': '#00bda5', '--success-subtle': '#e0f8f5', '--warning': '#f5c26b', '--warning-subtle': '#fef7e8',
      '--danger': '#f2545b', '--danger-subtle': '#fde8e9', '--info': '#00a4bd',
      '--bubble-user': '#fff0ec', '--bubble-assistant': '#ffffff', '--bubble-system': '#eaf0f6',
      '--status-open-bg': '#fef7e8', '--status-open-text': '#a37e1e', '--status-open-dot': '#f5c26b',
      '--status-progress-bg': '#e0f5f8', '--status-progress-text': '#007a93', '--status-progress-dot': '#00a4bd',
      '--status-resolved-bg': '#e0f8f5', '--status-resolved-text': '#00876e', '--status-resolved-dot': '#00bda5',
      '--status-escalated-bg': '#fde8e9', '--status-escalated-text': '#c23a40', '--status-escalated-dot': '#f2545b',
    },
    dark: {
      '--bg': '#13161a', '--bg-raised': '#1e2530', '--bg-sunken': '#0a0d10', '--bg-sidebar': '#171c22',
      '--ink': '#dfe3eb', '--ink-secondary': '#7c98b6', '--ink-tertiary': '#516f90',
      '--line': '#33475b', '--line-subtle': '#253342',
      '--accent': '#ff8f73', '--accent-hover': '#ffb39e', '--accent-subtle': '#3a1e15', '--accent-muted': '#5a3020',
      '--success': '#33d4be', '--success-subtle': '#0a2e28', '--warning': '#f7d08a', '--warning-subtle': '#2e2510',
      '--danger': '#f56e74', '--danger-subtle': '#2e1215', '--info': '#33bbda',
      '--bubble-user': '#3a1e15', '--bubble-assistant': '#1e2530', '--bubble-system': '#0a0d10',
      '--status-open-bg': '#2e2510', '--status-open-text': '#f7d08a', '--status-open-dot': '#f7d08a',
      '--status-progress-bg': '#0a2530', '--status-progress-text': '#33bbda', '--status-progress-dot': '#33bbda',
      '--status-resolved-bg': '#0a2e28', '--status-resolved-text': '#33d4be', '--status-resolved-dot': '#33d4be',
      '--status-escalated-bg': '#2e1215', '--status-escalated-text': '#f56e74', '--status-escalated-dot': '#f56e74',
    },
  },
  {
    id: 'zendesk-garden',
    name: 'Zendesk Garden',
    description: 'Support green — trust and helpfulness',
    category: 'Cool',
    preview: { accent: '#17494d', bg: '#f8f9f9', surface: '#ffffff', text: '#2f3941' },
    light: {
      '--bg': '#f8f9f9', '--bg-raised': '#ffffff', '--bg-sunken': '#edf0f2', '--bg-sidebar': '#f8f9f9',
      '--ink': '#2f3941', '--ink-secondary': '#68737d', '--ink-tertiary': '#87929d',
      '--line': '#c2c8cc', '--line-subtle': '#d8dcde',
      '--accent': '#17494d', '--accent-hover': '#0f3337', '--accent-subtle': '#e9f5f5', '--accent-muted': '#8bc0c3',
      '--success': '#228f67', '--success-subtle': '#e5f5ee', '--warning': '#c38f16', '--warning-subtle': '#fdf3de',
      '--danger': '#cc3340', '--danger-subtle': '#fce5e7', '--info': '#17494d',
      '--bubble-user': '#e9f5f5', '--bubble-assistant': '#ffffff', '--bubble-system': '#edf0f2',
      '--status-open-bg': '#fdf3de', '--status-open-text': '#8a620e', '--status-open-dot': '#c38f16',
      '--status-progress-bg': '#e9f5f5', '--status-progress-text': '#0f3337', '--status-progress-dot': '#17494d',
      '--status-resolved-bg': '#e5f5ee', '--status-resolved-text': '#176745', '--status-resolved-dot': '#228f67',
      '--status-escalated-bg': '#fce5e7', '--status-escalated-text': '#a32630', '--status-escalated-dot': '#cc3340',
    },
    dark: {
      '--bg': '#0f1517', '--bg-raised': '#1c2529', '--bg-sunken': '#080d0f', '--bg-sidebar': '#131a1e',
      '--ink': '#e0e4e6', '--ink-secondary': '#87929d', '--ink-tertiary': '#5a636c',
      '--line': '#2e3a40', '--line-subtle': '#222e33',
      '--accent': '#5ac0c4', '--accent-hover': '#85d6d8', '--accent-subtle': '#102628', '--accent-muted': '#1a3e40',
      '--success': '#4cc38a', '--success-subtle': '#0f2a1e', '--warning': '#e0aa3a', '--warning-subtle': '#2a2210',
      '--danger': '#e8555e', '--danger-subtle': '#2e1214', '--info': '#5ac0c4',
      '--bubble-user': '#102628', '--bubble-assistant': '#1c2529', '--bubble-system': '#080d0f',
      '--status-open-bg': '#2a2210', '--status-open-text': '#e0aa3a', '--status-open-dot': '#e0aa3a',
      '--status-progress-bg': '#102628', '--status-progress-text': '#5ac0c4', '--status-progress-dot': '#5ac0c4',
      '--status-resolved-bg': '#0f2a1e', '--status-resolved-text': '#4cc38a', '--status-resolved-dot': '#4cc38a',
      '--status-escalated-bg': '#2e1214', '--status-escalated-text': '#e8555e', '--status-escalated-dot': '#e8555e',
    },
  },
  {
    id: 'todoist-red',
    name: 'Todoist Focus',
    description: 'Productivity red — decisive and action-driven',
    category: 'Vibrant',
    preview: { accent: '#db4c3f', bg: '#fafafa', surface: '#ffffff', text: '#202020' },
    light: {
      '--bg': '#fafafa', '--bg-raised': '#ffffff', '--bg-sunken': '#f1f1f1', '--bg-sidebar': '#fafafa',
      '--ink': '#202020', '--ink-secondary': '#666666', '--ink-tertiary': '#999999',
      '--line': '#d1d1d1', '--line-subtle': '#e0e0e0',
      '--accent': '#db4c3f', '--accent-hover': '#c23a2e', '--accent-subtle': '#fdecea', '--accent-muted': '#f0a39c',
      '--success': '#058527', '--success-subtle': '#e3f4e8', '--warning': '#ed9e28', '--warning-subtle': '#fdf4e3',
      '--danger': '#db4c3f', '--danger-subtle': '#fdecea', '--info': '#246fe0',
      '--bubble-user': '#fdecea', '--bubble-assistant': '#ffffff', '--bubble-system': '#f1f1f1',
      '--status-open-bg': '#fdf4e3', '--status-open-text': '#a06b14', '--status-open-dot': '#ed9e28',
      '--status-progress-bg': '#e6f0fd', '--status-progress-text': '#1a54b0', '--status-progress-dot': '#246fe0',
      '--status-resolved-bg': '#e3f4e8', '--status-resolved-text': '#03651c', '--status-resolved-dot': '#058527',
      '--status-escalated-bg': '#fdecea', '--status-escalated-text': '#a13328', '--status-escalated-dot': '#db4c3f',
    },
    dark: {
      '--bg': '#1a1a1a', '--bg-raised': '#282828', '--bg-sunken': '#111111', '--bg-sidebar': '#1e1e1e',
      '--ink': '#e8e8e8', '--ink-secondary': '#999999', '--ink-tertiary': '#666666',
      '--line': '#383838', '--line-subtle': '#2e2e2e',
      '--accent': '#f06a5e', '--accent-hover': '#f59088', '--accent-subtle': '#3a1814', '--accent-muted': '#5a2820',
      '--success': '#30b84e', '--success-subtle': '#0f2a16', '--warning': '#f5b44e', '--warning-subtle': '#2a2210',
      '--danger': '#f06a5e', '--danger-subtle': '#3a1814', '--info': '#5090f0',
      '--bubble-user': '#3a1814', '--bubble-assistant': '#282828', '--bubble-system': '#111111',
      '--status-open-bg': '#2a2210', '--status-open-text': '#f5b44e', '--status-open-dot': '#f5b44e',
      '--status-progress-bg': '#0e1e3a', '--status-progress-text': '#5090f0', '--status-progress-dot': '#5090f0',
      '--status-resolved-bg': '#0f2a16', '--status-resolved-text': '#30b84e', '--status-resolved-dot': '#30b84e',
      '--status-escalated-bg': '#3a1814', '--status-escalated-text': '#f06a5e', '--status-escalated-dot': '#f06a5e',
    },
  },
  {
    id: 'intercom-blue',
    name: 'Intercom Blue',
    description: 'Communication blue — friendly and direct',
    category: 'Cool',
    preview: { accent: '#286efa', bg: '#f5f5f5', surface: '#ffffff', text: '#1a1a1a' },
    light: {
      '--bg': '#f5f5f5', '--bg-raised': '#ffffff', '--bg-sunken': '#ebebeb', '--bg-sidebar': '#f5f5f5',
      '--ink': '#1a1a1a', '--ink-secondary': '#555555', '--ink-tertiary': '#999999',
      '--line': '#d1d1d1', '--line-subtle': '#e2e2e2',
      '--accent': '#286efa', '--accent-hover': '#1a58d4', '--accent-subtle': '#eaf2ff', '--accent-muted': '#8fb5fc',
      '--success': '#3ba55c', '--success-subtle': '#e8f6ec', '--warning': '#f5a623', '--warning-subtle': '#fef6e6',
      '--danger': '#f04747', '--danger-subtle': '#fde8e8', '--info': '#286efa',
      '--bubble-user': '#eaf2ff', '--bubble-assistant': '#ffffff', '--bubble-system': '#ebebeb',
      '--status-open-bg': '#fef6e6', '--status-open-text': '#a07017', '--status-open-dot': '#f5a623',
      '--status-progress-bg': '#eaf2ff', '--status-progress-text': '#1a58d4', '--status-progress-dot': '#286efa',
      '--status-resolved-bg': '#e8f6ec', '--status-resolved-text': '#2d8045', '--status-resolved-dot': '#3ba55c',
      '--status-escalated-bg': '#fde8e8', '--status-escalated-text': '#c53535', '--status-escalated-dot': '#f04747',
    },
    dark: {
      '--bg': '#141414', '--bg-raised': '#222222', '--bg-sunken': '#0a0a0a', '--bg-sidebar': '#1a1a1a',
      '--ink': '#e8e8e8', '--ink-secondary': '#999999', '--ink-tertiary': '#555555',
      '--line': '#383838', '--line-subtle': '#2a2a2a',
      '--accent': '#5c93ff', '--accent-hover': '#8ab4ff', '--accent-subtle': '#0e1e40', '--accent-muted': '#162e5a',
      '--success': '#5cc87a', '--success-subtle': '#102a1a', '--warning': '#f7b84e', '--warning-subtle': '#2a2010',
      '--danger': '#f56565', '--danger-subtle': '#2e1010', '--info': '#5c93ff',
      '--bubble-user': '#0e1e40', '--bubble-assistant': '#222222', '--bubble-system': '#0a0a0a',
      '--status-open-bg': '#2a2010', '--status-open-text': '#f7b84e', '--status-open-dot': '#f7b84e',
      '--status-progress-bg': '#0e1e40', '--status-progress-text': '#5c93ff', '--status-progress-dot': '#5c93ff',
      '--status-resolved-bg': '#102a1a', '--status-resolved-text': '#5cc87a', '--status-resolved-dot': '#5cc87a',
      '--status-escalated-bg': '#2e1010', '--status-escalated-text': '#f56565', '--status-escalated-dot': '#f56565',
    },
  },
  {
    id: 'monday-vivid',
    name: 'Monday Vivid',
    description: 'Multi-color energy — vibrant workspace',
    category: 'Vibrant',
    preview: { accent: '#6161ff', bg: '#f6f7fb', surface: '#ffffff', text: '#323338' },
    light: {
      '--bg': '#f6f7fb', '--bg-raised': '#ffffff', '--bg-sunken': '#eceff5', '--bg-sidebar': '#f6f7fb',
      '--ink': '#323338', '--ink-secondary': '#676879', '--ink-tertiary': '#9699a6',
      '--line': '#c5c7d0', '--line-subtle': '#d5d8df',
      '--accent': '#6161ff', '--accent-hover': '#5050d8', '--accent-subtle': '#f0f0ff', '--accent-muted': '#a5a5ff',
      '--success': '#00ca72', '--success-subtle': '#e0faf0', '--warning': '#fdab3d', '--warning-subtle': '#fef5e6',
      '--danger': '#e2445c', '--danger-subtle': '#fde7ea', '--info': '#579bfc',
      '--bubble-user': '#f0f0ff', '--bubble-assistant': '#ffffff', '--bubble-system': '#eceff5',
      '--status-open-bg': '#fef5e6', '--status-open-text': '#a07020', '--status-open-dot': '#fdab3d',
      '--status-progress-bg': '#e8f2ff', '--status-progress-text': '#3a74cc', '--status-progress-dot': '#579bfc',
      '--status-resolved-bg': '#e0faf0', '--status-resolved-text': '#009955', '--status-resolved-dot': '#00ca72',
      '--status-escalated-bg': '#fde7ea', '--status-escalated-text': '#b83048', '--status-escalated-dot': '#e2445c',
    },
    dark: {
      '--bg': '#181b34', '--bg-raised': '#282b47', '--bg-sunken': '#0e1025', '--bg-sidebar': '#1e2140',
      '--ink': '#d5d8df', '--ink-secondary': '#9699a6', '--ink-tertiary': '#676879',
      '--line': '#383b55', '--line-subtle': '#2e3148',
      '--accent': '#7c7cff', '--accent-hover': '#a0a0ff', '--accent-subtle': '#1e1e4a', '--accent-muted': '#32326a',
      '--success': '#33e89c', '--success-subtle': '#0a2e1e', '--warning': '#febd5e', '--warning-subtle': '#2e2510',
      '--danger': '#f06078', '--danger-subtle': '#2e1018', '--info': '#7ab5ff',
      '--bubble-user': '#1e1e4a', '--bubble-assistant': '#282b47', '--bubble-system': '#0e1025',
      '--status-open-bg': '#2e2510', '--status-open-text': '#febd5e', '--status-open-dot': '#febd5e',
      '--status-progress-bg': '#102040', '--status-progress-text': '#7ab5ff', '--status-progress-dot': '#7ab5ff',
      '--status-resolved-bg': '#0a2e1e', '--status-resolved-text': '#33e89c', '--status-resolved-dot': '#33e89c',
      '--status-escalated-bg': '#2e1018', '--status-escalated-text': '#f06078', '--status-escalated-dot': '#f06078',
    },
  },
  {
    id: 'asana-coral',
    name: 'Asana Sunrise',
    description: 'Coral-salmon — warm productivity',
    category: 'Warm',
    preview: { accent: '#f06a6a', bg: '#f6f5f4', surface: '#ffffff', text: '#1e1f21' },
    light: {
      '--bg': '#f6f5f4', '--bg-raised': '#ffffff', '--bg-sunken': '#eceae8', '--bg-sidebar': '#f6f5f4',
      '--ink': '#1e1f21', '--ink-secondary': '#6d6e6f', '--ink-tertiary': '#9ca0a3',
      '--line': '#cfcdc9', '--line-subtle': '#e1dfdc',
      '--accent': '#f06a6a', '--accent-hover': '#d85555', '--accent-subtle': '#fde9e9', '--accent-muted': '#f5a5a5',
      '--success': '#5da283', '--success-subtle': '#e8f3ee', '--warning': '#f1bd6c', '--warning-subtle': '#fdf5e8',
      '--danger': '#f06a6a', '--danger-subtle': '#fde9e9', '--info': '#4573d2',
      '--bubble-user': '#fde9e9', '--bubble-assistant': '#ffffff', '--bubble-system': '#eceae8',
      '--status-open-bg': '#fdf5e8', '--status-open-text': '#a07e35', '--status-open-dot': '#f1bd6c',
      '--status-progress-bg': '#e8f0fd', '--status-progress-text': '#3058a8', '--status-progress-dot': '#4573d2',
      '--status-resolved-bg': '#e8f3ee', '--status-resolved-text': '#3e7a62', '--status-resolved-dot': '#5da283',
      '--status-escalated-bg': '#fde9e9', '--status-escalated-text': '#c04a4a', '--status-escalated-dot': '#f06a6a',
    },
    dark: {
      '--bg': '#1a1817', '--bg-raised': '#282624', '--bg-sunken': '#110f0e', '--bg-sidebar': '#1e1c1a',
      '--ink': '#e5e3e0', '--ink-secondary': '#9c9895', '--ink-tertiary': '#6d6a68',
      '--line': '#3a3835', '--line-subtle': '#2e2c2a',
      '--accent': '#f08080', '--accent-hover': '#f5a0a0', '--accent-subtle': '#3a1818', '--accent-muted': '#5a2828',
      '--success': '#78c4a5', '--success-subtle': '#0f2a20', '--warning': '#f5cf8a', '--warning-subtle': '#2a2210',
      '--danger': '#f08080', '--danger-subtle': '#3a1818', '--info': '#6c95e5',
      '--bubble-user': '#3a1818', '--bubble-assistant': '#282624', '--bubble-system': '#110f0e',
      '--status-open-bg': '#2a2210', '--status-open-text': '#f5cf8a', '--status-open-dot': '#f5cf8a',
      '--status-progress-bg': '#101e3a', '--status-progress-text': '#6c95e5', '--status-progress-dot': '#6c95e5',
      '--status-resolved-bg': '#0f2a20', '--status-resolved-text': '#78c4a5', '--status-resolved-dot': '#78c4a5',
      '--status-escalated-bg': '#3a1818', '--status-escalated-text': '#f08080', '--status-escalated-dot': '#f08080',
    },
  },
];

const THEME_CATEGORIES = ['All', 'Neutral', 'Cool', 'Warm', 'Vibrant'];

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
  const isDefault = themeId === 'warm-authority';
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
  if (!id) return 'warm-authority';
  return COLOR_THEMES.some(t => t.id === id) ? id : 'warm-authority';
}

/** Load initial settings synchronously to avoid FOUC */
function getInitialSettings() {
  const saved = loadSettings();
  if (!saved) return { themeId: 'warm-authority', brightness: 0, contrast: 0, textSize: 0, textBrightness: 0 };
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
    setThemeId('warm-authority');
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

  const isModified = themeId !== 'warm-authority' || brightness !== 0 || contrast !== 0 || textSize !== 0 || textBrightness !== 0;

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
