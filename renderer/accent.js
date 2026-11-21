'use strict';

const { normalizeTheme } = require('./theme.js');

const ACCENT_KEYS = ['claude', 'blue', 'green', 'purple', 'pink', 'amber', 'black', 'white'];

/**
 * 每个强调色提供 dark / light 两套 token：
 * color/soft/border 用于底色与边框，ink 用于文字/图标，on 是强调色底上的文字色。
 * black / white 是“中性强调”：深色主题解析为亮中性，浅色主题解析为暗中性。
 */
const ACCENTS = {
  claude: {
    label: 'Claude 橙',
    dark: {
      color: '#d97757',
      soft: 'rgba(217, 119, 87, 0.14)',
      border: 'rgba(217, 119, 87, 0.35)',
      ink: '#d97757',
      on: '#1a120f',
    },
    light: {
      color: '#d97757',
      soft: 'rgba(217, 119, 87, 0.14)',
      border: 'rgba(217, 119, 87, 0.35)',
      ink: '#834a37',
      on: '#1a120f',
    },
  },
  blue: {
    label: '蓝色',
    dark: {
      color: '#4f8cff',
      soft: 'rgba(79, 140, 255, 0.14)',
      border: 'rgba(79, 140, 255, 0.35)',
      ink: '#4f8cff',
      on: '#1a120f',
    },
    light: {
      color: '#4f8cff',
      soft: 'rgba(79, 140, 255, 0.14)',
      border: 'rgba(79, 140, 255, 0.35)',
      ink: '#375593',
      on: '#1a120f',
    },
  },
  green: {
    label: '绿色',
    dark: {
      color: '#3fb950',
      soft: 'rgba(63, 185, 80, 0.14)',
      border: 'rgba(63, 185, 80, 0.35)',
      ink: '#3fb950',
      on: '#1a120f',
    },
    light: {
      color: '#3fb950',
      soft: 'rgba(63, 185, 80, 0.14)',
      border: 'rgba(63, 185, 80, 0.35)',
      ink: '#2e6e33',
      on: '#1a120f',
    },
  },
  purple: {
    label: '紫色',
    dark: {
      color: '#a371f7',
      soft: 'rgba(163, 113, 247, 0.14)',
      border: 'rgba(163, 113, 247, 0.35)',
      ink: '#a371f7',
      on: '#1a120f',
    },
    light: {
      color: '#a371f7',
      soft: 'rgba(163, 113, 247, 0.14)',
      border: 'rgba(163, 113, 247, 0.35)',
      ink: '#65468f',
      on: '#1a120f',
    },
  },
  pink: {
    label: '粉色',
    dark: {
      color: '#ec6cb9',
      soft: 'rgba(236, 108, 185, 0.14)',
      border: 'rgba(236, 108, 185, 0.35)',
      ink: '#ec6cb9',
      on: '#1a120f',
    },
    light: {
      color: '#ec6cb9',
      soft: 'rgba(236, 108, 185, 0.14)',
      border: 'rgba(236, 108, 185, 0.35)',
      ink: '#8e446d',
      on: '#1a120f',
    },
  },
  amber: {
    label: '琥珀',
    dark: {
      color: '#d29922',
      soft: 'rgba(210, 153, 34, 0.14)',
      border: 'rgba(210, 153, 34, 0.35)',
      ink: '#d29922',
      on: '#1a120f',
    },
    light: {
      color: '#d29922',
      soft: 'rgba(210, 153, 34, 0.14)',
      border: 'rgba(210, 153, 34, 0.35)',
      ink: '#7f5c19',
      on: '#1a120f',
    },
  },
  black: {
    label: '柔和中性',
    dark: {
      color: '#a89e92',
      soft: 'rgba(168, 158, 146, 0.20)',
      border: 'rgba(168, 158, 146, 0.45)',
      ink: '#a89e92',
      on: '#15110e',
    },
    light: {
      color: '#625a51',
      soft: 'rgba(98, 90, 81, 0.20)',
      border: 'rgba(98, 90, 81, 0.45)',
      ink: '#625a51',
      on: '#fbf9f5',
    },
  },
  white: {
    label: '强调中性',
    dark: {
      color: '#f0eae1',
      soft: 'rgba(240, 234, 225, 0.18)',
      border: 'rgba(240, 234, 225, 0.42)',
      ink: '#f0eae1',
      on: '#15110e',
    },
    light: {
      color: '#2b2521',
      soft: 'rgba(43, 37, 33, 0.18)',
      border: 'rgba(43, 37, 33, 0.42)',
      ink: '#2b2521',
      on: '#fbf9f5',
    },
  },
};

function isNeutralAccent(key) {
  return key === 'black' || key === 'white';
}

/** 未知 key 回退 claude，未知主题回退 dark；返回当前主题下的实际 token。 */
function resolveAccent(key, theme) {
  const resolvedKey = Object.prototype.hasOwnProperty.call(ACCENTS, key) ? key : 'claude';
  const entry = ACCENTS[resolvedKey];
  const resolvedTheme = normalizeTheme(theme);
  // 纯黑与暖黑同为深色主题，强调色 token 复用 dark，避免再维护第三套色值
  const variant = entry[resolvedTheme] ? resolvedTheme : 'dark';
  return {
    key: resolvedKey,
    label: entry.label,
    isNeutral: isNeutralAccent(resolvedKey),
    theme: resolvedTheme,
    ...entry[variant],
  };
}

module.exports = { ACCENT_KEYS, ACCENTS, isNeutralAccent, resolveAccent };
