#!/usr/bin/env node
/**
 * Builds `server/src/fingerprint/mainstreamCatalog.json` using official Apple Music / iTunes
 * 30-second commercial preview audio across all 13 required genres:
 *   Pop, Hip-Hop, Rap, Rock, Alternative, Electronic, Dance, R&B,
 *   Bollywood, Indian Regional, Classical, Instrumental, Acoustic.
 *
 * Each preview is decoded to 16,000 Hz 16-bit mono PCM WAV via macOS `/usr/bin/afconvert`
 * and fingerprinted with the Auralis Wang (2003) Constellation-Peak engine (`generateFingerprints`).
 * Also saves 16 kHz mono WAV fixtures in `/tmp/auralis-mainstream-fixtures/` for Phase 5 testing.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeWav } from '../server/dist/audio/wav.js';
import { generateFingerprints } from '../server/dist/fingerprint/engine.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = '/tmp/auralis-mainstream-fixtures';
const OUTPUT_JSON = join(ROOT, 'server/src/fingerprint/mainstreamCatalog.json');

mkdirSync(FIXTURE_DIR, { recursive: true });

const QUERIES = [
  { genre: 'Pop', query: 'Taylor Swift Anti-Hero', country: 'US' },
  { genre: 'Pop', query: 'Dua Lipa Levitating', country: 'US' },
  { genre: 'Pop', query: 'Billie Eilish Birds of a Feather', country: 'US' },
  { genre: 'Hip-Hop', query: 'Drake Gods Plan', country: 'US' },
  { genre: 'Hip-Hop', query: 'Travis Scott SICKO MODE', country: 'US' },
  { genre: 'Rap', query: 'Kendrick Lamar HUMBLE', country: 'US' },
  { genre: 'Rap', query: 'Eminem Lose Yourself', country: 'US' },
  { genre: 'Rock', query: 'Queen Bohemian Rhapsody', country: 'US' },
  { genre: 'Rock', query: 'Linkin Park In the End', country: 'US' },
  { genre: 'Alternative', query: 'Nirvana Smells Like Teen Spirit', country: 'US' },
  { genre: 'Alternative', query: 'Coldplay Yellow', country: 'US' },
  { genre: 'Electronic', query: 'Daft Punk One More Time', country: 'US' },
  { genre: 'Electronic', query: 'The Chainsmokers Closer', country: 'US' },
  { genre: 'Dance', query: 'Calvin Harris Summer', country: 'US' },
  { genre: 'Dance', query: 'Avicii Wake Me Up', country: 'US' },
  { genre: 'R&B', query: 'The Weeknd Starboy', country: 'US' },
  { genre: 'R&B', query: 'SZA Kill Bill', country: 'US' },
  { genre: 'Bollywood', query: 'Pritam Arijit Singh Kesariya Brahmastra', country: 'IN' },
  { genre: 'Bollywood', query: 'Arijit Singh Tum Hi Ho', country: 'IN' },
  { genre: 'Indian Regional', query: 'A.R. Rahman Jai Ho', country: 'IN' },
  { genre: 'Indian Regional', query: 'Diljit Dosanjh Lover', country: 'IN' },
  { genre: 'Classical', query: 'Ludovico Einaudi Nuvole Bianche', country: 'US' },
  { genre: 'Classical', query: 'Yo-Yo Ma Bach Cello Suite No 1 Prelude', country: 'US' },
  { genre: 'Instrumental', query: 'Hans Zimmer Time Inception', country: 'US' },
  { genre: 'Instrumental', query: 'Miles Davis So What', country: 'US' },
  { genre: 'Acoustic', query: 'Ed Sheeran Thinking Out Loud', country: 'US' },
  { genre: 'Acoustic', query: 'John Mayer Slow Dancing in a Burning Room', country: 'US' },
];

async function searchItunesTrack(query) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&limit=10`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  if (!Array.isArray(data.results) || data.results.length === 0) return null;
  const valid = data.results.filter((r) => r.kind === 'song' && r.previewUrl && r.trackName && r.artistName);
  const studio = valid.find(
    (r) => !/\b(live|lofi|lo-fi|flip|remix|karaoke|cover|tribute|instrumental version)\b/i.test(`${r.trackName} ${r.collectionName ?? ''}`),
  );
  return studio ?? valid[0] ?? null;
}

async function main() {
  const catalogTracks = [];
  const seenIds = new Set();

  for (const item of QUERIES) {
    try {
      const hit = await searchItunesTrack(item.query, item.country);
      if (!hit) {
        console.warn(`[WARN] No iTunes preview found for "${item.query}"`);
        continue;
      }
      const id = `itunes:${hit.trackId}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      const m4aPath = join(FIXTURE_DIR, `${hit.trackId}.m4a`);
      const wavPath = join(FIXTURE_DIR, `${hit.trackId}.wav`);

      if (!existsSync(wavPath)) {
        const audioRes = await fetch(hit.previewUrl);
        if (!audioRes.ok) continue;
        const ab = await audioRes.arrayBuffer();
        writeFileSync(m4aPath, Buffer.from(ab));
        execFileSync('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', m4aPath, wavPath]);
      }

      const wavBytes = new Uint8Array(readFileSync(wavPath));
      const decoded = decodeWav(wavBytes);
      const hashes = generateFingerprints(decoded.mono, decoded.sampleRate);

      // Keep all hashes across the full 30-second commercial preview
      const fullHashes = hashes.map((h) => [h.hash, h.t]);

      const artworkUrl = hit.artworkUrl100
        ? String(hit.artworkUrl100).replace('100x100bb', '1000x1000bb')
        : null;

      const searchQ = encodeURIComponent(`${hit.trackName} ${hit.artistName}`);
      const meta = {
        id,
        title: String(hit.trackName),
        artists: [String(hit.artistName)],
        album: hit.collectionName ? String(hit.collectionName) : null,
        releaseDate: hit.releaseDate ? String(hit.releaseDate).slice(0, 10) : null,
        genres: Array.from(new Set([item.genre, hit.primaryGenreName].filter(Boolean))),
        label: hit.copyright ? String(hit.copyright) : 'Commercial Release',
        isrc: `ITUNES-${hit.trackId}`,
        durationMs: Number(hit.trackTimeMillis) || Math.round(decoded.durationMs),
        artworkUrl,
        previewUrl: String(hit.previewUrl),
        links: [
          hit.trackViewUrl ? { service: 'apple_music', url: String(hit.trackViewUrl), label: 'Apple Music' } : null,
          { service: 'spotify', url: `https://open.spotify.com/search/${searchQ}`, label: 'Spotify' },
          { service: 'youtube_music', url: `https://music.youtube.com/search?q=${searchQ}`, label: 'YouTube Music' },
          { service: 'youtube', url: `https://www.youtube.com/results?search_query=${searchQ}`, label: 'YouTube' },
        ].filter(Boolean),
      };

      catalogTracks.push({
        meta,
         fixtureWav: wavPath,
        hashes: fullHashes,
      });

      console.log(
        `[OK] Indexed [${item.genre}] "${meta.title}" — ${meta.artists[0]} (${fullHashes.length} hashes, ${Math.round(decoded.durationMs / 1000)}s preview)`,
      );
    } catch (err) {
      console.warn(`[WARN] Failed "${item.query}":`, err.message);
    }
  }

  const outputData = {
    generatedAt: new Date().toISOString(),
    trackCount: catalogTracks.length,
    tracks: catalogTracks.map(({ meta, hashes }) => ({ meta, hashes })),
  };

  writeFileSync(OUTPUT_JSON, JSON.stringify(outputData), 'utf8');
  writeFileSync(
    join(FIXTURE_DIR, 'manifest.json'),
    JSON.stringify(
      catalogTracks.map(({ meta, fixtureWav }) => ({ meta, fixtureWav })),
      null,
      2,
    ),
    'utf8',
  );
  console.log(`\nSaved ${catalogTracks.length} mainstream commercial tracks to ${OUTPUT_JSON}`);
}

main();
