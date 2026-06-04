import cv2
import numpy as np

img = cv2.imread("/home/admin-/stationos-main/scratch/debug_pd_frame.jpg")
h, w = img.shape[:2]
print(f"Image Resolution: {w}x{h}")

hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)

# Let's check where highly saturated pixels are (S >= 100, V >= 100)
mask = cv2.inRange(hsv, (0, 100, 100), (180, 255, 255))
contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

print(f"Highly saturated contours found: {len(contours)}")
for i, c in enumerate(contours):
    area = cv2.contourArea(c)
    if area < 10: continue
    x, y, cw, ch = cv2.boundingRect(c)
    print(f"Contour {i}: area={area:.1f}, bbox=({x},{y},{cw},{ch}), norm_bbox=({x/w:.3f},{y/h:.3f},{cw/w:.3f},{ch/h:.3f})")
