'use strict';

const THEMES = ['dark', 'light'];

const THEME_BACKGROUNDS = {
  dark: '#14100e',
  light: '#f6f3ee',
};

const THEME_LABELS = {
  dark: '黑色',
  light: '白色',
};

/** 非法或缺失的值一律回落到黑色主题，保证旧设置文件可用。 */
function normalizeTheme(value) {
  return value === 'light' ? 'light' : 'dark';
}

module.exports = { THEMES, THEME_BACKGROUNDS, THEME_LABELS, normalizeTheme };
