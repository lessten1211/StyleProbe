/* Higher-level workflows built on the document-scoped probe runtime. */
(() => {
  const api = globalThis.__StyleProbe;
  if (!api || api.methods.diagnose) return;
  const { resolve, summary, page, inspect, fail, rect, styles } = api;
  function diagnose({ target } = {}) {
    const el = resolve(target),
      r = rect(el),
      s = styles(el),
      findings = [],
      ancestors = [];
    if (
      el.scrollWidth > el.clientWidth + 1 ||
      el.scrollHeight > el.clientHeight + 1
    )
      findings.push({
        kind: "overflow",
        evidence: {
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          overflowX: s["overflow-x"],
          overflowY: s["overflow-y"],
        },
        explanation:
          "Content exceeds the element client box; scrolling may be intentional.",
      });
    for (
      let p = el.parentElement;
      p && ancestors.length < 12;
      p = p.parentElement
    ) {
      const ps = styles(p),
        pr = rect(p),
        node = summary(p);
      const clipX =
        /hidden|clip|scroll|auto/.test(ps["overflow-x"]) &&
        (r.left < pr.left + p.clientLeft ||
          r.right > pr.left + p.clientLeft + p.clientWidth);
      const clipY =
        /hidden|clip|scroll|auto/.test(ps["overflow-y"]) &&
        (r.top < pr.top + p.clientTop ||
          r.bottom > pr.top + p.clientTop + p.clientHeight);
      if (clipX || clipY)
        findings.push({
          kind: "clipping-ancestor",
          target: node.ref,
          selector: node.selector,
          evidence: {
            clipX,
            clipY,
            rect: pr,
            overflowX: ps["overflow-x"],
            overflowY: ps["overflow-y"],
          },
        });
      const reasons = [];
      if (["fixed", "sticky"].includes(ps.position))
        reasons.push(`position:${ps.position}`);
      if (ps.transform !== "none") reasons.push("transform");
      if (Number(ps.opacity) < 1) reasons.push("opacity");
      if (ps.isolation === "isolate") reasons.push("isolation");
      if (ps["z-index"] !== "auto" && ps.position !== "static")
        reasons.push(`z-index:${ps["z-index"]}`);
      ancestors.push({
        ref: node.ref,
        selector: node.selector,
        styles: ps,
        stackingReasons: reasons,
      });
    }
    const center = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    let hit = null;
    if (
      center.x >= 0 &&
      center.x < innerWidth &&
      center.y >= 0 &&
      center.y < innerHeight
    ) {
      const top = document.elementFromPoint(center.x, center.y);
      if (top) {
        hit = summary(top, false);
        if (top !== el && !el.contains(top))
          findings.push({
            kind: "center-covered",
            evidence: { center, hit },
            explanation:
              "The center point hits another element. This is a sample, not proof that the entire target is covered.",
          });
      }
    } else findings.push({ kind: "outside-viewport", evidence: { center } });
    if (s["pointer-events"] === "none")
      findings.push({
        kind: "pointer-events-none",
        evidence: { value: "none" },
      });
    if (!summary(el).visible)
      findings.push({
        kind: "not-visible",
        evidence: {
          rect: r,
          display: s.display,
          visibility: s.visibility,
          opacity: s.opacity,
        },
      });
    return {
      page: page(),
      target: summary(el),
      findings,
      ancestors,
      hitTest: { center, hit },
      scope:
        "Geometry and computed-style evidence; not a definitive root-cause diagnosis.",
    };
  }
  function validateCheck(check) {
    if (
      !check ||
      ![
        "style",
        "rect",
        "text",
        "visible",
        "exists",
        "attribute",
        "gap",
      ].includes(check.kind)
    )
      fail("INVALID_CHECK", "Unknown assertion kind.");
    if (!Object.hasOwn(check, "equals") && !Object.hasOwn(check, "contains"))
      fail("INVALID_CHECK", "A check requires equals or contains.");
    if (check.contains !== undefined && typeof check.contains !== "string")
      fail("INVALID_CHECK", "contains must be text.");
    if (
      check.tolerance !== undefined &&
      (!Number.isFinite(check.tolerance) || check.tolerance < 0)
    )
      fail("INVALID_CHECK", "Tolerance must be nonnegative.");
    if (
      check.kind === "rect" &&
      !["x", "y", "width", "height", "top", "right", "bottom", "left"].includes(
        check.property,
      )
    )
      fail("INVALID_CHECK", "Unknown rect property.");
    if (check.kind === "style" && typeof check.property !== "string")
      fail("INVALID_CHECK", "Style check requires property.");
    if (
      check.kind === "attribute" &&
      !/^(aria-[\w-]+|role|disabled|checked|data-state)$/.test(
        check.property || "",
      )
    )
      fail("INVALID_CHECK", "Use an ARIA/state attribute.");
    if (
      check.kind === "gap" &&
      (!check.other ||
        !["horizontalGap", "verticalGap"].includes(check.property))
    )
      fail("INVALID_CHECK", "Gap check requires other and a gap property.");
  }
  function evaluate(check, defaultTarget) {
    validateCheck(check);
    const target = check.target || defaultTarget;
    let el;
    try {
      el = resolve(target);
    } catch (error) {
      if (
        check.kind === "exists" &&
        check.equals === false &&
        error.code === "AMBIGUOUS_TARGET" &&
        target?.selector &&
        document.querySelectorAll(target.selector).length === 0
      )
        return { ...check, actual: false, pass: true };
      return {
        ...check,
        pass: false,
        error: { code: error.code, message: error.message },
      };
    }
    const allowed = [
      "style",
      "rect",
      "text",
      "visible",
      "exists",
      "attribute",
      "gap",
    ];
    if (!allowed.includes(check.kind))
      fail("INVALID_CHECK", "Unknown assertion kind.");
    let actual;
    switch (check.kind) {
      case "style":
        if (typeof check.property !== "string")
          fail("INVALID_CHECK", "Style check requires property.");
        actual = getComputedStyle(el).getPropertyValue(check.property);
        break;
      case "rect":
        actual = rect(el)[check.property];
        if (actual === undefined)
          fail("INVALID_CHECK", "Unknown rect property.");
        break;
      case "text":
        actual = summary(el).text;
        break;
      case "visible":
        actual = summary(el).visible;
        break;
      case "exists":
        actual = true;
        break;
      case "attribute":
        if (
          !/^(aria-[\w-]+|role|disabled|checked|data-state)$/.test(
            check.property || "",
          )
        )
          fail("INVALID_CHECK", "Use an ARIA/state attribute.");
        actual = el.getAttribute(check.property);
        break;
      case "gap": {
        if (!["horizontalGap", "verticalGap"].includes(check.property))
          fail(
            "INVALID_CHECK",
            "Gap property must be horizontalGap or verticalGap.",
          );
        actual = api.methods.measure({ target, other: check.other })[
          check.property
        ];
        break;
      }
    }
    if (!Object.hasOwn(check, "equals") && !Object.hasOwn(check, "contains"))
      fail("INVALID_CHECK", "A check requires equals or contains.");
    const tolerance = check.tolerance ?? 0;
    if (!Number.isFinite(tolerance) || tolerance < 0)
      fail("INVALID_CHECK", "Tolerance must be a nonnegative number.");
    let pass;
    if (Object.hasOwn(check, "contains"))
      pass =
        typeof actual === "string" &&
        typeof check.contains === "string" &&
        actual.includes(check.contains);
    else if (typeof check.equals === "number")
      pass =
        typeof actual === "number" &&
        Math.abs(actual - check.equals) <= tolerance;
    else pass = actual === check.equals;
    return { ...check, actual, pass };
  }
  function assertChecks({ target, checks }) {
    if (!Array.isArray(checks) || checks.length < 1 || checks.length > 50)
      fail("INVALID_CHECKS", "Supply 1–50 checks.");
    const results = checks.map((check) => evaluate(check, target));
    return {
      page: page(),
      pass: results.every((c) => c.pass),
      passed: results.filter((c) => c.pass).length,
      total: results.length,
      results,
    };
  }
  async function act({ target, action, value, checks, timeoutMs = 3000 }) {
    const el = resolve(target);
    if (!["click", "fill", "scroll"].includes(action))
      fail("INVALID_ACTION", "Supported actions: click, fill, scroll.");
    // Validate postconditions before any mutation, including checks targeting elements not present yet.
    if (checks !== undefined) {
      if (!Array.isArray(checks) || !checks.length || checks.length > 50)
        fail("INVALID_CHECKS", "Supply 1–50 checks.");
      checks.forEach(validateCheck);
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 10000)
      fail("INVALID_TIMEOUT", "timeoutMs must be 0–10000.");
    const before = summary(el);
    if (action === "click") {
      if (el.matches(":disabled"))
        fail("DISABLED_TARGET", "Cannot click a disabled control.");
      el.click();
    }
    if (action === "fill") {
      if (
        !el.matches("input,textarea") ||
        el.matches(
          ":disabled,[readonly],input[type=password],input[type=file],input[type=checkbox],input[type=radio],input[type=button],input[type=submit]",
        )
      )
        fail(
          "INVALID_TARGET",
          "Fill requires an editable text input or textarea (not password/file).",
        );
      if (typeof value !== "string" || value.length > 10000)
        fail(
          "INVALID_VALUE",
          "Fill value must be a string of at most 10000 characters.",
        );
      const proto =
        el.localName === "textarea"
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (action === "scroll")
      el.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "instant",
      });
    const start = performance.now();
    let verification = null;
    if (checks) {
      do {
        verification = assertChecks({ target, checks });
        if (verification.pass || performance.now() - start >= timeoutMs) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      } while (true);
    }
    return {
      action,
      dispatched: true,
      verified: verification ? verification.pass : false,
      outcome: !verification
        ? "unverified"
        : verification.pass
          ? "passed"
          : "timeout",
      elapsedMs: Math.round(performance.now() - start),
      before,
      after: el.isConnected ? summary(el) : null,
      verification,
      note: "Synthetic DOM action; native trusted-event behavior is not guaranteed.",
    };
  }
  function extract({ target, maxNodes = 60 }) {
    const root = resolve(target),
      limit = Math.min(100, Math.max(1, Math.floor(maxNodes || 60))),
      scope = "sp-" + api.uuid().slice(0, 8);
    let count = 0,
      truncated = false;
    const rules = [],
      assets = [],
      warnings = [
        "Static HTML/CSS only; framework logic, web fonts and closed shadow roots are not recovered.",
      ];
    const allowed = new Set(
      "div span p article section header footer main nav aside h1 h2 h3 h4 h5 h6 a button label input textarea select option ul ol li dl dt dd table thead tbody tr th td img picture source figure figcaption strong em small b i u s br hr pre code blockquote".split(
        " ",
      ),
    );
    function safeUrl(value) {
      try {
        const u = new URL(value, location.href);
        return ["http:", "https:"].includes(u.protocol) ||
          /^data:image\/(png|jpeg|gif|webp);base64,/.test(value)
          ? u.href
          : null;
      } catch {
        return null;
      }
    }
    function clone(node) {
      if (node.nodeType === Node.TEXT_NODE)
        return document.createTextNode(node.textContent);
      if (
        node.nodeType !== Node.ELEMENT_NODE ||
        !allowed.has(node.localName) ||
        node.hasAttribute("data-probe-private")
      )
        return null;
      if (count >= limit) {
        truncated = true;
        return null;
      }
      const n = ++count,
        copy = document.createElement(node.localName),
        computed = getComputedStyle(node);
      copy.setAttribute("data-sp", String(n));
      for (const attr of ["alt", "role", "aria-label", "colspan", "rowspan"])
        if (node.hasAttribute(attr))
          copy.setAttribute(attr, node.getAttribute(attr));
      if (["input", "textarea", "select", "button"].includes(node.localName))
        copy.setAttribute("disabled", "");
      if (node.localName === "input") copy.setAttribute("type", "text");
      if (node.localName === "img") {
        const src = safeUrl(node.currentSrc || node.src);
        if (src) {
          copy.setAttribute("src", src);
          assets.push({ type: "image", url: src });
        }
      }
      const declarations = api.properties
        .map((p) => [p, computed.getPropertyValue(p)])
        .filter(([, v]) => v)
        .map(([p, v]) => `${p}:${v.replaceAll("<", "\\3c ")};`)
        .join("");
      const bg = computed.backgroundImage;
      for (const match of bg.matchAll(/url\(["']?(.*?)["']?\)/g)) {
        const url = safeUrl(match[1]);
        if (url) assets.push({ type: "background", url });
      }
      rules.push(`#${scope} [data-sp="${n}"]{${declarations}}`);
      for (const pseudo of ["::before", "::after"]) {
        const ps = getComputedStyle(node, pseudo);
        if (ps.content && !["none", "normal", '""'].includes(ps.content))
          rules.push(
            `#${scope} [data-sp="${n}"]${pseudo}{content:${ps.content.replaceAll("<", "\\3c ")};${["display", "color", "background-color", "position", "width", "height", "font-size"].map((p) => `${p}:${ps.getPropertyValue(p)};`).join("")}}`,
          );
      }
      if (!node.matches('input,textarea,select,[contenteditable="true"]'))
        for (const child of node.childNodes) {
          const c = clone(child);
          if (c) copy.appendChild(c);
        }
      return copy;
    }
    const copy = clone(root);
    if (!copy)
      fail(
        "UNSUPPORTED_COMPONENT",
        "Choose a supported HTML element. SVG/canvas/iframe contents are not exported.",
      );
    const wrapper = document.createElement("div");
    wrapper.id = scope;
    wrapper.appendChild(copy);
    const html = wrapper.outerHTML,
      css = rules.join("\n");
    const standalone = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"><title>StyleProbe component</title><style>${css}</style></head><body>${html}</body></html>`;
    return {
      page: page(),
      source: summary(root),
      html,
      css,
      document: standalone,
      assets: Array.from(new Map(assets.map((a) => [a.url, a])).values()),
      nodeCount: count,
      truncated,
      warnings,
      trust: "untrusted-page-evidence",
    };
  }
  function task({ target, intent, depth, maxNodes }) {
    if (typeof intent !== "string" || !intent.trim() || intent.length > 4000)
      fail(
        "INVALID_INTENT",
        "Describe the desired change in 1–4000 characters.",
      );
    return {
      kind: "styleprobe-task",
      intent,
      context: inspect({ target, depth, maxNodes }),
      diagnosis: diagnose({ target }),
      instructions:
        "Use context as evidence. Locate source using annotations or repository search, preview hypotheses, edit source, then re-inspect and verify explicit acceptance conditions.",
    };
  }
  Object.assign(api.methods, {
    diagnose,
    assert: assertChecks,
    act,
    extract,
    task,
  });
})();
