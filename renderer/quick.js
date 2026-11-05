'use strict';

const input = document.getElementById('quick-input');
const hint = document.querySelector('.quick-hint');
const HINT = 'Enter 发送并切到主窗口 · Esc 关闭';
let sending = false;

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
