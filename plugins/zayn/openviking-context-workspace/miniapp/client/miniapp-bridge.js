(() => {
  const root = document.createElement('div')
  root.className = 'mcode-context-bridge'
  root.innerHTML = [
    '<button type="button" class="mcode-context-bridge__button">',
    '<span aria-hidden="true">↗</span>',
    '<span>Send to MiniMax Code</span>',
    '</button>',
    '<div class="mcode-context-bridge__status" role="status" aria-live="polite"></div>',
  ].join('')
  document.body.append(root)

  const button = root.querySelector('.mcode-context-bridge__button')
  const status = root.querySelector('.mcode-context-bridge__status')
  let statusTimer

  const showStatus = (message, tone = 'neutral') => {
    clearTimeout(statusTimer)
    status.textContent = message
    status.dataset.tone = tone
    status.classList.add('is-visible')
    statusTimer = setTimeout(() => status.classList.remove('is-visible'), 3200)
  }

  const buildHandoff = () => {
    const selection = String(window.getSelection?.() || '').trim()
    const uri = selection.match(/viking:\/\/[^\s<>'"\])}]+/i)?.[0]
      || decodeURIComponent(location.href).match(/viking:\/\/[^\s&#]+/i)?.[0]
    const lines = [
      'Use this OpenViking Studio context for the current task:',
      uri ? `Resource: ${uri}` : `Studio view: ${location.pathname}${location.search}${location.hash}`,
    ]
    if (selection) lines.push('', 'Selected content:', selection.slice(0, 12000))
    return lines.join('\n')
  }

  button.addEventListener('click', async () => {
    const text = buildHandoff()
    const append = window.mcode?.miniapp?.message?.append
    button.disabled = true
    try {
      if (append) {
        await append(text)
        showStatus('Added to chat draft. Review it and press Send.', 'success')
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        showStatus('Browser preview: copied handoff to clipboard.', 'success')
      } else {
        showStatus('Open this Studio inside MiniMax Code to add context.', 'warning')
      }
    } catch (error) {
      const message = error?.message === 'user_cancelled'
        ? 'Cancelled.'
        : `Could not add context (${error?.message || 'unknown error'}).`
      showStatus(message, 'warning')
    } finally {
      button.disabled = false
    }
  })
})()
