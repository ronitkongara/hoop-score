"""Bundle web/ into one self-contained page (dist/hoop-score.html) for the hosted demo link.

The hosted page gets wrapped in its own <html>/<head>/<body> when published, so this writes only
a <title>, the inlined CSS, the body markup and the inlined JS.

Run from the project folder:  python tools/build_hosted.py
"""
import pathlib
import re

root = pathlib.Path(__file__).resolve().parent.parent
web = root / "web"
html = (web / "index.html").read_text(encoding="utf-8")
css = (web / "style.css").read_text(encoding="utf-8")
js = (web / "app.js").read_text(encoding="utf-8")

body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
assert "</script" not in js, "app.js must not contain a closing script tag"
body = body.replace('<script src="app.js"></script>', "<script>\n" + js + "\n</script>")

out = "<title>Hoop Score</title>\n<style>\n" + css + "\n</style>\n" + body.strip() + "\n"
dist = root / "dist"
dist.mkdir(exist_ok=True)
(dist / "hoop-score.html").write_text(out, encoding="utf-8")
print(f"wrote {dist / 'hoop-score.html'} ({len(out.encode()) // 1024} KB)")
