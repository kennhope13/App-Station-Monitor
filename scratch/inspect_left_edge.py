import cv2
img = cv2.imread("/home/admin-/.gemini/antigravity/brain/e3609fcc-ee12-4ad4-9aee-949fcfd4a861/debug_pd_frame.jpg")
if img is not None:
    print("Image shape:", img.shape)
    # Print the left 10 pixels of the row around y = 64% of height
    h, w, c = img.shape
    y = int(h * 0.64)
    print("Pixels at y =", y, "from x = 0 to 20:")
    for x in range(20):
        print(f"x={x}: {img[y, x]}")
else:
    print("Could not read image")
