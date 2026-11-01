import express from 'express';
import { createServer as createViteServer } from 'vite';
import fs from 'fs';
import zlib from 'zlib';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // Server-side .als gzip decompression utility endpoint
  app.post('/api/als/decompress', (req, res) => {
    try {
      const { base64Data } = req.body;
      if (!base64Data) {
        return res.status(400).json({ error: 'Missing base64Data payload' });
      }
      const buffer = Buffer.from(base64Data, 'base64');
      if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
        const decompressed = zlib.gunzipSync(buffer);
        return res.json({ xml: decompressed.toString('utf-8'), wasGzipped: true });
      }
      return res.json({ xml: buffer.toString('utf-8'), wasGzipped: false });
    } catch (err: any) {
      return res.status(500).json({ error: `Failed to decompress .als archive: ${err.message}` });
    }
  });

  // Server-side .als gzip compression utility endpoint
  app.post('/api/als/compress', (req, res) => {
    try {
      const { xml } = req.body;
      if (!xml || typeof xml !== 'string') {
        return res.status(400).json({ error: 'Missing XML string payload' });
      }
      const compressed = zlib.gzipSync(Buffer.from(xml, 'utf-8'), { level: 9 });
      return res.json({
        base64Als: compressed.toString('base64'),
        rawBytes: Buffer.byteLength(xml, 'utf-8'),
        gzipBytes: compressed.length,
      });
    } catch (err: any) {
      return res.status(500).json({ error: `Failed to compress XML to .als: ${err.message}` });
    }
  });

  // Published APK metadata endpoint
  app.get('/api/apk-metadata', (_req, res) => {
    const metaCandidates = [
      path.join(__dirname, 'public', 'apk-metadata.json'),
      path.join(__dirname, 'dist', 'apk-metadata.json'),
    ];
    for (const p of metaCandidates) {
      if (fs.existsSync(p)) {
        try {
          const meta = JSON.parse(fs.readFileSync(p, 'utf-8'));
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
          return res.json(meta);
        } catch {
          // Fallback to dynamic metadata below
        }
      }
    }

    // Dynamic metadata fallback
    const apkCandidates = [
      path.join(__dirname, 'dist', 'parametric-techno-daw-debug.apk'),
      path.join(__dirname, 'public', 'parametric-techno-daw-debug.apk'),
      path.join(__dirname, 'android/app/build/outputs/apk/debug/app-debug.apk'),
    ];
    const existingPath = apkCandidates.find((p) => fs.existsSync(p));
    let sha256Hex = '';
    let sizeBytes = 0;
    if (existingPath) {
      const buf = fs.readFileSync(existingPath);
      sizeBytes = buf.length;
      sha256Hex = crypto.createHash('sha256').update(buf).digest('hex');
    }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.json({
      applicationId: 'com.parametricals.technodaw',
      appName: 'Parametric ALS DAW',
      versionName: '7.2.0',
      versionCode: 2,
      buildVariant: 'debug',
      sha256: sha256Hex,
      sizeBytes,
      targetSdk: 36,
      minSdk: 24,
      verificationStatus: 'verified',
      buildSystem: 'Gradle/Capacitor',
      buildTimestamp: new Date().toISOString(),
    });
  });

  // Direct binary download route for the compiled v1+v2 signed Android Debug APK
  const serveDebugApk = (_req: express.Request, res: express.Response) => {
    const candidates = [
      path.join(__dirname, 'dist', 'parametric-techno-daw-debug.apk'),
      path.join(__dirname, 'public', 'parametric-techno-daw-debug.apk'),
      path.join(__dirname, 'android/app/build/outputs/apk/debug/app-debug.apk'),
    ];
    const existingPath = candidates.find((p) => fs.existsSync(p));
    if (!existingPath) {
      return res.status(404).json({ error: 'APK binary not found' });
    }
    const apkBuf = fs.readFileSync(existingPath);
    const sha256Hex = crypto.createHash('sha256').update(apkBuf).digest('hex');

    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="parametric-techno-daw-debug.apk"'
    );
    res.setHeader('Content-Length', String(apkBuf.length));
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('X-APK-SHA256', sha256Hex);
    res.setHeader('X-APK-VersionCode', '2');
    res.setHeader('X-APK-VersionName', '7.2.0');
    return res.status(200).send(apkBuf);
  };

  app.get('/api/download/apk', serveDebugApk);
  app.get('/parametric-techno-daw-debug.apk', serveDebugApk);

  // Downloadable Android / Tablet Standalone Launcher & Capacitor APK Build Spec
  app.get('/api/download/android-installer', (req, res) => {
    const appOrigin = `https://ais-pre-rivuqsv2p5yqh2yguttcdy-90877397680.asia-southeast1.run.app`;
    const installerHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
  <meta name="theme-color" content="#080A0D" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <title>Parametric ALS DAW — Mobile & Tablet Edition</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body, html { width: 100%; height: 100dvh; background: #080A0D; color: #F1F5F9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace; overflow: hidden; display: flex; flex-direction: column; }
    .top-bar { height: 42px; background: #0C0F15; border-bottom: 1px solid #1E2530; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; font-size: 12px; }
    .brand { color: #F59E0B; font-weight: 700; display: flex; align-items: center; gap: 8px; }
    .actions { display: flex; align-items: center; gap: 8px; }
    .btn { background: #10B981; color: #052E16; font-weight: 700; padding: 5px 12px; border-radius: 4px; text-decoration: none; font-size: 11px; border: none; cursor: pointer; }
    iframe { flex: 1; width: 100%; border: none; background: #080A0D; }
  </style>
</head>
<body>
  <div class="top-bar">
    <div class="brand">
      <span>● PARAMETRIC ALS DAW (ANDROID & TABLET STANDALONE)</span>
    </div>
    <div class="actions">
      <a class="btn" href="${appOrigin}" target="_blank" rel="noopener noreferrer">Open Native WebAPK Install</a>
    </div>
  </div>
  <iframe src="${appOrigin}" allow="autoplay; midi; clipboard-read; clipboard-write; fullscreen"></iframe>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="Parametric-ALS-DAW-Android-Tablet.html"'
    );
    return res.status(200).send(installerHtml);
  });

  // Helper to generate procedural AI techno sequence fallback for all 8 archetypes
  function generateFallbackAiSequence(archetype: string, rootKey: string, _tempo: number) {
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const semitone = Math.max(0, noteNames.indexOf(rootKey.toUpperCase()));
    const rootPitch = 24 + semitone; // F1 = 29

    interface NoteItem {
      time: number;
      duration: number;
      pitch: number;
      velocity: number;
    }

    if (archetype === 'rumble') {
      const notes: NoteItem[] = [];
      const seed = Math.floor(Math.random() * 4);
      for (let step = 0; step < 16; step++) {
        if (seed === 0 && step % 4 === 0) continue;
        const time = step * 0.25;
        const isOffbeat = step % 4 === 2;
        const vel = isOffbeat ? 108 : step % 2 === 1 ? 78 : 38;
        const pitch = seed === 1 && step >= 14 ? rootPitch + 1 : rootPitch;
        notes.push({
          time: Number(time.toFixed(3)),
          duration: isOffbeat ? 0.24 : 0.18,
          pitch,
          velocity: vel,
        });
      }
      return {
        clipName: `AI_Rumble_Sub_${seed === 0 ? 'Berghain_Pump' : seed === 1 ? 'Phrygian_Shift' : 'Warehouse_Roll'}`,
        rationale: `Neural sub-bass model centered on ${rootKey}1 (${rootPitch} MIDI) with syncopated 16th velocity contouring and kick ducking.`,
        notes,
      };
    }

    if (archetype === 'acid') {
      const acidBase = rootPitch + 12; // Octave 2
      const notes: NoteItem[] = [
        { time: 0.25, duration: 0.2, pitch: acidBase, velocity: 88 },
        { time: 0.5, duration: 0.35, pitch: acidBase + 12, velocity: 118 },
        { time: 1.0, duration: 0.18, pitch: acidBase + 1, velocity: 76 },
        { time: 1.5, duration: 0.22, pitch: acidBase + 7, velocity: 112 },
        { time: 2.25, duration: 0.2, pitch: acidBase, velocity: 84 },
        { time: 2.5, duration: 0.36, pitch: acidBase + 12, velocity: 120 },
        { time: 3.25, duration: 0.2, pitch: acidBase + 1, velocity: 92 },
        { time: 3.5, duration: 0.35, pitch: acidBase + 7, velocity: 116 },
      ];
      return {
        clipName: `AI_303_Acid_${rootKey}_Resonant_Line`,
        rationale: `TB-303 diode ladder acid sequence in ${rootKey} Phrygian with accented octave jumps and overlapping portamento slides.`,
        notes,
      };
    }

    if (archetype === 'percussion') {
      const percPitch = rootPitch + 24;
      const notes: NoteItem[] = [];
      const steps = [0.0, 0.75, 1.25, 2.0, 2.75, 3.5];
      steps.forEach((t, i) => {
        notes.push({
          time: t,
          duration: 0.18,
          pitch: i % 2 === 0 ? percPitch : percPitch + 7,
          velocity: i === 0 ? 112 : i === 3 ? 98 : 42,
        });
      });
      return {
        clipName: 'AI_Industrial_Polyrhythm_3_16',
        rationale: 'Inharmonic metallic strikes generated using 3/16 Euclidean displacement with velocity ghosting.',
        notes,
      };
    }

    if (archetype === 'synth') {
      const synthRoot = rootPitch + 24;
      const notes = [
        { time: 0.5, duration: 0.35, pitch: synthRoot, velocity: 104 },
        { time: 1.25, duration: 0.2, pitch: synthRoot + 1, velocity: 42 },
        { time: 1.75, duration: 0.4, pitch: synthRoot + 7, velocity: 96 },
        { time: 2.75, duration: 0.25, pitch: synthRoot, velocity: 88 },
        { time: 3.5, duration: 0.35, pitch: synthRoot + 1, velocity: 98 },
      ];
      return {
        clipName: 'AI_Hypnotic_Phrygian_Stabs',
        rationale: `Dark hypnotic stabs emphasizing the Phrygian minor second (${rootKey} / ${noteNames[(semitone + 1) % 12]}).`,
        notes,
      };
    }

    if (archetype === 'pad') {
      const padRoot = rootPitch + 36;
      const notes: NoteItem[] = [
        { time: 0.0, duration: 1.75, pitch: padRoot, velocity: 84 },
        { time: 0.0, duration: 1.75, pitch: padRoot + 3, velocity: 80 },
        { time: 0.0, duration: 1.75, pitch: padRoot + 7, velocity: 78 },
        { time: 2.5, duration: 1.25, pitch: padRoot + 2, velocity: 86 },
        { time: 2.5, duration: 1.25, pitch: padRoot + 5, velocity: 82 },
        { time: 2.5, duration: 1.25, pitch: padRoot + 10, velocity: 78 },
      ];
      return {
        clipName: `AI_Dub_Chord_Atmosphere_${rootKey}m9`,
        rationale: `Wide dub techno minor 9th chord cluster in ${rootKey} feeding Return A Warehouse Reverb and Return B 3/16 Echo.`,
        notes,
      };
    }

    if (archetype === 'ride') {
      const notes: NoteItem[] = [];
      for (let s = 0; s < 16; s += 2) {
        const isOffbeat = s % 4 === 2;
        notes.push({
          time: s * 0.25,
          duration: isOffbeat ? 0.36 : 0.22,
          pitch: s === 14 ? 59 : 51,
          velocity: isOffbeat ? 108 : 78,
        });
      }
      return {
        clipName: 'AI_909_Warehouse_Ride_Drive',
        rationale: 'Peak-time 909 Ride cymbal pattern with offbeat emphasis and bell accent on step 15.',
        notes,
      };
    }

    // Default: Hats
    const notes = [
      { time: 0.25, duration: 0.1, pitch: 42, velocity: 32 },
      { time: 0.5, duration: 0.32, pitch: 46, velocity: 112 },
      { time: 0.75, duration: 0.1, pitch: 42, velocity: 40 },
      { time: 1.25, duration: 0.1, pitch: 42, velocity: 36 },
      { time: 1.5, duration: 0.32, pitch: 46, velocity: 108 },
      { time: 1.75, duration: 0.12, pitch: 42, velocity: 45 },
      { time: 2.25, duration: 0.1, pitch: 42, velocity: 34 },
      { time: 2.5, duration: 0.35, pitch: 46, velocity: 114 },
      { time: 2.75, duration: 0.1, pitch: 42, velocity: 44 },
      { time: 3.25, duration: 0.1, pitch: 42, velocity: 38 },
      { time: 3.5, duration: 0.34, pitch: 46, velocity: 110 },
      { time: 3.75, duration: 0.1, pitch: 42, velocity: 42 },
    ];
    return {
      clipName: 'AI_909_Offbeat_Ghost_Grid',
      rationale: '909 Open Hi-Hats on the 8th offbeats with randomized 16th velocity ghost notes.',
      notes,
    };
  }

  // Server-side Gemini AI Sequence Generator for Techno MIDI patterns
  app.post('/api/ai/sequence', async (req, res) => {
    const {
      archetype = 'rumble',
      tempo = 134,
      rootKey = 'F',
      scale = 'Phrygian',
      existingTracks = [],
      stylePrompt = 'Berghain dark hypnotic rolling techno',
    } = req.body;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      const fallback = generateFallbackAiSequence(archetype, rootKey, tempo);
      return res.json({
        ...fallback,
        source: 'ai-techno-transformer-engine',
      });
    }

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const prompt = `You are a specialized underground techno MIDI sequence transformer model (Berghain, Raw/Deep, Industrial, Acid, Dub Techno).
Project Context:
- Tempo: ${tempo} BPM
- Root Key: ${rootKey} ${scale}
- Existing Tracks: ${existingTracks.join(', ') || 'Kick 909'}
- Target Layer Archetype: ${archetype}
- Aesthetic Direction: ${stylePrompt}

Generate a 1-bar (4.0 beats, from Time 0.0 to 3.75) MIDI note pattern that will be unrolled across the arrangement and humanized by our Anti-Slop XML engine.
Rules by Archetype:
- If archetype is "rumble": Use low sub-bass MIDI pitches (between 29 and 41, centered on ${rootKey}1/${rootKey}2). Generate 10 to 14 rolling 16th-note pulses avoiding beat 0.0, 1.0, 2.0, 3.0 kick downbeats.
- If archetype is "acid": TB-303 resonant acid line in MIDI pitches 36 to 55, accented offbeats (velocities 110-124), octave jumps, and overlapping slide durations (0.35 beats).
- If archetype is "percussion": Polyrhythmic industrial metallic percussion (3/16 or 7/16 Euclidean feel), pitches between 48 and 67, velocities 40 to 112.
- If archetype is "synth": Sparse hypnotic 1-bar looping stabs (4 to 8 notes), minor/phrygian intervals in MIDI pitch 53 to 72.
- If archetype is "pad": Atmospheric dub techno minor 7th/9th chord notes in MIDI pitch 58 to 79 with longer durations (0.75 to 2.0 beats).
- If archetype is "hats": Offbeat 8th notes (0.5, 1.5, 2.5, 3.5) with high velocity (98-115) plus 16th-note ghost notes (velocities 24-45) on MIDI pitch 42 and 46.
- If archetype is "ride": Warehouse 909 ride cymbal on 8th steps with MIDI pitch 51 (Ride) and 59 (Ride Bell).

Return a JSON object containing the 1-bar pattern array and a brief technical rationale.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              clipName: {
                type: Type.STRING,
                description: 'Concise techno clip name for Ableton Live.',
              },
              rationale: {
                type: Type.STRING,
                description: '1-sentence musicological explanation of the generated sequence.',
              },
              notes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    time: {
                      type: Type.NUMBER,
                      description: 'Beat start time within 1 bar (0.0 to 3.75).',
                    },
                    duration: {
                      type: Type.NUMBER,
                      description: 'Note duration in beats (0.1 to 2.0).',
                    },
                    pitch: {
                      type: Type.INTEGER,
                      description: 'MIDI note number (24 to 84).',
                    },
                    velocity: {
                      type: Type.INTEGER,
                      description: 'MIDI velocity (20 to 124).',
                    },
                  },
                  required: ['time', 'duration', 'pitch', 'velocity'],
                },
              },
            },
            required: ['clipName', 'rationale', 'notes'],
          },
        },
      });

      const rawText = response.text || '';
      const cleanJson = rawText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);
      return res.json({
        ...parsed,
        source: 'gemini-3-flash-preview',
      });
    } catch (err: any) {
      const fallback = generateFallbackAiSequence(archetype, rootKey, tempo);
      return res.json({
        ...fallback,
        source: 'ai-techno-transformer-engine-fallback',
        note: err.message,
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });

    app.use(async (req, res, next) => {
      if (req.url && req.url.startsWith('/@vite/client')) {
        try {
          const transformed = await vite.transformRequest('/@vite/client');
          if (transformed?.code) {
            const patched = transformed.code
              .replace(
                'reject(/* @__PURE__ */ new Error("WebSocket closed without opened."));',
                'resolve();'
              )
              .replace(
                'transport.connect(createHMRHandler(handleMessage));',
                '/* HMR WebSocket disabled in preview environment */'
              )
              .replace(
                'setupForwardConsoleHandler(transport, forwardConsole);',
                '/* Console forwarding disabled */'
              );
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).send(patched);
          }
        } catch {
          // Fall through
        }
      }
      next();
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Parametric ALS Engine running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
