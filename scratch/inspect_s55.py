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

s_min = 55
mask = cv2.inRange(hsv, (0, s_min, 60), (180, 255, 255))

# Apply masking
mask[:, int(small_w * 0.90):] = 0
mask[:int(small_h * 0.02), :] = 0
mask[int(small_h * 0.98):, :] = 0

cx_center = small_w // 2
cy_center = small_h // 2
mask[cy_center - 10:cy_center + 10, cx_center - 10:cx_center + 10] = 0

kernel = np.ones((3, 3), np.uint8)
mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

print(f"Contours at S_min = {s_min}:")
for i, c in enumerate(contours):
    area = float(cv2.contourArea(c))
    x, y, cw, ch = cv2.boundingRect(c)
    print(f"  Contour {i}: area={area:.1f}, bbox=({x},{y},{cw},{ch})")
