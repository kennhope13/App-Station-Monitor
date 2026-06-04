import urllib.request

try:
    url = "http://localhost:5173"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req) as r:
        html = r.read().decode('utf-8')
        print("VITE STATUS: RUNNING!")
        print("HTML LENGTH:", len(html))
        if "PdRegionTab" in html or "assets" in html or "index.html" in html:
            print("Vite is serving the React frontend successfully!")
except Exception as e:
    print("VITE STATUS: DOWN!", e)
