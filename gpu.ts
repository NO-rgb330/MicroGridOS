class GPU {
  constructor(canvas, container) {
    this.canvas = canvas;
    this.container = container;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.font = '20px "VT323", monospace';
    
    this.cols = 80;
    this.rows = 24;
    this.col = 0;
    this.row = 0;
    this.chars = 0;
    this.wraps = 0;
    this.frames = 0;
    
    this.buf = new Uint16Array(this.cols * this.rows);
    
    // Auto-resize based on container
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    
    this.ctx.scale(dpr, dpr);
    this.ctx.font = this.font;
    this.ctx.textBaseline = 'top';
    
    const metrics = this.ctx.measureText('M');
    this.cellW = Math.ceil(metrics.width);
    this.cellH = 24; // fixed height for VT323

    this.cols = Math.floor(rect.width / this.cellW);
    this.rows = Math.floor(rect.height / this.cellH);
    
    if (this.cols < 10) this.cols = 10;
    if (this.rows < 5) this.rows = 5;

    this.buf = new Uint16Array(this.cols * this.rows);
    this.col = 0;
    this.row = 0;
  }

  start() {
    const loop = () => { this.render(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  putChar(b) {
    this.chars++;
    if (b === 10) { // \n
      this.col = 0;
      this.row++;
      if (this.row >= this.rows) this.scroll();
      return;
    }
    if (b === 8) { // backspace
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

  write(s) {
    for (let i = 0; i < s.length; i++) this.putChar(s.charCodeAt(i));
  }

  clear() {
    this.buf.fill(0);
    this.col = 0;
    this.row = 0;
    this.chars = 0;
    this.wraps = 0;
  }

  scroll() {
    this.buf.copyWithin(0, this.cols);
    this.buf.fill(0, (this.rows - 1) * this.cols, this.rows * this.cols);
    this.row = this.rows - 1;
    this.wraps++;
  }

  render() {
    this.frames++;
    const w = this.canvas.width / (window.devicePixelRatio || 1);
    const h = this.canvas.height / (window.devicePixelRatio || 1);
    
    this.ctx.fillStyle = '#0b0e14';
    this.ctx.fillRect(0, 0, w, h);
    
    this.ctx.font = this.font;
    this.ctx.fillStyle = '#ffb86c'; // Amber text
    
    // Subtle glow
    this.ctx.shadowColor = '#ffb86c';
    this.ctx.shadowBlur = 4;

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const ch = this.buf[r * this.cols + c];
        if (ch) {
          this.ctx.fillText(String.fromCharCode(ch), c * this.cellW, r * this.cellH);
        }
      }
    }

    // Reset shadow for cursor
    this.ctx.shadowBlur = 0;

    // Blinking block cursor
    if (Math.floor(Date.now() / 500) % 2 === 0) {
      this.ctx.fillStyle = 'rgba(255, 184, 108, 0.7)';
      this.ctx.fillRect(this.col * this.cellW, this.row * this.cellH, this.cellW, this.cellH);
    }
  }
}
