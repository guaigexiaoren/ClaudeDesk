'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { ACCENT_KEYS, resolveAccent } = require('../renderer/accent');

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const PAGE = { dark: '#1b1715', light: '#f0ede8' };

test('强调色数量和顺序保持不变', () => {
  assert.deepEqual(ACCENT_KEYS, [
    'claude',
    'blue',
    'green',
    'purple',
    'pink',
    'amber',
    'black',
    'white',
  ]);
});

test('未知强调色回退 Claude，未知主题回退黑色主题', () => {
  assert.equal(resolveAccent('missing', 'dark').key, 'claude');
  assert.equal(resolveAccent('black', 'unknown').theme, 'dark');
});

test('8 种强调色在深浅主题下按钮与文字都有足够对比度', () => {
  for (const theme of ['dark', 'light']) {
    for (const key of ACCENT_KEYS) {
      const token = resolveAccent(key, theme);
      assert.ok(
        contrast(token.color, token.on) >= 4.5,
        `${theme}/${key} 按钮文字对比度不足`
      );
      assert.ok(
        contrast(token.ink, PAGE[theme]) >= 4.5,
        `${theme}/${key} 文字/图标对比度不足`
      );
    }
  }
});

test('黑/白中性强调随主题反转，且同主题下可区分', () => {
  const darkBlack = resolveAccent('black', 'dark');
  const darkWhite = resolveAccent('white', 'dark');
  const lightBlack = resolveAccent('black', 'light');
  const lightWhite = resolveAccent('white', 'light');

  assert.equal(darkBlack.isNeutral, true);
  assert.equal(darkWhite.isNeutral, true);
  assert.notEqual(darkBlack.color, lightBlack.color);
  assert.notEqual(darkWhite.color, lightWhite.color);

  // 深色主题下都是亮中性，强调中性比柔和中性更亮
  assert.ok(luminance(darkBlack.color) > luminance(PAGE.dark));
  assert.ok(luminance(darkWhite.color) > luminance(darkBlack.color));
  // 浅色主题下都是暗中性，强调中性比柔和中性更暗
  assert.ok(luminance(lightBlack.color) < luminance(PAGE.light));
  assert.ok(luminance(lightWhite.color) < luminance(lightBlack.color));
});
