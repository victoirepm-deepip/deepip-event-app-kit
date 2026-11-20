/*
 * The capture form, and the one thing a Node test cannot see.
 *
 *   node tests/capture-form.test.js
 *
 * A seller at Paris held the keyboard microphone, spoke, and lost sight of the
 * words. The cause was the viewport, not the code that renders the field, so
 * most of this file asserts on source text rather than on behaviour — the only
 * honest thing a test without a browser can do about a viewport.
 *
 * growField() is the exception: it is arithmetic, so it runs here against a
 * fake element and the clamp is checked for real.
 *
 * None of this replaces dictating for thirty seconds on a phone. Typing has
 * never reproduced the bug, which is exactly why it survived every test.
 */
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log("  ok   " + n); }
                       else { fail++; console.log("  FAIL " + n); } };
const head = t => console.log("\n" + t);

head("The keyboard must shrink the layout viewport, not slide the page under it");
{
  const html = read("index.html");
  const meta = (html.match(/<meta name="viewport"[^>]*>/) || [""])[0];
  ok("the viewport meta exists", !!meta);
  ok("it asks the keyboard to resize the content", /interactive-widget=resizes-content/.test(meta));
  ok("it still covers the notch", /viewport-fit=cover/.test(meta));
}

head("The field grows to what it holds, and stops");
{
  const src = read("app.js");
  ok("growField is defined", /function growField\(/.test(src));
  ok("it is called on every input", /addEventListener\("input", e => \{\s*growField\(e\.target\);/.test(src));
  ok("and on focusin, which bubbles where focus does not", /addEventListener\("focusin", e => growField\(e\.target\)\)/.test(src));
  ok("it scrolls only when the field has left the screen", /block: "nearest"/.test(src));

  // The arithmetic, for real.
  const body = src.slice(src.indexOf("function growField("), src.indexOf("// focusin bubbles"));
  const growField = new Function("window", body + "\nreturn growField;")({ innerHeight: 800 });
  const el = (scrollHeight, tag = "TEXTAREA") => {
    let h = ""; let scrolled = false;
    return { tagName: tag, scrollHeight, style: { set height(v) { h = v; }, get height() { return h; } },
             scrollIntoView() { scrolled = true; }, get scrolled() { return scrolled; } };
  };
  const small = el(120); growField(small);
  ok("a short note sizes to its content", small.style.height === "120px");
  ok("and is scrolled back into view", small.scrolled);

  const long = el(5000); growField(long);
  ok("a long dictation is capped at 40% of the screen", long.style.height === "320px");

  const notATextarea = el(5000, "INPUT"); growField(notATextarea);
  ok("a text input is left alone", notATextarea.style.height === "");
  ok("and nothing throws on a null target", (() => { try { growField(null); return true; } catch (e) { return false; } })());
}

head("The cap is also in the stylesheet, so a slow script cannot hide the Save button");
{
  const css = read("styles.css");
  ok("the note field has a maximum height", /\.hook textarea\{[^}]*max-height:40vh/s.test(css));
  ok("and scrolls inside itself past it", /\.hook textarea\{[^}]*overflow-y:auto/s.test(css));
}

head("The form still renders a note field at all");
{
  ok("ui.js renders the textarea", /<textarea id="cap-hook"/.test(read("ui.js")));
}

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
