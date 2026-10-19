import { createEditorClient } from '../sdk/editor.mjs';

// callTool must be supplied by the actual Agent runtime, returning MCP content.
// editorId is explicitly selected from client.list(); never choose a random tab.
export async function drawSwatches(callTool, editorId) {
  const client = createEditorClient(callTool);
  const job = await client.edit(editorId, (doc) => {
    const colors = ['#0f172a', '#2563eb', '#38bdf8', '#f8fafc'];
    const margin = Math.round(doc.width * 0.06),
      size = Math.max(1, Math.round(doc.width * 0.12));
    return [
      { op: 'add_layer', name: '配色方案', as: 'swatches' },
      ...colors.map((color, index) => ({
        op: 'shape',
        layerId: '$swatches',
        kind: 'rect',
        x: margin + index * (size + 12),
        y: margin,
        width: size,
        height: size,
        color,
      })),
      { op: 'update_layer', layerId: '$swatches', opacity: 0.9 },
    ];
  });
  // Do not resubmit on timeout/interruption: keep this jobId and query it.
  return client.wait(job.jobId);
}

export async function recolorNamedLayers(callTool, editorId, names) {
  const client = createEditorClient(callTool);
  const job = await client.edit(editorId, (doc) =>
    doc.layers
      .filter((layer) => names.includes(layer.name) && !layer.locked && !layer.adjustment)
      .map((layer) => ({ op: 'filter', layerId: layer.id, type: 'saturation', value: -30 })),
  );
  return client.wait(job.jobId);
}
