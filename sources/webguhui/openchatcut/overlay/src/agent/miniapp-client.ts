// Mini App 禁止独立 LLM 调用；请在剪辑助手中由宿主 Agent 完成推理。
export async function generateAgentText(): Promise<never> {
  throw new Error('此功能需要宿主 AI：请在 MiniMax 剪辑助手中提出翻译或生成要求，再导入结果。');
}
