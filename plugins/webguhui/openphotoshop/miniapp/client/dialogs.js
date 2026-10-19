export function createDialogs(dialog, status) {
  let generation = 0;
  function modal(title, fields, onOk, ok = '确定') {
    const current = ++generation;
    dialog.close();
    // A successful action can open the next dialog while old controls are disabled.
    for (const control of dialog.querySelectorAll('button')) control.disabled = false;
    dialog.querySelector('#dialog-title').textContent = title;
    const body = dialog.querySelector('#dialog-body'),
      apply = dialog.querySelector('#dialog-ok');
    const error = document.createElement('p');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    body.replaceChildren(...fields, error);
    apply.textContent = ok;
    apply.disabled = false;
    let pending = false;
    dialog.oncancel = (e) => {
      if (pending) e.preventDefault();
    };
    apply.onclick = async () => {
      if (pending) return;
      pending = true;
      error.hidden = true;
      const controls = [...dialog.querySelectorAll('button,input,select,textarea')].map(
        (element) => [element, element.disabled],
      );
      controls.forEach(([element]) => (element.disabled = true));
      apply.textContent = '处理中…';
      try {
        const result = await onOk();
        if (current === generation && result !== false) dialog.close();
      } catch (e) {
        if (current === generation) {
          error.textContent = e.message || '操作失败，请重试';
          error.hidden = false;
          status(error.textContent, true);
        }
      } finally {
        if (current === generation) {
          pending = false;
          controls.forEach(([element, disabled]) => (element.disabled = disabled));
          apply.textContent = ok;
        }
      }
    };
    dialog.showModal();
  }
  return { modal };
}
export function field(label, value, type = 'number', attrs = {}) {
  const row = document.createElement('label');
  row.textContent = label;
  const input = document.createElement('input');
  input.type = type;
  Object.assign(input, attrs);
  // Range inputs clamp and round immediately; configure their bounds before setting the value.
  input.value = value;
  row.append(input);
  return [row, input];
}
export function note(text) {
  const p = document.createElement('p');
  p.textContent = text;
  return p;
}
