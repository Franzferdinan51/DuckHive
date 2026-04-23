/**
 * Canvas Host Service
 *
 * HTTP server for live debugging UI with WebSocket support.
 * Serves from ~/.duckhive/canvas/ and provides live reload via WebSocket.
 */

import { type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js';

export type CanvasHostOptions = {
  port?: number;
  host?: string;
  rootDir?: string;
};

export type CanvasHost = {
  port: number;
  rootDir: string;
  close: () => Promise<void>;
};

type LiveReloadClient = {
  id: string;
  ws: WebSocket;
};

const WS_PATH = '/__duckhive_live_reload';

let canvasServerInstance: CanvasHost | null = null;

// Lazy load ws to avoid type issues
let WebSocketServer: typeof import('ws').WebSocketServer | null = null;
let wssModule: typeof import('ws') | null = null;

async function getWs(): Promise<typeof import('ws')> {
  if (!wssModule) {
    wssModule = await import('ws');
    WebSocketServer = wssModule.WebSocketServer;
  }
  return wssModule;
}

/**
 * Get the canvas root directory, defaulting to ~/.duckhive/canvas.
 */
export function getCanvasRootDir(): string {
  const home = getClaudeConfigHomeDir();
  return path.join(home, 'canvas');
}

/**
 * Resolve a file path within the canvas root directory.
 * Prevents path traversal attacks.
 */
function resolveCanvasPath(rootDir: string, urlPath: string): string {
  const safePath = urlPath === '/' ? '/index.html' : urlPath;
  const cleanPath = safePath.split('?')[0];
  const resolved = path.resolve(rootDir, cleanPath);
  if (!resolved.startsWith(rootDir + path.sep) && resolved !== rootDir) {
    throw new Error('Path outside canvas root');
  }
  return resolved;
}

/**
 * Detect MIME type from file extension.
 */
function detectMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Create and start the Canvas Host server.
 */
export async function startCanvasHost(options: CanvasHostOptions = {}): Promise<CanvasHost> {
  if (canvasServerInstance) {
    return canvasServerInstance;
  }

  const rootDir = options.rootDir || getCanvasRootDir();
  const port = options.port || 0;
  const host = options.host || 'localhost';

  await fs.mkdir(rootDir, { recursive: true });

  const server = createServer();

  const ws = await getWs();
  const wss = new ws.WebSocketServer({ noServer: true });
  const liveReloadClients = new Set<LiveReloadClient>();

  wss.on('connection', (ws: import('ws').WebSocket) => {
    const client: LiveReloadClient = {
      id: randomUUID(),
      ws,
    };
    liveReloadClients.add(client);

    ws.on('close', () => {
      liveReloadClients.delete(client);
    });

    ws.on('error', () => {
      liveReloadClients.delete(client);
    });
  });

  function injectLiveReload(html: string, wsPort: number): string {
    const liveReloadScript = `
<script>
(function() {
  var ws = new WebSocket('ws://' + window.location.hostname + ':${wsPort}');
  ws.onmessage = function(e) {
    if (e.data === 'reload') {
      window.location.reload();
    }
  };
  ws.onclose = function() {
    setTimeout(function() { window.location.reload(); }, 1000);
  };
})();
</script>`;
    return html.replace('</body>', liveReloadScript + '</body>');
  }

  server.on('request', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (req.url === WS_PATH && req.headers.upgrade) {
        wss.handleUpgrade(req, req.socket, Buffer.from(''), (ws) => {
          wss.emit('connection', ws, req);
        });
        return;
      }

      const filePath = resolveCanvasPath(rootDir, req.url || '/');
      const stat = await fs.stat(filePath);

      if (stat.isDirectory()) {
        const indexPath = path.join(filePath, 'index.html');
        try {
          const content = await fs.readFile(indexPath);
          res.writeHead(200, { 'Content-Type': 'text/html' });
          const addr = server.address();
          const wsPort = typeof addr === 'object' && addr ? addr.port : 0;
          res.end(injectLiveReload(content.toString(), wsPort));
        } catch {
          const files = await fs.readdir(filePath);
          const html = `<html><body><h1>Canvas Directory</h1><ul>${files.map(f =>
            `<li><a href="${f}">${f}</a></li>`).join('')}</ul></body></html>`;
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(html);
        }
        return;
      }

      const content = await fs.readFile(filePath);
      const mime = detectMime(filePath);
      res.writeHead(200, { 'Content-Type': mime });

      if (mime === 'text/html') {
        const addr = server.address();
        const wsPort = typeof addr === 'object' && addr ? addr.port : 0;
        res.end(injectLiveReload(content.toString(), wsPort));
      } else {
        res.end(content);
      }
    } catch (err) {
      const error = err as { code?: string };
      if (error.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      } else if (error.code === 'EPERM') {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
    }
  });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    if (req.url === WS_PATH) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, host, () => resolve());
    server.on('error', reject);
  });

  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : 0;

  // File watcher for live reload
  let watcher: fsSync.FSWatcher | null = null;
  try {
    const chokidar = await import('chokidar');
    watcher = chokidar.watch(rootDir, {
      ignored: /(^|[\/\\])\../,
      persistent: true,
      ignoreInitial: true,
    });

    watcher.on('change', () => {
      for (const client of liveReloadClients) {
        try {
          if (client.ws.readyState === 1) {
            client.ws.send('reload');
          }
        } catch {
          liveReloadClients.delete(client);
        }
      }
    });
  } catch {
    // chokidar not available, skip live reload
  }

  const hostServer: CanvasHost = {
    port: actualPort,
    rootDir,
    close: async () => {
      if (watcher) {
        await watcher.close();
      }
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      canvasServerInstance = null;
    },
  };

  canvasServerInstance = hostServer;
  return hostServer;
}

/**
 * Stop the canvas host server.
 */
export async function stopCanvasHost(): Promise<void> {
  if (canvasServerInstance) {
    await canvasServerInstance.close();
    canvasServerInstance = null;
  }
}

/**
 * Get the current canvas host instance.
 */
export function getCanvasHost(): CanvasHost | null {
  return canvasServerInstance;
}

/**
 * Build the canvas URL for the current host.
 */
export function getCanvasUrl(): string | null {
  if (!canvasServerInstance) return null;
  return `http://localhost:${canvasServerInstance.port}`;
}
