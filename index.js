// index.js

let websocketConnection;
let messageQueue = ["", "", "", "", ""];
let currentServerId = "";

function connectToServer(e) {
  e.preventDefault();

  // Save the server ID (used for filtering) and clear prior messages
  currentServerId = document.getElementById("server-id").value.trim();
  messageQueue = ["", "", "", "", ""];
  renderMessages(messageQueue);

  // (Re)connect
  if (websocketConnection && websocketConnection.readyState === WebSocket.OPEN) {
    websocketConnection.close();
  }

  websocketConnection = new WebSocket("ws://34.28.153.91");

  websocketConnection.addEventListener("open", connectionOpen);
  websocketConnection.addEventListener("close", connectionClosed);

  websocketConnection.addEventListener("message", (event) => {
    const msg = String(event.data ?? "");
    // FILTER: only keep messages that include the current server ID
    if (!currentServerId || !msg.includes(currentServerId)) return;

    // Enqueue the filtered message (most recent at top, max 5)
    messageQueue.pop();
    messageQueue.unshift(msg);
    renderMessages(messageQueue);
  });
}

function connectionOpen() {
  document.getElementById("connection-status").innerText = "Connected";
  // Send the server ID once connected (if required by your backend)
  const id = currentServerId || document.getElementById("server-id").value.trim();
  if (id) {
    websocketConnection.send(id);
  }
}

function connectionClosed() {
  websocketConnection = undefined;
  document.getElementById("connection-status").innerText = "Not Connected";
}

function renderMessages(messages) {
  messages.forEach((message, index) => {
    const el = document.getElementById("msg-" + (index + 1));
    if (el) el.innerText = message;
  });
}

function sendMessage(e) {
  e.preventDefault();
  if (!websocketConnection || websocketConnection.readyState !== WebSocket.OPEN) {
    alert("Cannot send message, WebSocket connection is not active.");
    return;
  }
  const input = document.getElementById("send-message-input");
  const text = input.value;
  if (text.trim() === "") return;
  websocketConnection.send(text);
  input.value = "";
}

document.addEventListener("DOMContentLoaded", function () {
  document.getElementById("connect-form").addEventListener("submit", connectToServer);
  document.getElementById("send-message-form").addEventListener("submit", sendMessage);
});
