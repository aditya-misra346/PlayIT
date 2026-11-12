import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FP_SAMPLE_RATE, generateFingerprints, AcousticCatalogIndex, type CatalogTrackMeta } from './engine.js';
export { FP_SAMPLE_RATE };

export interface ReferenceSongSpec {
  meta: CatalogTrackMeta;
  bpm: number;
  rootMidi: number;
  scale: number[];
  progression: number[][];
  melodyPattern: number[];
  timbre: 'synthwave' | 'piano' | 'edm' | 'rock' | 'jazz' | 'ambient' | 'lofi' | 'orchestral' | 'latin' | 'dnb' | 'phonk' | 'hindi' | 'funk_carioca' | 'reggaeton' | 'trap_rap';
  hasVocalsFormant: boolean;
}

/**
 * 10 distinct reference tracks spanning genres, decades, vocal-formant vs instrumental timbres, and tempos.
 * Used both for:
 *  - Automated acoustic recognition accuracy benchmarks (clean, speaker IR, noisy, low-volume, echo, short clips)
 *  - Built-in Reference Jukebox in the web app so users can play a track through their speakers and test live
 *    microphone recognition out of the box even before adding commercial AudD / ACRCloud API keys.
 */
export const REFERENCE_SONGS: ReferenceSongSpec[] = [
  {
    meta: {
      id: 'isrc:USARL2600001',
      title: 'Midnight Horizon',
      artists: ['Nova Pulse', 'Elena Vance'],
      album: 'Neon Odyssey',
      releaseDate: '2024-09-14',
      genres: ['Synthwave', 'Electronic'],
      label: 'Auralis Reference Pressing',
      isrc: 'USARL2600001',
      durationMs: 24000,
      artworkUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=1000&q=80',
      links: [
        { service: 'spotify', url: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT', label: 'Spotify' },
        { service: 'apple_music', url: 'https://music.apple.com/us/album/neon-odyssey/1440857781', label: 'Apple Music' },
        { service: 'youtube_music', url: 'https://music.youtube.com/watch?v=dQw4w9WgXcQ', label: 'YouTube Music' },
      ],
    },
    bpm: 118,
    rootMidi: 57, // A3
    scale: [0, 2, 3, 5, 7, 8, 10, 12],
    progression: [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]],
    melodyPattern: [0, 4, 7, 5, 3, 2, 4, 1, 0, 5, 7, 6, 4, 2, 3, 0],
    timbre: 'synthwave',
    hasVocalsFormant: true,
  },
  {
    meta: {
      id: 'isrc:USARL2600002',
      title: 'Velvet Solitude (Nocturne in D Minor)',
      artists: ['Julian Vance Trio'],
      album: 'Blue Note Sessions',
      releaseDate: '1978-11-03',
      genres: ['Jazz', 'Instrumental'],
      label: 'Vanguard Acoustic Archive',
      isrc: 'USARL2600002',
      durationMs: 24000,
      artworkUrl: 'https://images.unsplash.com/photo-1511192336575-5a79af67a629?auto=format&fit=crop&w=1000&q=80',
      links: [
        { service: 'spotify', url: 'https://open.spotify.com/track/1dGr1c8CrMLDpV6mPbImSI', label: 'Spotify' },
        { service: 'deezer', url: 'https://www.deezer.com/track/3135556', label: 'Deezer' },
      ],
    },
    bpm: 86,
    rootMidi: 62, // D4
    scale: [0, 2, 3, 5, 7, 9, 10, 12],
    progression: [[0, 3, 7, 10], [5, 8, 12, 15], [7, 11, 14, 17], [0, 3, 7, 11]],
    melodyPattern: [7, 6, 4, 2, 3, 5, 1, 0, 4, 3, 2, 5, 7, 4, 2, 0],
    timbre: 'jazz',
    hasVocalsFormant: false,
  },
  {
    meta: {
      id: 'isrc:USARL2600003',
      title: 'Solaris Overdrive',
      artists: ['Kinetix'],
      album: 'Subatomic',
      releaseDate: '2025-03-21',
      genres: ['Drum & Bass', 'Electronic'],
      label: 'Hyperion Bass Collective',
      isrc: 'USARL2600003',
      durationMs: 24000,
      artworkUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=1000&q=80',
      links: [
        { service: 'spotify', url: 'https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b', label: 'Spotify' },
        { service: 'youtube', url: 'https://www.youtube.com/watch?v=fHI8X4OXluQ', label: 'YouTube' },
      ],
    },
    bpm: 172,
    rootMidi: 53, // F3
    scale: [0, 2, 3, 5, 7, 8, 11, 12],
    progression: [[0, 7, 12], [8, 15, 20], [5, 12, 17], [7, 14, 19]],
    melodyPattern: [0, 7, 5, 3, 6, 4, 2, 1, 7, 5, 3, 0, 4, 6, 5, 7],
    timbre: 'dnb',
    hasVocalsFormant: false,
  },
  {
    meta: {
      id: 'isrc:USARL2600004',
      title: 'Golden Hour Echoes',
      artists: ['Clara Solis'],
      album: 'Porcelain & Pine',
      releaseDate: '2016-05-19',
      genres: ['Indie Folk', 'Acoustic'],
      label: 'Lumen Records',
      isrc: 'USARL2600004',
      durationMs: 24000,
      artworkUrl: 'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?auto=format&fit=crop&w=1000&q=80',
      links: [
        { service: 'apple_music', url: 'https://music.apple.com/us/album/1440857781', label: 'Apple Music' },
        { service: 'deezer', url: 'https://www.deezer.com/track/3135556', label: 'Deezer' },
      ],
    },
    bpm: 102,
    rootMidi: 60, // C4
    scale: [0, 2, 4, 5, 7, 9, 11, 12],
    progression: [[0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14]],
    melodyPattern: [2, 4, 5, 4, 2, 0, 1, 2, 4, 6, 7, 5, 4, 2, 1, 0],
    timbre: 'piano',
    hasVocalsFormant: true,
  },
  {
    meta: {
      id: 'isrc:USARL2600005',
      title: 'Static in the Catacombs',
      artists: ['Blackwood & The Iron Choir'],
      album: 'Rust & Voltage',
      releaseDate: '1994-10-11',
      genres: ['Alternative Rock'],
      label: 'Monolith Sound',
      isrc: 'USARL2600005',
      durationMs: 24000,
      artworkUrl: 'https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?auto=format&fit=crop&w=1000&q=80',
      links: [
        { service: 'spotify', url: 'https://open.spotify.com/track/7qiZfU4dY1lWllzX7mPBI3', label: 'Spotify' },
      ],
    },
    bpm: 132,
    rootMidi: 52, // E3
    scale: [0, 2, 3, 5, 7, 10, 12, 14],
    progression: [[0, 7, 12], [3, 10, 15], [5, 12, 17], [2, 9, 14]],
    melodyPattern: [0, 2, 4, 3, 5, 4, 2, 0, 6, 5, 4, 2, 3, 1, 2, 0],
    timbre: 'rock',
    hasVocalsFormant: true,
  },
  {
    meta: {
      id: 'isrc:USARL2600006',
      title: 'Celestial Drift (Op. 42)',
      artists: ['Prague Chamber Consort'],
      album: 'Modern Minimalists',
      releaseDate: '2008-02-28',
      genres: ['Classical', 'Instrumental'],
      label: 'Helios Classical',
      isrc: 'USARL2600006',
      durationMs: 24000,
      artworkUrl: 'https://images.unsplash.com/photo-1507838153414-b4b713384a76?auto=format&fit=crop&w=1000&q=80',
      links: [
        { service: 'apple_music', url: 'https://music.apple.com/us/album/1440857781', label: 'Apple Music' },
      ],
    },
    bpm: 74,
    rootMidi: 55, // G3
    scale: [0, 2, 4, 6, 7, 9, 11, 12],
    progression: [[0, 4, 7, 11], [2, 6, 9, 14], [4, 7, 11, 16], [0, 7, 11, 14]],
    melodyPattern: [0, 3, 4, 6, 7, 4, 3, 1, 2, 5, 6, 4, 7, 6, 4, 0],
    timbre: 'orchestral',
    hasVocalsFormant: false,
  },
  {
    meta: {
      id: 'isrc:USARL2600007',
      title: 'Rain on Shinjuku Glass',
      artists: ['Kumo Beats'],
      album: 'Late Night Transit',
      releaseDate: '2021-12-01',
      genres: ['Lo-Fi Hip-Hop', 'Chillhop'],
      label: 'Driftwood Tape Co.',
      isrc: 'USARL2600007',
      durationMs: 24000,
      artworkUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1000&q=80',
      links: [
        { service: 'spotify', url: 'https://open.spotify.com/track/5HCyWlXZPP0y6Gqq8TgA20', label: 'Spotify' },
        { service: 'youtube_music', url: 'https://music.youtube.com/watch?v=jfKfPfyJRdk', label: 'YouTube Music' },
      ],
    },
    bpm: 82,
    rootMidi: 58, // Bb3
    scale: [0, 2, 3, 5, 7, 8, 10, 12],
    progression: [[0, 3, 7, 10], [5, 8, 12, 15], [3, 7, 10, 14], [2, 5, 9, 12]],
    melodyPattern: [4, 2, 0, 3, 5, 4, 1, 2, 6, 4, 3, 1, 2, 0, 4, 3],
    timbre: 'lofi',
    hasVocalsFormant: false,
  },
  {
    meta: {
      id: 'isrc:USARL2600008',
      title: 'Brisa de Cartagena',
      artists: ['Mateo Rivera', 'Orquesta del Mar'],
      album: 'Sol y Sombra',
      releaseDate: '2019-07-12',
      genres: ['Latin Pop', 'Tropical'],
      label: 'Miramar Musica',
      isrc: 'USARL2600008',
      durationMs: 24000,
      artworkUrl: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=1000&q=80',
      links: [
        { service: 'spotify', url: 'https://open.spotify.com/track/2Fxmhks0bxGSBdJ92vM42m', label: 'Spotify' },
        { service: 'deezer', url: 'https://www.deezer.com/track/3135556', label: 'Deezer' },
      ],
    },
    bpm: 108,
    rootMidi: 64, // E4
    scale: [0, 1, 4, 5, 7, 8, 10, 12], // Phrygian dominant
    progression: [[0, 4, 7], [1, 5, 8], [3, 7, 10], [0, 4, 7]],
    melodyPattern: [0, 1, 2, 4, 3, 2, 1, 0, 4, 5, 4, 2, 3, 1, 2, 0],
    timbre: 'latin',
    hasVocalsFormant: true,
  },
  {
    meta: {
      id: 'isrc:INARL2600009',
      title: 'Raag Darbari Nights (राग दरबारी)',
      artists: ['Rohan Sen', 'Auralis Bollywood Ensemble'],
      album: 'Varanasi Solitude',
      releaseDate: '2023-04-18',
      genres: ['Bollywood', 'Classical', 'Sufi'],
      label: 'Saregama India Ltd / Auralis Pressing',
      isrc: 'INARL2600009',
      durationMs: 24000,
      artworkUrl: 'https://images.unsplash.com/photo-1545232979-fbf68fe9b1af?auto=format&fit=crop&w=1000&q=80',
      links: [
        { service: 'spotify', url: 'https://open.spotify.com/search/Raag%20Darbari%20Nights', label: 'Spotify' },
        { service: 'apple_music', url: 'https://music.apple.com/in/search?term=Raag%20Darbari%20Nights', label: 'Apple Music' },
      ],
    },
    bpm: 88,
    rootMidi: 58, // Bb3 (Bhairavi / Darbari)
    scale: [0, 1, 3, 5, 7, 8, 10, 12],
    progression: [[0, 3, 7], [1, 5, 8], [5, 8, 12], [0, 3, 7]],
    melodyPattern: [0, 1, 3, 5, 4, 3, 1, 0, 7, 8, 7, 5, 3, 1, 2, 0],
    timbre: 'hindi',
    hasVocalsFormant: true,
  },
  {
    meta: {
      id: 'isrc:USARL2600010',
      title: 'Tokyo Drift Cowbell Madness',
      artists: ['KAGE PHONK', 'Ghost 808'],
      album: 'Drift Katana Vol. 1',
      releaseDate: '2024-02-10',
      genres: ['Phonk', 'Drift Phonk', 'Electronic'],
      label: 'Black 17 Media / Auralis Drift',
      isrc: 'USARL2600010',
      durationMs: 24000,
      artworkUrl: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?auto=format&fit=crop&w=1000&q=80',
      links: [
        { service: 'spotify', url: 'https://open.spotify.com/search/Tokyo%20Drift%20Cowbell%20Madness', label: 'Spotify' },
        { service: 'youtube_music', url: 'https://music.youtube.com/search?q=Tokyo%20Drift%20Cowbell%20Madness', label: 'YouTube Music' },
      ],
    },
    bpm: 152,
    rootMidi: 48, // C3
    scale: [0, 3, 5, 6, 7, 10, 12], // Blues/Minor
    progression: [[0, 3, 7], [5, 8, 12], [3, 6, 10], [0, 3, 7]],
    melodyPattern: [0, 3, 5, 6, 5, 3, 0, 5, 6, 7, 6, 5, 3, 5, 3, 0],
    timbre: 'phonk',
    hasVocalsFormant: true,
  },
  {
    meta: {
      id: 'isrc:BRARL2600011',
      title: 'Batidão de Copacabana',
      artists: ['MC Carioca', 'DJ Favela'],
      album: 'Baile da Glória',
      releaseDate: '2023-11-05',
      genres: ['Funk Carioca', 'Mandelão', 'Brazilian'],
      label: 'Som Livre / KondZilla',
      isrc: 'BRARL2600011',
      durationMs: 24000,
      artworkUrl: 'https://images.unsplash.com/photo-1483412033650-1015ddeb83d1?auto=format&fit=crop&w=1000&q=80',
      links: [
        { service: 'spotify', url: 'https://open.spotify.com/search/Batid%C3%A3o%20de%20Copacabana', label: 'Spotify' },
        { service: 'apple_music', url: 'https://music.apple.com/br/search?term=Batidao%20de%20Copacabana', label: 'Apple Music' },
      ],
    },
    bpm: 130,
    rootMidi: 50, // D3
    scale: [0, 2, 3, 5, 7, 8, 10, 12],
    progression: [[0, 3, 7], [8, 12, 15], [5, 8, 12], [0, 3, 7]],
    melodyPattern: [0, 2, 3, 5, 7, 5, 3, 2, 0, 3, 7, 5, 3, 2, 3, 0],
    timbre: 'funk_carioca',
    hasVocalsFormant: true,
  },
  {
    meta: {
      id: 'isrc:ESARL2600012',
      title: 'Fuego en San Juan',
      artists: ['Mateo Vega', 'El Cangri'],
      album: 'Perreo Cósmico',
      releaseDate: '2024-01-20',
      genres: ['Reggaeton', 'Latin Pop', 'Urban Latino'],
      label: 'Rimas Entertainment / Sony Music Latin',
      isrc: 'ESARL2600012',
      durationMs: 24000,
      artworkUrl: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=1000&q=80',
      links: [
        { service: 'spotify', url: 'https://open.spotify.com/search/Fuego%20en%20San%20Juan', label: 'Spotify' },
        { service: 'apple_music', url: 'https://music.apple.com/us/search?term=Fuego%20en%20San%20Juan', label: 'Apple Music' },
      ],
    },
    bpm: 94,
    rootMidi: 57, // A3
    scale: [0, 2, 3, 5, 7, 8, 10, 12],
    progression: [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]],
    melodyPattern: [0, 2, 3, 5, 3, 2, 0, 3, 5, 7, 5, 3, 2, 0, 2, 0],
    timbre: 'reggaeton',
    hasVocalsFormant: true,
  },
  {
    meta: {
      id: 'isrc:USARL2600013',
      title: 'Section 80 Chronicles',
      artists: ['Marcus Cole', 'K-Dot Squad'],
      album: 'Compton to Harlem',
      releaseDate: '2022-08-14',
      genres: ['Hip-Hop', 'Conscious Rap', 'Trap'],
      label: 'Top Dawg Entertainment / Interscope',
      isrc: 'USARL2600013',
      durationMs: 24000,
      artworkUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&w=1000&q=80',
      links: [
        { service: 'spotify', url: 'https://open.spotify.com/search/Section%2080%20Chronicles', label: 'Spotify' },
        { service: 'apple_music', url: 'https://music.apple.com/us/search?term=Section%2080%20Chronicles', label: 'Apple Music' },
      ],
    },
    bpm: 142,
    rootMidi: 46, // Bb2 (Deep 808 sub)
    scale: [0, 2, 3, 5, 7, 8, 10, 12],
    progression: [[0, 3, 7], [5, 8, 12], [8, 12, 15], [0, 3, 7]],
    melodyPattern: [0, 3, 5, 7, 5, 3, 0, 2, 3, 5, 3, 2, 0, 3, 2, 0],
    timbre: 'trap_rap',
    hasVocalsFormant: true,
  },
];

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Deterministic polyphonic synthesizer generating rich harmonic audio for a reference song.
 * Produces distinct chord voicings, arpeggiated leads, bass harmonics, vocal-formant modulation, and drum transients
 * so that every 500ms slice has a unique constellation peak signature.
 */
export function synthesizeReferenceSong(spec: ReferenceSongSpec, durationSec = 24, sampleRate = FP_SAMPLE_RATE): Float32Array {
  const numSamples = Math.floor(durationSec * sampleRate);
  const out = new Float32Array(numSamples);
  const spb = 60 / spec.bpm; // seconds per beat
  const sixteenth = spb / 4;

  // Deterministic PRNG seeded by ISRC for percussive transients & unique melodic variations per bar
  let seed = 0;
  for (let i = 0; i < spec.meta.id.length; i++) {
    seed = (seed * 31 + spec.meta.id.charCodeAt(i)) >>> 0;
  }
  const nextRand = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return (seed / 0xffffffff) * 2 - 1;
  };

  // Pre-generate bar-level melodic variations so bars 1..16 are non-identical (accurate offset detection!)
  const totalSixteenths = Math.ceil(durationSec / sixteenth) + 4;
  const noteSteps = new Int32Array(totalSixteenths);
  for (let s = 0; s < totalSixteenths; s++) {
    const base = spec.melodyPattern[s % spec.melodyPattern.length];
    const barShift = Math.floor(s / 16) % 5;
    const salt = Math.abs(Math.floor(nextRand() * 7));
    noteSteps[s] = (base + barShift + (s % 3 === 0 ? salt : 0)) % spec.scale.length;
  }

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const beatIdx = Math.floor(t / spb);
    const stepIdx = Math.floor(t / sixteenth);
    const stepPhase = (t % sixteenth) / sixteenth;
    const barIdx = Math.floor(beatIdx / 4);

    // 1. Chord progression pad + harmonic overtones
    const chord = spec.progression[barIdx % spec.progression.length];
    let pad = 0;
    for (let c = 0; c < chord.length; c++) {
      const f = midiToHz(spec.rootMidi - 12 + chord[c]);
      pad += 0.14 * Math.sin(2 * Math.PI * f * t) + 0.07 * Math.sin(4 * Math.PI * f * t) + 0.03 * Math.sin(6 * Math.PI * f * t);
    }

    // 2. Melodic lead with step-unique interval and decay envelope
    const scaleDeg = spec.scale[noteSteps[stepIdx]];
    const octaveShift = ((stepIdx + barIdx) % 3) * 12;
    const leadFreq = midiToHz(spec.rootMidi + scaleDeg + octaveShift);
    const env = Math.exp(-stepPhase * (spec.timbre === 'piano' || spec.timbre === 'latin' ? 5.5 : 3.2));
    let lead =
      env *
      (0.32 * Math.sin(2 * Math.PI * leadFreq * t) +
        0.18 * Math.sin(2 * Math.PI * leadFreq * 2 * t + 0.4) +
        0.11 * Math.sin(2 * Math.PI * leadFreq * 3 * t) +
        0.06 * Math.sin(2 * Math.PI * leadFreq * 4 * t));

    // Counter-melody fifths/thirds that evolve with absolute time t
    const counterFreq = midiToHz(spec.rootMidi + 7 + ((stepIdx * 3 + barIdx * 2) % 11));
    lead += 0.14 * Math.exp(-stepPhase * 4) * Math.sin(2 * Math.PI * counterFreq * t);

    // 3. Vocal formant carrier when song has vocals
    let vocal = 0;
    if (spec.hasVocalsFormant) {
      const vibrato = 1 + (spec.timbre === 'hindi' ? 0.018 : 0.006) * Math.sin(2 * Math.PI * (spec.timbre === 'hindi' ? 6.2 : 5.4) * t);
      const vf = midiToHz(spec.rootMidi + 12 + spec.scale[(beatIdx + barIdx) % spec.scale.length]) * vibrato;
      const formant1 = Math.sin(2 * Math.PI * vf * 2 * t);
      const formant2 = Math.sin(2 * Math.PI * vf * 4 * t);
      vocal = 0.15 * (0.6 * formant1 + 0.4 * formant2) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 1.5 * t));
    }

    // 4. Genre-specific acoustic instrumentation:
    let genreElements = 0;
    if (spec.timbre === 'phonk') {
      // Roland TR-808 cowbells (840 Hz & 1680 Hz) + distorted 808 sub-bass
      const cowbellTrigger = (stepIdx % 4 === 1 || stepIdx % 4 === 3);
      if (cowbellTrigger) {
        const cbEnv = Math.exp(-stepPhase * 18);
        const cbFreq = 840 + (stepIdx % 3) * 140;
        genreElements += cbEnv * 0.28 * (Math.sin(2 * Math.PI * cbFreq * t) + 0.6 * Math.sin(2 * Math.PI * (cbFreq * 1.48) * t));
      }
      const sub808 = Math.sin(2 * Math.PI * 42 * t) * 0.35;
      genreElements += Math.tanh(sub808 * 2.5) * 0.25;
    } else if (spec.timbre === 'hindi') {
      // Sitar / Tanpura sympathetic resonance drone & tabla bayan modulation
      const drone = 0.12 * Math.sin(2 * Math.PI * 146.83 * t) + 0.08 * Math.sin(2 * Math.PI * 220 * t);
      genreElements += drone;
    } else if (spec.timbre === 'funk_carioca') {
      // Tamborzão syncopated rhythm ("tchá-tchá-tum-tchá")
      const isTamborzao = (stepIdx % 16 === 0 || stepIdx % 16 === 3 || stepIdx % 16 === 8 || stepIdx % 16 === 10 || stepIdx % 16 === 14);
      if (isTamborzao) {
        genreElements += Math.exp(-stepPhase * 14) * 0.26 * Math.sin(2 * Math.PI * 75 * t);
      }
    } else if (spec.timbre === 'reggaeton') {
      // Classic dembow syncopation
      const isDembowSnare = (stepIdx % 8 === 3 || stepIdx % 8 === 6);
      if (isDembowSnare) {
        genreElements += Math.exp(-stepPhase * 22) * 0.24 * Math.sin(2 * Math.PI * 260 * t);
      }
    } else if (spec.timbre === 'trap_rap') {
      // Rolling 32nd-note hi-hat flutter & deep 808 sub
      const sub808 = Math.sin(2 * Math.PI * 46 * t) * 0.28;
      const hatFlutter = (stepIdx % 4 === 3) ? Math.exp(-(stepPhase % 0.5) * 45) * 0.12 * Math.sin(2 * Math.PI * 5200 * t) : 0;
      genreElements += sub808 + hatFlutter;
    }

    // 5. Kick + Hi-Hat transients (gives sharp time localization in spectrogram)
    const beatPhase = (t % spb) / spb;
    const kickFreq = 55 + 110 * Math.exp(-beatPhase * 28);
    const kick = Math.exp(-beatPhase * 12) * 0.25 * Math.sin(2 * Math.PI * kickFreq * t);
    const hatEnv = stepIdx % 2 === 1 ? Math.exp(-stepPhase * 35) * 0.08 : 0;
    const hat = hatEnv * Math.sin(2 * Math.PI * (3400 + (stepIdx % 5) * 210) * t);

    out[i] = Math.max(-0.95, Math.min(0.95, pad + lead + vocal + genreElements + kick + hat));
  }
  return out;
}

let cachedDefaultCatalog: AcousticCatalogIndex | null = null;
let cachedMainstreamTracks: CatalogTrackMeta[] | null = null;

function loadBundledMainstreamCatalog(): Array<{ meta: CatalogTrackMeta; hashes: Array<[number, number]> }> {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, 'mainstreamCatalog.json'),
    join(here, '../../src/fingerprint/mainstreamCatalog.json'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const parsed = JSON.parse(readFileSync(p, 'utf8'));
        if (Array.isArray(parsed?.tracks)) {
          return parsed.tracks;
        }
      } catch {
        // Ignore malformed JSON
      }
    }
  }
  return [];
}

export function getMainstreamCatalogTracks(): CatalogTrackMeta[] {
  if (cachedMainstreamTracks) return cachedMainstreamTracks;
  cachedMainstreamTracks = loadBundledMainstreamCatalog().map((t) => t.meta);
  return cachedMainstreamTracks;
}

export function getDefaultReferenceCatalog(): AcousticCatalogIndex {
  if (cachedDefaultCatalog) return cachedDefaultCatalog;
  const idx = new AcousticCatalogIndex();
  for (const spec of REFERENCE_SONGS) {
    const pcm = synthesizeReferenceSong(spec, 24, FP_SAMPLE_RATE);
    const hashes = generateFingerprints(pcm, FP_SAMPLE_RATE);
    idx.addTrack(spec.meta, hashes);
  }
  // Load pre-computed Wang (2003) constellation fingerprints for real mainstream commercial tracks across 13 genres
  const mainstream = loadBundledMainstreamCatalog();
  for (const item of mainstream) {
    if (item?.meta && Array.isArray(item.hashes)) {
      idx.addTrack(
        item.meta,
        item.hashes.map(([hash, t]) => ({ hash, t })),
      );
    }
  }
  cachedDefaultCatalog = idx;
  return idx;
}
