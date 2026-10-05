// Minimal in-browser test runner. A test module exports `tests`: { name: fn }.
// fn may be async; throwing (or a rejected promise) means fail.

export function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

export function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error((msg ? msg + ': ' : '') + 'expected ' + e + ', got ' + a);
}

export async function run(suitePaths) {
  const results = document.getElementById('results');
  const summary = document.getElementById('summary');
  let passed = 0;
  let failed = 0;

  for (const path of suitePaths) {
    const heading = document.createElement('h3');
    heading.textContent = path;
    results.appendChild(heading);

    let mod;
    try {
      mod = await import(path);
    } catch (err) {
      failed++;
      addLine(results, 'fail', 'Could not load suite', err);
      continue;
    }

    for (const [name, fn] of Object.entries(mod.tests || {})) {
      try {
        await fn();
        passed++;
        addLine(results, 'pass', name);
      } catch (err) {
        failed++;
        addLine(results, 'fail', name, err);
      }
    }
  }

  summary.textContent = failed === 0
    ? 'ALL PASSED (' + passed + ')'
    : failed + ' FAILED, ' + passed + ' passed';
  summary.className = failed === 0 ? 'pass' : 'fail';
}

function addLine(parent, cls, name, err) {
  const div = document.createElement('div');
  div.className = cls;
  div.textContent = (cls === 'pass' ? '✓ ' : '✗ ') + name;
  parent.appendChild(div);
  if (err) {
    const pre = document.createElement('pre');
    pre.textContent = String(err && err.stack || err);
    parent.appendChild(pre);
  }
}
