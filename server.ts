import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRouter from './server/routes.ts';
import { purgeExpiredSessions } from './server/auth.ts';
import { ensureSeeded } from './src/db/seed.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  await ensureSeeded();
  await purgeExpiredSessions().catch(() => {});

  const cleanupTimer = setInterval(() => {
    purgeExpiredSessions().catch(() => {});
  }, 60 * 60 * 1000);
  cleanupTimer.unref();

  const app = express();
  app.set('trust proxy', 1);
  const port = Number(process.env.PORT || 3000);

  app.use(express.json({ limit: '12mb' }));
  app.use(cookieParser());

  app.use('/api', apiRouter);

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`[Board Sight] Server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
