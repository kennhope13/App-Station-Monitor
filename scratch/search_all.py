import os

search_dir = "/home/admin-/Desktop/DA/stationos-main/ai_engine"
query = b"AudioReader"
for root, dirs, files in os.walk(search_dir):
    for file in files:
        path = os.path.join(root, file)
        try:
            with open(path, "rb") as f:
                content = f.read()
                if query in content:
                    print(f"Found in: {path}")
        except Exception as e:
            pass
