/*
 * ArduCAM WiFi WebSocket Client - MINIMAL VERSION
 * Sends only first 100 bytes of image as proof-of-concept
 * For Arduino WiFi Rev 2 with ArduCAM Mini OV2640
 */

#include "memorysaver.h"
#include <ArduCAM.h>
#include <ArduinoHttpClient.h>
#include <SPI.h>
#include <WiFiNINA.h>
#include <Wire.h>

// ===== CONFIGURE THESE =====
const char *WIFI_SSID = "tufts_eecs";
const char *WIFI_PASSWORD = "foundedin1883";
const char *WS_SERVER = "10.5.15.112";
const int WS_PORT = 8080;
const char *WS_PATH = "/";
const char *CLIENT_ID = "F392FC86D8D7";
const int CS_PIN = 7;
// ===========================

ArduCAM myCAM(OV2640, CS_PIN);
WiFiClient wifiClient;
WebSocketClient wsClient = WebSocketClient(wifiClient, WS_SERVER, WS_PORT);

bool wifiConnected = false;
bool wsConnected = false;
unsigned long lastReconnectAttempt = 0;
const unsigned long RECONNECT_INTERVAL = 5000;

void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 3000)
    ;

  Serial.println("\n=== ArduCAM WiFi MINIMAL ===");

  Wire.begin();
  pinMode(CS_PIN, OUTPUT);
  digitalWrite(CS_PIN, HIGH);
  SPI.begin();
  delay(100);

  if (!initCamera()) {
    Serial.println("ERROR: Camera init failed!");
    while (1)
      delay(1000);
  }

  connectWiFi();
  connectWebSocket();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    wifiConnected = false;
    if (millis() - lastReconnectAttempt > RECONNECT_INTERVAL) {
      lastReconnectAttempt = millis();
      connectWiFi();
    }
    return;
  }

  if (!wsClient.connected()) {
    wsConnected = false;
    if (millis() - lastReconnectAttempt > RECONNECT_INTERVAL) {
      lastReconnectAttempt = millis();
      connectWebSocket();
    }
    return;
  }

  int messageSize = wsClient.parseMessage();
  if (messageSize > 0) {
    String message = wsClient.readString();
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
    Serial.println("\n✓ WiFi connected!");
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n✗ WiFi failed!");
  }
}

void connectWebSocket() {
  if (!wifiConnected)
    return;

  Serial.print("Connecting to WS: ");
  Serial.print(WS_SERVER);
  Serial.print(":");
  Serial.println(WS_PORT);

  wsClient.begin(WS_PATH);

  if (wsClient.connected()) {
    wsConnected = true;
    Serial.println("✓ WebSocket connected!");

    wsClient.beginMessage(TYPE_TEXT);
    wsClient.print(CLIENT_ID);
    wsClient.endMessage();

    Serial.print("Sent ID: ");
    Serial.println(CLIENT_ID);
  } else {
    Serial.println("✗ WebSocket failed!");
  }
}

bool initCamera() {
  Serial.println("Init camera...");

  myCAM.write_reg(0x07, 0x80);
  delay(100);
  myCAM.write_reg(0x07, 0x00);
  delay(100);

  uint8_t vid, pid;
  myCAM.wrSensorReg8_8(0xff, 0x01);
  myCAM.rdSensorReg8_8(OV2640_CHIPID_HIGH, &vid);
  myCAM.rdSensorReg8_8(OV2640_CHIPID_LOW, &pid);

  if ((vid != 0x26) && ((pid != 0x41) || (pid != 0x42))) {
    Serial.println("Camera not detected!");
    return false;
  }

  myCAM.set_format(JPEG);
  myCAM.InitCAM();
  myCAM.OV2640_set_JPEG_size(OV2640_160x120);

  delay(1000);
  myCAM.clear_fifo_flag();

  Serial.println("✓ Camera ready (160x120)");
  return true;
}

void handleCommand(String cmd) {
  cmd.trim();

  // Ignore self-sent messages
  String selfPrefix = String(CLIENT_ID) + " ";
  if (cmd.startsWith(selfPrefix)) {
    return;
  }

  // Extract command from server prefix
  int commaPos = cmd.indexOf(',');
  if (commaPos >= 0) {
    cmd = cmd.substring(commaPos + 1);
    cmd.trim();
  }

  if (cmd == "TAKE_IMAGE") {
    Serial.println("📸 Capturing...");
    captureAndSendProof();
  } else if (cmd.indexOf("SERVER") < 0) {
    Serial.print("Unknown: ");
    Serial.println(cmd);
  }
}

void captureAndSendProof() {
  // Capture
  myCAM.flush_fifo();
  myCAM.clear_fifo_flag();
  myCAM.start_capture();

  while (!myCAM.get_bit(ARDUCHIP_TRIG, CAP_DONE_MASK))
    ;

  uint32_t length = myCAM.read_fifo_length();

  if (length >= MAX_FIFO_SIZE || length == 0) {
    Serial.println("ERROR: Invalid size");
    myCAM.clear_fifo_flag();
    return;
  }

  Serial.print("Image: ");
  Serial.print(length);
  Serial.println(" bytes");

  // Read only first 100 bytes as proof
  const int PROOF_SIZE = 100;
  uint8_t proofBuffer[PROOF_SIZE];

  myCAM.CS_LOW();
  myCAM.set_fifo_burst();

  // Read first 100 bytes
  for (int i = 0; i < PROOF_SIZE; i++) {
    proofBuffer[i] = SPI.transfer(0x00);
  }

  myCAM.CS_HIGH();
  myCAM.clear_fifo_flag();

  // Send proof
  sendProof(proofBuffer, PROOF_SIZE, length);
}

void sendProof(uint8_t *data, int proofSize, uint32_t totalSize) {
  // Use even smaller proof - 50 bytes
  const int SAFE_SIZE = 50;

  // Encode just 50 bytes to be extra safe
  String base64 = base64_encode(data, SAFE_SIZE);

  Serial.print("Sending proof (");
  Serial.print(SAFE_SIZE);
  Serial.print(" of ");
  Serial.print(totalSize);
  Serial.println(" bytes)...");

  // Build message piece-by-piece to avoid memory issues
  static int frameCounter = 0;
  frameCounter++;

  wsClient.beginMessage(TYPE_TEXT);
  wsClient.print(CLIENT_ID);
  wsClient.print(" {\"type\":\"image_b64\"");
  wsClient.print(",\"frameId\":");
  wsClient.print(frameCounter);
  wsClient.print(",\"mime\":\"image/jpeg\"");
  wsClient.print(",\"bytes\":");
  wsClient.print(totalSize);
  wsClient.print(",\"serverId\":\"");
  wsClient.print(CLIENT_ID);
  wsClient.print("\",\"data\":\"");
  wsClient.print(base64);
  wsClient.print("\"}");
  wsClient.endMessage();

  Serial.println("✓ Proof sent!");
  Serial.print("Base64 length: ");
  Serial.println(base64.length());
}

String base64_encode(const uint8_t *data, size_t length) {
  const char *b64 =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  String result = "";
  result.reserve(((length + 2) / 3) * 4);

  for (size_t i = 0; i < length; i += 3) {
    uint32_t n = ((uint32_t)data[i]) << 16;
    if (i + 1 < length)
      n |= ((uint32_t)data[i + 1]) << 8;
    if (i + 2 < length)
      n |= data[i + 2];

    result += b64[(n >> 18) & 0x3F];
    result += b64[(n >> 12) & 0x3F];
    result += (i + 1 < length) ? b64[(n >> 6) & 0x3F] : '=';
    result += (i + 2 < length) ? b64[n & 0x3F] : '=';
  }

  return result;
}
