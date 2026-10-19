import { composite } from './model.js';

export function createAgentRequest(state, getEditor) {
  let prepared = null;
  return async (mode, request) => {
    const editor = getEditor();
    request = request.trim();
    if (!request) throw Error('请填写修图需求');
    if (mode === 'edit' && !state.doc) throw Error('请先打开图片');
    let text;
    if (mode === 'workbench') {
      if (!editor) throw Error('编辑器尚未连接');
      text = `请在修图工作台直接完成编辑。需求：${request}\n目标 editorId：${editor.editorId}。先调用 editor_capabilities 和 editor_inspect。多步任务可调用 editor_run_code 提交 JavaScript：用 await editor.inspect()、preview(options)、edit(operations)、create({width,height,name})、export()，根据真实结果使用循环和条件；必须逐个 await。用 editor_code_result 查询 runId 并查看最终预览。脚本整体不回滚，错误时查 trace 和 editor_job，不能换编号重复执行。简单编辑也可用 editor_batch。保留用户已有内容，除非需求明确要求删除。`;
    } else {
      const doc = state.doc;
      const key = JSON.stringify([mode, request, doc?.id]);
      if (!prepared || prepared.key !== key) {
        const response = await fetch('/api/agent/requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: mode,
            prompt: request,
            name: doc?.name || 'Agent 图片',
            reference: mode === 'edit' ? composite(doc).toDataURL('image/png') : undefined,
          }),
        });
        const record = await response.json();
        if (!response.ok) throw Error(record.error || '保存图片需求失败');
        prepared = { key, id: record.id };
      }
      text = `\n请处理修图工作台图片任务 ${prepared.id}。\n需求：${request}\n先调用 retouch-images 的 get_image_request，requestId 为 ${prepared.id}，读取任务和参考图路径。使用可用的生图或改图工具生成 PNG，再调用 submit_image_result，以同一 requestId 和生成文件的本机绝对路径 imagePath 交回结果。不要改写原工程。若工具不可用，请说明限制并提供可下载图片，供手动导入。\n`;
    }

    const message = window.mcode?.miniapp?.message;
    if (typeof message?.append !== 'function') return { text };
    try {
      await message.append(text);
      return { delivered: true };
    } catch (error) {
      const messages = {
        user_cancelled: '已取消，需求未加入聊天',
        result_unknown: '结果未确认，请先检查聊天输入框，避免重复添加',
        target_unavailable: '当前没有可用的目标聊天，请从聊天中打开 Mini App 后重试',
      };
      throw Error(messages[error?.message] || '未能加入聊天，请检查目标聊天后重试');
    }
  };
}
