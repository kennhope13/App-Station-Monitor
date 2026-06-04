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
# Mask all saturated colors
mask = cv2.inRange(hsv, (0, 30, 60), (180, 255, 255))
mask[:, int(small_w * 0.98):] = 0
mask[:int(small_h * 0.02), :] = 0
mask[int(small_h * 0.98):, :] = 0

kernel = np.ones((3, 3), np.uint8)
mask_morphed = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
mask_morphed = cv2.morphologyEx(mask_morphed, cv2.MORPH_CLOSE, kernel)

contours, _ = cv2.findContours(mask_morphed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
print(f"Total contours found: {len(contours)}")
candidates = []
for i, c in enumerate(contours):
    area = float(cv2.contourArea(c))
    x, y, cw, ch = cv2.boundingRect(c)
    # Calculate average color in the contour
    c_mask = np.zeros(small.shape[:2], dtype=np.uint8)
    cv2.drawContours(c_mask, [c], -1, 255, -1)
    mean_color = cv2.mean(small, mask=c_mask)[:3] # BGR
    print(f"Contour {i}: area={area:.1f}, bbox=({x},{y},{cw},{ch}), mean_bgr=({mean_color[0]:.1f}, {mean_color[1]:.1f}, {mean_color[2]:.1f})")
