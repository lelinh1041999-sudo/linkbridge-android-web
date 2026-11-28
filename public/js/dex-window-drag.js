// Android reports tasks in front-to-back order within each display.
function windowAt(dump, x, y) {
  let task;
  for (const line of dump.split('\n')) {
    if (/^\s*\* Task\{/.test(line)) {
      task = line;
      continue;
    }
    const bounds = line.match(/^\s*mBounds=Rect\((-?\d+), (-?\d+) - (-?\d+), (-?\d+)\)/);
    if (!bounds || !task) continue;
    const header = task;
    task = null;
    const [left, top, right, bottom] = bounds.slice(1).map(Number);
    if (!/\bvisible=true\b/.test(header) || x < left || x >= right || y < top || y >= bottom) continue;
    const id = header.match(/#(\d+)\b/);
    if (!id || !/\btype=standard\b/.test(header) || !/\bmode=freeform\b/.test(header)) return null;
    return { id: Number(id[1]), left, top, width: right - left, height: bottom - top };
  }
  return null;
}

export class DexWindowDrag {
  constructor(runShell, onError) {
    this.runShell = runShell;
    this.onError = onError;
    this.queue = Promise.resolve();
    this.closed = false;
  }

  async shell(command) {
    if (this.closed) throw new Error('Phiên DeX đã đóng.');
    const result = await this.runShell(command);
    const output = (result.stdout || '').trim();
    if (result.ok === false || result.error || /^(error|exception|unknown command)/im.test(output)) {
      throw new Error(result.stderr || result.error || output || 'Samsung không thực hiện được lệnh cửa sổ.');
    }
    return output;
  }

  async prepare() {
    const info = await this.shell('cmd display get-displays');
    const displays = [...info.matchAll(/^\s*Display id (\d+): DisplayInfo\{"scrcpy",[^\n]*?\breal (\d+) x (\d+)/gm)];
    if (displays.length !== 1 || Number(displays[0][1]) === 0) {
      throw new Error('Không xác định được màn DeX của LinhBridge.');
    }
    const [id, width, height] = displays[0].slice(1).map(Number);
    if (this.configuredDisplay !== id) {
      const mode = await this.shell(`wm get-display-windowing-mode -d ${id}`);
      if (!/\bfreeform\b/.test(mode)) await this.shell(`wm set-display-windowing-mode -d ${id} 5`);
      this.configuredDisplay = id;
    }
    return { id, width, height };
  }

  async listWindows() {
    const display = await this.prepare();
    const dump = await this.shell(`dumpsys activity activities | sed -n '/^Display #${display.id} /,/^Display #/p' | grep -E '^ *\\* Task\\{|^ *mBounds=Rect\\(' || true`);
    const windows = [];
    let task;
    for (const line of dump.split('\n')) {
      if (/^\s*\* Task\{/.test(line)) {
        task = line;
        continue;
      }
      const bounds = line.match(/^\s*mBounds=Rect\((-?\d+), (-?\d+) - (-?\d+), (-?\d+)\)/);
      if (!bounds || !task) continue;
      const id = task.match(/#(\d+)\b/);
      const app = task.match(/\bA=\d+:([^\s}]+)/);
      if (id && app && /\bvisible=true\b/.test(task) && /\btype=standard\b/.test(task) && /\bmode=freeform\b/.test(task)) {
        const [left, top, right, bottom] = bounds.slice(1).map(Number);
        windows.push({
          id: Number(id[1]),
          app: app[1],
          left,
          top,
          width: right - left,
          height: bottom - top,
        });
      }
      task = null;
    }
    return { display, windows };
  }

  async focus(id) {
    await this.shell(`am task focus ${id}`);
  }

  async minimize(id) {
    await this.shell(`am task move-to-back ${id}`);
  }

  async closeWindow(id) {
    await this.shell(`am task remove ${id}`);
  }

  async setBounds(id, left, top, width, height) {
    await this.shell(`am task focus ${id} && am task resize ${id} ${left} ${top} ${left + width} ${top + height}`);
  }

  begin(start) {
    const drag = { start, point: start, released: false, cancelled: false };
    this.drag = drag;
    this.queue = this.queue.then(() => this.track(drag)).catch((err) => {
      if (!this.closed && !drag.cancelled) this.onError(err.message);
    });
  }

  update(point) {
    if (!this.drag) return;
    this.drag.point = point;
    this.drag.wake?.();
  }

  end(cancelled = false) {
    if (!this.drag) return;
    this.drag.cancelled = cancelled;
    this.drag.released = true;
    this.drag.wake?.();
    this.drag = null;
  }

  close() {
    this.closed = true;
    this.end(true);
  }

  async track(drag) {
    if (this.closed || drag.cancelled) return;
    const display = await this.prepare();
    const dump = await this.shell(`dumpsys activity activities | sed -n '/^Display #${display.id} /,/^Display #/p' | grep -E '^ *\\* Task\\{|^ *mBounds=Rect\\(' || true`);
    const scaleX = display.width / drag.start.w;
    const scaleY = display.height / drag.start.h;
    const task = windowAt(dump, drag.start.x * scaleX, drag.start.y * scaleY);
    if (this.closed || drag.cancelled) return;
    if (!task) throw new Error('Hãy giữ chuột trái bên trong một cửa sổ DeX đang mở.');
    let left = task.left;
    let top = task.top;
    let focused = false;
    while (!this.closed && !drag.cancelled) {
      const point = drag.point;
      const x = task.left + Math.round((point.x - drag.start.x) * scaleX);
      const y = task.top + Math.round((point.y - drag.start.y) * scaleY);
      const nextLeft = Math.max(0, Math.min(x, display.width - task.width));
      const nextTop = Math.max(0, Math.min(y, display.height - task.height));
      if (nextLeft !== left || nextTop !== top) {
        const focus = focused ? '' : `am task focus ${task.id} && `;
        await this.shell(`${focus}am task resize ${task.id} ${nextLeft} ${nextTop} ${nextLeft + task.width} ${nextTop + task.height}`);
        left = nextLeft;
        top = nextTop;
        focused = true;
      }
      // Coalesce pointer events while ADB is busy, including the final release point.
      if (drag.point !== point) continue;
      if (drag.released || this.closed) break;
      await new Promise((resolve) => { drag.wake = resolve; });
    }
  }
}
