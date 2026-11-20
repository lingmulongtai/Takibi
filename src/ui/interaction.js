/**
 * Gentle camera parallax, click-to-stoke fire interaction, and keyboard shortcuts.
 */
export class InteractionController {
  constructor(canvas, callbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;

    this.targetOffset = { x: 0, y: 0 };
    this.currentOffset = { x: 0, y: 0 };

    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerLeave = this._onPointerLeave.bind(this);
    this._onCanvasClick = this._onCanvasClick.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);

    window.addEventListener('pointermove', this._onPointerMove, { passive: true });
    window.addEventListener('pointerleave', this._onPointerLeave, { passive: true });
    canvas.addEventListener('click', this._onCanvasClick);
    window.addEventListener('keydown', this._onKeyDown);
  }

  _onPointerMove(event) {
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    const nx = (event.clientX / w) * 2 - 1;
    const ny = -((event.clientY / h) * 2 - 1);
    // Keep parallax restrained and grounded like sitting calmly beside the fire
    this.targetOffset.x = Math.max(-1, Math.min(1, nx));
    this.targetOffset.y = Math.max(-1, Math.min(1, ny));
    this.callbacks.onUserActivity?.();
  }

  _onPointerLeave() {
    this.targetOffset.x = 0;
    this.targetOffset.y = 0;
  }

  _onCanvasClick(event) {
    this.callbacks.onUserActivity?.();

    const rect = this.canvas.getBoundingClientRect();
    const u = (event.clientX - rect.left) / Math.max(1, rect.width);
    const v = (event.clientY - rect.top) / Math.max(1, rect.height);
    const nearFire = Math.hypot(u - 0.5, v - 0.56) < 0.28;

    this.callbacks.onCanvasTap?.({ nearFire });
  }

  _onKeyDown(event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;

    const key = event.key.toLowerCase();
    if (key === ' ') {
      event.preventDefault();
      this.callbacks.onStoke?.();
    } else if (key === 'm') {
      event.preventDefault();
      this.callbacks.onToggleSound?.();
    } else if (key === 'f') {
      event.preventDefault();
      this.callbacks.onToggleFullscreen?.();
    } else if (key === 'h') {
      event.preventDefault();
      this.callbacks.onToggleZen?.();
    }
  }

  update(dt) {
    const smooth = 1 - Math.exp(-Math.min(dt, 0.05) * 3.2);
    this.currentOffset.x += (this.targetOffset.x - this.currentOffset.x) * smooth;
    this.currentOffset.y += (this.targetOffset.y - this.currentOffset.y) * smooth;
    return this.currentOffset;
  }

  destroy() {
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerleave', this._onPointerLeave);
    this.canvas.removeEventListener('click', this._onCanvasClick);
    window.removeEventListener('keydown', this._onKeyDown);
  }
}
