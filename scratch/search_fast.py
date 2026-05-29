import os

search_dir = "/home/admin-/Desktop/DA"

for root, dirs, files in os.walk(search_dir):
    for file in files:
        if file.endswith(".py"):
            path = os.path.join(root, file)
            try:
                with open(path, "rb") as f:
                    content = f.read()
                    if b"D\xe1\xbb\xacNG READER" in content or b"B\xe1\xbb\x95t \u0111\xe1\xba\xa7u" in content:
                        print(f"Found in: {path}")
            except Exception as e:
                pass
