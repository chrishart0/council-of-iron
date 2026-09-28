/** Small stdio MCP client for the game's existing tools-only server. */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export class LocalMcpClient {
  constructor(command, args, env) {
    this.child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message || 'MCP error'));
      else pending.resolve(message.result);
    });
    this.child.on('exit', (code, signal) => {
      this.closed = true;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Game MCP exited (${code ?? signal}).`));
      }
      this.pending.clear();
    });
    this.child.stderr.resume();
  }
  request(method, params, timeoutMs = 20000) {
    if (this.closed) return Promise.reject(new Error('Game MCP is closed.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Game MCP ${method} timed out.`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }
  async initialize() {
    await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'council-pi', version: '0.1.0' } });
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    return this.request('tools/list', {});
  }
  call(name, args) { return this.request('tools/call', { name, arguments: args }); }
  close() { this.child.kill('SIGTERM'); }
}
