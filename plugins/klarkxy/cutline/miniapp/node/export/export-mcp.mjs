// @ts-check
// The `cutline_export` MCP tool.
//
// It does not render anything. It prepares a self-contained export job — a
// snapshot of the saved project, copies of the media and library files it
// names, a copy of the renderer and a copy of the standalone runner — and
// hands back the exact path of that runner. The Agent then starts the runner
// itself, with its ordinary background shell tool, and asks for the job's
// status while it works.
//
// The three actions are prepare, status and cancel. There is no "start"
// action on purpose: starting the render is the Agent's job, in a process it
// owns, not something the Mini App can do on its behalf.

import { describeJob } from './job-state.mjs';

/** The tool definition, added to the MCP tool list next to the upstream ones. */
export const EXPORT_TOOL = {
  name: 'cutline_export',
  description:
    'Render the timeline to a video file with a standalone renderer that runs outside the Mini App. ' +
    'Three actions: prepare (copy the saved project, its media, the library assets and the renderer into a job folder under the plugin\'s private data dir, then return the exact path of the runner to start), ' +
    'status (read a job\'s progress and result), and cancel (ask a running job to stop). ' +
    'prepare does not start anything: start the returned runner with your own background shell tool, then poll status. ' +
    'The render uses the editor\'s own compositor, audio mix and encoding, so the file matches what the editor shows. ' +
    'Needs ffmpeg and ffprobe on PATH, and a Chrome or Edge install for the renderer. ' +
    'One file per render in this release: batch outputs are not supported here.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['prepare', 'status', 'cancel'],
        description: 'prepare: build a job to run. status: read a job. cancel: ask a running job to stop.',
      },
      job: {
        type: 'string',
        description: 'The job id, for status and cancel.',
      },
      range: {
        type: 'string',
        enum: ['entire', 'in-out'],
        description: 'The part of the timeline to render: the whole timeline, or the project\'s inPoint to outPoint. Default: in-out when either marker is set, else the whole timeline.',
      },
      preset: {
        type: 'string',
        description:
          'A delivery preset id: youtube, youtube-shorts, instagram-reels, tiktok, x, linkedin, master, broadcast, web, archive, custom, or a saved preset\'s id. ' +
          'An id nobody has is refused before the job is made, so a typo never renders as Custom.',
      },
      delivery: {
        type: 'object',
        description:
          'Delivery settings over the preset (or over custom): the same shape fablecut_export takes — {width, height, fps, reframe, container, video:{…}, audio:{…}, color, filename, metadata}. ' +
          'It may carry a preset of its own ({preset: "…"}); that id is checked the same way.',
      },
      profile: {
        type: 'string',
        description: 'A raw encoding profile id (ffmpeg argument lists) instead of a preset. Cannot be combined with preset, delivery or outputs.',
      },
    },
    required: ['action'],
  },
};

/**
 * @param {Record<string, any>} args
 * @returns {string} the answer the Agent reads
 */
function formatPrepare(job) {
  const lines = [];
  lines.push(`Export job ${job.jobId} is prepared and has not started.`);
  lines.push('');
  lines.push('Start it with your own background shell tool, in the foreground of that task. Run the');
  lines.push('`node` on your PATH - plain Node, not the desktop app\'s executable - with these arguments:');
  lines.push('');
  lines.push(`  ${job.runnerPath}`);
  lines.push('  --job');
  lines.push(`  ${job.jobDir}`);
  lines.push('');
  lines.push('Quote each path for the shell you are using (single quotes in PowerShell, single or');
  lines.push('double quotes in a POSIX shell): a path may hold a space, a dollar sign or a backtick.');
  lines.push('The answer also carries these as structured fields, so you can build the command from');
  lines.push('them instead of from this text.');
  lines.push('');
  lines.push('Then poll it with:');
  lines.push(`  cutline_export {action:"status", job:"${job.jobId}"}`);
  lines.push('and stop it with:');
  lines.push(`  cutline_export {action:"cancel", job:"${job.jobId}"}`);
  lines.push('');
  lines.push(
    'The runner is a plain Node process you own: it reads only the job folder, needs ffmpeg and ffprobe on PATH and a Chrome or Edge install, and writes its file into the job folder\'s exports directory.',
  );
  lines.push('');
  lines.push('Where the file lands: the finished video is written to the job folder\'s `exports`');
  lines.push('directory and its absolute path is in the job\'s status. Copy it out where you want it.');
  lines.push('What the job folder holds: copies of the project, the media and the library files it');
  lines.push('names, the renderer, and the video itself - disk space of its own, and nothing deletes it');
  lines.push('for you. Delete the job folder once you have the file. A file that was made but failed');
  lines.push('its checks is kept in the job folder\'s `provisional` directory instead, so it can still');
  lines.push('be looked at.');
  if (job.project) {
    lines.push(
      `Snapshot: ${job.project.name || 'Untitled Project'} — ${job.project.clips ?? 0} clips, ${job.project.media ?? 0} media, ${job.project.width ?? '?'}x${job.project.height ?? '?'} @ ${job.project.fps ?? '?'} fps, revision ${job.project.revision ?? '?'}.`,
    );
  }
  if (job.media && job.media.length) {
    lines.push(`Copied ${job.media.length} source file(s) into the job folder.`);
  }
  lines.push('');
  lines.push(
    'Limits: one file per render (batch outputs are not supported by this tool), the renderer must find a Chrome or Edge install, and the job stops if the renderer or ffmpeg is missing. The job runs until it finishes or is cancelled — it does not stop when the Mini App is closed.',
  );
  return lines.join('\n');
}

/**
 * @param {Record<string, any>} job
 * @returns {string}
 */
function formatStatus(job) {
  const lines = [];
  const percent = Math.round((Number(job.progress) || 0) * 100);
  const shown = job.observedStatus ?? job.status;
  const live = job.status === 'running' || job.status === 'verifying';
  lines.push(`Job ${job.jobId}: ${shown}${live ? ` (${percent}%)` : ''}`);
  if (job.observed) lines.push(job.observed);
  if (job.attempt) {
    lines.push(
      `Attempt ${job.attempt.id} — pid ${job.attempt.pid ?? '?'}, started ${new Date(job.attempt.startedAt ?? 0).toISOString()}, last heartbeat ${job.attempt.heartbeatAt ? new Date(job.attempt.heartbeatAt).toISOString() : 'none'}.`,
    );
  }
  if (job.outputs && job.outputs.length) {
    lines.push('Files:');
    for (const output of job.outputs) {
      lines.push(`  ${output.file ?? output.path} — ${output.bytes ?? '?'} bytes${output.note ? ` (${output.note})` : ''}`);
      if (output.path) lines.push(`    ${output.path}`);
    }
  }
  const warnings = Array.isArray(job.warnings) ? job.warnings : [];
  if (warnings.length) {
    lines.push('Warnings from the file check — the file was made, but it did not match everything that was asked:');
    for (const warning of warnings) lines.push(`  ${warning}`);
  }
  if (job.error) lines.push(`Error: ${job.error}`);
  if (job.notes && job.notes.length) lines.push(`Notes: ${job.notes.join('; ')}`);
  lines.push(`Job folder: ${job.jobDir ?? '(unknown)'}`);
  return lines.join('\n');
}

/**
 * Build the dispatcher the MCP endpoint calls.
 *
 * The answer is a text and, where there is one, a set of structured fields.
 * The fields carry the absolute paths and the argument list, so an Agent can
 * build the command itself and quote the paths for the shell it has - the
 * text never guesses a quoting style.
 *
 * @param {{ prepare: (args: Record<string, any>) => Record<string, any>, status: (id: unknown) => Record<string, any>, cancel: (id: unknown) => Record<string, any> }} jobs
 */
export function createExportToolHandler(jobs) {
  /**
   * @param {Record<string, any>} args
   * @returns {{ text: string, structured?: Record<string, unknown> }}
   */
  return function handleExportTool(args) {
    const action = String(args?.action ?? '').trim();
    if (action === 'prepare') {
      const job = jobs.prepare(args);
      return {
        text: formatPrepare(job),
        structured: {
          action: 'prepare',
          jobId: job.jobId,
          status: job.status,
          jobDir: job.jobDir,
          runnerPath: job.runnerPath,
          argv: job.argv,
          // The name to look up on PATH. The Mini App's own process may be
          // the desktop app, which is not Node.
          node: job.node ?? 'node',
          notes: job.notes ?? [],
        },
      };
    }
    if (action === 'status') {
      const job = jobs.status(args?.job);
      return {
        text: formatStatus(job),
        structured: {
          action: 'status',
          jobId: job.jobId,
          status: job.status,
          observedStatus: job.observedStatus ?? job.status,
          progress: job.progress ?? 0,
          attempt: job.attempt ?? null,
          outputs: job.outputs ?? [],
          warnings: job.warnings ?? [],
          notes: job.notes ?? [],
          // A lock left by an earlier attempt: the runner would refuse to
          // start. Nothing is reclaimed and no process is killed.
          locked: job.locked === true,
          error: job.error ?? null,
          jobDir: job.jobDir,
        },
      };
    }
    if (action === 'cancel') {
      const job = jobs.cancel(args?.job);
      return {
        text: `Cancel requested for job ${job.jobId} (status ${job.status}).\n\n${formatStatus(job)}\n\n${job.note ?? ''}`,
        structured: {
          action: 'cancel',
          jobId: job.jobId,
          status: job.status,
          cancelRequested: true,
          jobDir: job.jobDir,
        },
      };
    }
    throw new Error('action must be prepare, status or cancel');
  };
}

export { describeJob };
