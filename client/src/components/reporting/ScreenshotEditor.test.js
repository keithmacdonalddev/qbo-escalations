import { expect, it } from 'vitest';
import { normalizedRect } from './ScreenshotEditor.jsx';

it('normalizes screenshot crop and redaction drags in either direction', () => {
  expect(normalizedRect({ x: 0.8, y: 0.7 }, { x: 0.2, y: 0.1 })).toEqual({
    x: 0.2,
    y: 0.1,
    width: 0.6000000000000001,
    height: 0.6,
  });
});

it('clamps screenshot selections to the visible image', () => {
  expect(normalizedRect({ x: -2, y: 0.4 }, { x: 3, y: 1.4 })).toEqual({
    x: 0,
    y: 0.4,
    width: 1,
    height: 0.6,
  });
});
