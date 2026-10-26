export interface Entry { name: string; kind: 'file' | 'dir'; size: number; }
export interface WriteResult { bytes: number; size: number; }
export interface RemoveResult { kind: 'file' | 'dir'; size: number; }
export interface Usage { used: number; files: number; dirs: number; }

abstract class Backend {
  abstract read(path: string): Promise<string>;
  abstract write(path: string, text: string, append: boolean): Promise<WriteResult>;
  abstract list(path: string): Promise<Entry[]>;
  abstract remove(path: string, recursive: boolean): Promise<RemoveResult>;
  abstract mkdir(path: string): Promise<void>;
  abstract usage(): Promise<Usage>;
}

/* ============================================================
   OPFS backend
   ============================================================ */

class OPFSBackend extends Backend {
  private root: FileSystemDirectoryHandle;

  constructor(root: FileSystemDirectoryHandle) { super(); this.root = root; }

  private static parts(path: string): string[] { return path.split('/').filter(Boolean); }

  private async dir(path: string, create = false): Promise<FileSystemDirectoryHandle> {
    let d = this.root;
    for (const p of OPFSBackend.parts(path)) d = await d.getDirectoryHandle(p, { create });
    return d;
  }

  private async locate(path: string, create = false): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
    const parts = OPFSBackend.parts(path);
    if (!parts.length) throw new Error('not a file path');
    const name = parts.pop()!;
    const dir = await this.dir(parts.join('/'), create);
    return { dir, name };
  }

  private async *handles(dir: FileSystemDirectoryHandle): AsyncGenerator<FileSystemHandle> {
    const anyDir = dir as any;
    if (typeof anyDir.values === 'function') {
      for await (const h of anyDir.values()) yield h as FileSystemHandle;
    } else if (typeof anyDir.entries === 'function') {
      for await (const [, h] of anyDir.entries()) yield h as FileSystemHandle;
    }
  }

  async read(path: string): Promise<string> {
    const { dir, name } = await this.locate(path);
    const fh = await dir.getFileHandle(name);
    return (await fh.getFile()).text();
  }

  async write(path: string, text: string, append: boolean): Promise<WriteResult> {
    const { dir, name } = await this.locate(path, true);
    const fh = await dir.getFileHandle(name, { create: true });
    let existing = '';
    if (append) { try { existing = await (await fh.getFile()).text(); } catch {} }
    const data = existing + text;
    const w = await fh.createWritable();
    await w.write(data);
    await w.close();
    return { bytes: text.length, size: data.length };
  }

  async list(path: string): Promise<Entry[]> {
    const dir = await this.dir(path);
    const out: Entry[] = [];
    for await (const handle of this.handles(dir)) {
      if (handle.kind === 'file') {
        const f = await (handle as FileSystemFileHandle).getFile();
        out.push({ name: handle.name, kind: 'file', size: f.size });
      } else {
        out.push({ name: handle.name, kind: 'dir', size: 0 });
      }
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  async remove(path: string, recursive: boolean): Promise<RemoveResult> {
    const parts = OPFSBackend.parts(path);
    if (!parts.length) throw new Error('cannot remove root');
    const name = parts.pop()!;
    const dir = await this.dir(parts.join('/'));
    let kind: 'file' | 'dir' = 'file';
    let size = 0;
    try {
      const fh = await dir.getFileHandle(name);
      size = (await fh.getFile()).size;
    } catch {
      kind = 'dir';
      size = await this.dirSize(await dir.getDirectoryHandle(name));
    }
    await dir.removeEntry(name, { recursive });
    return { kind, size };
  }

  private async dirSize(dir: FileSystemDirectoryHandle): Promise<number> {
    let total = 0;
    for await (const handle of this.handles(dir)) {
      if (handle.kind === 'file') total += (await (handle as FileSystemFileHandle).getFile()).size;
      else total += await this.dirSize(handle as FileSystemDirectoryHandle);
    }
    return total;
  }

  async mkdir(path: string): Promise<void> { await this.dir(path, true); }

  async usage(): Promise<Usage> {
    let used = 0, files = 0, dirs = 0;
    const walk = async (d: FileSystemDirectoryHandle): Promise<void> => {
      for await (const handle of this.handles(d)) {
        if (handle.kind === 'file') {
          used += (await (handle as FileSystemFileHandle).getFile()).size;
          files++;
        } else {
          dirs++;
          await walk(handle as FileSystemDirectoryHandle);
        }
      }
    };
    await walk(this.root);
    return { used, files, dirs };
  }
}

/* ============================================================
   In-memory fallback
   ============================================================ */

interface MemNode {
  kind: 'file' | 'dir';
  name: string;
  size: number;
  text?: string;
  children?: Map<string, MemNode>;
}

class MemoryBackend extends Backend {
  private root: MemNode = { kind: 'dir', name: '', size: 0, children: new Map() };

  private static parts(path: string): string[] { return path.split('/').filter(Boolean); }

  private find(path: string, create = false): MemNode {
    let cur = this.root;
    for (const p of MemoryBackend.parts(path)) {
      if (!cur.children) throw new Error('not a directory: ' + path);
      let next = cur.children.get(p);
      if (!next) {
        if (!create) throw new Error('not found: ' + path);
        next = { kind: 'dir', name: p, size: 0, children: new Map() };
        cur.children.set(p, next);
      }
      cur = next;
    }
    return cur;
  }

  async read(path: string): Promise<string> {
    const n = this.find(path);
    if (n.kind !== 'file') throw new Error('not a file: ' + path);
    return n.text || '';
  }

  async write(path: string, text: string, append: boolean): Promise<WriteResult> {
    const parts = MemoryBackend.parts(path);
    if (!parts.length) throw new Error('not a file path');
    const name = parts.pop()!;
    const parent = this.find(parts.join('/'), true);
    let n = parent.children!.get(name);
    if (!n) { n = { kind: 'file', name, size: 0, text: '' }; parent.children!.set(name, n); }
    if (n.kind !== 'file') throw new Error('not a file: ' + path);
    n.text = (append ? n.text : '') + text;
    n.size = n.text!.length;
    return { bytes: text.length, size: n.size };
  }

  async list(path: string): Promise<Entry[]> {
    const n = this.find(path);
    if (n.kind !== 'dir') throw new Error('not a directory: ' + path);
    const out: Entry[] = [];
    for (const c of n.children!.values()) out.push({ name: c.name, kind: c.kind, size: c.kind === 'file' ? c.size : 0 });
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  async remove(path: string, recursive: boolean): Promise<RemoveResult> {
    const parts = MemoryBackend.parts(path);
    if (!parts.length) throw new Error('cannot remove root');
    const name = parts.pop()!;
    const parent = this.find(parts.join('/'));
    const n = parent.children!.get(name);
    if (!n) throw new Error('not found: ' + path);
    if (n.kind === 'dir' && !recursive && n.children!.size > 0) throw new Error('directory not empty: ' + path);
    parent.children!.delete(name);
    return { kind: n.kind, size: n.kind === 'file' ? n.size : this.dirSize(n) };
  }

  private dirSize(n: MemNode): number {
    let total = 0;
    if (n.children) for (const c of n.children.values()) total += c.kind === 'file' ? c.size : this.dirSize(c);
    return total;
  }

  async mkdir(path: string): Promise<void> { this.find(path, true); }

  async usage(): Promise<Usage> {
    let used = 0, files = 0, dirs = 0;
    const walk = (n: MemNode): void => {
      if (n.children) for (const c of n.children.values()) {
        if (c.kind === 'file') { used += c.size; files++; }
        else { dirs++; walk(c); }
      }
    };
    walk(this.root);
    return { used, files, dirs };
  }
}

/* ============================================================
   VFS — façade
   ============================================================ */

export class VFS {
  readonly cap = 1 << 30; // 1 GiB
  mode: 'opfs' | 'memory' = 'memory';
  used = 0;
  files = 0;
  dirs = 0;
  private backend!: Backend;

  async init(): Promise<'opfs' | 'memory'> {
    try {
      if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.getDirectory) {
        throw new Error('OPFS unavailable');
      }
      const root = await navigator.storage.getDirectory();
      this.backend = new OPFSBackend(root);
      this.mode = 'opfs';
    } catch {
      this.backend = new MemoryBackend();
      this.mode = 'memory';
    }
    await this.refresh();
    return this.mode;
  }

  private async refresh(): Promise<void> {
    const u = await this.backend.usage();
    this.used = u.used;
    this.files = u.files;
    this.dirs = u.dirs;
  }

  async read(path: string): Promise<string> { return this.backend.read(path); }

  async write(path: string, text: string, append = false): Promise<WriteResult> {
    let prev = 0;
    try { prev = (await this.backend.read(path)).length; } catch {}
    const projected = (append ? prev : 0) + text.length;
    if (this.used - prev + projected > this.cap) throw new Error('storage cap reached (1 GiB)');
    const r = await this.backend.write(path, text, append);
    await this.refresh();
    return r;
  }

  async list(path: string): Promise<Entry[]> { return this.backend.list(path); }

  async remove(path: string, recursive: boolean): Promise<RemoveResult> {
    const r = await this.backend.remove(path, recursive);
    await this.refresh();
    return r;
  }

  async mkdir(path: string): Promise<void> {
    await this.backend.mkdir(path);
    await this.refresh();
  }
}
