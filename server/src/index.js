import express from 'express';
import cors from 'cors';
import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { router as authRouter, authenticate } from './auth.js';
import routes from './routes.js';

process.on('unhandledRejection', e => console.error('unhandledRejection:', e.message));

const app = express();
app.use(cors({ origin: (process.env.CLIENT_ORIGIN || '*').split(',') }));
app.use(express.json());

app.get('/api/v1/health', (req, res) => res.json({ success: true, data: 'ok' }));
app.use('/api/v1/auth', authRouter);
app.use('/api/v1', authenticate, routes);

// Serve the built React app when client/dist exists (single-service hosting)
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ success: false, message: 'Something went wrong — try again' });
});

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`ExitFlow API on http://localhost:${port}`));
