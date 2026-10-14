import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const engineRoot = resolve(repositoryRoot, 'engines/original');
export function rubyEnvironment() {
  return { ...process.env, BUNDLE_GEMFILE: resolve(engineRoot, 'Gemfile'),
    BUNDLE_PATH: resolve(repositoryRoot, 'artifacts/original-engines/gems'),
    BUNDLE_USER_HOME: resolve(repositoryRoot, 'artifacts/original-engines/bundle-user'),
    BUNDLE_FROZEN: 'true', BUNDLE_IGNORE_CONFIG: 'true' };
}

// A persistent subprocess boundary also works with C# Process + redirected
// UTF-8 streams. No shell, evaluation, HTTP service, or fallback parser is used.
export class OriginalEngine {
  static async start(mode, { timeoutMs = 30000, ruby = process.env.MDV_RUBY || 'ruby', desktop = false } = {}) {
    if (!['github', 'qiita'].includes(mode)) throw new Error(`Unknown engine: ${mode}`);
    const engine = new OriginalEngine();
    engine.timeoutMs = timeoutMs;
    engine.pending = new Map();
    engine.nextId = 1;
    engine.stderr = '';
    engine.buffer = '';
    engine.closed = false;
    engine.process = spawn(ruby, ['-rbundler/setup', resolve(engineRoot, 'worker.rb'), mode, ...(desktop ? ['--desktop'] : [])], {
      cwd: repositoryRoot, env: rubyEnvironment(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    engine.process.stdout.setEncoding('utf8');
    engine.process.stderr.setEncoding('utf8');
    const ready = new Promise((accept, reject) => {
      engine.pending.set('ready', { accept, reject, timer: setTimeout(() => engine.fail(new Error('Original engine startup timed out')), timeoutMs) });
    });
    engine.process.stderr.on('data', data => { engine.stderr = (engine.stderr + data).slice(-16384); });
    engine.process.stdout.on('data', data => engine.receive(data));
    engine.process.on('error', error => engine.fail(error));
    engine.process.stdin.on('error', error => engine.fail(error));
    engine.process.on('exit', (code, signal) => engine.fail(new Error(`Original engine exited (${code ?? signal}). ${engine.stderr}`)));
    try {
      engine.metadata = await ready;
      const lock = await readFile(resolve(engineRoot, 'Gemfile.lock'));
      const expectedHash = createHash('sha256').update(lock).digest('hex');
      if (engine.metadata.protocol !== 1 || engine.metadata.mode !== mode || engine.metadata.lock_sha256 !== expectedHash)
        throw new Error('Original engine identity or lock does not match');
      return engine;
    } catch (error) { engine.fail(error); throw error; }
  }

  receive(data) {
    this.buffer += data;
    if (Buffer.byteLength(this.buffer) > 64 * 1024 * 1024) return this.fail(new Error('Original engine response exceeds 64 MiB'));
    let end;
    while ((end = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
      try {
        const message = JSON.parse(line);
        const key = message.type === 'ready' ? 'ready' : message.id;
        const waiter = this.pending.get(key);
        if (!waiter) throw new Error(`Unexpected original engine response: ${key}`);
        if (key !== 'ready' && message.ok !== false && (message.ok !== true || typeof message.html !== 'string'))
          throw new Error('Invalid original engine response');
        clearTimeout(waiter.timer); this.pending.delete(key);
        if (message.ok === false) waiter.reject(new Error(`${message.error?.type}: ${message.error?.message}`));
        else waiter.accept(key === 'ready' ? message.metadata : message);
      } catch (error) { this.fail(error); return; }
    }
  }

  render(markdown) {
    if (this.closed) return Promise.reject(new Error('Original engine is closed'));
    if (typeof markdown !== 'string' || markdown.length > 4 * 1024 * 1024)
      return Promise.reject(new Error('Markdown must be a string of at most 4 Mi characters'));
    const id = this.nextId++;
    const line = JSON.stringify({ id, markdown }) + '\n';
    if (Buffer.byteLength(line) > 24 * 1024 * 1024) return Promise.reject(new Error('Request exceeds 24 MiB'));
    return new Promise((accept, reject) => {
      this.pending.set(id, { accept, reject, timer: setTimeout(() => this.fail(new Error(`Original engine render timed out (${id})`)), this.timeoutMs) });
      this.process.stdin.write(line);
    });
  }

  fail(error) {
    this.closed = true;
    for (const waiter of this.pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); }
    this.pending.clear();
    if (this.process.exitCode === null) this.process.kill();
  }

  close() { this.fail(new Error('Original engine closed')); }
}
