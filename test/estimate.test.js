import test from 'node:test';
import assert from 'node:assert/strict';
import { completedNotes, estimate, exampleNotes } from '../estimate.js';

const settings = { unitPrice: 25, wastePercent: 10 };
const price = (notes, patch = {}) => estimate(notes, { ...settings, ...patch });

test('incomplete survey keeps the original measurement, asks for width, withholds price', () => {
  const result = price(exampleNotes);
  assert.equal(result.lengthM, 4.8);
  assert.equal(result.widthM, null);
  assert.equal(result.subtotal, null);
  assert.equal(result.ready, false);
  assert.match(result.issues.join(' '), /room width/i);
  assert.ok(result.evidence.every(item => exampleNotes.includes(item)));
  assert.equal(price(exampleNotes + '\nWidth: 3.6 m.').ready, true);
});

test('complete survey rounds order area upward before applying the user rate', () => {
  const result = price(completedNotes);
  assert.equal(result.ready, true);
  assert.deepEqual(result.issues, []);
  assert.equal(result.areaM2, 17.28);
  assert.equal(result.orderM2, 19.01);
  assert.equal(result.subtotal, 475.25);
  assert.equal(price('2.5 x 2 m', { wastePercent: 0 }).orderM2, 5);
});

test('explicit pairs support spacing, mixed units and shared trailing units', () => {
  for (const note of ['Room: 4.8 × 3.6 m', 'floor: 4.8m x 360 cm', '4800x3600 mm',
    'room length 4.8 x 3.6 metres', 'Room width: 3600 mm × 480 cm.', 'Room: 4.8 by 3.6 metres']) {
    const result = price(note);
    assert.equal(result.lengthM, 4.8, note);
    assert.equal(result.widthM, 3.6, note);
    assert.equal(result.ready, true, note);
  }
});

test('repeated equivalent evidence is accepted; conflicting measurements block the quote', () => {
  assert.equal(price('Room 4.8 x 3.6 m; length: 480 cm.').ready, true);
  const conflict = price('Room 4.8 x 3.6 m; length: 49 cm.');
  assert.equal(conflict.lengthM, null);
  assert.match(conflict.issues.join(' '), /conflicting room length/i);
  assert.equal(conflict.subtotal, null);
});

test('units, sign, ambiguous quantities and three axes cannot silently produce a quote', () => {
  for (const note of ['4.8x3.6', 'Length 4.8; width 3.6 m', '0 x 3 m',
    '-2 x 3 m', '2m x 3', '2 x 3 ft', 'Room length: 4 m to 5 m; width: 2 m',
    'room length: 4 m 80 cm; width: 3m', '4 x 3 x 2.8 m']) {
    assert.equal(price(note).ready, false, note);
  }
});

test('door, wall and window sizes never complete the floor geometry', () => {
  for (const note of ['Window: 120cm x 90cm. Room length: 4.8m.',
    'Room length: 4.8m. Door dimensions:\nWidth: 90cm. Height: 2m.',
    'Room length: 4.8m; 90 x 210 cm door.', 'Wall: 4.8 x 2.8 m']) {
    assert.equal(price(note).subtotal, null, note);
  }
  assert.equal(price('Room: 4.8 x 3.6 m, window: 120 x 90 cm.').subtotal, 475.25);
});

test('missing settings remain unknown and zero is a valid explicit input', () => {
  for (const value of ['', null, -1, Infinity, true, 'one']) {
    assert.equal(price(completedNotes, { unitPrice: value }).subtotal, null);
    assert.equal(price(completedNotes, { wastePercent: value }).orderM2, null);
  }
  assert.equal(price(completedNotes, { unitPrice: '0', wastePercent: '0' }).subtotal, 0);
});

test('tentative or explicitly negated measurements must be confirmed before pricing', () => {
  for (const statement of ['Room width: about 3.6 m, not yet confirmed.',
    'Room width: 3.6 m?', 'Estimated room width: 3.6 m.',
    'Width 3.6 m, wrong value.', 'Width is not 3.6 m.', 'Room: roughly 4.8 x 3.6 m.']) {
    const result = price('Length: 4.8 m. ' + statement);
    assert.equal(result.widthM, null, statement);
    assert.equal(result.ready, false, statement);
    assert.equal(result.subtotal, null, statement);
  }
  assert.equal(price('Length: 4.8 m. Width: 3 m. Width needs remeasurement?').ready, false);
  assert.equal(price('Length: 4.8 m. Width: 3.6 m? Width confirmed in field. Width: 3.6 m.').subtotal, 475.25);
});
