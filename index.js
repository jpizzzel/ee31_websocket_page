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
    // If no server ID is provided, show all messages
    if (currentServerId && !msg.includes(currentServerId)) return;

    // Enqueue the filtered message (most recent at top, max 5)
    messageQueue.pop();
    messageQueue.unshift(`[RECEIVED] ${msg}`);
    renderMessages(messageQueue);
  });
}

function connectionOpen() {
  const statusElement = document.getElementById("connection-status");
  statusElement.innerText = "Connected";
  statusElement.className = "status-indicator connected";
  // Send the server ID once connected (if required by your backend)
  const id = currentServerId || document.getElementById("server-id").value.trim();
  if (id) {
    websocketConnection.send(id);
  }
}

function connectionClosed() {
  websocketConnection = undefined;
  const statusElement = document.getElementById("connection-status");
  statusElement.innerText = "Not Connected";
  statusElement.className = "status-indicator";
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
  
  // Send the message
  websocketConnection.send(text);
  
  // Display the sent message in the message queue
  messageQueue.pop();
  messageQueue.unshift(`[SENT] ${text}`);
  renderMessages(messageQueue);
  
  // Clear the input
  input.value = "";
}

document.addEventListener("DOMContentLoaded", function () {
  document.getElementById("connect-form").addEventListener("submit", connectToServer);
  document.getElementById("send-message-form").addEventListener("submit", sendMessage);
});
