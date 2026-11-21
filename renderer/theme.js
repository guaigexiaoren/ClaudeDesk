'use strict';

const THEMES = ['dark', 'pure', 'light'];

const THEME_BACKGROUNDS = {
  dark: '#14100e',
  pure: '#0b0b0b',
  light: '#f6f3ee',
};

const THEME_LABELS = {
  dark: '暖黑',
  pure: '纯黑',
  light: '白色',
};

/** 非法或缺失的值一律回落到暖黑主题，保证旧设置文件可用。 */
function normalizeTheme(value) {
  if (value === 'light') return 'light';
  if (value === 'pure') return 'pure';
  return 'dark';
}

module.exports = { THEMES, THEME_BACKGROUNDS, THEME_LABELS, normalizeTheme };
