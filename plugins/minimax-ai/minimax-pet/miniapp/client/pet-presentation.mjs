export function aggregateText(counts) {
  if (!counts) return '';
  return `${counts.total} 个可见任务 · ${counts.running} 运行中 · ${counts.completed} 本次完成 · ${counts.error} 异常 · ${counts.aborted} 已停止 · ${counts.idle} 空闲`;
}

export function notificationItems(items) {
  return items.filter((item) => item.needsAnswer === true || ['completed', 'error'].includes(item.displayStatus))
    .sort((a, b) => Number(b.needsAnswer === true) - Number(a.needsAnswer === true)).slice(0, 3);
}

export function notificationText(item, previews = {}) {
  if (item.needsAnswer === true) return '需要你回答';
  return previews[item.sessionId] || (item.displayStatus === 'error' ? '任务出现异常' : '本次观察到任务完成');
}

// A task snapshot may refresh while its animation has already settled into calm idle.
export function createAnimationGate(player, onError = () => {}) {
  let previous = null;
  return {
    apply(state, key, { loop = false } = {}) {
      const identity = `${key}:${state}:${loop}`;
      if (previous === identity && player.state === state) return false;
      previous = identity;
      void player.play(state, { loop }).catch(onError);
      return true;
    },
    invalidate() { previous = null; },
  };
}
