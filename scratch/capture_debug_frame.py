import cv2
import numpy as np
import json
import psycopg2

rtsp_url = "rtsp://localhost:8554/camera_192_168_10_153_pd"
device_id = "4f7fb8c5-75ad-49f5-9b25-529e7fb2a2b2"

def detect_hotspot(img):
    h, w = img.shape[:2]
    scale = 320.0 / float(w)
    small_w, small_h = int(w * scale), int(h * scale)
    small = cv2.resize(img, (small_w, small_h))
    
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, (0, 30, 60), (180, 255, 255))
    
    mask[:, int(small_w * 0.98):] = 0
    mask[:int(small_h * 0.02), :] = 0
    mask[int(small_h * 0.98):, :] = 0
    
    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours: return None, None, None
    candidates = []
    for c in contours:
        area = float(cv2.contourArea(c))
        if area < 2: continue
        candidates.append((area, c))
    if not candidates: return None, None, None
    _, largest = max(candidates, key=lambda t: t[0])
    M = cv2.moments(largest)
    if M["m00"] == 0: return None, None, None
    cx = M["m10"] / M["m00"]
    cy = M["m01"] / M["m00"]
    
    return (cx / small_w, cy / small_h), mask, (int(cx / scale), int(cy / scale))

def point_in_polygon(point, polygon_vertices):
    x, y = point
    n = len(polygon_vertices)
    inside = False
    j = n - 1
    for i in range(n):
        xi = polygon_vertices[i][0]
        yi = polygon_vertices[i][1]
        xj = polygon_vertices[j][0]
        yj = polygon_vertices[j][1]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside

# 1. Fetch boundaries from DB
conn = psycopg2.connect("host='localhost' port=5432 dbname='StationOS' user='postgres' password='postgres123'")
cur = conn.cursor()
cur.execute("""
    SELECT "Name", "PolygonJson"
    FROM "Boundaries"
    WHERE "DeviceId" = %s;
""", (device_id,))
boundaries = []
for row in cur.fetchall():
    try:
        poly = json.loads(row[1])
        boundaries.append((row[0], poly))
    except:
        pass
cur.close()
conn.close()

# 2. Capture frame
print("Connecting to RTSP stream...")
cap = cv2.VideoCapture(rtsp_url)
if not cap.isOpened():
    print("Error: Could not open RTSP stream.")
    exit(1)

ret, frame = cap.read()
cap.release()

if not ret:
    print("Error: Could not read frame from stream.")
    exit(1)

h, w = frame.shape[:2]
print(f"Captured frame size: {w}x{h}")

# 3. Detect hotspot
hotspot, mask, pixel_pos = detect_hotspot(frame)
if hotspot:
    print(f"Hotspot detected at normalized pos: {hotspot[0]:.3f}, {hotspot[1]:.3f}")
    print(f"Hotspot pixel pos: {pixel_pos}")
    # Draw hotspot
    cv2.circle(frame, pixel_pos, 10, (255, 0, 0), -1) # Blue filled circle
else:
    print("No hotspot detected.")

# 4. Check boundaries and draw them
for name, poly in boundaries:
    # Convert poly normalized [0-1] to pixels
    pts = np.array([[int(p[0]*w), int(p[1]*h)] for p in poly], dtype=np.int32)
    # Check if hotspot is inside
    inside = False
    if hotspot:
        inside = point_in_polygon(hotspot, poly)
    
    color = (0, 0, 255) if inside else (0, 255, 0)
    print(f"Boundary '{name}': inside={inside}")
    
    cv2.polylines(frame, [pts], isClosed=True, color=color, thickness=2)
    # Put text
    cv2.putText(frame, f"{name} (inside={inside})", (pts[0][0], pts[0][1] - 10),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)

# Save debug image
output_path = "/home/admin-/stationos-main/scratch/debug_pd_frame.jpg"
cv2.imwrite(output_path, frame)
print(f"Saved debug frame to {output_path}")
