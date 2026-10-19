import {
  t,
  initLanguage,
  getLanguage,
  getPreference,
  languages,
  setLanguage,
  subscribeLanguage,
} from './photo-i18n.js';
const content = {
  "zh-hans": [
    [
      "OpenPhotoShop",
      "打开照片，调整图层和色彩，或描述想法让 AI 帮你完成。"
    ],
    [
      "开始创作",
      "欢迎页可打开图片、新建画布或试用示例作品。商品、肖像和海报示例均可继续编辑。"
    ],
    [
      "保存与恢复",
      "“更多 → 保存工程”保留图层，下载的 .pcraft 文件可以再次打开。“导出 PNG”保存合并图片。应用每隔几秒检查当前作品的变化并在本机备份，可从“更多 → 恢复作品”找回。刚完成的修改可能还未备份；关闭前请保存重要作品。"
    ],
    [
      "与 AI 协作",
      "打开右下角的 AI 助手，直接输入需求并发送。AI 会按需要读取画面、编辑图层或生成图片。标题栏可以拖动，减号收起面板。窄窗口下显示在底部，不会占用固定侧栏。"
    ],
    [
      "查看图片与进度",
      "生成的图片显示在“AI 返回的图片”，点击“打开图片”会打开新作品，原作品保留。发送过程中可以停止；需要许可或补充信息时，在面板里操作。读取结果失败时可点击重试。"
    ],
    [
      "继续上次对话",
      "草稿和最近回复会自动保存在本机。重新打开后继续使用原会话。若上次任务结果不确定，请先“查看完整会话”，不要重复发送。请不要同时在两个窗口修改同一份 AI 会话。"
    ],
    [
      "语言与兼容性",
      "“更多 → 语言”支持简体中文、繁体中文、English 和日本語。旧 .retouch.json 文件从“打开旧版工程”打开。复杂 PSD、特殊字体和部分滤镜可能与桌面软件有差异；重要作品请检查导出结果。"
    ]
  ],
  "en": [
    [
      "OpenPhotoShop",
      "Open a photo, edit layers and colors, or describe an idea to the AI assistant."
    ],
    [
      "Start creating",
      "Open an image, create a canvas or try an editable product, portrait or poster example on the welcome page."
    ],
    [
      "Save and recover",
      "More → Save project downloads an editable .pcraft file with layers. Export PNG saves a flattened image. Changed active artwork is backed up locally every few seconds and can be reopened from More → Recover artwork. Recent edits may not be backed up yet. Save important work before closing."
    ],
    [
      "Work with AI",
      "Open AI assistant at the bottom right and send your request directly. AI can inspect the canvas, edit layers or generate images. Drag the heading to move it; use minus to minimize. On narrow windows it appears at the bottom."
    ],
    [
      "Images and progress",
      "Returned images appear under AI returned images. Open image creates another document and preserves the original. Stop a running request or answer approvals and questions in the panel. Failed result loading has a retry button."
    ],
    [
      "Continue a conversation",
      "Drafts and the latest reply are saved locally. Reopen the app to continue the same conversation. If the previous outcome is unknown, use View full conversation before sending again. Avoid editing the same conversation in two windows."
    ],
    [
      "Language and compatibility",
      "More → Language supports Simplified Chinese, Traditional Chinese, English and Japanese. Open older .retouch.json files with Open legacy project. Complex PSDs, fonts and some filters may differ from desktop editors; check important exports."
    ]
  ],
  "zh-hant": [
    [
      "OpenPhotoShop",
      "開啟照片，調整圖層和色彩，或描述想法讓 AI 協助完成。"
    ],
    [
      "開始創作",
      "歡迎頁可開啟圖片、建立畫布，或試用可繼續編輯的商品、肖像與海報範例。"
    ],
    [
      "儲存與復原",
      "「更多 → 儲存專案」下載保留圖層的 .pcraft 檔案；「匯出 PNG」儲存合併圖片。應用每隔幾秒檢查目前作品的變更並在本機備份，可從「更多 → 復原作品」找回。最新修改可能尚未備份，關閉前請儲存重要作品。"
    ],
    [
      "與 AI 協作",
      "開啟右下角的 AI 助手，直接輸入需求並傳送。AI 可讀取畫面、編輯圖層或生成圖片。拖動標題列可移動面板，減號可收起；窄視窗會顯示於底部。"
    ],
    [
      "圖片與進度",
      "生成圖片顯示於「AI 回傳的圖片」，開啟後會建立另一份作品，保留原作。處理中可停止；需要許可或補充資訊時可在面板中操作。讀取結果失敗時可重試。"
    ],
    [
      "繼續對話",
      "草稿與最近回覆會儲存於本機，重新開啟後可繼續原對話。若上次結果不明，請先查看完整對話，勿重複傳送。避免同時在兩個視窗修改同一對話。"
    ],
    [
      "語言與相容性",
      "語言選單支援簡體中文、繁體中文、English 與日本語。舊 .retouch.json 檔案請用「開啟舊版專案」。複雜 PSD、特殊字型與部分濾鏡可能與桌面軟體不同，請檢查重要匯出結果。"
    ]
  ],
  "ja": [
    [
      "OpenPhotoShop",
      "写真を開いてレイヤーや色を編集したり、AI にアイデアを伝えて制作できます。"
    ],
    [
      "制作を始める",
      "ホーム画面で画像を開く、新規キャンバスを作る、商品・ポートレート・ポスターの編集可能な作例を試すことができます。"
    ],
    [
      "保存と復元",
      "「その他 → プロジェクトを保存」でレイヤーを含む .pcraft を保存します。PNG は統合画像です。編集中の作品の変更を数秒ごとに確認し、端末内にバックアップします。「作品を復元」から開けます。直前の変更は未保存の場合があります。重要な作品は閉じる前に保存してください。"
    ],
    [
      "AI と制作",
      "右下の AI アシスタントに依頼を直接送信します。画像の確認、レイヤー編集、画像生成ができます。見出しをドラッグして移動し、マイナスで最小化します。狭いウィンドウでは下部に表示します。"
    ],
    [
      "画像と進行状況",
      "返された画像を開くと別の作品が開き、元の作品は残ります。処理中は停止でき、許可や質問にもパネル内で回答できます。結果の読み込みに失敗した場合は再試行できます。"
    ],
    [
      "会話を続ける",
      "下書きと直近の回答は端末内に保存します。再度開いて同じ会話を続けられます。前回の結果が不明な場合は、会話全体を確認してから送信してください。複数のウィンドウで同じ会話を同時に編集しないでください。"
    ],
    [
      "言語と互換性",
      "簡体字中国語、繁体字中国語、英語、日本語に対応します。旧 .retouch.json は旧形式のプロジェクトとして開きます。複雑な PSD、フォント、一部のフィルターはデスクトップ版と異なる場合があります。重要な出力は確認してください。"
    ]
  ]
};
initLanguage();
const select = document.querySelector('select');
function render() {
  document.title = 'OpenPhotoShop · ' + t('使用说明');
  const back = document.querySelector('a');
  back.textContent = '← ' + t('返回工作台');
  select.setAttribute('aria-label', t('语言'));
  select.replaceChildren(
    ...languages.map(([code, label]) => new Option(code === 'auto' ? t(label) : label, code)),
  );
  select.value = getPreference();
  const main = document.querySelector('main');
  main.replaceChildren();
  for (const [i, [heading, text]] of content[getLanguage()].entries()) {
    const h = document.createElement(i ? 'h2' : 'h1'),
      p = document.createElement('p');
    h.textContent = heading;
    p.textContent = text;
    main.append(h, p);
  }
}
select.onchange = () => setLanguage(select.value);
subscribeLanguage(render);
render();
