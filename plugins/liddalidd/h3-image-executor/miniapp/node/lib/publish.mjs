// 分享页发布：把自包含 HTML 部署成公开链接。
//
// 为什么必须绕道 Agent turn：Mini App 的 context 只有 agent / capabilities / hostConnector /
// listen / logger / tool 六个成员，**没有任何 drive / upload / storage 能力**，页面和服务端
// 自己绝对做不到部署。而 website_deploy 是 Host 的「顶层控制工具」，只下发给 Agent turn——
// context.tool（Connector / MCP）够不到它。所以唯一通路是 context.agent.run 起一个 turn，
// 让那个 turn 去调 website_deploy，我们从它的最终回复里把公开地址捞出来。
//
// 权限：website_deploy 会触发 permission.requested。这一条**不能自己放行**：点「发布」只说明
// 用户想发布，不等于批准这一次工具调用（docs/security.md：Never answer allowOnce automatically）。
// 所以把它交给 onPermission，由页面上的确认卡片让用户点「允许一次」或「拒绝」。
// 其余工具一律自动 deny（拒绝可以自动），免得这个节点变成通用执行面。
// 问卷请求（question.requested）不能自动答：没人回答会一直挂着，所以直接中断整轮。
import { AGENT_OFF_HINT, isNotPermitted } from './agent.mjs';

// 部署地址的形状：Host 返回 *.space.mcode.cn。从自由文本里捞地址必须锚定域名，
// 否则 agent 回复里任何一条 http 链接（文档、报错、它自己举的例子）都会被误当成部署结果。
const DEPLOY_URL_RE = /https:\/\/[a-z0-9][a-z0-9-]*\.space\.mcode\.cn(?:\/[^\s"'<>`）】，。；、]*)?/i;

// 一次发布的上限。3MB 的页面上传本身不慢，但这个 turn 要先起会话、跑模型、再调工具，
// 实测量级在分钟级。给 6 分钟，超过了就当失败——用户可以再点一次。
const DEFAULT_TIMEOUT_MS = 6 * 60 * 1000;

export function buildPublishPrompt({ htmlPath, projectName, note }) {
  return [
    '把一个已经生成好的自包含 HTML 页面发布成公开链接。这是一次纯执行任务，不要规划、不要提问、不要做发布以外的任何事。',
    '',
    '待发布的文件（绝对路径，已经在磁盘上）：',
    htmlPath,
    '',
    '严格按下面四步做：',
    '',
    '1. 运行 pwd，确认你当前的工作目录。',
    '2. 在工作目录下建一个子目录 h3-share-publish，把文件拷进去：',
    '   mkdir -p h3-share-publish && cp ' + JSON.stringify(htmlPath) + ' h3-share-publish/index.html',
    '   注意：website_deploy 只接受工作目录以内的路径，直接把上面那个绝对路径传给它会被拒绝',
    '   （报 Cannot deploy: ... is outside the workspace or invalid）。所以必须先拷进工作目录。',
    '   另外不要用 mv 或 rm，权限门会把它们当成删除操作拦下来；只用 cp。',
    '3. 调用 website_deploy，三个参数这样填：',
    '   path = h3-share-publish',
    '   source_path = h3-share-publish',
    '   project_name = ' + JSON.stringify(projectName),
    '4. 拿到返回的公开地址后，**最后一行只输出那个 https 地址本身**，不要加任何解释、',
    '   不要加 markdown、不要加句号。前面几行你爱写什么都行，但最后一行必须是纯地址。',
    '',
    '不要做的事：不要修改这个 HTML 的内容；不要部署任何别的文件；不要创建 PR 或提交代码；',
    '不要调用 ask_user 或任何问卷工具（这个任务没有需要用户决定的事）。',
    note ? '' : null,
    note ? '补充说明：' + note : null,
  ].filter((line) => line !== null).join('\n');
}

// 从 turn 的最终回复里捞部署地址。找不到就是失败——宁可报错也不能把一个不相干的
// 链接当成发布成功写回会话，用户会拿着它去分享。
export function extractDeployUrl(text) {
  const value = String(text == null ? '' : text);
  const hit = DEPLOY_URL_RE.exec(value);
  if (!hit) return null;
  // 结尾的标点是句法的一部分，不是地址的一部分：agent 常写成「地址。」或「地址）。」
  return hit[0].replace(/[).,;:'"\]】）]+$/, '');
}

// 给页面确认卡片看的说明：发出去的是什么、谁能看到，以及 Agent 实际要传给工具的参数。
function describeDeployRequest(event) {
  const parts = ['允许后，分享页会被发布成公开网址，任何拿到链接的人都能打开。'];
  if (event.reason) parts.push(String(event.reason));
  if (event.toolInput && typeof event.toolInput === 'object') {
    try {
      parts.push('参数：' + JSON.stringify(event.toolInput).slice(0, 300));
    } catch {
      /* 参数展示不出来就不展示，不影响确认 */
    }
  }
  return parts.join(' ');
}

export async function publishHtml({ context, htmlPath, projectName, note, timeoutMs, onProgress, onPermission }) {
  if (!context || !context.agent || typeof context.agent.run !== 'function') {
    return { ok: false, error: 'agent_unavailable' };
  }
  const limit = Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  // 问卷中断和超时都会 abort 同一个 signal，光看 signal.aborted 分不出是哪种。
  // 失败原因要能直接告诉用户「是它问了问题」还是「是它太慢」，所以单独记一份。
  let abortReason = null;
  const timer = setTimeout(() => {
    abortReason = 'publish_timeout';
    controller.abort();
  }, limit);
  const started = Date.now();
  const tools = [];
  let denied = 0;

  const report = (text, extra) => {
    if (typeof onProgress === 'function') onProgress(text, extra || {});
  };

  try {
    report('开始发布，正在起一个 Agent 会话');
    const result = await context.agent.run(
      { text: buildPublishPrompt({ htmlPath, projectName, note }) },
      {
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === 'permission.requested') {
            const tool = String(event.toolName || '');
            // 部署本身交给用户在页面上确认；没有页面可问（onPermission 缺失）时按拒绝处理。
            if (tool === 'website_deploy' && typeof onPermission === 'function') {
              report('等待你在页面上确认 website_deploy：点「允许一次」后才会真正发布', { level: 'warn' });
              onPermission({
                requestId: event.requestId,
                sessionId: event.sessionId,
                toolName: tool,
                reason: describeDeployRequest(event),
              });
              return;
            }
            // 其余工具（shell、文件写入、别的控制工具）一律拒绝：
            // 这个节点的职责就是发一个页面，放行别的等于给了一个不受控的执行面。
            denied += 1;
            report('拒绝非部署工具调用：' + (tool || '未知'), { level: 'warn' });
            void Promise.resolve(
              context.agent.reply({
                sessionId: event.sessionId,
                requestId: event.requestId,
                decision: 'deny',
              }),
            ).catch(() => { /* 请求可能已经自己结束了 */ });
            return;
          }
          if (event.type === 'question.requested') {
            // 没人能回答问卷，这一轮会一直挂着。直接中断，让用户看到明确失败而不是转圈。
            report('发布会话发起了提问，已中断（发布任务不应该需要提问）', { level: 'warn' });
            abortReason = 'publish_asked_question';
            controller.abort();
            return;
          }
          if (event.type === 'tool.started') {
            const name = event.toolName || event.name || '未知工具';
            tools.push({ name, at: Date.now() - started });
            report('调用工具 ' + name);
          }
        },
      },
    );

    const ms = Date.now() - started;
    if (result && result.status === 'aborted') {
      // 不是我们自己中断的（超时 / 提问），多半是用户在插件详情里关掉了 Agent 权限，或在别处停掉了它。
      const reason = abortReason || 'publish_aborted：Agent 回合被中止。如果你关闭了 Agent 权限，' + AGENT_OFF_HINT;
      return { ok: false, error: reason, ms, tools };
    }
    if (!result || result.status !== 'finished') {
      const info = result && result.error;
      const detail = info ? [info.code, info.message].filter(Boolean).join(' ') : '';
      return { ok: false, error: 'publish_turn_failed' + (detail ? '：' + detail : ''), ms, tools };
    }
    const url = extractDeployUrl(result.text);
    if (!url) {
      return { ok: false, error: 'publish_no_url', ms, tools, text: String(result.text || '').slice(0, 400) };
    }
    return { ok: true, url, ms, tools, denied, text: String(result.text || '').slice(0, 400) };
  } catch (error) {
    const ms = Date.now() - started;
    if (abortReason) return { ok: false, error: abortReason, ms, tools };
    if (isNotPermitted(error)) {
      return { ok: false, error: 'publish_not_permitted：Agent 权限已关闭，' + AGENT_OFF_HINT, ms, tools };
    }
    return { ok: false, error: 'publish_error：' + String(error && error.message ? error.message : error), ms, tools };
  } finally {
    clearTimeout(timer);
  }
}

export { DEPLOY_URL_RE, DEFAULT_TIMEOUT_MS };
