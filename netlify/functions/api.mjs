import { getStore } from '@netlify/blobs';
import { handle } from './lib/game.mjs';

export default async (req) => {
  const store = getStore({ name: 'muaythai-game', consistency: 'strong' });
  return handle(req, {
    store,
    now: Date.now(),
    env: { ADMIN_PASSWORD: process.env.ADMIN_PASSWORD, TOKEN_SECRET: process.env.TOKEN_SECRET },
  });
};

export const config = { path: '/api/*' };
