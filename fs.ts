class VFS {
  constructor() {
    this.cap = 1 << 30; // 1 GiB
    this.mode = 'memory';
    this.used = 0;
    this.files = 0;
    this.dirs = 0;
    this.memRoot = { kind: 'dir', name: '', children: new Map() };
    this.opfsRoot = null;
  }

  async init() {
    try {
      if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.getDirectory) {
        this.opfsRoot = await navigator.storage.getDirectory();
        this.mode = 'opfs';
      }
    } catch {
      this.mode = 'memory';
    }
    await this.refresh();
    return this.mode;
  }

  async refresh() {
    if (this.mode === 'memory') {
      let used = 0, files = 0, dirs = 0;
      const walk = (n) => {
        if (n.children) for (const c of n.children.values()) {
          if (c.kind === 'file') { used += c.size; files++; }
          else { dirs++; walk(c); }
        }
      };
      walk(this.memRoot);
      this.used = used; this.files = files; this.dirs = dirs;
    } else {
      let used = 0, files = 0, dirs = 0;
      const walk = async (dir) => {
        try {
          for await (const [name, handle] of dir.entries()) {
            if (handle.kind === 'file') {
              const f = await handle.getFile();
              used += f.size; files++;
            } else {
              dirs++; await walk(handle);
            }
          }
        } catch (e) {}
      };
      await walk(this.opfsRoot);
      this.used = used; this.files = files; this.dirs = dirs;
    }
  }

  parts(path) { return path.split('/').filter(Boolean); }

  async getDir(path, create = false) {
    if (this.mode === 'memory') {
      let cur = this.memRoot;
      for (const p of this.parts(path)) {
        if (!cur.children) throw new Error('not a dir');
        let next = cur.children.get(p);
        if (!next) {
          if (!create) throw new Error('not found');
          next = { kind: 'dir', name: p, size: 0, children: new Map() };
          cur.children.set(p, next);
        }
        cur = next;
      }
      return cur;
    } else {
      let d = this.opfsRoot;
      for (const p of this.parts(path)) d = await d.getDirectoryHandle(p, { create });
      return d;
    }
  }

  async write(path, text, append = false) {
    const bytes = text.length;
    if (this.used + bytes > this.cap) throw new Error('cap reached');

    if (this.mode === 'memory') {
      const parts = this.parts(path);
      if (!parts.length) throw new Error('bad path');
      const name = parts.pop();
      const parent = await this.getDir(parts.join('/'), true);
      let n = parent.children.get(name);
      if (!n) { n = { kind: 'file', name, size: 0, text: '' }; parent.children.set(name, n); }
      n.text = (append ? n.text : '') + text;
      n.size = n.text.length;
    } else {
      const parts = this.parts(path);
      const name = parts.pop();
      const dir = await this.getDir(parts.join('/'), true);
      const fh = await dir.getFileHandle(name, { create: true });
      let existing = '';
      if (append) { try { existing = await (await fh.getFile()).text(); } catch {} }
      const w = await fh.createWritable();
      await w.write(existing + text);
      await w.close();
    }
    await this.refresh();
    return { bytes };
  }

  async read(path) {
    if (this.mode === 'memory') {
      const parts = this.parts(path);
      const name = parts.pop();
      const dir = await this.getDir(parts.join('/'));
      const n = dir.children.get(name);
      if (!n || n.kind !== 'file') throw new Error('not found');
      return n.text || '';
    } else {
      const parts = this.parts(path);
      const name = parts.pop();
      const dir = await this.getDir(parts.join('/'));
      const fh = await dir.getFileHandle(name);
      return await (await fh.getFile()).text();
    }
  }

  async list(path) {
    const out = [];
    if (this.mode === 'memory') {
      const dir = await this.getDir(path);
      for (const c of dir.children.values()) out.push({ name: c.name, kind: c.kind, size: c.size });
    } else {
      const dir = await this.getDir(path);
      for await (const [name, handle] of dir.entries()) {
        out.push({ 
          name, 
          kind: handle.kind, 
          size: handle.kind === 'file' ? (await handle.getFile()).size : 0 
        });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async remove(path, recursive) {
    if (this.mode === 'memory') {
      const parts = this.parts(path);
      const name = parts.pop();
      const dir = await this.getDir(parts.join('/'));
      dir.children.delete(name);
    } else {
      const parts = this.parts(path);
      const name = parts.pop();
      const dir = await this.getDir(parts.join('/'));
      await dir.removeEntry(name, { recursive });
    }
    await this.refresh();
  }

  async mkdir(path) {
    if (this.mode === 'memory') await this.getDir(path, true);
    else await this.getDir(path, true);
    await this.refresh();
  }
}
