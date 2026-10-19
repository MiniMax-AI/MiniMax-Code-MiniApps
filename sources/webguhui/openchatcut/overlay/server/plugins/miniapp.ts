import { miniappAudioExportPlugin } from './miniapp-audio-export';
// Mini App 只装配编辑/媒体能力；推理由宿主 Agent 承担。
import type { Plugin } from 'vite';
import { requestShapeGatePlugin } from './request-shape-gate';
import { systemFontsPlugin } from './system-fonts';
import { crossOriginIsolationPlugin } from './cross-origin-isolation';
import { storageLifecyclePlugin } from './storage-lifecycle';
import { projectStorePlugin } from './project-store-plugin';
import { extensionStorePlugin } from './extension-store';
import { externalAgentPlugin } from './external-agent';
import { exportStagePlugin } from './export-stage';
import { exportPlugin } from './export';
import { exportDestinationPlugin } from './export-destination';
import { uploadPostPlugin } from './upload-post';
import { exportMediaSourcesPlugin } from './export-media-sources';
import { exportQaPlugin } from './export-qa';
import { uploadMultipartPlugin } from './upload-multipart';
import { uploadPlugin } from './upload';
import { extractAudioPlugin } from './extract-audio';
import { extractFramesPlugin } from './extract-frames';
import { sceneDetectionPlugin } from './scene-detection';
import { autoGradePlugin } from './auto-grade';
import { mediaPreviewPlugin } from './media-preview';
import { normalizeMediaPlugin } from './normalize-media';
import { probeMediaPlugin } from './probe-media';
import { subtitleExportPlugin } from './subtitles';
import { installSystemProxy } from '../net';

export function miniappPlugins(): Plugin[] {
  installSystemProxy();
  return [requestShapeGatePlugin(), systemFontsPlugin(), crossOriginIsolationPlugin(), storageLifecyclePlugin(),
    projectStorePlugin({ http: true }), extensionStorePlugin(), externalAgentPlugin(), exportStagePlugin(),
    miniappAudioExportPlugin(), exportPlugin(), exportDestinationPlugin(), uploadPostPlugin(), exportMediaSourcesPlugin(), exportQaPlugin(),
    uploadMultipartPlugin(), uploadPlugin(), extractAudioPlugin(), extractFramesPlugin(), sceneDetectionPlugin(),
    autoGradePlugin(), mediaPreviewPlugin(), normalizeMediaPlugin(), probeMediaPlugin(), subtitleExportPlugin()];
}
