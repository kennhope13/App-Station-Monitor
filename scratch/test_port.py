import urllib.request

try:
    url = "http://localhost:8100/pd-monitor/4f7fb8c5-75ad-49f5-9b25-529e7fb2a2b2?backend=http://localhost:5000"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req) as r:
        html = r.read().decode('utf-8')
        
        print("--- Diagnostic on localhost:8100 ---")
        if "Xóa" in html:
            print("SUCCESS: HTML contains new 'Xóa' button text!")
        else:
            print("FAIL: HTML still contains old button text (only has cross character or old cache).")
            
        # Find window.askDel button rendering line
        for line in html.split('\n'):
            if "window.askDel" in line:
                print("Line rendered:", line.strip())
except Exception as e:
    print("Error:", e)
