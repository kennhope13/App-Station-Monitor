import urllib.request

try:
    url = "http://localhost:8100/pd-monitor/4f7fb8c5-75ad-49f5-9b25-529e7fb2a2b2?backend=http://localhost:5000"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req) as response:
        html = response.read().decode('utf-8')
        print("LENGTH OF HTML:", len(html))
        
        # Check if new confirmation strings or 'Xóa' exists
        has_new_delete = "window.askDel" in html
        has_xoa_btn = "window.askDel" in html and "Xóa" in html
        print("HAS NEW DELETE LOGIC:", has_new_delete)
        print("HAS 'Xóa' TEXT:", has_xoa_btn)
        
        # Print a snippet of where askDel is defined
        idx = html.find("window.askDel")
        if idx != -1:
            print("\n--- Snippet around window.askDel ---")
            print(html[idx-100:idx+200])
        else:
            print("\nWARNING: window.askDel NOT FOUND in returned HTML!")
except Exception as e:
    print("ERROR CONNECTING TO AI ENGINE:", e)
