export class GPU {
  readonly cols: number;
  readonly rows: number;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;

  private buf: Uint16Array;
  col = 0;
  row = 0;
  chars = 0;
  wraps = 0;
  frames = 0;

  private cellW = 10;
  private cellH = 18;
  private padX = 14;
  private padY = 14;
  private font = '14px ui-monospace, "Cascadia Mono", Consolas, monospace';

  constructor(canvas: HTMLCanvasElement, cols = 80, rows = 24) {
    this.canvas = canvas;
    this.cols = cols;
    this.rows = rows;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable');
    this.ctx = ctx;
    this.buf = new Uint16Array(cols * rows);

    ctx.font = this.font;
    this.cellW = Math.ceil(ctx.measureText('M').width) + 1;
    canvas.width = cols * this.cellW + this.padX * 2;
    canvas.height = rows * this.cellH + this.padY * 2;
  }

  start(): void {
    const loop = () => { this.render(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  putChar(b: number): void {
    this.chars++;
    if (b === 10) {
      this.col = 0;
      this.row++;
      if (this.row >= this.rows) this.scroll();
      return;
    }
    if (b === 8) {
      if (this.col > 0) {
        this.col--;
        this.buf[this.row * this.cols + this.col] = 0;
      }
      return;
    }
    this.buf[this.row * this.cols + this.col] = b;
    this.col++;
    if (this.col >= this.cols) {
      this.col = 0;
      this.row++;
      this.wraps++;
      if (this.row >= this.rows) this.scroll();
    }
  }

  write(s: string): void { for (let i = 0; i < s.length; i++) this.putChar(s.charCodeAt(i)); }

  clear(): void {
    this.buf.fill(0);
    this.col = 0;
    this.row = 0;
    this.chars = 0;
    this.wraps = 0;
  }

  private scroll(): void {
    this.buf.copyWithin(0, this.cols);
    this.buf.fill(0, (this.rows - 1) * this.cols, this.rows * this.cols);
    this.row = this.rows - 1;
    this.wraps++;
  }

  private render(): void {
    const { ctx, cols, rows, cellW, cellH, padX, padY } = this;
    this.frames++;

    ctx.fillStyle = '#07100a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.font = this.font;
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#8bffb0';

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ch = this.buf[r * cols + c];
        if (ch) ctx.fillText(String.fromCharCode(ch), padX + c * cellW, padY + r * cellH);
      }
    }

    if (Math.floor(Date.now() / 500) % 2 === 0) {
      ctx.fillStyle = 'rgba(139,255,176,0.55)';
      ctx.fillRect(padX + this.col * cellW, padY + this.row * cellH, cellW, cellH);
    }
  }
}
