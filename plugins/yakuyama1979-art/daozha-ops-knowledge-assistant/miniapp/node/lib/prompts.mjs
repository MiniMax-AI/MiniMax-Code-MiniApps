// Prompt builders. Every prompt asks for one JSON object so the reply can be verified
// before it reaches the page.

export const CATEGORY_VALUES = ['知识点', '规则', '合同', '其他'];

export function analyzeDocumentPrompt({ name, category, text }) {
  return {
    system: '你是道闸售后运维的资料归档助手，负责把投喂的资料整理成可检索的知识条目。只依据资料原文，不要编造原文没有的内容。',
    prompt: [
      `资料名称：${name}`,
      `用户指定的资料分类：${category}`,
      '',
      '请只输出一个 JSON 对象：',
      '{"title":"简短的资料标题","summary":"120字以内的资料摘要","keyPoints":["关键条款"],"suggestedCategory":"知识点|规则|合同|其他","suggestedCategoryReason":"一句话理由"}',
      '',
      '资料原文：',
      '---',
      String(text).slice(0, 12000),
      '---',
    ].join('\n'),
  };
}

export function answerQuestionPrompt({ question, contexts }) {
  const blocks = contexts.map((context, index) => {
    const label = `S${index + 1}`;
    return `【${label}】资料：${context.documentName}（分类：${context.category}，片段 ${context.chunkIndex + 1}）\n${context.text}`;
  });
  const material = blocks.length
    ? blocks.join('\n\n')
    : '（本次检索没有命中任何资料片段）';
  return {
    system: '你是道闸售后运维专家。只依据给出的资料片段回答问题，不得编造资料中没有的条款。若资料不足，必须明确写出缺少哪些依据。',
    prompt: [
      `问题：${question}`,
      '',
      '资料片段：',
      material,
      '',
      '请只输出一个 JSON 对象：',
      '{"standardAnswer":"面向运维人员的标准答案，可直接执行","analysis":"解析：判断依据、适用条款、风险提示","confidence":0,"cited":["S1"],"missing":["资料没有覆盖的点"]}',
      'confidence 为 0-100 的置信度；cited 只能填写实际引用的片段编号，没有命中时填写空数组。',
    ].join('\n'),
  };
}

export function locateChangePrompt({ fileName, outline, requirement }) {
  return {
    system: '你是代码定位助手。根据文件结构大纲判断需要修改的代码区域，只输出 JSON，不要输出解释。',
    prompt: [
      `文件：${fileName}`,
      `修改要求：${requirement}`,
      '',
      `文件共 ${outline.totalLines} 行，结构大纲如下（行号: 内容）：`,
      outline.anchors.join('\n'),
      '',
      '请只输出一个 JSON 对象：{"startLine":起始行号,"endLine":结束行号,"reason":"判断理由"}',
      '行号必须是文件里真实存在的范围，并且要完整覆盖需要改动的代码块。',
    ].join('\n'),
  };
}

export function generatePatchPrompt({ fileName, requirement, window, header }) {
  return {
    system: [
      '你是资深工程师，擅长对代码做最小且精确的修改。',
      '你必须只输出 SEARCH/REPLACE 补丁块，不要输出任何解释、前言或总结。',
    ].join('\n'),
    prompt: [
      `文件：${fileName}`,
      `修改要求：${requirement}`,
      '',
      '文件开头（仅供理解上下文，不要修改它）：',
      header,
      '',
      `相关区域：第 ${window.from} 行到第 ${window.to} 行`,
      '区域内容：',
      '---',
      window.text,
      '---',
      '',
      '输出格式：',
      '<<<<<<< SEARCH',
      '（逐字复制自上面区域、且在原文件中只出现一次的原文，至少 1 行）',
      '=======',
      '（替换后的新内容）',
      '>>>>>>> REPLACE',
      '',
      '需要多处修改时可以输出多个补丁块。SEARCH 原文必须与文件中内容逐字一致且唯一。',
    ].join('\n'),
  };
}

export function refinePatchPrompt({ fileName, requirement, window, header, problem }) {
  return {
    system: [
      '你是资深工程师。你上一次给出的补丁无法安全应用，请重新给出。',
      '只输出 SEARCH/REPLACE 补丁块，不要输出任何解释。',
    ].join('\n'),
    prompt: [
      `文件：${fileName}`,
      `修改要求：${requirement}`,
      `上一次的问题：${problem}`,
      '',
      '文件开头（仅供理解上下文）：',
      header,
      '',
      `相关区域：第 ${window.from} 行到第 ${window.to} 行`,
      '区域内容：',
      '---',
      window.text,
      '---',
      '',
      '请让 SEARCH 原文更短但仍能唯一确定位置，并确保在整份文件中只出现一次。',
      '输出格式：',
      '<<<<<<< SEARCH',
      '...',
      '=======',
      '...',
      '>>>>>>> REPLACE',
    ].join('\n'),
  };
}
