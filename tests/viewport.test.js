const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const fn = source.slice(source.indexOf('  function syncViewportHeight()'), source.indexOf('  function settleViewportHeight()'));
const values = [];
let editing = false;
const context = {
  window: { matchMedia: () => ({ matches: false }), navigator: {}, CSS: { supports: () => true }, innerHeight: 800, visualViewport: { height: 700, scale: 1 } },
  document: { activeElement: { matches: () => editing }, documentElement: { style: { setProperty: (name, value) => values.push(value) } } }
};
vm.createContext(context);
vm.runInContext(fn, context);
context.syncViewportHeight();
assert.equal(values.at(-1), '700px');
context.window.visualViewport.height = 780;
context.syncViewportHeight();
assert.equal(values.at(-1), '780px');
context.window.visualViewport.scale = 2;
context.syncViewportHeight();
assert.equal(values.length, 2);
context.window.visualViewport.scale = 1;
editing = true;
context.syncViewportHeight();
assert.equal(values.length, 2);
editing = false;
delete context.window.visualViewport;
context.syncViewportHeight();
assert.equal(values.at(-1), '800px');
console.log('PASS: Initial viewport, height changes, zoom/keyboard guards, fallback');

context.window.matchMedia = () => ({ matches: true });
context.window.visualViewport = { height: 640, scale: 1 };
context.syncViewportHeight();
assert.equal(values.at(-1), '100lvh');
context.window.matchMedia = () => ({ matches: false });
context.window.navigator.standalone = true;
context.syncViewportHeight();
assert.equal(values.at(-1), '100lvh');
context.window.CSS.supports = () => false;
context.syncViewportHeight();
assert.equal(values.at(-1), '640px');
console.log('PASS: Installed-app viewport ignores stale visual height, including iOS standalone and legacy fallback');
