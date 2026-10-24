export const generationCapabilityPrompt = '检查我在 MiniMax Code 中已配置的图片、视频、语音生成能力。只查找工具和读取配置状态，不生成、不安装、不修改工程。分别说明：已发现的工具、是否仍需配置或授权、尚未找到的能力。工具能被发现不代表服务已验证可用；无法确认时明确标为待验证。缺少能力时，根据工具实际返回的信息告诉我下一步，不猜测设置入口，也不要让我在聊天中粘贴密钥。';

export const generationInstructions = '图片、视频、语音生成使用用户在 MiniMax Code 中配置并授权的工具，由当前 Agent 执行；MiniApp 负责导入生成结果，不自行配置另一套模型服务。先查找匹配能力并读取工具要求，区分已发现、缺少配置或授权、实际调用成功，不能仅凭工具存在就宣称可用。找不到能力时说明缺什么，让用户配置后继续，或使用已有素材；不要擅自安装插件、索要聊天中的密钥、猜测设置入口或切换收费服务。仅检查能力时不要创建编辑草稿或发起生成。生成前确认内容、数量及可能的费用；用户已明确授权的同一请求不重复询问。异步任务保存任务 ID 并查询已有任务，不因等待超时重新生成。生成成功后保留工具返回的文件路径、URL 和任务 ID；导入失败明确区分“已生成、未导入”，只重试导入已有产物。需要放入时间线时通过 manual 草稿提交预览。只有导入工具成功且重新读取工程确认素材存在，才能报告已导入；只有修改状态为 applied 才能报告已应用。';

// MiniApp 助手的引导按工程进度展示；建议只填入输入框，由用户决定是否发送。
export function assistantStarters(assetCount: number, itemCount: number) {
  if (!assetCount && !itemCount) return [
    { label: '先想一个视频方案', hint: '还没有素材也可以开始', prompt: '我想做一个短视频。先问我一个最重要的问题，帮我确定主题、用途和时长，再告诉我需要准备哪些素材。先不要生成素材或修改工程。' },
    { label: '了解 AI 能做什么', hint: '检查你配置的生成能力', prompt: generationCapabilityPrompt },
  ];
  if (!itemCount) return [
    { label: '先看看这些素材', hint: '了解内容，给出剪辑建议', prompt: '读取当前工程素材，查看代表性画面，告诉我适合剪成什么视频。先给方案，不修改工程。' },
    { label: '制作第一版', hint: '用已有素材粗剪，先看预览', prompt: '使用当前工程已有素材制作一版简洁的粗剪。先读取素材，不重新生成，完成后提交编辑提案供我预览，不自动应用。' },
  ];
  return [
    { label: '检查代表画面和字幕', hint: '抽查画面和字幕，提出建议', prompt: '读取当前时间线，最多检查两个代表帧，每次仅抽取一帧，检查字幕是否清晰、有没有遮挡，给出具体建议。仅检查，不修改工程。' },
    { label: '优化剪辑节奏', hint: '保留原素材，修改先预览', prompt: '读取当前工程和已有草稿，检查视频节奏，使用已有素材做一版更紧凑的剪辑。保留原素材，完成后提交编辑提案，不自动应用。' },
    { label: '继续已有草稿', hint: '先看之前改了什么', prompt: '读取当前工程已有草稿和修改记录，简短告诉我已完成哪些修改、还缺什么，再等我决定下一步。不要新建、提交或丢弃草稿。' },
  ];
}

const toolLabels: Record<string, string> = {
  target_project: '连接当前工程', read_project: '读取工程', read_timeline: '读取时间线',
  list_assets: '查看素材', list_edit_sessions: '检查已有草稿', get_edit_session: '读取草稿修改',
  begin_edit_session: '准备编辑草稿', recover_edit_session: '恢复已有草稿',
  edit_item: '调整片段', add_item: '添加片段', remove_item: '移除片段',
  review_edit_session: '准备修改预览', view_timeline_frames: '查看成片画面',
  view_asset_frames: '查看素材画面', import_asset: '导入素材',
  ToolSearch: '查找可用能力', tool_search: '查找可用能力',
};
export function assistantToolLabel(name: string) {
  const key = name.split('__').at(-1) ?? name;
  return toolLabels[key] ?? '执行任务';
}

export function insertAssistantSuggestion(current: string, suggestion: string) {
  if (!current.trim()) return suggestion;
  if (current.includes(suggestion)) return current;
  return `${current.trimEnd()}\n\n${suggestion}`;
}
