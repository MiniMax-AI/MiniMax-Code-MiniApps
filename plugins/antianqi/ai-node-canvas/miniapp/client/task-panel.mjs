// The parts of the progress panel that are the panel's own.
//
// The panel sits over the canvas, so the user has to be able to put it away:
// the title row carries a button that says so. The row is built here — with
// the document handed to it — so what the button asks for is one thing in one
// place, and it can be tested without a browser.

/**
 * The title row of the progress panel.
 *
 * The row holds the name of the panel and the button that puts it away. The
 * button only asks: what happens to the panel is the page's business.
 *
 * @param {Document} doc the document the row is built in
 * @param {{label?: string, closeLabel?: string, onPutAway?: () => void}} options
 * @returns {HTMLElement} the title row
 */
export function panelTitleRow(doc, { label = '运行进度', closeLabel = '收起', onPutAway = null } = {}) {
  const row = doc.createElement('div');
  row.className = 'nxc-taskpanel__title';

  const caption = doc.createElement('span');
  caption.textContent = label;
  row.appendChild(caption);

  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'nxc-taskpanel__close';
  close.textContent = closeLabel;
  close.addEventListener('click', (event) => {
    event?.stopPropagation?.();
    onPutAway?.();
  });
  row.appendChild(close);

  return row;
}
