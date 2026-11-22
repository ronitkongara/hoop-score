#pragma once

// ---------- Wi-Fi access point ----------
#define WIFI_SSID      "HoopScore"
#define WIFI_PASSWORD  "changeme123"   // 8+ characters. Change this!
#define WIFI_CHANNEL   6

// ---------- Pins ----------
#define PIN_TRIG 5
#define PIN_ECHO 18   // HC-SR04 ECHO is 5 V: use a 1k / 2k voltage divider!

// ---------- Detection defaults (caregiver can change dropCm / minHoldMs / cooldownMs from the app) ----------
#define DEFAULT_DROP_CM       15     // distance must drop this far below baseline
#define DEFAULT_MIN_HOLD_MS   40     // ...for at least this long
#define DEFAULT_MAX_HOLD_MS   600    // longer than this is not a ball (hand on net, kid under hoop): ignored
#define DEFAULT_COOLDOWN_MS   2000   // ignore everything after a score (net bounce)
#define MIN_BELOW_SAMPLES     2      // need at least 2 consecutive "below" readings

// ---------- Timing ----------
#define POLL_MS               30     // HC-SR04. For JSN-SR04T use 60 (it needs a longer cycle).
#define ECHO_TIMEOUT_US       25000  // ~4.3 m max range; keeps each read under POLL_MS
#define CALIBRATION_MS        2000
#define DRIFT_IDLE_MS         60000  // re-learn baseline after this long with no activity
#define DRIFT_SAMPLE_MS       1000
#define DRIFT_MAX_SPREAD_CM   8.0f   // only re-learn if readings were steady
#define STATUS_INTERVAL_MS    500

// ---------- Sensor valid range ----------
#define SENSOR_MIN_CM         2.0f   // JSN-SR04T: set to 22 (it can't see closer than ~20 cm)
#define SENSOR_MAX_CM         400.0f

// Print every distance reading to Serial (noisy; for bench testing)
#define DEBUG_PRINT_DISTANCE  0
