'use strict';

const input = document.getElementById('quick-input');
const hint = document.querySelector('.quick-hint');
const HINT = 'Enter 发送并切到主窗口 · Esc 关闭';
let sending = false;

/** 启动时从 URL 取主题和强调色，之后每次显示由主进程推送最新值。 */
function applyTheme(value) {
  document.documentElement.dataset.theme =
    value === 'light' ? 'light' : value === 'pure' ? 'pure' : 'dark';
}

function applyAccent(color, border) {
  if (color) document.documentElement.style.setProperty('--q-accent', color);
  if (border) document.documentElement.style.setProperty('--q-accent-border', border);
}

const params = new URLSearchParams(location.search);
applyTheme(params.get('theme'));
applyAccent(params.get('accentColor'), params.get('accentBorder'));
window.desk.onQuickTheme?.((payload) => {
  // 兼容旧格式：只传主题字符串
  if (typeof payload === 'string') {
    applyTheme(payload);
    return;
  }
  applyTheme(payload?.theme);
  applyAccent(payload?.color, payload?.border);
});

async function submit() {
  const text = input.value.trim();
  if (!text || sending) return;
  sending = true;
  hint.textContent = '正在发送…';
  try {
    const result = await window.desk.quickSubmit(text);
    if (!result?.ok) {
      hint.textContent = result?.error || '发送失败';
      return;
    }
    input.value = '';
    hint.textContent = HINT;
  } catch {
    hint.textContent = '发送失败';
  } finally {
    sending = false;
  }
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    window.desk.hideQuick();
    return;
  }
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    submit();
  }
});

window.desk.onQuickFocus(() => {
  input.focus();
  input.select();
});

input.focus();
