import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { generateBrief, inspectAI, prepareDevice } from '../firebase-adapter.js';
import { exampleNotes, completedNotes } from '../estimate.js';

let bundle;
before(async () => {
  // Exercise the browser Firebase AI SDK. Replace external attestation and inference
  // endpoints with fixtures so these regression tests need no project or credentials.
  const root = fileURLToPath(new URL('../', import.meta.url));
  const output = await build({
    root, configFile: false, envDir: false, logLevel: 'silent',
    define: {
      'import.meta.env.VITE_FIREBASE_API_KEY': '"fixture"',
      'import.meta.env.VITE_FIREBASE_PROJECT_ID': '"demo-measurebrief"',
      'import.meta.env.VITE_FIREBASE_APP_ID': '"fixture-web"',
      'import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY': '"fixture-site"'
    },
    plugins: [{
      name: 'offline-app-check-fixture', enforce: 'pre',
      resolveId(id) { return id === 'firebase/app-check' ? '\0fixture-check' : undefined; },
      load(id) {
        return id === '\0fixture-check'
          ? 'export class ReCaptchaEnterpriseProvider {} export function initializeAppCheck() {}'
          : undefined;
      }
    }],
    build: {
      write: false, minify: false,
      lib: { entry: root + 'firebase-adapter.js', name: 'Adapter', formats: ['iife'] }
    }
  });
  bundle = output[0].output.find(chunk => chunk.type === 'chunk').code;
});

function browserFixture(availability, online, reply = { measurements: [1], decisions: [], questions: [] }) {
  const requests = [];
  const cloudPrompts = [];
  const context = {
    window: {}, navigator: { onLine: online }, Headers, Response, structuredClone,
    AbortController, AbortSignal, setTimeout: (...args) => setTimeout(...args).unref(), clearTimeout, URL, URLSearchParams, TextEncoder, TextDecoder,
    fetch: async (url, options) => {
      requests.push(String(url));
      assert.match(String(url), /firebasevertexai\.googleapis\.com.*:generateContent/);
      const body = JSON.parse(options.body);
      cloudPrompts.push(body.contents[0].parts[0].text);
      assert.equal(body.generationConfig.responseJsonSchema.properties.measurements.items.type, 'integer');
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] });
    }
  };
  if (availability) {
    context.window.LanguageModel = {
      availability: async () => availability,
      create: async () => ({
        prompt: async (_, options) => {
          assert.equal(options.responseConstraint.properties.measurements.items.type, 'integer');
          return JSON.stringify(reply);
        }, destroy() {}
      })
    };
  }
  runInNewContext(bundle, context);
  return { adapter: context.Adapter, requests, cloudPrompts };
}
const notes = 'Room 4 m wide.';

test('missing web configuration never produces an AI handoff', async () => {
  assert.deepEqual(await inspectAI(), { device: 'unavailable', firebaseConfigured: false, cloudConfigured: false });
  for (const mode of ['device', 'hybrid', 'cloud']) {
    await assert.rejects(generateBrief(notes, mode), /Connect a Firebase web app/);
  }
});

test('device preparation reports native progress and disposes its session without generating a brief', async t => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
  });
  const progress = [];
  let destroyed = false;
  let created = false;
  globalThis.window = { LanguageModel: {
    availability: async () => destroyed ? 'available' : 'downloadable',
    create: async options => {
      created = true;
      assert.deepEqual(Object.keys(options).sort(), ['expectedInputs', 'expectedOutputs', 'monitor']);
      options.monitor({ addEventListener(type, listener) {
        assert.equal(type, 'downloadprogress');
        listener({ loaded: 0.5 });
        listener({ loaded: 1 });
      } });
      return { destroy() { destroyed = true; } };
    }
  } };
  const pending = prepareDevice(fraction => progress.push(fraction));
  assert.equal(created, true, 'native create is invoked before the click activation expires');
  await pending;
  assert.deepEqual(progress, [0.5, 1]);
  assert.equal(destroyed, true);
  assert.equal((await inspectAI()).device, 'available');
  await assert.rejects(generateBrief(notes, 'device'), /Connect a Firebase web app/);
});

test('a missing device API fails closed in private mode', async () => {
  const { adapter, requests } = browserFixture(null, true);
  await assert.rejects(adapter.generateBrief(notes, 'device'), /notes stayed on this device/);
  assert.equal(requests.length, 0);
});

test('the SDK selects the device while offline when a model is ready', async () => {
  const { adapter, requests } = browserFixture('available', false);
  assert.match(await adapter.generateBrief(notes, 'device'), /Measurements · Room 4 m wide\./);
  const hybrid = await adapter.generateBrief(notes, 'hybrid');
  assert.equal(hybrid.source, 'device');
  assert.match(hybrid.text, /AI-selected excerpts/);
  assert.equal(requests.length, 0);
});

test('with online fallback allowed the SDK returns the cloud inference source', async () => {
  const { adapter, requests } = browserFixture('unavailable', true);
  const result = await adapter.generateBrief(notes, 'hybrid');
  assert.equal(result.source, 'cloud');
  assert.match(result.text, /Measurements · Room 4 m wide\./);
  assert.equal(requests.length, 1);
});

test('handoff preserves selected source quotes and separates unresolved worksheet checks', async () => {
  const { adapter, cloudPrompts } = browserFixture('unavailable', true, { measurements: [2, 4], decisions: [5], questions: [5] });
  const missing = await adapter.generateBrief(exampleNotes, 'hybrid');
  const complete = await adapter.generateBrief(completedNotes, 'hybrid');
  assert.match(missing.text, /Decisions · Keep the existing threshold\./);
  assert.doesNotMatch(missing.text, /Questions in the notes/);
  assert.match(missing.text, /Worksheet dimension checks\nMeasure and record the room width\./);
  assert.match(complete.text, /Worksheet dimension checks\nBoth room dimensions are recorded\./);
  for (const { text } of JSON.parse(cloudPrompts[0].split('\n').at(-1))) assert.ok(exampleNotes.includes(text));
});

test('invented contents or unknown excerpt IDs are withheld from the display and export', async () => {
  for (const reply of [
    { measurements: [2, 55], decisions: [], questions: [] },
    { measurements: [2], decisions: ['Visit complete on 2024-02-29'], questions: [] },
    { measurements: [2], decisions: [], questions: [], date: '2024-02-29' }
  ]) {
    const { adapter } = browserFixture('available', false, reply);
    await assert.rejects(adapter.generateBrief(exampleNotes, 'device'), /verifiable note selections/);
  }
});

test('hybrid without internet or a ready model does not try cloud', async () => {
  const { adapter, requests } = browserFixture('downloadable', false);
  await assert.rejects(adapter.generateBrief(notes, 'hybrid'), /internet connection/);
  assert.equal(requests.length, 0);
});
