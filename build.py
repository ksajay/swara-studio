"""Build the installable (PWA) copy of Swara Studio into ./dist.

The source index.html is written for Claude artifacts, which add the document
skeleton themselves. For GitHub Pages we add that skeleton, the manifest,
icons and the offline worker here.
"""
import pathlib, shutil, time

ROOT = pathlib.Path(__file__).parent
DIST = ROOT / "dist"
BUILD = time.strftime("%Y%m%d%H%M%S")

HEAD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#F1F0F6" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#121129" media="(prefers-color-scheme: dark)">
<meta name="description" content="Hear, name and sing musical notes, with Indian swaras and Western notes side by side.">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon-192.png" type="image/png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}img{max-width:100%}</style>
</head>
<body>
"""

TAIL = """
<script>
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
}
(function () {
  var t = (location.hash || "").slice(1);
  if (t === "ear" || t === "sing") { var b = document.querySelector('[data-tab-btn="' + t + '"]'); if (b) b.click(); }
})();
</script>
</body>
</html>
"""

if DIST.exists():
    shutil.rmtree(DIST)
DIST.mkdir()
for folder in ("assets", "lessons", "reference", "icons"):
    shutil.copytree(ROOT / folder, DIST / folder)
shutil.copy(ROOT / "pwa" / "manifest.webmanifest", DIST / "manifest.webmanifest")
(DIST / "sw.js").write_text((ROOT / "pwa" / "sw.js").read_text().replace("__BUILD__", BUILD))
(DIST / "index.html").write_text(HEAD + (ROOT / "index.html").read_text() + TAIL)
(DIST / ".nojekyll").write_text("")
(DIST / "README.md").write_text(
    "# Swara Studio\n\nHear, name and sing musical notes, with Indian swaras and Western notes side by side.\n\n"
    "Open the GitHub Pages address in Chrome on Android and choose Install app (or menu > Add to Home screen).\n"
)
print("built", BUILD, "->", DIST)
