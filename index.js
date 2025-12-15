let ws;
let isAuthed = false;
let nextFrameId = 1;
let currentServerId = "";
let isAutoCapture = false;

// old image stuff, no longer needed (for old go beyond with camera)
// Image gallery storage
const imageGallery = []; // Stores {url, timestamp, frameId, bytes}
const MAX_GALLERY_SIZE = 10;

// tune for your server limits
const MAX_JSON_LEN = 100_000;
const CHUNK_LEN = 60_000;

// reassembly for chunked echoes
const rxFrames = new Map(); // frameId -> { mime, total, got, parts[] }

const el = (id) => document.getElementById(id);
const logEl = el("log");

function log(kind, msg) {
  const ts = new Date().toLocaleTimeString();
  const cls = kind === "err" ? "err" : kind === "ok" ? "ok" : "info";
  logEl.innerHTML += `<span class="${cls}">[${ts}] ${msg}</span>\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function setStatus(txt) { el("status").textContent = txt; }

function setArduinoStatus(connected) {
  const statusEl = el("arduino-status");
  if (connected) {
    statusEl.textContent = "🟢 Arduino Connected";
    statusEl.className = "status-indicator connected";
  } else {
    statusEl.textContent = "⚪ Arduino Disconnected";
    statusEl.className = "status-indicator disconnected";
  }
}

function connect() {
  const url = el("wsUrl").value.trim();
  currentServerId = el("server-id").value.trim();

  if (!currentServerId) {
    alert("Enter your Client ID first");
    return;
  }

  if (ws && ws.readyState === WebSocket.OPEN) ws.close(1000, "reconnect");

  isAuthed = false;
  setStatus("Connecting...");
  ws = new WebSocket(url);

  ws.onopen = () => {
    setStatus("Connected (authenticating...)");
    // handshake: ID only, first message
    ws.send(currentServerId);
    log("ok", `SENT ID only: ${currentServerId}`);
  };

  ws.onerror = (e) => {
    log("err", `ERROR ${e?.message || e}`);
  };

  ws.onclose = (e) => {
    setStatus("Not Connected");
    isAuthed = false;
    setArduinoStatus(false);
    log("err", `CLOSE code=${e.code} reason=${e.reason}`);
  };

  ws.onmessage = (ev) => onServerMessage(ev.data);
}

function onServerMessage(raw) {
  const text = String(raw ?? "");

  console.log("📨 Raw message received:", text.substring(0, 200));

  // Don't log every single message to reduce clutter
  if (!text.startsWith("IMG_B64_CHUNK")) {
    log("info", `RECV: ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`);
  }

  // auth gate: server says "Invalid Client ID" if bad
  if (/Invalid Client ID/i.test(text)) {
    isAuthed = false;
    return; // server will close us
  }

  // first non-error after ID means we are good
  if (!isAuthed) {
    isAuthed = true;
    setStatus("Connected");
    log("ok", "Handshake accepted. Camera controls ready.");
  }

  // Handle Arduino status messages
  try {
    const msg = JSON.parse(text);
    if (msg.type === "arduino_status") {
      handleArduinoStatus(msg.message);
      return;
    }
  } catch { }

  // server may echo with an ID prefix like: "<ID> <payload>"
  const firstSpace = text.indexOf(" ");
  let payload = text;
  let prefixId = null;
  if (firstSpace > 0) {
    prefixId = text.slice(0, firstSpace);
    payload = text.slice(firstSpace + 1);
    console.log("🔍 Extracted - prefixId:", prefixId, "currentServerId:", currentServerId);
  }

  // chunk protocol lines
  if (payload.startsWith("IMG_B64_BEGIN") || payload.startsWith("IMG_B64_CHUNK") || payload.startsWith("IMG_B64_END")) {
    console.log("📦 Chunked protocol message");
    handleChunkProtocol(payload);
    return;
  }

  // plain JSON image
  try {
    const msg = JSON.parse(payload);
    console.log("📄 Parsed JSON:", msg.type);

    if (msg && msg.type === "image_b64") {
      console.log("🖼️ Image message detected!");
      console.log("   prefixId:", prefixId);
      console.log("   currentServerId:", currentServerId);

      // Filter: allow if no filter set, OR if our ID is anywhere in the prefix
      const shouldDisplay = !currentServerId || !prefixId || prefixId.indexOf(currentServerId) >= 0;
      console.log("   Should display?", shouldDisplay);

      if (!shouldDisplay) {
        console.log("❌ Filtered out - ID not found in prefix");
        return;
      }

      console.log("✅ Displaying image...");
      displayImage(msg.data, msg.mime || "image/jpeg", msg.frameId, msg.bytes);
      return;
    }
  } catch (err) {
    console.log("⚠️ JSON parse failed:", err.message);
    // not JSON, ignore
  }
}

function handleArduinoStatus(statusMsg) {
  // statusMsg format: "STATUS:TYPE:Message"
  const parts = statusMsg.split(":");
  if (parts.length >= 3) {
    const type = parts[1];
    const message = parts.slice(2).join(":");

    if (type === "READY") {
      setArduinoStatus(true);
      log("ok", `Arduino: ${message}`);
    } else if (type === "ERROR") {
      log("err", `Arduino: ${message}`);
    } else if (type === "OK") {
      log("ok", `Arduino: ${message}`);
    }
  }
}

function handleChunkProtocol(line) {
  // "IMG_B64_BEGIN {json}", "IMG_B64_CHUNK {json}", "IMG_B64_END {json}"
  const sp = line.indexOf(" ");
  if (sp < 0) return;
  const cmd = line.slice(0, sp);
  const json = line.slice(sp + 1);

  try {
    const msg = JSON.parse(json);

    if (cmd === "IMG_B64_BEGIN") {
      rxFrames.set(msg.frameId, { mime: msg.mime, total: msg.total, got: 0, parts: new Array(msg.total) });
      log("info", `begin frameId=${msg.frameId} total=${msg.total}`);
      return;
    }
    if (cmd === "IMG_B64_CHUNK") {
      const rec = rxFrames.get(msg.frameId);
      if (!rec) return;
      rec.parts[msg.index] = msg.data;
      rec.got++;
      if (rec.got === rec.total) {
        const b64 = rec.parts.join("");
        displayImage(b64, rec.mime || "image/jpeg", msg.frameId, null);
        rxFrames.delete(msg.frameId);
      }
      return;
    }
    // END is optional
  } catch {
    // ignore bad json
  }
}

function displayImage(base64Data, mimeType, frameId, bytes) {
  console.log("🎨 displayImage called");
  console.log("   base64 length:", base64Data?.length);
  console.log("   mime:", mimeType);
  console.log("   frameId:", frameId);

  const blob = base64ToBlob(base64Data, mimeType);
  console.log("   blob size:", blob.size);

  const url = URL.createObjectURL(blob);
  console.log("   blob URL:", url);

  // Update live view
  const liveImg = el("live-image");
  console.log("   liveImg element:", liveImg);

  liveImg.src = url;
  liveImg.style.display = "block";
  el("no-image-msg").style.display = "none";

  // Update image info
  const sizeKB = bytes ? (bytes / 1024).toFixed(1) : (blob.size / 1024).toFixed(1);
  el("image-info").textContent = `Frame ${frameId} • ${sizeKB} KB`;

  // Add to gallery
  addToGallery(url, frameId, blob.size);

  log("ok", `Displayed image frameId=${frameId} size=${sizeKB}KB`);
  console.log("✅ displayImage complete");
}

function addToGallery(url, frameId, bytes) {
  const timestamp = new Date();
  imageGallery.unshift({ url, frameId, bytes, timestamp });

  // Keep only last 10 images
  while (imageGallery.length > MAX_GALLERY_SIZE) {
    const removed = imageGallery.pop();
    URL.revokeObjectURL(removed.url); // Free memory
  }

  renderGallery();
}

function renderGallery() {
  const galleryEl = el("gallery");

  if (imageGallery.length === 0) {
    galleryEl.innerHTML = '<div class="gallery-empty">Images will appear here after capture</div>';
    return;
  }

  galleryEl.innerHTML = imageGallery.map((img, idx) => `
    <div class="gallery-item" onclick="loadGalleryImage(${idx})">
      <img src="${img.url}" alt="Frame ${img.frameId}">
      <div class="gallery-info">
        <div>Frame ${img.frameId}</div>
        <div>${img.timestamp.toLocaleTimeString()}</div>
      </div>
    </div>
  `).join('');
}

function loadGalleryImage(index) {
  if (index >= 0 && index < imageGallery.length) {
    const img = imageGallery[index];
    el("live-image").src = img.url;
    el("live-image").style.display = "block";
    el("no-image-msg").style.display = "none";
    const sizeKB = (img.bytes / 1024).toFixed(1);
    el("image-info").textContent = `Frame ${img.frameId} • ${sizeKB} KB`;
    log("info", `Loaded gallery image: Frame ${img.frameId}`);
  }
}

function clearGallery() {
  // Free memory for all URLs
  imageGallery.forEach(img => URL.revokeObjectURL(img.url));
  imageGallery.length = 0;
  renderGallery();
  log("info", "Gallery cleared");
}

function downloadImage() {
  const imgSrc = el("live-image").src;
  if (!imgSrc || imgSrc === window.location.href) {
    alert("No image to download");
    return;
  }

  const a = document.createElement('a');
  a.href = imgSrc;
  a.download = `arducam_${new Date().getTime()}.jpg`;
  a.click();
  log("ok", "Image downloaded");
}

// ===== Camera Control Functions =====

function mustBeOpenAndAuthed() {
  if (!ws || ws.readyState !== WebSocket.OPEN) { alert("Connect first"); return false; }
  if (!isAuthed) { alert("Server has not accepted your Client ID yet"); return false; }
  return true;
}

function sendCameraCommand(cmd) {
  if (!mustBeOpenAndAuthed()) return;

  // Send command directly - Arduino is a WebSocket peer client
  // Server broadcasts to all connected clients including Arduino
  ws.send(cmd);
  log("info", `Sent camera command: ${cmd}`);
}

function captureImage() {
  sendCameraCommand("TAKE_IMAGE");
}

function toggleAutoCapture() {
  isAutoCapture = !isAutoCapture;
  const btn = el("auto-capture-btn");

  if (isAutoCapture) {
    sendCameraCommand("AUTO_ON");
    btn.textContent = "⏸️ Stop Auto Capture";
    btn.classList.add("active");
  } else {
    sendCameraCommand("AUTO_OFF");
    btn.textContent = "▶️ Start Auto Capture";
    btn.classList.remove("active");
  }
}

function changeResolution() {
  const resIndex = el("resolution-select").value;
  sendCameraCommand(`SET_RES_${resIndex}`);
}

function sendCustomMessage() {
  if (!mustBeOpenAndAuthed()) return;

  const messageInput = el("ws-message");
  const message = messageInput.value.trim();

  if (!message) {
    alert("Enter a message to send");
    return;
  }

  ws.send(message);
  log("ok", `Sent: ${message}`);
  messageInput.value = ""; // Clear input after sending
}

// ===== Manual Upload Functions (kept for testing) =====

// send tiny 1x1 PNG JSON, prefixed by ID
function sendTinyProbe() {
  if (!mustBeOpenAndAuthed()) return;
  const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAA" +
    "AAC0lEQVR42mP8/x8AAusB9Y7vJqkAAAAASUVORK5CYII=";
  const frameId = Date.now();
  const msg = JSON.stringify({
    type: "image_b64",
    frameId,
    mime: "image/png",
    bytes: 67,
    serverId: currentServerId,
    data: b64
  });
  ws.send(`${currentServerId} ${msg}`);
  log("ok", "SENT tiny probe");
}

// upload button handler
async function sendImage() {
  if (!mustBeOpenAndAuthed()) return;

  const file = el("image-file").files?.[0];
  if (!file) { alert("Choose an image"); return; }

  // optional: downscale here if needed to reduce size
  const buf = await file.arrayBuffer();
  const b64 = arrayBufferToBase64(buf);
  const frameId = nextFrameId++;

  const jsonText = JSON.stringify({
    type: "image_b64",
    frameId,
    mime: file.type || "image/jpeg",
    bytes: buf.byteLength,
    serverId: currentServerId,
    data: b64
  });

  // try single JSON first
  if (jsonText.length <= MAX_JSON_LEN) {
    ws.send(`${currentServerId} ${jsonText}`);
    log("ok", `SENT image_b64 frameId=${frameId} bytes=${buf.byteLength} len=${jsonText.length}`);
    return;
  }

  // else chunk it
  const total = Math.ceil(b64.length / CHUNK_LEN);
  const begin = JSON.stringify({ frameId, mime: file.type || "image/jpeg", bytes: buf.byteLength, total });
  ws.send(`${currentServerId} IMG_B64_BEGIN ${begin}`);
  log("info", `SENT begin frameId=${frameId} total=${total}`);

  for (let i = 0; i < total; i++) {
    const slice = b64.slice(i * CHUNK_LEN, (i + 1) * CHUNK_LEN);
    const part = JSON.stringify({ frameId, index: i, data: slice });
    ws.send(`${currentServerId} IMG_B64_CHUNK ${part}`);
  }
  ws.send(`${currentServerId} IMG_B64_END ${JSON.stringify({ frameId })}`);
  log("ok", `SENT end frameId=${frameId}`);
}

// helpers
function arrayBufferToBase64(ab) {
  const bytes = new Uint8Array(ab);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
function base64ToBlob(b64, mime) {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// wire up
document.addEventListener("DOMContentLoaded", () => {
  el("btnConnect")?.addEventListener("click", connect);
  el("capture-btn")?.addEventListener("click", captureImage);
  el("auto-capture-btn")?.addEventListener("click", toggleAutoCapture);
  el("resolution-select")?.addEventListener("change", changeResolution);
  el("download-btn")?.addEventListener("click", downloadImage);
  el("clear-gallery-btn")?.addEventListener("click", clearGallery);
  el("send-image-btn")?.addEventListener("click", sendImage);
  el("send-probe-btn")?.addEventListener("click", sendTinyProbe);
  el("send-msg-btn")?.addEventListener("click", sendCustomMessage);

  // Allow sending message with Enter key
  el("ws-message")?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendCustomMessage();
  });
});

// Make loadGalleryImage available globally for onclick
window.loadGalleryImage = loadGalleryImage;
