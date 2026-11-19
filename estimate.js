export const exampleNotes = `Studio A · flooring survey
Room length: 4.8 m.
Room width: still to measure.
Door opening: 90 cm wide. Keep the existing threshold.`;

export const completedNotes = exampleNotes.replace('still to measure', '3.6 m');

const numberPattern = String.raw`[+-]?(?:\d+(?:\.\d+)?|\.\d+)`;
const unitPattern = String.raw`(?:millimet(?:er|re)s?|centimet(?:er|re)s?|met(?:er|re)s?|mm|cm|m)\b`;
const measurement = String.raw`(${numberPattern})\s*(${unitPattern})?`;
const labels = new RegExp(String.raw`\b(length|width)\s*(?:(?:is|of|measures?)\s+|[:=]\s*)?${measurement}`, 'gi');
const separator = String.raw`(?:[x×]|by\b)`;
const pair = new RegExp(String.raw`(?<![\w.,+-])${measurement}\s*${separator}\s*${measurement}`, 'gi');
const threeDimensions = new RegExp(String.raw`${measurement}\s*${separator}\s*${measurement}\s*${separator}\s*${numberPattern}`, 'i');
const measurementBeforeNoun = new RegExp(String.raw`${numberPattern}\s*(?:${unitPattern})?\s*(?:wide|high|long)?\s*$`, 'i');
const additionalNumber = new RegExp(String.raw`^\s*(?:(?:to\b|or\b|[+–—/-])\s*${numberPattern}|\d+\s*${unitPattern})`, 'i');

const objectWord = /\b(doors?|doorways?|windows?|ceilings?|walls?|cabinets?|tables?|desks?|openings?|rugs?|tiles?|planks?|rooms?|floors?|flooring)\b/gi;
const floorObject = /^(?:room|floor|flooring)s?$/i;
const tentative = /[?~≈±]|\b(?:about|approx(?:imately)?|around|rough(?:ly)?|estimated?|guess(?:ed)?|possibly|maybe|might|assum(?:e|ed)|unconfirmed|unverified|uncertain|tbc|tbd|incorrect|wrong|re-?measure|at (?:least|most)|not (?:yet )?(?:confirmed|measured|verified|sure|to be used)|do not use)\b|\bnot\s+[\d.]/i;

function meters(value, unit) {
  const size = Number(value);
  if (!unit || !Number.isFinite(size) || size <= 0) return null;
  if (/^(mm|milli)/i.test(unit)) return size / 1000;
  if (/^(cm|centi)/i.test(unit)) return size / 100;
  return size;
}

// Parse a single rectangular room. Each labeled value needs its own metric unit.
// In a pair, a trailing unit can apply to both values (e.g. "4.8 x 3.6 m").
// Explicit mixed units are accepted. Door/window and other object dimensions
// are ignored. A new room/floor label switches the parsing context back.
// Approximate, questioned and negated statements are held for confirmation.
// Add a separate, positive labeled measurement after checking it on site.
export function readDimensions(notes) {
  const seen = { length: new Set(), width: new Set() };
  const issues = new Set();
  const evidence = new Set();
  const awaitingConfirmation = new Set();
  let roomContext = true;
  let sectionIsRoom = true;
  let tentativeClause = false;

  function record(axis, value, unit, source, tail) {
    const size = meters(value, unit);
    if (size === null || additionalNumber.test(tail) || /^\s*,\d/.test(tail)) {
      issues.add(`Enter one positive room ${axis} with a metric unit (m, cm or mm).`);
      return;
    }
    awaitingConfirmation.delete(axis);
    seen[axis].add(Number(size.toPrecision(15)));
    evidence.add(source.trim());
  }

  function parsePart(part) {
    if (!roomContext || !part.trim()) return;
    if (tentativeClause) {
      const hasPair = !part.matchAll(pair).next().done;
      if (hasPair || /\blength\b/i.test(part)) awaitingConfirmation.add('length');
      if (hasPair || /\bwidth\b/i.test(part)) awaitingConfirmation.add('width');
      return;
    }
    if (threeDimensions.test(part)) {
      issues.add('Specify room length and width separately for this three-dimensional measurement.');
      return;
    }
    for (const match of part.matchAll(labels)) {
      const tail = part.slice(match.index + match[0].length);
      if (/^\s*(?:[x×]|by\b)\s*[+-]?[\d.]/i.test(tail)) continue;
      record(match[1].toLowerCase(), match[2], match[3], match[0], tail);
    }
    for (const match of part.matchAll(pair)) {
      const [, a, unitA, b, unitB] = match;
      // A label immediately before the first value can reverse the axis order.
      const reversed = /\bwidth\s*(?:(?:is|of|measures?)\s+|[:=]\s*)?$/i.test(part.slice(0, match.index));
      const tail = part.slice(match.index + match[0].length);
      record(reversed ? 'width' : 'length', a, unitA || unitB, match[0], tail);
      record(reversed ? 'length' : 'width', b, unitB, match[0], tail);
    }
  }

  for (const clause of String(notes ?? '').split(/[;!\n]+|(?<=\?)|\.(?!\d)/)) {
    roomContext = sectionIsRoom;
    tentativeClause = tentative.test(clause);
    let start = 0;
    for (const word of clause.matchAll(objectWord)) {
      const previous = clause.slice(start, word.index);
      if (floorObject.test(word[0]) || !measurementBeforeNoun.test(previous)) parsePart(previous);
      roomContext = floorObject.test(word[0]);
      start = word.index + word[0].length;
      if (/^\s*(?:dimensions?|measurements?)?\s*:\s*$/i.test(clause.slice(start))) sectionIsRoom = roomContext;
    }
    parsePart(clause.slice(start));
  }

  function resolve(axis) {
    if (awaitingConfirmation.has(axis)) {
      issues.add(`Confirm the room ${axis}. The latest note marks it as uncertain.`);
      return null;
    }
    if (seen[axis].size === 1) return [...seen[axis]][0];
    issues.add(seen[axis].size
      ? `Conflicting room ${axis} measurements. Confirm one value.`
      : `Measure and record the room ${axis}.`);
    return null;
  }
  return { lengthM: resolve('length'), widthM: resolve('width'), issues: [...issues], evidence: [...evidence] };
}

function numericSetting(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()))) return null;
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

// Waste is added to the measured area. The order is rounded UP to the next
// 0.01 m² before applying the user's rate; the subtotal is rounded to cents.
export function estimate(notes, { unitPrice, wastePercent } = {}) {
  const result = { ...readDimensions(notes), areaM2: null, orderM2: null, subtotal: null, ready: false };
  const validGeometry = !result.issues.length;
  const rate = numericSetting(unitPrice);
  const waste = numericSetting(wastePercent);
  if (rate === null) result.issues.push('Enter a non-negative material price per m².');
  if (waste === null) result.issues.push('Enter a non-negative waste allowance as a percentage.');
  if (!validGeometry) return result;

  const area = Number((result.lengthM * result.widthM).toPrecision(14));
  if (area <= 0 || !Number.isSafeInteger(Math.ceil(area * 100))) {
    result.issues.push('The floor area is outside the supported calculation range.');
    return result;
  }
  result.areaM2 = area;
  if (waste === null) return result;
  const orderHundredths = Math.ceil(Number((area * (1 + waste / 100) * 100).toPrecision(14)));
  if (!Number.isSafeInteger(orderHundredths)) {
    result.issues.push('The order area is outside the supported calculation range.');
    return result;
  }
  result.orderM2 = orderHundredths / 100;
  if (rate === null) return result;
  const cents = Math.round(Number((orderHundredths * rate).toPrecision(14)));
  if (!Number.isSafeInteger(cents)) {
    result.issues.push('The subtotal is outside the supported calculation range.');
    return result;
  }
  result.subtotal = cents / 100;
  result.ready = true;
  return result;
}
