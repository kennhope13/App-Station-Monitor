import cv2
import numpy as np

img = cv2.imread("/home/admin-/.gemini/antigravity/brain/e3609fcc-ee12-4ad4-9aee-949fcfd4a861/debug_pd_frame.jpg")
if img is not None:
    # Resize to 320x240 like the analyzer does
    small = cv2.resize(img, (320, 240))
    small_h, small_w = small.shape[:2]
    
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    
    m_red1 = cv2.inRange(hsv, (0, 25, 50), (15, 255, 255))
    m_red2 = cv2.inRange(hsv, (160, 25, 50), (180, 255, 255))
    m_oy   = cv2.inRange(hsv, (15, 25, 50), (35, 255, 255))
    mask = m_red1 | m_red2 | m_oy
    
    # Apply masking boundaries
    mask[:, int(small_w * 0.84):] = 0 # Right side (color bar)
    mask[:, :int(small_w * 0.05)] = 0 # Left side (potential border noise)
    mask[:int(small_h * 0.05), :] = 0 # Top side
    mask[int(small_h * 0.95):, :] = 0 # Bottom side
    
    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    print("Found", len(contours), "contours")
    candidates = []
    for c in contours:
        area = cv2.contourArea(c)
        print("Contour area:", area)
        if area < 3:
            continue
        candidates.append((area, c))
        
    if candidates:
        area, largest = max(candidates, key=lambda t: t[0])
        M = cv2.moments(largest)
        if M["m00"] > 0:
            cx = M["m10"] / M["m00"]
            cy = M["m01"] / M["m00"]
            print(f"Hotspot detected at: cx={cx/small_w:.3f}, cy={cy/small_h:.3f} (area={area:.1f})")
        else:
            print("Moments m00 is 0")
    else:
        print("No candidates found")
else:
    print("Could not read image")
