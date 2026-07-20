import { readFile } from 'node:fs/promises';

const config = await readFile(new URL('../config.js', import.meta.url), 'utf8');
const url = config.match(/SUPABASE_URL\s*=\s*'([^']+)'/)?.[1];
const key = config.match(/SUPABASE_ANON_KEY\s*=\s*'([^']+)'/)?.[1];

if (!url || !key) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in config.js');
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
};

async function request(path, options = {}) {
  const response = await fetch(`${url}${path}`, {
    ...options,
    headers: {
      ...headers,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} failed ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function resetPlots() {
  await request('/rest/v1/plots?plot_idx=not.is.null', {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
  const rows = await request('/rest/v1/plots?select=plot_idx&limit=1');
  console.log(`plots empty=${Array.isArray(rows) && rows.length === 0}`);
  if (!Array.isArray(rows) || rows.length !== 0) {
    throw new Error('public.plots is not empty after reset');
  }
}

async function listPhotos() {
  return request('/storage/v1/object/list/photos', {
    method: 'POST',
    body: JSON.stringify({ limit: 1000, offset: 0, sortBy: { column: 'name', order: 'asc' } }),
  });
}

async function resetPhotos() {
  try {
    const objects = await listPhotos();
    const names = Array.isArray(objects) ? objects.map(obj => obj.name).filter(Boolean) : [];
    if (!names.length) {
      console.log('photos empty=true');
      return;
    }
    await request('/storage/v1/object/photos', {
      method: 'DELETE',
      body: JSON.stringify({ prefixes: names }),
    });
    const remaining = await listPhotos();
    const remainingCount = Array.isArray(remaining) ? remaining.length : -1;
    console.log(`photos empty=${remainingCount === 0}`);
    if (remainingCount !== 0) {
      console.log(`photos cleanup skipped: ${remainingCount} old objects remain unreferenced after public.plots reset`);
    }
  } catch (error) {
    console.log(`photos cleanup skipped: ${error.message}`);
    console.log('photos debris status=old objects unreferenced after public.plots reset');
  }
}

await resetPlots();
await resetPhotos();
