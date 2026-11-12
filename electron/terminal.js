'use strict';

const os = require('node:os');
const { execFileSync } = require('node:child_process');

/**
 * 真终端会话：通过 node-pty 启动一个带伪终端（PTY）的 shell。
 * PTY（伪终端）可以理解为「给程序看的假控制台」，所以 vim、top 这类
 * 需要持续交互的程序也能正常使用。
 */
class TerminalSession {
  constructor() {
    this.proc = null;
    this.cwd = '';
  }

  get running() {
    return Boolean(this.proc);
  }

  start({ cwd, cols = 80, rows = 24, onData, onExit } = {}) {
    if (this.proc) return { ok: true, pid: this.proc.pid, cwd: this.cwd };

    let pty;
    try {
      pty = require('node-pty');
    } catch (err) {
      return { ok: false, error: `终端组件加载失败：${err?.message || err}` };
    }

    const isWin = process.platform === 'win32';
    const shell = isWin ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
    const args = isWin
      ? [
          '-NoLogo',
          '-NoProfile',
          '-NoExit',
          '-Command',
          '[Console]::InputEncoding=[Text.Encoding]::UTF8; [Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; chcp 65001 > $null',
        ]
      : [];

    const options = {
      name: 'xterm-256color',
      cols: Math.max(20, Number(cols) || 80),
      rows: Math.max(5, Number(rows) || 24),
      cwd: cwd || os.homedir(),
      env: { ...process.env, TERM: 'xterm-256color' },
    };
    if (isWin) {
      // 用 node-pty 自带的 ConPTY，不依赖系统组件，也避免退出时的控制台枚举报错
      options.useConpty = true;
      options.useConptyDll = true;
    }

    try {
      this.proc = pty.spawn(shell, args, options);
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }

    this.cwd = options.cwd;
    const spawned = this.proc;
    spawned.onData((data) => onData?.(data));
    spawned.onExit(({ exitCode, signal }) => {
      // 重启后旧 PTY 的退出事件不能污染新终端
      if (this.proc !== spawned) return;
      this.proc = null;
      onExit?.({ exitCode, signal });
    });

    return { ok: true, pid: this.proc.pid, cwd: this.cwd };
  }

  write(data) {
    if (!this.proc) return { ok: false, error: '终端尚未启动' };
    this.proc.write(String(data ?? ''));
    return { ok: true };
  }

  resize(cols, rows) {
    if (!this.proc) return { ok: false };
    try {
      this.proc.resize(Math.max(20, Number(cols) || 80), Math.max(5, Number(rows) || 24));
    } catch {
      // 终端刚退出时 resize 可能失败，忽略
    }
    return { ok: true };
  }

  stop() {
    if (!this.proc) return { ok: false, error: '终端尚未启动' };
    const proc = this.proc;
    const pid = proc.pid;
    this.proc = null;
    try {
      proc.kill();
    } catch {
      // 忽略
    }
    if (process.platform === 'win32' && pid) {
      // ConPTY 的 kill 不一定能带走 shell 子进程，这里强制结束整棵进程树
      try {
        execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
      } catch {
        // 进程已经退出时会报错，忽略
      }
    }
    return { ok: true };
  }
}

module.exports = { TerminalSession };
