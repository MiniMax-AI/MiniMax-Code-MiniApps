// @ts-check
// 遍历钩子：按规则把目录和文件识别成清理条目，并收集大文件、重复文件候选、文件类型统计。
import { CF, F } from './tree.mjs';
import { DOCKER_FILE_NAMES, NO_PATTERN_PARENTS, categoriesFor, extOf, fileKind, installerExts, isArtifactDir, isVenvName } from './rules.mjs';
import { DUP_MIN_BYTES, LARGE_FILE_BYTES, daysSince } from './util.mjs';

/**
 * @typedef {{ dir: import('./tree.mjs').TNode, name: string, bytes: number, mtime: number, dev: number, ino: number, diskId: string | null }} DupCandidate
 */

/**
 * @param {{
 *   model: import('./model.mjs').ScanModel,
 *   rules: ReturnType<typeof import('./rules.mjs').buildRuleIndex>,
 *   platform: string,
 *   now: number,
 *   dupBySize: Map<number, DupCandidate[]>,
 * }} o
 */
export function createHooks(o) {
  const { model, rules, platform, now, dupBySize } = o;
  const tiers = new Map(categoriesFor(platform).map((c) => [c.id, c.tier]));
  const instExts = installerExts(platform);
  /** 当前遍历所在的磁盘（每次 walkRoots 之前设置）。 */
  let diskId = /** @type {string | null} */ (null);
  /** 文件类型统计归入的扫描根（rootId）。 */
  let typeKey = /** @type {string | null} */ (null);

  /** @param {import('./tree.mjs').TNode} node */
  function denyNote(node) {
    if (node.flags & F.DENIED) return '无权限读取';
    if (node.flags & F.DENIED_INSIDE) return '部分目录无权限读取，实际可能更大';
    return null;
  }

  /**
   * @param {import('./tree.mjs').TNode} node @param {string} path
   * @param {{ cat: string, name: string, chat?: boolean, app?: string | null, note?: string | null, selected?: boolean, exempt?: boolean }} f
   */
  function dirItem(node, path, f) {
    /** @type {string[]} */
    const tags = [];
    if (node.flags & F.HAS_GIT && !(node.flags & F.GIT_DIR)) tags.push('git');
    if (f.chat) tags.push('chat');
    const tier = tiers.get(f.cat);
    return model.addItem({
      path,
      name: f.name,
      kind: 'dir',
      diskId,
      sizeBytes: node.size,
      releasableBytes: node.rel,
      duBytes: node.du,
      mtimeMs: node.mtime,
      dev: node.dev,
      ino: node.ino,
      category: f.cat,
      tags,
      note: f.note === undefined ? denyNote(node) : f.note,
      defaultSelected: f.selected === undefined ? tier === 'safe' : f.selected,
      exempt: !!f.exempt,
      typeKind: null,
      app: f.app || null,
      large: false,
    });
  }

  /**
   * @param {string} path @param {string} name @param {import('node:fs').Stats} st @param {number} size @param {number} rel
   * @param {{ cat: string | null, name: string, note?: string | null, selected?: boolean, exempt?: boolean, large?: boolean, app?: string | null }} f
   * @param {number} [du]
   */
  function fileItem(path, name, st, size, rel, f, du = size) {
    const tier = f.cat ? tiers.get(f.cat) : null;
    return model.addItem({
      path,
      name: f.name || name,
      kind: 'file',
      diskId,
      sizeBytes: size,
      releasableBytes: rel,
      duBytes: du,
      mtimeMs: st.mtimeMs,
      dev: st.dev,
      ino: st.ino,
      category: f.cat,
      tags: [],
      note: f.note || null,
      defaultSelected: f.selected === undefined ? tier === 'safe' : f.selected,
      exempt: !!f.exempt,
      typeKind: fileKind(name),
      app: f.app || null,
      large: !!f.large,
    });
  }

  return {
    /** 每次遍历前设置所在磁盘和扫描根；rootId 为 null 时不记文件类型（单目录重新扫描）。 @param {string | null} id @param {string | null} [rootId] */
    setDisk(id, rootId) {
      diskId = id;
      typeKey = rootId === undefined ? id : rootId;
    },
    /** @param {string} key */
    special(key) {
      return rules.specials.get(key) || null;
    },
    /**
     * 父目录列完后决定子目录继承的上下文位，并识别构建产物和虚拟环境。
     * @param {import('./tree.mjs').TNode} node @param {string} _path @param {any} meta @param {{ node: import('./tree.mjs').TNode }[]} subdirs
     */
    deriveChildren(node, _path, meta, subdirs) {
      // git 工作区（主仓库或 worktree：目录里有 .git 目录或 .git 文件）：整个工作区的文件都不参与重复比对，
      // 同一仓库的不同 worktree 里有相同文件很正常。这个目录自己的文件在列目录时已经登记成候选，
      // 目录本身也加上 NODUP，比对前再筛掉。
      if (meta && meta.hasGit && !(node.flags & F.GIT_DIR)) node.cf |= CF.NODUP;
      let base = node.cf;
      const blocked = CF.ARTIFACT | CF.PROTECTED | CF.CLAIMED | CF.NO_PATTERN;
      if (isVenvName(node.name) && meta.hasPyvenv && !(node.cf & blocked)) {
        node.flags |= F.VENV;
        base |= CF.ARTIFACT | CF.DEVCACHE | CF.NODUP;
      }
      // node_modules、site-packages、.venv、venv 里面的子目录不再单独识别（不论它们自己是否算构建产物）。
      if (NO_PATTERN_PARENTS.has(node.name)) base |= CF.NO_PATTERN;
      // .git 目录里面出现的 .git 不算仓库。
      if (node.flags & F.GIT_DIR) base |= CF.IN_GIT;
      const claims = !!(node.sp && node.sp.childrenRule);
      for (const s of subdirs) {
        const c = s.node;
        let cf = base | (c.sp ? c.sp.cf : 0);
        if (c.sp && c.sp.dataVol) cf &= ~CF.SYSVOL;
        if (claims && !(c.sp && c.sp.pass)) cf |= CF.CLAIMED;
        if (!(cf & blocked) && isArtifactDir(c.name, meta, platform)) {
          c.flags |= F.ARTIFACT_ROOT;
          cf |= CF.ARTIFACT | CF.DEVCACHE | CF.NODUP;
        }
        if (c.flags & F.GIT_DIR) cf |= CF.NODUP;
        c.cf = cf;
        // 快速扫描里还在统计的规则位置：登记节点，页面先按当前已统计的部分显示。
        if (c.sp && c.sp.target) model.attachComputing(/** @type {any} */ (s).path.toLowerCase(), c);
      }
    },
    /**
     * @param {import('./tree.mjs').TNode} node @param {string} name @param {string} path
     * @param {import('node:fs').Stats} st @param {number} size @param {number} rel @param {number} [du]
     */
    onFile(node, name, path, st, size, rel, du = size) {
      const cf = node.cf;
      const sp = node.sp;
      if (DOCKER_FILE_NAMES.has(name.toLowerCase())) {
        fileItem(path, name, st, size, rel, { cat: 'docker', name: `Docker 磁盘镜像（${name}）`, note: '在 Docker 里清理不用的镜像、容器和构建缓存', large: size >= LARGE_FILE_BYTES }, du);
      }
      if (sp) {
        if (sp.thumbs && /^thumbcache_.*\.db$/i.test(name)) {
          fileItem(path, name, st, size, rel, { cat: 'thumbnails', name }, du);
        }
        const r = sp.childrenRule;
        if (r && r.kind === 'temp') {
          const days = daysSince(now, st.mtimeMs);
          if (days >= r.ageDays) fileItem(path, name, st, size, rel, { cat: 'temp', name, note: `${days} 天未改动`, exempt: true }, du);
        }
      }
      if (cf & CF.INSTALLER && !(cf & CF.CLAIMED) && instExts.has(extOf(name))) {
        const days = daysSince(now, st.mtimeMs);
        if (days >= 30) fileItem(path, name, st, size, rel, { cat: 'installers', name, note: `${days} 天未改动` }, du);
      }
      if (typeKey) model.addType(typeKey, cf & CF.DEVCACHE ? 'dev-cache' : fileKind(name), size);
      if (size >= LARGE_FILE_BYTES && !(cf & CF.NOLARGE)) {
        const days = daysSince(now, st.mtimeMs);
        const old = days >= 180 && !(cf & CF.PROTECTED);
        fileItem(path, name, st, size, rel, { cat: old ? 'large-old' : null, name, note: old ? `${days} 天未修改` : null, large: true, selected: false }, du);
      }
      if (st.size >= DUP_MIN_BYTES && rel > 0 && !(cf & CF.NODUP)) {
        let arr = dupBySize.get(st.size);
        if (!arr) {
          arr = [];
          dupBySize.set(st.size, arr);
        }
        arr.push({ dir: node, name, bytes: size, mtime: st.mtimeMs, dev: st.dev, ino: st.ino, diskId });
      }
    },
    /**
     * 目录统计完成：固定位置、子项规则、构建产物、虚拟环境；顺带记录代码仓库候选。
     * @param {import('./tree.mjs').TNode} node @param {string} path @param {any} meta @param {any} parentMeta
     */
    onDirDone(node, path, meta, parentMeta) {
      if (model.computingAreas.size) model.finishArea(path.toLowerCase());
      // 代码仓库：.git 目录是主仓库，.git 文件是 worktree 或子模块（扫描结束后再读文件区分）。
      // node_modules、.git 里面、各类规则目录和保护目录里的 .git 不算。
      if (meta && meta.hasGit && !(node.flags & F.GIT_DIR) && !(node.cf & (CF.CLAIMED | CF.ARTIFACT | CF.NO_PATTERN | CF.IN_GIT | CF.PROTECTED))) {
        const gitChild = !meta.gitIsFile && node.children ? node.children.find((c) => c.name === '.git') || null : null;
        model.repoCandidates.push({ node, path, gitFile: !!meta.gitIsFile, gitDu: gitChild ? gitChild.du : 0, gitNode: gitChild });
      }
      if (meta && meta.hasHead && meta.hasObjects && !(node.flags & F.GIT_DIR) && !(node.cf & CF.IN_GIT)) model.gitDirCandidates.set(path.toLowerCase(), node);
      const sp = node.sp;
      if (sp && sp.target) {
        const t = sp.target;
        let note = denyNote(node);
        // Go 模块目录是只读的，直接删除会失败；官方的清理方式是 go clean -modcache。
        const goNote = '在终端运行 go clean -modcache 清理，这里只显示大小';
        if (t.cat === 'go-mod-cache') note = note ? `${note}。${goNote}` : goNote;
        dirItem(node, path, { cat: t.cat, name: t.name, chat: t.chat, app: t.app, note });
        return;
      }
      const psp = node.parent ? node.parent.sp : null;
      if (psp && psp.childrenRule && !(sp && sp.pass)) {
        const r = psp.childrenRule;
        if (r.kind === 'remainder') {
          dirItem(node, path, { cat: r.cat, name: node.name });
          return;
        }
        const days = daysSince(now, node.maxMtime);
        if (r.kind === 'temp') {
          if (days >= r.ageDays) dirItem(node, path, { cat: 'temp', name: node.name, note: `${days} 天未改动`, exempt: true });
          return;
        }
        if (r.kind === 'derived') {
          dirItem(node, path, { cat: r.cat, name: `${r.name}：${node.name}`, note: `项目 ${days} 天未改动`, selected: days >= 90 });
          return;
        }
      }
      if (node.flags & F.ARTIFACT_ROOT) {
        const parent = node.parent;
        const projectMtime = (parentMeta && parentMeta.maxMtimeNonArtifact) || (parent ? parent.mtime : 0) || node.mtime;
        const days = daysSince(now, projectMtime);
        dirItem(node, path, { cat: 'build-artifacts', name: `${parent ? parent.name : ''}/${node.name}`, note: `项目 ${days} 天未改动`, selected: days >= 90 });
      } else if (node.flags & F.VENV) {
        const parent = node.parent;
        dirItem(node, path, { cat: 'python-venv', name: `${parent ? parent.name : ''}/${node.name}` });
      }
    },
    /** @param {import('./tree.mjs').TNode} _node @param {string} path */
    onDenied(_node, path) {
      model.addDenied(path);
    },
    /** @param {import('./tree.mjs').TNode} node */
    forget(node) {
      model.forget(node);
    },
  };
}
