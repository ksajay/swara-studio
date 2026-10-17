/* Reusable quiz: <div class="quiz" data-quiz='[{"q":"…","opts":["…","…"],"a":0,"why":"…"}]'></div>
   Instant feedback per question; answers are shown in the order authored. */
(function () {
  "use strict";
  document.querySelectorAll("[data-quiz]").forEach(function (root) {
    var items; try { items = JSON.parse(root.getAttribute("data-quiz")); } catch (e) { return; }
    var score = 0, done = 0, total = items.length;
    var tally = document.createElement("p"); tally.className = "muted num";
    items.forEach(function (it, qi) {
      var box = document.createElement("div"); box.className = "q";
      var h = document.createElement("p"); h.innerHTML = "<b>" + (qi + 1) + ".</b> " + it.q; box.appendChild(h);
      var opts = document.createElement("div"); opts.className = "opts";
      var why = document.createElement("p"); why.className = "why"; why.hidden = true; why.innerHTML = it.why || "";
      it.opts.forEach(function (o, oi) {
        var b = document.createElement("button"); b.type = "button"; b.innerHTML = o;
        b.addEventListener("click", function () {
          if (box.dataset.done) return; box.dataset.done = "1"; done++;
          var ok = oi === it.a; if (ok) score++;
          b.className = ok ? "right" : "wrong";
          opts.children[it.a].className = "right";
          why.hidden = false; why.innerHTML = (ok ? "Right. " : "Not quite. ") + (it.why || "");
          tally.textContent = score + " of " + done + " right" + (done === total ? (score === total ? ". All correct." : ". Try the missed ones again tomorrow.") : "");
        });
        opts.appendChild(b);
      });
      box.appendChild(opts); box.appendChild(why); root.appendChild(box);
    });
    root.appendChild(tally);
  });
})();
