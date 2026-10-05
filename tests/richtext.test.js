import { assert, assertEqual } from './runner.js';
import { sanitizeHtml, htmlToPlain, plainToHtml, notesHtmlOf } from '../js/ui/richText.js';
import { createPhysics, setMotion, MOTION, MOTION_KEYS } from '../js/ui/physics.js';
import { PRESETS } from '../js/ui/motionPanel.js';
import { applyItemPatch, sanitizeCanvas, newCanvas } from '../js/core/model.js';

const allOn = () => setMotion(Object.fromEntries(MOTION_KEYS.map(k => [k, true])));

export const tests = {
  'rich text: keeps bold/italic/underline/heading/lists, drops everything else': () => {
    const html = sanitizeHtml('<p><strong>B</strong> <em>i</em> <u>u</u></p><h1>T</h1><ul data-b="star"><li>a</li></ul><ol><li>1</li></ol>');
    assertEqual(html, '<div><b>B</b> <i>i</i> <u>u</u></div><h3>T</h3><ul data-b="star"><li>a</li></ul><ol><li>1</li></ol>');
  },

  'rich text: scripts, handlers, links, styles and unknown bullet types never survive': () => {
    const html = sanitizeHtml('<img src=x onerror=alert(1)><script>alert(2)</script><a href="javascript:x" style="color:red">link</a><b onclick="x()">b</b><ul data-b="evil" class="c"><li>x</li></ul><iframe src="//x"></iframe>');
    assert(!/script|onerror|onclick|href|style|class|img|iframe|evil/i.test(html), html);
    assert(html.includes('link') && html.includes('<b>b</b>') && html.includes('<ul><li>x</li></ul>'), html);
  },

  'rich text: plain text has one line per block and bullet symbols': () => {
    assertEqual(htmlToPlain('<h3>Shop</h3><ul data-b="tick"><li>milk</li><li>eggs</li></ul><ol><li>one</li></ol>end'), 'Shop\n✓ milk\n✓ eggs\n1. one\nend');
    assertEqual(htmlToPlain('a<br>b'), 'a\nb');
  },

  'rich text: old plain descriptions are shown safely': () => {
    assertEqual(plainToHtml('a < b\nc'), 'a &lt; b<br>c');
    assertEqual(notesHtmlOf({ notes: 'x\ny', notesHtml: '' }), 'x<br>y');
    assertEqual(notesHtmlOf({ notes: 'x', notesHtml: '<b onclick=1>x</b>' }), '<b>x</b>');
  },

  'rich text: the model stores notesHtml (capped) and repairs bad values': () => {
    const it = { notesHtml: '' };
    assert(applyItemPatch(it, { notesHtml: '<b>x</b>' }));
    assertEqual(it.notesHtml, '<b>x</b>');
    const d = newCanvas('x');
    d.items.a = { id: 'a', parentId: null, title: 't', notes: '', notesHtml: 42, color: '#ff8a7a' };
    sanitizeCanvas(d);
    assertEqual(d.items.a.notesHtml, '');
  },

  'motion: switched-off effects do nothing; positions are untouched': () => {
    const layer = document.createElement('div');
    const body = document.createElement('div');
    layer.append(body);
    document.body.append(layer);
    const h = createPhysics(layer, body, 7);
    try {
      setMotion({ ...PRESETS.off });
      h.spawn();
      h.glideFrom(50, 0);
      h.poke(0.2);
      h.resized({ w: 100, h: 100 }, { w: 200, h: 200 });
      assertEqual(layer.style.transform, '', 'no birth / glide / bounce transform');
      h.setRoundness(0.3);
      assertEqual(h.visual().rd, 0.3, 'roundness jumps instead of morphing');
      assert(!MOTION.wobble && !MOTION.lines);
    } finally {
      h.dispose();
      layer.remove();
      allOn();
    }
  },

  'motion: presets — Light switches off only the continuous effects': () => {
    assertEqual(MOTION_KEYS.filter(k => !PRESETS.light[k]).sort(), ['bob', 'drawGoo', 'lines', 'wobble']);
    assert(MOTION_KEYS.every(k => PRESETS.full[k] && !PRESETS.off[k]));
  }
};
