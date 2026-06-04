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
s_channel = hsv[:, :, 1]
v_channel = hsv[:, :, 2]

# Find pixels with high saturation in the right 30% of the screen
coords = []
for y in range(small_h):
    for x in range(int(small_w * 0.70), small_w):
        if s_channel[y, x] >= 50 and v_channel[y, x] >= 50:
            coords.append((x, y))

print(f"Total saturated pixels in right 30%: {len(coords)}")
if coords:
    xs = [pt[0] for pt in coords]
    ys = [pt[1] for pt in coords]
    print(f"X range: {min(xs)} to {max(xs)}")
    print(f"Y range: {min(ys)} to {max(ys)}")
    
    # Print a small density map of these pixels
    grid = np.zeros((small_h, small_w), dtype=np.uint8)
    for x, y in coords:
        grid[y, x] = 1
    # Find bounding boxes of connected components
    contours, _ = cv2.findContours(grid, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    print("Saturated regions (contours):")
    for i, c in enumerate(contours):
        area = cv2.contourArea(c)
        x, y, cw, ch = cv2.boundingRect(c)
        print(f"  Region {i}: area={area}, bbox=({x},{y},{cw},{ch}) (Norm X: {x/small_w:.3f} to {(x+cw)/small_w:.3f})")
