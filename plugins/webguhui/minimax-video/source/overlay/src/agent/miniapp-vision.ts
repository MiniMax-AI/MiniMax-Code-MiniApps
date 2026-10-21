// 图像直接随 MCP 工具结果交给宿主，不运行第二套视觉模型。
export async function maybeDescribeFramesResult(result: unknown): Promise<unknown> { return result; }
export async function describeImagesForTextModel<T>(messages: T): Promise<T> { return messages; }
export async function describeImageWithVision(): Promise<never> { throw new Error('请使用宿主 Agent 的视觉工具'); }
