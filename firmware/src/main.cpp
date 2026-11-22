// Hoop Score firmware: ultrasonic basket detection -> WebSocket -> phone.
// Bias: it is better to miss a borderline basket than to fire when nothing happened.

#include <Arduino.h>
#include <WiFi.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include <algorithm>
#include "config.h"

AsyncWebServer server(80);
AsyncWebSocket ws("/ws");
Preferences prefs;

// ---- thresholds (persisted in NVS) ----
volatile int dropCm     = DEFAULT_DROP_CM;
volatile int minHoldMs  = DEFAULT_MIN_HOLD_MS;
volatile int maxHoldMs  = DEFAULT_MAX_HOLD_MS;
volatile int cooldownMs = DEFAULT_COOLDOWN_MS;
volatile bool recalRequested = false;
volatile bool thresholdsChanged = false;

// ---- detection state ----
float baseline = -1;
float lastDistance = -1;
uint32_t lastPoll = 0, lastStatus = 0;
uint32_t cooldownUntil = 0;
bool inEvent = false, blocked = false;
uint32_t eventStart = 0;
int belowCount = 0;
uint32_t lastActivity = 0, lastRelearn = 0, lastDriftSample = 0;

// rolling buffer for slow baseline drift correction
const int DRIFT_N = 15;
float driftBuf[DRIFT_N];
int driftCount = 0, driftIdx = 0;

// ---------------------------------------------------------------- sensor
float readCm() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(3);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);
  unsigned long us = pulseIn(PIN_ECHO, HIGH, ECHO_TIMEOUT_US);
  if (us == 0) return -1;                        // timeout / glitch
  float cm = us / 58.0f;
  if (cm < SENSOR_MIN_CM || cm > SENSOR_MAX_CM) return -1;
  return cm;
}

float median(float *v, int n) {
  if (n <= 0) return -1;
  std::sort(v, v + n);
  return (n % 2) ? v[n / 2] : (v[n / 2 - 1] + v[n / 2]) / 2.0f;
}

void calibrate() {
  Serial.println("[cal] learning baseline, keep the hoop clear...");
  static float samples[120];
  int n = 0;
  uint32_t start = millis();
  while (millis() - start < CALIBRATION_MS && n < 120) {
    float d = readCm();
    if (d > 0) samples[n++] = d;
    delay(POLL_MS);
  }
  float m = median(samples, n);
  if (n >= 10 && m > 0) {
    baseline = m;
    Serial.printf("[cal] baseline = %.1f cm (%d samples)\n", baseline, n);
  } else {
    Serial.printf("[cal] FAILED (%d valid samples). Detection disabled until recalibrated.\n", n);
    baseline = -1;
  }
  inEvent = false;
  driftCount = 0;
  lastActivity = lastRelearn = millis();
}

// ---------------------------------------------------------------- messages
String configJson() {
  JsonDocument d;
  d["type"] = "config";
  d["dropCm"] = dropCm;
  d["minHoldMs"] = minHoldMs;
  d["maxHoldMs"] = maxHoldMs;
  d["cooldownMs"] = cooldownMs;
  String s; serializeJson(d, s); return s;
}

void fireScore(uint32_t now) {
  cooldownUntil = now + cooldownMs;
  Serial.printf("[score] ts=%lu\n", (unsigned long)now);
  char buf[48];
  snprintf(buf, sizeof(buf), "{\"type\":\"score\",\"ts\":%lu}", (unsigned long)now);
  ws.textAll(buf);
}

// ---------------------------------------------------------------- detection
void process(float d, uint32_t now) {
  if (d < 0 || baseline <= 0) return;             // ignore glitches; no baseline = no detection
  if ((int32_t)(now - cooldownUntil) < 0) {       // cooldown: ignore all readings
    inEvent = false;
    return;
  }
  bool below = d < (baseline - dropCm);
  if (below) {
    lastActivity = now;
    if (!inEvent) { inEvent = true; blocked = false; eventStart = now; belowCount = 0; }
    belowCount++;
    if (now - eventStart > (uint32_t)maxHoldMs) blocked = true;   // something is just sitting there
  } else if (inEvent) {
    // object has left the beam: decide now
    uint32_t hold = now - eventStart;
    inEvent = false;
    if (!blocked && belowCount >= MIN_BELOW_SAMPLES && hold >= (uint32_t)minHoldMs && hold <= (uint32_t)maxHoldMs) {
      fireScore(now);
    } else {
      Serial.printf("[skip] hold=%lums samples=%d blocked=%d\n", (unsigned long)hold, belowCount, blocked);
    }
  } else if (now - lastDriftSample >= DRIFT_SAMPLE_MS) {
    // idle + clear: feed the drift buffer
    lastDriftSample = now;
    driftBuf[driftIdx] = d; driftIdx = (driftIdx + 1) % DRIFT_N;
    if (driftCount < DRIFT_N) driftCount++;
  }

  // slow baseline re-learn after 60 s of no activity
  if (!inEvent && now - lastActivity >= DRIFT_IDLE_MS && now - lastRelearn >= DRIFT_IDLE_MS && driftCount == DRIFT_N) {
    lastRelearn = now;
    float tmp[DRIFT_N];
    memcpy(tmp, driftBuf, sizeof(tmp));
    float m = median(tmp, DRIFT_N);
    float spread = tmp[DRIFT_N - 1] - tmp[0];      // sorted by median()
    if (spread <= DRIFT_MAX_SPREAD_CM && m > 0) {
      float old = baseline;
      baseline = baseline * 0.7f + m * 0.3f;        // move slowly
      Serial.printf("[drift] baseline %.1f -> %.1f\n", old, baseline);
    }
  }
}

// ---------------------------------------------------------------- websocket
void onWsEvent(AsyncWebSocket *server, AsyncWebSocketClient *client, AwsEventType type, void *arg, uint8_t *data, size_t len) {
  if (type == WS_EVT_CONNECT) {
    Serial.printf("[ws] client %u connected\n", client->id());
    client->text(configJson());
  } else if (type == WS_EVT_DISCONNECT) {
    Serial.printf("[ws] client %u disconnected\n", client->id());
  } else if (type == WS_EVT_DATA) {
    AwsFrameInfo *info = (AwsFrameInfo *)arg;
    if (!(info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT)) return;
    JsonDocument doc;
    if (deserializeJson(doc, data, len)) return;
    const char *t = doc["type"] | "";
    if (strcmp(t, "recalibrate") == 0) {
      recalRequested = true;                       // done in loop(), not in the network task
    } else if (strcmp(t, "setThresholds") == 0) {
      dropCm     = constrain((int)(doc["dropCm"]     | (int)dropCm), 3, 100);
      minHoldMs  = constrain((int)(doc["minHoldMs"]  | (int)minHoldMs), 10, 500);
      cooldownMs = constrain((int)(doc["cooldownMs"] | (int)cooldownMs), 500, 10000);
      maxHoldMs  = constrain((int)(doc["maxHoldMs"]  | (int)maxHoldMs), 100, 3000);
      thresholdsChanged = true;
    }
  }
}

// ---------------------------------------------------------------- setup / loop
void setup() {
  Serial.begin(115200);
  delay(200);
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);

  prefs.begin("hoop", false);
  dropCm     = prefs.getInt("dropCm", DEFAULT_DROP_CM);
  minHoldMs  = prefs.getInt("minHoldMs", DEFAULT_MIN_HOLD_MS);
  maxHoldMs  = prefs.getInt("maxHoldMs", DEFAULT_MAX_HOLD_MS);
  cooldownMs = prefs.getInt("cooldownMs", DEFAULT_COOLDOWN_MS);
  Serial.printf("[cfg] drop=%d hold=%d..%d cooldown=%d\n", dropCm, minHoldMs, maxHoldMs, cooldownMs);

  if (!LittleFS.begin(true)) Serial.println("[fs] LittleFS mount failed. Did you run: pio run -t uploadfs ?");

  WiFi.mode(WIFI_AP);
  WiFi.softAP(WIFI_SSID, WIFI_PASSWORD, WIFI_CHANNEL, 0, 4);
  WiFi.setSleep(false);                            // lower latency
  Serial.printf("[wifi] AP \"%s\" at http://%s\n", WIFI_SSID, WiFi.softAPIP().toString().c_str());

  ws.onEvent(onWsEvent);
  server.addHandler(&ws);
  server.serveStatic("/", LittleFS, "/").setDefaultFile("index.html").setCacheControl("no-cache");
  server.onNotFound([](AsyncWebServerRequest *req) { req->redirect("/"); });
  server.begin();

  calibrate();
}

void loop() {
  uint32_t now = millis();

  if (recalRequested) { recalRequested = false; calibrate(); now = millis(); }

  if (thresholdsChanged) {
    thresholdsChanged = false;
    prefs.putInt("dropCm", dropCm);
    prefs.putInt("minHoldMs", minHoldMs);
    prefs.putInt("maxHoldMs", maxHoldMs);
    prefs.putInt("cooldownMs", cooldownMs);
    Serial.printf("[cfg] saved drop=%d hold=%d..%d cooldown=%d\n", dropCm, minHoldMs, maxHoldMs, cooldownMs);
    ws.textAll(configJson());
  }

  if (now - lastPoll >= POLL_MS) {
    lastPoll = now;
    float d = readCm();
    lastDistance = d;
#if DEBUG_PRINT_DISTANCE
    Serial.printf("%.1f\n", d);
#endif
    process(d, millis());
  }

  if (now - lastStatus >= STATUS_INTERVAL_MS) {
    lastStatus = now;
    if (ws.count() > 0) {
      char buf[80];
      snprintf(buf, sizeof(buf), "{\"type\":\"status\",\"baseline\":%.1f,\"distance\":%.1f}", baseline, lastDistance);
      ws.textAll(buf);
    }
    ws.cleanupClients();
  }
}
