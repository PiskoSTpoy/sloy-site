/* СЛОЙ — app.js. Three.js hero (layer-by-layer print reveal) + calculator + video gating.
   External lib: Three.js r150 UMD (cdnjs, pinned version) — loaded in index.html. */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── smooth anchor scroll (fallback for browsers without CSS scroll-behavior) ── */
  var cue = document.getElementById("scrollCue");
  if (cue) cue.addEventListener("click", function () {
    var next = document.getElementById("process");
    if (next) next.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  });

  /* ══════════════════════════════════════════════════════════════════════
     LIVE PRINT DEMO: an object "prints" bottom-up through a Three.js
     clipping plane. Not an icon — real procedural geometry (LatheGeometry),
     ribbed to read as visibly layered, resting on a lit turntable plate
     with a baked contact shadow. Lives in a small fixed-aspect card inside
     #process (see .livedemo in style.css) — never full-bleed, so it can't
     repeat the old bug of bleeding under reflowed text on narrow screens.
     ══════════════════════════════════════════════════════════════════════ */
  (function initLiveDemo() {
    var canvas = document.getElementById("gl");
    var stage = document.querySelector(".livedemo__stage");
    var fallbackImg = document.getElementById("demoFallback");
    var hint = document.getElementById("demoHint");
    if (!canvas || !stage) return;

    var webglOK = false;
    try {
      var test = document.createElement("canvas");
      webglOK = !!(window.WebGLRenderingContext &&
        (test.getContext("webgl") || test.getContext("experimental-webgl")));
    } catch (e) { webglOK = false; }

    if (!webglOK || typeof THREE === "undefined") {
      canvas.hidden = true;
      if (fallbackImg) fallbackImg.hidden = false;
      if (hint) hint.textContent = "";
      return;
    }

    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.localClippingEnabled = true;
    renderer.setClearColor(0x0c0a08, 1);

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0.32, 4.4); // closer than the old vase framing — the rocket is
    // taller and slimmer, and filling more of the frame reads more confident than leaving
    // it small with empty headroom above

    /* light: warm key (molten plastic), cool rim (precision), soft hemisphere fill for volume */
    scene.add(new THREE.HemisphereLight(0x9fcbe0, 0x1a1108, 0.62));
    var key = new THREE.DirectionalLight(0xffb27a, 2.15);
    key.position.set(2.2, 3, 2.6);
    scene.add(key);
    var rim = new THREE.DirectionalLight(0xbfe6ff, 0.95);
    rim.position.set(-3, 1.5, -2);
    scene.add(rim);

    /* ── rocket profile (control points), densified + gently ribbed so the
       surface itself reads as "built from layers" — the studio's own name.
       Deliberately NOT a vase/pot silhouette (that read as generic "AI decor"
       and was cut) — a long straight-sided body + tapered nose is instantly
       readable as "rocket", not "vessel", at a glance, and is still a shape
       a lathe-revolve can produce (fully rotationally symmetric). ── */
    var profileControl = [
      [0.03, 0], [0.40, 0.06], [0.34, 0.22], [0.27, 0.40], [0.29, 0.65],
      [0.29, 1.00], [0.29, 1.40], [0.27, 1.68], [0.18, 1.92], [0.07, 2.15], [0.0, 2.35]
    ];
    var PROFILE_TOTAL_H = profileControl[profileControl.length - 1][1];
    function radiusAtHeight(y) {
      for (var i = 0; i < profileControl.length - 1; i++) {
        var a = profileControl[i], b = profileControl[i + 1];
        if (y >= a[1] && y <= b[1]) {
          var segT = (b[1] - a[1]) > 0 ? (y - a[1]) / (b[1] - a[1]) : 0;
          return a[0] + (b[0] - a[0]) * segT;
        }
      }
      return profileControl[profileControl.length - 1][0];
    }

    function densify(control, totalSamples) {
      var out = [];
      var perSeg = Math.max(2, Math.round(totalSamples / (control.length - 1)));
      for (var i = 0; i < control.length - 1; i++) {
        var a = control[i], b = control[i + 1];
        for (var s = 0; s < perSeg; s++) {
          var t = s / perSeg;
          out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
      }
      out.push(control[control.length - 1].slice());
      return out;
    }

    var LAYER_H = 0.05;     // world-unit spacing between visible ridge bands
    var RIDGE_AMP = 0.0085; // how much each band pushes the radius — subtle, not noisy
    var dense = densify(profileControl, 170);
    var profile = dense.map(function (p, i) {
      var edgeFade = Math.min(1, i / 6, (dense.length - 1 - i) / 6); // keep rim/base clean
      var ridge = Math.sin((p[1] / LAYER_H) * Math.PI * 2) * RIDGE_AMP * edgeFade;
      return new THREE.Vector2(Math.max(0.001, p[0] + ridge), p[1]);
    });

    var geo = new THREE.LatheGeometry(profile, 72);
    geo.computeVertexNormals();
    geo.translate(0, -PROFILE_TOTAL_H / 2, 0); // recenter vertically — derived from the
    // profile itself, not a hardcoded half-height, so swapping the silhouette later
    // (like this pass did) can't silently leave the object mis-centered in frame

    var bbox = new THREE.Box3().setFromBufferAttribute(geo.attributes.position);
    var height = bbox.max.y - bbox.min.y;
    var baseY = bbox.min.y;

    /* Clip plane: THREE.Plane stores normal·p + constant; fragments with a negative
       distance are discarded. Normal points DOWN, so points below the current print
       height (already "printed") keep a positive distance and stay visible. */
    var clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);

    var solidMat = new THREE.MeshPhysicalMaterial({
      color: 0xe9e0d2, roughness: 0.5, metalness: 0.05,
      clearcoat: 0.18, clearcoatRoughness: 0.4,
      clippingPlanes: [clipPlane], clipShadows: true,
    });
    var solid = new THREE.Mesh(geo, solidMat);
    scene.add(solid);

    /* ghost wireframe — the part "not yet printed", a digital blueprint outline */
    var edges = new THREE.EdgesGeometry(geo, 12);
    var wireMat = new THREE.LineBasicMaterial({ color: 0x7fd3ff, transparent: true, opacity: 0.28 });
    var wire = new THREE.LineSegments(edges, wireMat);
    wire.scale.setScalar(1.006);
    scene.add(wire);

    /* glowing ring marking the current print height ("hot head") */
    var headGeo = new THREE.TorusGeometry(0.5, 0.045, 10, 40);
    var headMat = new THREE.MeshBasicMaterial({ color: 0xff5a1f, transparent: true, opacity: 0.9 });
    var head = new THREE.Mesh(headGeo, headMat);
    head.rotation.x = Math.PI / 2;
    scene.add(head);
    var headLight = new THREE.PointLight(0xff5a1f, 2.2, 3.2, 2);
    scene.add(headLight);

    var group = new THREE.Group();
    group.add(solid, wire, head, headLight);
    scene.add(group);

    /* ── turntable plate: stays still while the object spins on it, like a real
       product-photography turntable. Canvas-baked leveling rings + a soft
       contact-shadow blob stand in for a proper shadow map — cheap, always sharp. ── */
    function makePlateTexture() {
      var size = 512;
      var c = document.createElement("canvas");
      c.width = c.height = size;
      var ctx = c.getContext("2d");

      ctx.fillStyle = "#141110";
      ctx.fillRect(0, 0, size, size);

      var vign = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size * 0.52);
      vign.addColorStop(0, "rgba(255,255,255,0.06)");
      vign.addColorStop(0.55, "rgba(255,255,255,0.015)");
      vign.addColorStop(1, "rgba(0,0,0,0.4)");
      ctx.fillStyle = vign;
      ctx.fillRect(0, 0, size, size);

      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 1;
      for (var r = size * 0.12; r < size * 0.48; r += size * 0.085) {
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
        ctx.stroke();
      }

      var shadow = ctx.createRadialGradient(size / 2, size * 0.56, size * 0.02, size / 2, size * 0.56, size * 0.32);
      shadow.addColorStop(0, "rgba(0,0,0,0.55)");
      shadow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = shadow;
      ctx.beginPath();
      ctx.ellipse(size / 2, size * 0.56, size * 0.3, size * 0.19, 0, 0, Math.PI * 2);
      ctx.fill();

      return new THREE.CanvasTexture(c);
    }
    var plateMat = new THREE.MeshStandardMaterial({ map: makePlateTexture(), roughness: 0.82, metalness: 0.22 });
    var plate = new THREE.Mesh(new THREE.CircleGeometry(0.62, 72), plateMat); // sized to the
    // rocket's ~0.4 max radius, not the old vase's 0.78 — same proportion as before
    plate.rotation.x = -Math.PI / 2;
    plate.position.y = baseY - 0.012;
    scene.add(plate);

    /* ── print animation: 0→1 over ~4.2s, then holds ── */
    var progress = reduceMotion ? 1 : 0;
    var printing = !reduceMotion;
    var printStart = performance.now();
    var PRINT_MS = 4200;
    function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

    function setClip(p) {
      var y = baseY + height * p;
      clipPlane.set(new THREE.Vector3(0, -1, 0), y);
      var t = height ? (y - baseY) / height : 0;
      var rActual = radiusAtHeight(t * PROFILE_TOTAL_H); // real profile lookup, not an approximation
      head.scale.setScalar(Math.max(rActual, 0.05) / 0.5);
      head.position.y = y;
      headLight.position.y = y;
      wireMat.opacity = 0.34 * (1 - p) + 0.06;
    }
    setClip(progress);

    function replay() {
      printing = true;
      printStart = performance.now();
      if (hint) hint.textContent = "печатается…";
    }
    canvas.addEventListener("click", replay);
    canvas.style.cursor = "pointer";

    /* ── pointer: gentle parallax layered on top of the continuous auto-rotation ── */
    var tiltTargetX = 0.08, tiltTargetY = 0, tiltX = 0.08, tiltY = 0;
    function onPointerMove(e) {
      var r = stage.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width * 2 - 1;
      var y = (e.clientY - r.top) / r.height * 2 - 1;
      tiltTargetY = x * 0.35;
      tiltTargetX = 0.08 - y * 0.16;
    }
    stage.addEventListener("pointermove", onPointerMove);
    stage.addEventListener("pointerleave", function () { tiltTargetX = 0.08; tiltTargetY = 0; });

    /* ── resize: .livedemo__stage is always a fixed-aspect boxed card (see
       CSS), so the canvas's own displayed size is unambiguous — no need to
       reconcile it against a different-shaped ancestor. ── */
    function resize() {
      var w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();
    window.addEventListener("resize", resize);

    /* ── render loop — stops while the hero is off-screen (don't spin WebGL
       forever on a long page), resumes when it re-enters view ── */
    var autoRotSpeed = 0.09; // rad/s — slow continuous auto-rotation
    var autoYaw = 0.5;
    var lastT = performance.now();
    var rafId = null;

    function tick(now) {
      var dt = Math.min((now - lastT) / 1000, 0.05);
      lastT = now;

      if (printing) {
        var p = Math.min((now - printStart) / PRINT_MS, 1);
        progress = ease(p);
        setClip(progress);
        if (p >= 1) { printing = false; if (hint) hint.textContent = "готово · крутится само · можно потянуть"; }
      }

      /* breathing glow on the hot-head ring — brighter/faster while actively printing */
      var pulse = 0.5 + 0.5 * Math.sin(now * 0.005);
      headMat.opacity = printing ? 0.72 + 0.22 * pulse : 0.32 + 0.14 * pulse;
      headLight.intensity = printing ? 1.9 + 0.7 * pulse : 0.35 + 0.25 * pulse;

      if (!reduceMotion) {
        autoYaw += autoRotSpeed * dt;
        tiltX += (tiltTargetX - tiltX) * 0.06;
        tiltY += (tiltTargetY - tiltY) * 0.06;
        group.rotation.y = autoYaw + tiltY;
        group.rotation.x = tiltX;
      }

      renderer.render(scene, camera);
      rafId = requestAnimationFrame(tick);
    }
    function startLoop() { if (rafId === null) { lastT = performance.now(); rafId = requestAnimationFrame(tick); } }
    function stopLoop() { if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; } }

    startLoop();
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { en.isIntersecting ? startLoop() : stopLoop(); });
      }, { threshold: 0.01 }).observe(stage);
    }
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stopLoop(); else startLoop();
    });
  })();

  /* ══════════════════════════════════════════════════════════════════════
     VIDEO GATING: don't load the Kling loops on mobile/reduced-motion.
     The poster stays the only LCP element in each section.
     ══════════════════════════════════════════════════════════════════════ */
  (function gateVideos() {
    var small = window.matchMedia("(max-width: 767px)").matches;
    document.querySelectorAll("video[preload='none']").forEach(function (v) {
      if (small || reduceMotion) {
        v.removeAttribute("autoplay");
        v.pause();
        v.querySelectorAll("source").forEach(function (s) { s.remove(); });
        v.load();
        return;
      }
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) v.play().catch(function () {});
          else v.pause();
        });
      }, { threshold: 0.35 });
      io.observe(v);
    });
  })();

  /* ══════════════════════════════════════════════════════════════════════
     STEPS REVEAL: three "as you scroll" cards should feel like a sequence,
     not three static facts appearing at once. Staggered fade/rise, one
     IntersectionObserver, unobserve after first reveal (never re-hide on
     scroll-away — this is a one-time "arrival", not a toggle).
     ══════════════════════════════════════════════════════════════════════ */
  (function initSteps() {
    var steps = document.querySelectorAll(".steps .step");
    if (!steps.length) return;
    if (reduceMotion || !("IntersectionObserver" in window)) {
      steps.forEach(function (el) { el.classList.add("step--in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target;
        var i = Array.prototype.indexOf.call(steps, el);
        setTimeout(function () { el.classList.add("step--in"); }, i * 120);
        obs.unobserve(el);
      });
    }, { threshold: 0.25 });
    steps.forEach(function (el) { io.observe(el); });
  })();

  /* ══════════════════════════════════════════════════════════════════════
     CALCULATOR: dimensions × material × quality × quantity → estimate
     ══════════════════════════════════════════════════════════════════════ */
  (function initCalc() {
    var dimL = document.getElementById("dimL"), dimW = document.getElementById("dimW"), dimH = document.getElementById("dimH");
    var matSel = document.getElementById("calcMat"), qSel = document.getElementById("calcQuality"), qtyInp = document.getElementById("calcQty");
    var priceOut = document.getElementById("calcPrice"), daysOut = document.getElementById("calcDays"), volOut = document.getElementById("calcVolume");
    if (!dimL || !priceOut) return;

    /* ₽ per cm³ (machine time baked in) and print speed in cm³/hour — honest ballparks, not exact cost accounting */
    var MATS = {
      pla:       { price: 8,  speed: 12, setup: 300 },
      petg:      { price: 10, speed: 9,  setup: 300 },
      abs:       { price: 10, speed: 9,  setup: 350 },
      resin:     { price: 18, speed: 5,  setup: 400 },
      resinTough:{ price: 26, speed: 4,  setup: 400 },
      tpu:       { price: 16, speed: 4,  setup: 350 },
    };
    var QUALITY = { draft: 0.7, standard: 1.0, fine: 1.8 };
    var FILL_HEURISTIC = 0.4; // a real object's volume is on average ~40% of its bounding box

    function fmt(n) { return n.toLocaleString("ru-RU"); }

    function recalc() {
      var L = Math.max(1, Number(dimL.value) || 0);
      var W = Math.max(1, Number(dimW.value) || 0);
      var H = Math.max(1, Number(dimH.value) || 0);
      var qty = Math.max(1, Math.min(500, Number(qtyInp.value) || 1));
      var mat = MATS[matSel.value] || MATS.pla;
      var qMul = QUALITY[qSel.value] || 1;

      var bboxCm3 = (L * W * H) / 1000;
      var volCm3 = bboxCm3 * FILL_HEURISTIC;

      // first unit at full material price, each next one at an 8% discount (typical practice, not a guarantee)
      var unitsWeighted = qty === 1 ? 1 : 1 + (qty - 1) * 0.92;
      var total = Math.round(mat.setup + volCm3 * mat.price * unitsWeighted);

      var hours = (volCm3 / mat.speed) * qMul * qty + 0.5 * qty; // + 30 min of post-processing per unit
      var days = Math.max(2, Math.ceil(hours / 8) + 1); // printing at 8h/day + 1 day for QA/packing

      priceOut.textContent = "от " + fmt(total) + " ₽";
      daysOut.textContent = days + (days === 1 ? " день" : days < 5 ? " дня" : " дней");
      volOut.textContent = "≈ " + fmt(Math.round(volCm3)) + " см³ (из " + fmt(Math.round(bboxCm3)) + " см³ габарита)";
    }

    [dimL, dimW, dimH, matSel, qSel, qtyInp].forEach(function (el) {
      el.addEventListener("input", recalc);
      el.addEventListener("change", recalc);
    });
    recalc();
  })();

  /* ══════════════════════════════════════════════════════════════════════
     LEAD FORM: contact-method switch (Telegram ⇄ phone — one real input,
     just its type/placeholder/name change) + a styled drag-and-drop file
     attachment. The pill toggle itself needs no JS — plain radios with a
     CSS :checked+label rule do that; JS only syncs the one real contact
     field to whichever method is selected.
     ══════════════════════════════════════════════════════════════════════ */
  (function initLeadForm() {
    var switchWrap = document.querySelector(".form__switch");
    var contactInput = document.getElementById("fContact");
    if (!switchWrap || !contactInput) return;

    var CONTACT_MODES = {
      tg: { type: "text", name: "telegram", placeholder: "@username или ссылка на профиль" },
      phone: { type: "tel", name: "phone", placeholder: "+7 999 123-45-67" },
    };
    function syncContact() {
      var checked = switchWrap.querySelector("input:checked");
      var mode = CONTACT_MODES[checked ? checked.value : "tg"];
      contactInput.type = mode.type;
      contactInput.name = mode.name;
      contactInput.placeholder = mode.placeholder;
      contactInput.value = "";
    }
    switchWrap.querySelectorAll("input").forEach(function (el) {
      el.addEventListener("change", syncContact);
    });
    syncContact();

    var fileLabel = document.querySelector(".form__file");
    var fileInput = document.getElementById("fFile");
    var fileHint = document.getElementById("fFileHint");
    if (!fileLabel || !fileInput || !fileHint) return;
    var defaultHint = fileHint.textContent;

    function describeFiles() {
      var n = fileInput.files.length;
      if (n === 0) fileHint.textContent = defaultHint;
      else if (n === 1) fileHint.textContent = "Прикреплено: " + fileInput.files[0].name;
      else fileHint.textContent = "Прикреплено файлов: " + n;
    }
    fileInput.addEventListener("change", describeFiles);

    ["dragenter", "dragover"].forEach(function (evt) {
      fileLabel.addEventListener(evt, function (e) { e.preventDefault(); fileLabel.classList.add("is-drag"); });
    });
    ["dragleave", "drop"].forEach(function (evt) {
      fileLabel.addEventListener(evt, function (e) { e.preventDefault(); fileLabel.classList.remove("is-drag"); });
    });
    fileLabel.addEventListener("drop", function (e) {
      var dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length) {
        fileInput.files = dt.files;
        describeFiles();
      }
    });
  })();
})();
