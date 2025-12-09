/*
 * ArduCAM WiFi WebSocket Client
 * For Arduino WiFi Rev 2 with ArduCAM Mini OV2640
 *
 * Connects to WiFi and WebSocket server to receive TAKE_IMAGE commands
 * and send captured images wirelessly.
 *
 * Libraries needed:
 * - ArduCAM
 * - WiFiNINA
 * - ArduinoHttpClient (for WebSocket)
 *
 * Install via: Tools -> Manage Libraries
 */

#include "memorysaver.h"
#include <ArduCAM.h>
#include <ArduinoHttpClient.h>
#include <SPI.h>
#include <WiFiNINA.h>
#include <Wire.h>

// ===== CONFIGURABLE SETTINGS =====
// WiFi credentials
const char *SSID = "tufts_eecs";
const char *PASS = "foundedin1883";
const char *WIFI_SSID = "tufts_eecs";
const char *WIFI_PASSWORD = "foundedin1883";
const char *WS_SERVER = "10.5.15.112";
const int WS_PORT = 8080;               // WebSocket port
const char *CLIENT_ID = "F392FC86D8D7"; // Keep this or change if needed
const char *WS_PATH = "/";

// Camera settings
const int CS_PIN = 7; // ArduCAM chip select pin
// =================================

// Camera and WiFi objects
ArduCAM myCAM(OV2640, CS_PIN);
WiFiClient wifiClient;
WebSocketClient wsClient = WebSocketClient(wifiClient, WS_SERVER, WS_PORT);

// State variables
bool wifiConnected = false;
bool wsConnected = false;
unsigned long lastReconnectAttempt = 0;
const unsigned long RECONNECT_INTERVAL = 5000;

void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 3000)
    ; // Wait up to 3 seconds for Serial

  Serial.println("\n=== ArduCAM WiFi WebSocket Client ===");

  // Initialize I2C
  Wire.begin();

  // Initialize SPI
  pinMode(CS_PIN, OUTPUT);
  digitalWrite(CS_PIN, HIGH);
  SPI.begin();

  delay(100);

  // Initialize ArduCAM
  if (!initCamera()) {
    Serial.println("ERROR: Camera initialization failed!");
    while (1)
      delay(1000);
  }

  // Connect to WiFi
  connectWiFi();

  // Connect to WebSocket server
  connectWebSocket();
}

void loop() {
  // Check WiFi connection
  if (WiFi.status() != WL_CONNECTED) {
    wifiConnected = false;
    if (millis() - lastReconnectAttempt > RECONNECT_INTERVAL) {
      lastReconnectAttempt = millis();
      connectWiFi();
    }
    return;
  }

  // Check WebSocket connection
  if (!wsClient.connected()) {
    wsConnected = false;
    if (millis() - lastReconnectAttempt > RECONNECT_INTERVAL) {
      lastReconnectAttempt = millis();
      connectWebSocket();
    }
    return;
  }

  // Check for incoming WebSocket messages
  int messageSize = wsClient.parseMessage();
  if (messageSize > 0) {
    String message = wsClient.readString();
    Serial.print("Received: ");
    Serial.println(message);
    handleCommand(message);
  }
}

void connectWiFi() {
  Serial.print("Connecting to WiFi: ");
  Serial.println(WIFI_SSID);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    wifiConnected = true;
    Serial.println("\nWiFi connected!");
    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nWiFi connection failed!");
  }
}

void connectWebSocket() {
  if (!wifiConnected)
    return;

  Serial.print("Connecting to WebSocket server: ");
  Serial.print(WS_SERVER);
  Serial.print(":");
  Serial.println(WS_PORT);

  wsClient.begin(WS_PATH);

  if (wsClient.connected()) {
    wsConnected = true;
    Serial.println("WebSocket connected!");

    // Send client ID as first message (authentication)
    wsClient.beginMessage(TYPE_TEXT);
    wsClient.print(CLIENT_ID);
    wsClient.endMessage();

    Serial.print("Sent Client ID: ");
    Serial.println(CLIENT_ID);
  } else {
    Serial.println("WebSocket connection failed!");
  }
}

bool initCamera() {
  Serial.println("Initializing camera...");

  // Reset CPLD
  myCAM.write_reg(0x07, 0x80);
  delay(100);
  myCAM.write_reg(0x07, 0x00);
  delay(100);

  // Check if ArduCAM is detected
  uint8_t vid, pid;
  myCAM.wrSensorReg8_8(0xff, 0x01);
  myCAM.rdSensorReg8_8(OV2640_CHIPID_HIGH, &vid);
  myCAM.rdSensorReg8_8(OV2640_CHIPID_LOW, &pid);

  if ((vid != 0x26) && ((pid != 0x41) || (pid != 0x42))) {
    Serial.println("Camera not detected!");
    return false;
  }

  // Initialize camera
  myCAM.set_format(JPEG);
  myCAM.InitCAM();

  // Set to lowest resolution for speed (160x120)
  myCAM.OV2640_set_JPEG_size(OV2640_160x120);

  delay(1000);
  myCAM.clear_fifo_flag();

  Serial.println("Camera initialized at 160x120");
  return true;
}

void handleCommand(String cmd) {
  cmd.trim();

  // Ignore messages from ourselves (starts with our CLIENT_ID)
  if (cmd.startsWith(CLIENT_ID)) {
    return;
  }

  if (cmd == "TAKE_IMAGE") {
    Serial.println("Capturing image...");
    captureAndSendImage();
  } else if (cmd == "PING") {
    wsClient.beginMessage(TYPE_TEXT);
    wsClient.print(CLIENT_ID);
    wsClient.print(" PONG");
    wsClient.endMessage();
  } else {
    Serial.print("Unknown command: ");
    Serial.println(cmd);
  }
}

void captureAndSendImage() {
  // Start capture
  myCAM.flush_fifo();
  myCAM.clear_fifo_flag();
  myCAM.start_capture();

  // Wait for capture to complete
  while (!myCAM.get_bit(ARDUCHIP_TRIG, CAP_DONE_MASK))
    ;

  // Get image length
  uint32_t length = myCAM.read_fifo_length();

  if (length >= MAX_FIFO_SIZE || length == 0) {
    Serial.println("ERROR: Invalid image size");
    myCAM.clear_fifo_flag();
    return;
  }

  Serial.print("Image size: ");
  Serial.print(length);
  Serial.println(" bytes");

  // Read image data into buffer
  uint8_t *imageBuffer = (uint8_t *)malloc(length);
  if (!imageBuffer) {
    Serial.println("ERROR: Memory allocation failed");
    myCAM.clear_fifo_flag();
    return;
  }

  myCAM.CS_LOW();
  myCAM.set_fifo_burst();

  uint32_t bufferIndex = 0;
  uint8_t temp = 0, temp_last = 0;
  bool is_header = false;

  for (uint32_t i = 0; i < length; i++) {
    temp_last = temp;
    temp = SPI.transfer(0x00);

    // Check for JPEG header (0xFF 0xD8)
    if ((temp == 0xD8) && (temp_last == 0xFF)) {
      is_header = true;
      imageBuffer[bufferIndex++] = temp_last;
      imageBuffer[bufferIndex++] = temp;
    } else if (is_header) {
      imageBuffer[bufferIndex++] = temp;

      // Check for JPEG end marker (0xFF 0xD9)
      if ((temp == 0xD9) && (temp_last == 0xFF)) {
        break;
      }
    }
  }

  myCAM.CS_HIGH();
  myCAM.clear_fifo_flag();

  Serial.print("JPEG extracted: ");
  Serial.print(bufferIndex);
  Serial.println(" bytes");

  // Send via WebSocket
  sendImageViaWebSocket(imageBuffer, bufferIndex);

  free(imageBuffer);
}

void sendImageViaWebSocket(uint8_t *data, uint32_t length) {
  // Calculate total Base64 length
  // Base64 length is ceil(length / 3) * 4
  uint32_t base64Len = ((length + 2) / 3) * 4;

  Serial.print("Image size: ");
  Serial.print(length);
  Serial.print(" -> Base64 len: ");
  Serial.println(base64Len);

  // Use a static counter for frame ID
  static int frameCounter = 0;
  frameCounter++;
  String frameId = String(frameCounter);

  // CRITICAL: Use very small chunks to avoid memory crashes
  // 300 bytes of raw data -> 400 bytes of Base64
  const int RAW_CHUNK_SIZE = 300;
  int totalChunks = (length + RAW_CHUNK_SIZE - 1) / RAW_CHUNK_SIZE;

  Serial.print("Sending ");
  Serial.print(totalChunks);
  Serial.println(" chunks...");

  // Send BEGIN
  wsClient.beginMessage(TYPE_TEXT);
  wsClient.print(CLIENT_ID);
  wsClient.print(" IMG_B64_BEGIN {\"frameId\":");
  wsClient.print(frameId);
  wsClient.print(",\"mime\":\"image/jpeg\",\"bytes\":");
  wsClient.print(length);
  wsClient.print(",\"total\":");
  wsClient.print(totalChunks);
  wsClient.print("}");
  wsClient.endMessage();
  delay(50); // Increased delay

  // Send chunks
  for (int i = 0; i < totalChunks; i++) {
    uint32_t start = i * RAW_CHUNK_SIZE;
    uint32_t end = min(start + RAW_CHUNK_SIZE, length);
    uint32_t chunkLen = end - start;

    // Encode just this chunk
    String chunkBase64 = base64_encode(data + start, chunkLen);

    wsClient.beginMessage(TYPE_TEXT);
    wsClient.print(CLIENT_ID);
    wsClient.print(" IMG_B64_CHUNK {\"frameId\":");
    wsClient.print(frameId);
    wsClient.print(",\"index\":");
    wsClient.print(" IMG_B64_END {\"frameId\":");
    wsClient.print(frameId);
    wsClient.print("}");
    wsClient.endMessage();

    Serial.print("✓ Sent ");
    Serial.print(totalChunks);
    Serial.println(" chunks!");
  }

  // Simple Base64 encoder
  String base64_encode(const uint8_t *data, size_t length) {
    const char *b64chars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    String result = "";
    result.reserve(((length + 2) / 3) * 4);

    for (size_t i = 0; i < length; i += 3) {
      uint32_t n = ((uint32_t)data[i]) << 16;
      if (i + 1 < length)
        n |= ((uint32_t)data[i + 1]) << 8;
      if (i + 2 < length)
        n |= data[i + 2];

      result += b64chars[(n >> 18) & 0x3F];
      result += b64chars[(n >> 12) & 0x3F];
      result += (i + 1 < length) ? b64chars[(n >> 6) & 0x3F] : '=';
      result += (i + 2 < length) ? b64chars[n & 0x3F] : '=';
    }

    return result;
  }
