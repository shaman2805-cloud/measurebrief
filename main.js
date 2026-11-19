import { exampleNotes, completedNotes, estimate } from "./estimate.js";
import { inspectAI, generateBrief, prepareDevice } from "./firebase-adapter.js";

const byId = (id) => document.getElementById(id);
const notes = byId("notes");
const price = byId("unit-price");
const waste = byId("waste");
const key = "measurebrief.worksheet.v1";
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
const formatArea = (value) =>
  Number.isFinite(value) ? number.format(value) + " m²" : "—";
const units = (value, suffix) =>
  Number.isFinite(value) ? number.format(value) + suffix : "Missing";
let previous = null;
let analysis;
let briefing = "";
let modelState;
let running = false;
let preparationStatus = "";
let requestId = 0;
let shellReady = false;
let storageAvailable = true;

try {
  previous = JSON.parse(localStorage.getItem(key));
} catch {
  storageAvailable = false;
}
notes.value =
  typeof previous?.notes === "string" ? previous.notes : exampleNotes;
price.value =
  typeof previous?.unitPrice === "string" ? previous.unitPrice : "25";
waste.value =
  typeof previous?.wastePercent === "string" ? previous.wastePercent : "10";
byId("saved").textContent = previous
  ? "Restored on this device"
  : "Sample note loaded";

function replaceList(id, rows) {
  byId(id).replaceChildren(
    ...rows.map((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      return item;
    }),
  );
}

function refreshPlan() {
  const { lengthM, widthM, areaM2 } = analysis;
  const plan = byId("plan-shape");
  plan.classList.toggle("unknown-length", !Number.isFinite(lengthM));
  plan.classList.toggle("unknown-width", !Number.isFinite(widthM));
  let planWidth = 148;
  let planHeight = 80;
  if (lengthM > 0 && widthM > 0) {
    const ratio = Math.max(0.35, Math.min(5, lengthM / widthM));
    planWidth = Math.min(175, 90 * ratio);
    planHeight = planWidth / ratio;
  }
  plan.style.setProperty("--room-width", planWidth + "px");
  plan.style.setProperty("--room-height", planHeight + "px");
  byId("plan-length").textContent = units(lengthM, " m");
  byId("plan-width").textContent = units(widthM, " m");
  byId("plan-area").textContent = Number.isFinite(areaM2)
    ? formatArea(areaM2)
    : "";
}

function refreshWorksheet() {
  analysis = estimate(notes.value, {
    unitPrice: price.valueAsNumber,
    wastePercent: waste.valueAsNumber,
  });
  byId("summary").classList.toggle("is-ready", analysis.ready);
  byId("status").textContent = analysis.ready
    ? "Ready to estimate"
    : "Needs a site check";
  byId("area").textContent = formatArea(analysis.areaM2);
  byId("order").textContent = formatArea(analysis.orderM2);
  byId("subtotal").textContent = Number.isFinite(analysis.subtotal)
    ? dollars.format(analysis.subtotal)
    : "—";
  replaceList("issues", analysis.issues);
  replaceList(
    "evidence-list",
    analysis.evidence.length
      ? analysis.evidence
      : ["No room measurements confirmed yet."],
  );
  byId("incomplete").setAttribute(
    "aria-pressed",
    String(notes.value === exampleNotes),
  );
  byId("complete").setAttribute(
    "aria-pressed",
    String(notes.value === completedNotes),
  );
  refreshPlan();
}

function updateLocal() {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        notes: notes.value,
        unitPrice: price.value,
        wastePercent: waste.value,
      }),
    );
    byId("saved").textContent = "Saved on this device";
    storageAvailable = true;
  } catch {
    storageAvailable = false;
    byId("saved").textContent = "Local storage unavailable";
  }
  refreshWorksheet();
}

function notesChanged() {
  requestId++;
  running = false;
  briefing = "";
  byId("ai-result").hidden = true;
  updateLocal();
  updateAIControls();
}

notes.addEventListener("input", notesChanged);
price.addEventListener("input", updateLocal);
waste.addEventListener("input", updateLocal);
for (const [buttonId, sample] of [
  ["complete", completedNotes],
  ["incomplete", exampleNotes],
]) {
  byId(buttonId).addEventListener("click", () => {
    if (
      notes.value !== exampleNotes &&
      notes.value !== completedNotes &&
      notes.value.trim() &&
      !window.confirm("Replace your current field notes with this sample?")
    )
      return;
    notes.value = sample;
    notesChanged();
  });
}

byId("export").addEventListener("click", () => {
  const body = [
    "Measurebrief | Flooring worksheet",
    "",
    "Field notes",
    notes.value.trim() || "No notes recorded.",
    "",
    "Room length: " + units(analysis.lengthM, " m"),
    "Room width: " + units(analysis.widthM, " m"),
    "Floor area: " + formatArea(analysis.areaM2),
    "Waste allowance: " + units(waste.valueAsNumber, "%"),
    "Order quantity: " + formatArea(analysis.orderM2),
    "Unit price: " +
      (Number.isFinite(price.valueAsNumber)
        ? dollars.format(price.valueAsNumber) + "/m²"
        : "Missing"),
    "Material subtotal: " + byId("subtotal").textContent,
    "Material only. Labour, delivery and tax are excluded.",
    "",
    analysis.ready
      ? "Site check: Complete."
      : "Site check: " + analysis.issues.join(" "),
    ...analysis.evidence.map((line) => "Evidence: " + line),
  ];
  if (briefing) body.push("", "AI field brief", briefing);
  const url = URL.createObjectURL(
    new Blob([body.join("\n") + "\n"], { type: "text/plain;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "measurebrief-flooring-worksheet.txt";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

function updateNetwork() {
  byId("connection").textContent = !navigator.onLine
    ? "Offline"
    : shellReady
      ? "Ready for offline use"
      : "Local worksheet";
  updateAIControls();
}

function updateAIControls() {
  const device = byId("device");
  const hybrid = byId("hybrid");
  const modelLabel = byId("model-status");
  const hasNotes = Boolean(notes.value.trim());
  const needsDownload = ["downloadable", "downloading"].includes(modelState?.device);
  const busy = running || Boolean(preparationStatus);
  const canUseDevice = needsDownload && navigator.onLine ||
    modelState?.device === "available" && modelState.firebaseConfigured;
  device.disabled = busy || !canUseDevice || (modelState?.firebaseConfigured && !hasNotes);
  hybrid.disabled =
    busy || !hasNotes || !modelState?.cloudConfigured || !navigator.onLine;
  device.textContent = "Use device only";
  if (needsDownload) {
    device.textContent = modelState.firebaseConfigured ? "Download model & generate" : "Prepare device model";
  }
  if (!modelState) return;
  if (preparationStatus) {
    modelLabel.textContent = preparationStatus;
  } else if (running) {
    modelLabel.textContent = "Generating the field brief…";
  } else {
    const deviceLabel =
      {
        available: "On-device model ready",
        downloadable: "On-device model needs downloading",
        downloading: "On-device model is downloading",
        unavailable: "On-device model unavailable",
      }[modelState.device] ?? "On-device status unknown";
    modelLabel.textContent =
      deviceLabel +
      " · " +
      (!modelState.firebaseConfigured
        ? "Connect Firebase to generate a brief"
        : !navigator.onLine
        ? "Cloud offline"
        : modelState.cloudConfigured
          ? "Cloud configured"
          : "Cloud setup required");
  }
}

async function checkAI() {
  try {
    modelState = await inspectAI();
  } catch {
    modelState = {
      device: "unavailable",
      firebaseConfigured: false,
      cloudConfigured: false,
    };
  }
  updateAIControls();
}

async function prepareDeviceModel() {
  if (preparationStatus) return;
  preparationStatus = "Preparing the Chrome model…";
  const result = byId("ai-result");
  result.hidden = true;
  updateAIControls();
  try {
    await prepareDevice((fraction) => {
      preparationStatus = "Preparing the Chrome model · " + Math.round(fraction * 100) + "%";
      updateAIControls();
    });
  } catch (error) {
    result.textContent = "Chrome could not prepare the model. " +
      (error instanceof Error ? error.message : "Please try again.");
    result.hidden = false;
  } finally {
    await checkAI();
    preparationStatus = "";
    updateAIControls();
  }
}

async function runBrief(mode) {
  if (running || !notes.value.trim()) return;
  const id = ++requestId;
  running = true;
  briefing = "";
  const result = byId("ai-result");
  result.hidden = true;
  updateAIControls();
  try {
    const response = await generateBrief(notes.value.trim(), mode);
    const text = mode === "hybrid" ? response.text : response;
    const source = mode === "hybrid" ? response.source : "device";
    if (id !== requestId) return;
    if (!text?.trim()) throw new Error("The model returned an empty brief.");
    const sourceLabel =
      { device: "On-device brief", cloud: "Cloud brief" }[source] ||
      "Field brief · source unavailable";
    briefing = sourceLabel + "\n" + text.trim();
    result.textContent = briefing;
  } catch (err) {
    if (id !== requestId) return;
    result.textContent =
      "Brief unavailable. " +
      (err instanceof Error ? err.message : "Please try again.");
  } finally {
    if (id === requestId) {
      result.hidden = false;
      running = false;
      updateAIControls();
      void checkAI();
    }
  }
}
byId("device").addEventListener("click", () => {
  if (modelState?.firebaseConfigured) void runBrief("device");
  else void prepareDeviceModel();
});
byId("hybrid").addEventListener("click", () => void runBrief("hybrid"));
window.addEventListener("online", updateNetwork);
window.addEventListener("offline", updateNetwork);
window.addEventListener("focus", checkAI);
refreshWorksheet();
if (!storageAvailable) byId("saved").textContent = "Local storage unavailable";
updateNetwork();
void checkAI();
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker
    .register(new URL("sw.js", document.baseURI))
    .then(() => navigator.serviceWorker.ready)
    .then(() => {
      shellReady = true;
      updateNetwork();
    })
    .catch(() => {
      /* The open worksheet still works while the page stays open. */
    });
}
