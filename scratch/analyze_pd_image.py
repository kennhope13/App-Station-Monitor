import cv2
import numpy as np

img = cv2.imread("/home/admin-/.gemini/antigravity/brain/e3609fcc-ee12-4ad4-9aee-949fcfd4a861/debug_pd_frame.jpg")
if img is not None:
    h, w, c = img.shape
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    
    # Define bounding box for PD_2
    # x from 0.70 * w to 0.90 * w
    # y from 0.42 * h to 0.70 * h
    x_start, x_end = int(0.70 * w), int(0.90 * w)
    y_start, y_end = int(0.42 * h), int(0.70 * h)
    
    roi_hsv = hsv[y_start:y_end, x_start:x_end]
    roi_bgr = img[y_start:y_end, x_start:x_end]
    
    # Let's find pixels with high Saturation or Value
    print(f"Analyzing ROI (PD_2 region) size: {roi_hsv.shape}")
    
    # Find pixels where S > 30 and V > 50
    # Let's see what hues are present
    flat_hsv = roi_hsv.reshape(-1, 3)
    flat_bgr = roi_bgr.reshape(-1, 3)
    
    # Filter pixels
    mask = (flat_hsv[:, 1] > 30) & (flat_hsv[:, 2] > 50)
    filtered_hsv = flat_hsv[mask]
    filtered_bgr = flat_bgr[mask]
    
    print("Found", len(filtered_hsv), "pixels with S > 30 and V > 50")
    if len(filtered_hsv) > 0:
        # Group by hue
        hues = filtered_hsv[:, 0]
        # Print top 5 colors
        print("Hue range:", np.min(hues), "to", np.max(hues))
        # Let's print some pixels with red/orange/yellow hue (Hue < 40 or Hue > 140)
        red_mask = (hues < 40) | (hues > 140)
        red_hsv = filtered_hsv[red_mask]
        print("Found", len(red_hsv), "red/orange/yellow pixels")
        if len(red_hsv) > 0:
            print("Red/orange/yellow pixels HSV sample:")
            for i in range(min(10, len(red_hsv))):
                print(red_hsv[i])
else:
    print("Failed to read image")
