import cv2
import numpy as np

rtsp_url = "rtsp://localhost:8554/camera_192_168_10_153_pd"

cap = cv2.VideoCapture(rtsp_url)
if not cap.isOpened():
    print("Error: Could not open RTSP stream.")
    exit(1)
ret, frame = cap.read()
cap.release()

if not ret:
    print("Error: Could not read frame.")
    exit(1)

h, w = frame.shape[:2]
scale = 320.0 / float(w)
small_w, small_h = int(w * scale), int(h * scale)
small = cv2.resize(frame, (small_w, small_h))

hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)

# Exclude right 10% and center crosshair
mask = np.ones(small.shape[:2], dtype=np.uint8) * 255
mask[:, int(small_w * 0.90):] = 0
cx_center = small_w // 2
cy_center = small_h // 2
mask[cy_center - 10:cy_center + 10, cx_center - 10:cx_center + 10] = 0

s_channel = hsv[:, :, 1]
v_channel = hsv[:, :, 2]

# Apply mask
s_masked = s_channel[mask == 255]
v_masked = v_channel[mask == 255]

print(f"Max S in active area: {np.max(s_masked)}")
print(f"Mean S in active area: {np.mean(s_masked):.1f}")
print(f"Max V in active area: {np.max(v_masked)}")
print(f"Mean V in active area: {np.mean(v_masked):.1f}")

# Count pixels with S >= threshold
for thresh in [30, 50, 70, 90, 110, 130, 150]:
    count = np.sum((s_channel >= thresh) & (v_channel >= 60) & (mask == 255))
    print(f"Pixels with S >= {thresh} and V >= 60: {count}")
