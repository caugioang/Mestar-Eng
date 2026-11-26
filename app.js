(() => {
  'use strict';

  const STORAGE_KEY = 'mestar_eng_srs_v1';

  const DEFAULT_SETTINGS = {
    newQuota: 30,
    reviewQuota: 20,
    interval1Days: 10,
    interval2Days: 30,
    studyGroup: 'ALL',
    newOrder: 'sequential', // 'sequential' | 'random'
    forget30Rule: 'new', // 'new' | 'wait_10d'
    showPos: true,
    showIpa: true,
    showExample: true,
    showNote: true,
  };

  const SAMPLE_VOCAB_TXT = `# Mestar Eng — Danh sách từ mẫu (định dạng: word | pos | meaning | example | ipa | note | group)
word | pos | meaning | example | ipa | note | group
abandon | v | từ bỏ, bỏ rơi | He decided to abandon the outdated plan. | /əˈbændən/ | a + band + on | Core 01
concise | adj | ngắn gọn, súc tích | Keep your summary concise and clear. | /kənˈsaɪs/ | trái nghĩa với verbose | Core 01
consistent | adj | nhất quán, kiên trì | Consistent daily practice beats cramming. | /kənˈsɪstənt/ | consist + ent | Core 01
deliberate | adj | có chủ ý, thận trọng | She made a deliberate effort to slow down. | /dɪˈlɪbərət/ | cũng là động từ: cân nhắc kỹ | Core 01
essential | adj | thiết yếu, cốt lõi | Focus on the essential vocabulary first. | /ɪˈsenʃl/ | essence + ial | Core 01
friction | n | sự ma sát, trở ngại | Remove friction so studying feels effortless. | /ˈfrɪkʃn/ | low friction = ít rào cản | Core 01
momentum | n | đà tiến, động lực | Small wins build momentum over time. | /məˈmentəm/ | keep the momentum going | Core 01
pragmatic | adj | thực tế, thực dụng | We chose a pragmatic solution for the MVP. | /præɡˈmætɪk/ | tập trung vào tính ứng dụng | Core 02
retain | v | ghi nhớ, giữ lại | Spaced repetition helps you retain words longer. | /rɪˈteɪn/ | retention (n): khả năng lưu giữ | Core 02
threshold | n | ngưỡng, ranh giới | Once you cross that threshold, reading gets easier. | /ˈθreʃhəʊld/ | ngưỡng cửa / mức tối thiểu | Core 02
ubiquitous | adj | có mặt khắp nơi | Smartphones have become ubiquitous in daily life. | /juːˈbɪkwɪtəs/ | mọi lúc mọi nơi | Core 02
versatile | adj | đa năng, linh hoạt | A versatile tool adapts to many workflows. | /ˈvɜːrsətl/ | linh hoạt trong nhiều tình huống | Core 02
`;

  // =========================================================
  // Date Helpers (Local Calendar YYYY-MM-DD)
  // =========================================================

  function formatDateLocal(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function getTodayStr() {
    return formatDateLocal(new Date());
  }

  function parseDateLocal(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(dateStr, days) {
    const dt = parseDateLocal(dateStr);
    dt.setDate(dt.getDate() + days);
    return formatDateLocal(dt);
  }

  function diffDays(fromStr, toStr) {
    const a = parseDateLocal(fromStr);
    const b = parseDateLocal(toStr);
    return Math.round((b - a) / 86400000);
  }

  function makeId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `w_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  // =========================================================
  // State Management & Auto-save
  // =========================================================

  function createEmptyState() {
    return {
      version: 1,
      nextOrder: 1,
      settings: { ...DEFAULT_SETTINGS },
      dailyStats: {},
      dailySession: null,
      words: [],
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return createEmptyState();
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.words)) return createEmptyState();
      return {
        version: 1,
        nextOrder: typeof parsed.nextOrder === 'number' ? parsed.nextOrder : parsed.words.length + 1,
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
        dailyStats: parsed.dailyStats && typeof parsed.dailyStats === 'object' ? parsed.dailyStats : {},
        dailySession: parsed.dailySession && typeof parsed.dailySession === 'object' ? parsed.dailySession : null,
        words: parsed.words,
      };
    } catch (err) {
      console.error('Failed to load state:', err);
      return createEmptyState();
    }
  }

  let state = loadState();

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.error('Failed to save state:', err);
      showToast('Không thể lưu vào trình duyệt (hết dung lượng bộ nhớ).');
    }
  }

  function getTodayStats() {
    const today = getTodayStr();
    if (!state.dailyStats[today]) {
      state.dailyStats[today] = { newDone: 0, reviewDone: 0 };
    }
    return state.dailyStats[today];
  }

  // =========================================================
  // Runtime Session State (in-memory)
  // =========================================================

  let currentView = 'study';
  let isRevealed = false;
  let undoStack = []; // up to 15 actions
  let toastTimer = null;

  // =========================================================
  // DOM References
  // =========================================================

  const els = {
    tabStudy: document.getElementById('tab-study'),
    tabManage: document.getElementById('tab-manage'),
    viewStudy: document.getElementById('view-study'),
    viewManage: document.getElementById('view-manage'),

    statNewRemaining: document.getElementById('stat-new-remaining'),
    statNewQuota: document.getElementById('stat-new-quota'),
    statReviewRemaining: document.getElementById('stat-review-remaining'),
    statReviewQuota: document.getElementById('stat-review-quota'),
    btnUndo: document.getElementById('btn-undo'),

    inputNewQuota: document.getElementById('input-new-quota'),
    inputReviewQuota: document.getElementById('input-review-quota'),
    inputInterval1: document.getElementById('input-interval-1'),
    inputInterval2: document.getElementById('input-interval-2'),
    labelBucketP1: document.getElementById('label-bucket-p1'),
    labelBucketP2: document.getElementById('label-bucket-p2'),

    studyStage: document.getElementById('study-stage'),
    studyEmpty: document.getElementById('study-empty'),
    flashcard: document.getElementById('flashcard'),
    cardBadge: document.getElementById('card-badge'),
    cardGroup: document.getElementById('card-group'),
    cardWord: document.getElementById('card-word'),
    cardPos: document.getElementById('card-pos'),
    cardIpa: document.getElementById('card-ipa'),
    cardDivider: document.getElementById('card-divider'),
    cardBack: document.getElementById('card-back'),
    cardMeaning: document.getElementById('card-meaning'),
    cardExample: document.getElementById('card-example'),
    cardNote: document.getElementById('card-note'),
    cardFlipHint: document.getElementById('card-flip-hint'),

    btnForgot: document.getElementById('btn-forgot'),
    btnRemembered: document.getElementById('btn-remembered'),
    btnMasterBack: document.getElementById('btn-master-back'),
    forgotSub: document.getElementById('forgot-sub'),
    rememberSub: document.getElementById('remember-sub'),

    emptyIcon: document.getElementById('empty-icon'),
    emptyTitle: document.getElementById('empty-title'),
    emptyDesc: document.getElementById('empty-desc'),
    emptyStats: document.getElementById('empty-stats'),
    emptyActions: document.getElementById('empty-actions'),

    // Manage view
    totalWordsLabel: document.getElementById('total-words-label'),
    countNew: document.getElementById('count-new'),
    countWait10: document.getElementById('count-wait10'),
    dueWait10: document.getElementById('due-wait10'),
    countWait30: document.getElementById('count-wait30'),
    dueWait30: document.getElementById('due-wait30'),
    countMastered: document.getElementById('count-mastered'),

    fileImportTxt: document.getElementById('file-import-txt'),
    selectImportFormat: document.getElementById('select-import-format'),
    btnTogglePaste: document.getElementById('btn-toggle-paste'),
    pasteBox: document.getElementById('paste-box'),
    pasteTextarea: document.getElementById('paste-textarea'),
    btnImportPaste: document.getElementById('btn-import-paste'),
    btnCancelPaste: document.getElementById('btn-cancel-paste'),
    importReport: document.getElementById('import-report'),

    selectNewOrder: document.getElementById('select-new-order'),
    selectForget30Rule: document.getElementById('select-forget30-rule'),

    btnExportTxt: document.getElementById('btn-export-txt'),
    btnExportCsv: document.getElementById('btn-export-csv'),
    btnClearAll: document.getElementById('btn-clear-all'),

    toast: document.getElementById('toast'),
  };

  // =========================================================
  // Fixed Daily Batch & SRS Queue Logic
  // =========================================================

  function isDueReview(word, today) {
    return (
      (word.status === 'wait_10d' || word.status === 'wait_30d') &&
      Boolean(word.dueDate) &&
      word.dueDate <= today
    );
  }

  function getDueReviewPool(today) {
    return state.words
      .filter((w) => isDueReview(w, today))
      .sort((a, b) => {
        if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        return a.order - b.order;
      });
  }

  function getNewPool() {
    return state.words
      .filter((w) => w.status === 'new')
      .sort((a, b) => a.order - b.order);
  }

  function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function getWordById(id) {
    return state.words.find((w) => w.id === id) || null;
  }

  // Ensures today has a fixed batch of up to newQuota new words + reviewQuota due review words.
  // Once locked for the day, forgotten words loop inside today's batch without pulling extra words from outside.
  function ensureDailySession(allowTopUp = false) {
    const today = getTodayStr();
    const wordMap = new Map(state.words.map((w) => [w.id, w]));
    let changed = false;

    if (!state.dailySession || state.dailySession.date !== today) {
      const duePool = getDueReviewPool(today);
      let newPool = getNewPool();
      if (state.settings.newOrder === 'random') {
        newPool = shuffleArray(newPool);
      }

      const reviewIds = duePool.slice(0, state.settings.reviewQuota).map((w) => w.id);
      const newIds = newPool.slice(0, state.settings.newQuota).map((w) => w.id);

      state.dailySession = {
        date: today,
        reviewQueue: reviewIds,
        newQueue: newIds,
        assignedIds: [...reviewIds, ...newIds],
        relearningP1Ids: [],
        reviewDone: 0,
        newDone: 0,
      };
      changed = true;
    } else {
      // Remove any IDs that no longer exist in state.words
      const s = state.dailySession;
      if (!Array.isArray(s.relearningP1Ids)) s.relearningP1Ids = [];
      const beforeR = s.reviewQueue.length;
      const beforeN = s.newQueue.length;
      s.reviewQueue = s.reviewQueue.filter((id) => wordMap.has(id));
      s.newQueue = s.newQueue.filter((id) => wordMap.has(id));
      s.assignedIds = (s.assignedIds || []).filter((id) => wordMap.has(id));
      s.relearningP1Ids = s.relearningP1Ids.filter((id) => wordMap.has(id));
      if (s.reviewQueue.length !== beforeR || s.newQueue.length !== beforeN) {
        changed = true;
      }

      // Top up only when new words were just imported or user adjusted daily quota
      if (allowTopUp) {
        const assignedSet = new Set(s.assignedIds);

        const targetReviewRem = Math.max(0, state.settings.reviewQuota - (s.reviewDone || 0));
        if (s.reviewQueue.length < targetReviewRem) {
          const need = targetReviewRem - s.reviewQueue.length;
          const extraDue = getDueReviewPool(today)
            .filter((w) => !assignedSet.has(w.id))
            .slice(0, need);
          for (const w of extraDue) {
            s.reviewQueue.push(w.id);
            s.assignedIds.push(w.id);
            assignedSet.add(w.id);
            changed = true;
          }
        } else if (s.reviewQueue.length > targetReviewRem) {
          const removed = s.reviewQueue.splice(targetReviewRem);
          const remSet = new Set(removed);
          s.assignedIds = s.assignedIds.filter((id) => !remSet.has(id));
          changed = true;
        }

        const targetNewRem = Math.max(0, state.settings.newQuota - (s.newDone || 0));
        if (s.newQueue.length < targetNewRem) {
          const need = targetNewRem - s.newQueue.length;
          let extraNew = getNewPool().filter((w) => !assignedSet.has(w.id));
          if (state.settings.newOrder === 'random') {
            extraNew = shuffleArray(extraNew);
          }
          for (const w of extraNew.slice(0, need)) {
            s.newQueue.push(w.id);
            s.assignedIds.push(w.id);
            assignedSet.add(w.id);
            changed = true;
          }
        } else if (s.newQueue.length > targetNewRem) {
          const removed = s.newQueue.splice(targetNewRem);
          const remSet = new Set(removed);
          s.assignedIds = s.assignedIds.filter((id) => !remSet.has(id));
          changed = true;
        }
      }
    }

    if (changed) saveState();
    return state.dailySession;
  }

  function getCurrentQueueItem() {
    const s = ensureDailySession(false);
    if (s.reviewQueue.length > 0) {
      const w = getWordById(s.reviewQueue[0]);
      if (w) return { word: w, source: 'review' };
    }
    if (s.newQueue.length > 0) {
      const w = getWordById(s.newQueue[0]);
      if (w) return { word: w, source: 'new' };
    }
    return null;
  }

  function getSessionCounts() {
    const today = getTodayStr();
    const s = ensureDailySession(false);
    const duePool = getDueReviewPool(today);
    const newPool = getNewPool();

    return {
      today,
      stats: { newDone: s.newDone || 0, reviewDone: s.reviewDone || 0 },
      duePool,
      newPool,
      reviewRemaining: s.reviewQueue.length,
      newRemaining: s.newQueue.length,
    };
  }

  // =========================================================
  // SRS Actions (Auto-save immediately after every action)
  // =========================================================

  function cloneSession(s) {
    return {
      date: s.date,
      reviewQueue: [...s.reviewQueue],
      newQueue: [...s.newQueue],
      assignedIds: [...(s.assignedIds || [])],
      relearningP1Ids: [...(s.relearningP1Ids || [])],
      reviewDone: s.reviewDone || 0,
      newDone: s.newDone || 0,
    };
  }

  function pushUndo(word, prevSession, prevStats) {
    undoStack.push({
      wordSnapshot: { ...word },
      todayKey: getTodayStr(),
      statsSnapshot: { ...prevStats },
      sessionSnapshot: cloneSession(prevSession),
    });
    if (undoStack.length > 15) undoStack.shift();
  }

  function handleAction(actionType) {
    const item = getCurrentQueueItem();
    if (!item) return;

    const { word, source } = item;
    const today = getTodayStr();
    const stats = getTodayStats();
    const session = state.dailySession;
    pushUndo(word, session, stats);

    const queue = source === 'review' ? session.reviewQueue : session.newQueue;
    queue.shift(); // remove from front

    const prevStatus = word.status;
    if (!Array.isArray(session.relearningP1Ids)) session.relearningP1Ids = [];
    const isRelearningP1 = session.relearningP1Ids.includes(word.id);

    if (actionType === 'master') {
      // Removed from today's loop -> straight to mastered
      word.status = 'mastered';
      word.dueDate = null;
      word.updatedAt = today;
      session.relearningP1Ids = session.relearningP1Ids.filter((id) => id !== word.id);

      if (source === 'review') {
        session.reviewDone = (session.reviewDone || 0) + 1;
        stats.reviewDone += 1;
      } else {
        session.newDone = (session.newDone || 0) + 1;
        stats.newDone += 1;
      }
      showToast(`"${word.word}" → Đã thuộc`);
    } else if (actionType === 'remember') {
      // Removed from today's loop -> advance SRS stage
      if (isRelearningP1) {
        // Re-learned after forgetting at Part 2 (with forget30Rule === 'wait_10d'): keep at Part 1
        word.status = 'wait_10d';
        word.dueDate = addDays(today, state.settings.interval1Days);
        word.updatedAt = today;
        session.relearningP1Ids = session.relearningP1Ids.filter((id) => id !== word.id);
      } else if (prevStatus === 'new') {
        word.status = 'wait_10d';
        word.dueDate = addDays(today, state.settings.interval1Days);
        word.updatedAt = today;
      } else if (prevStatus === 'wait_10d') {
        word.status = 'wait_30d';
        word.dueDate = addDays(today, state.settings.interval2Days);
        word.updatedAt = today;
      } else if (prevStatus === 'wait_30d') {
        word.status = 'mastered';
        word.dueDate = null;
        word.updatedAt = today;
        showToast(`"${word.word}" → Đã thuộc`);
      }

      if (source === 'review') {
        session.reviewDone = (session.reviewDone || 0) + 1;
        stats.reviewDone += 1;
      } else {
        session.newDone = (session.newDone || 0) + 1;
        stats.newDone += 1;
      }
    } else if (actionType === 'forgot') {
      // Loop back to the end of today's batch so user can re-practice it today
      if (prevStatus === 'new') {
        word.updatedAt = today;
      } else if (prevStatus === 'wait_10d') {
        if (isRelearningP1) {
          word.dueDate = addDays(today, state.settings.interval1Days);
        } else {
          word.status = 'new';
          word.dueDate = null;
        }
        word.updatedAt = today;
      } else if (prevStatus === 'wait_30d') {
        if (state.settings.forget30Rule === 'wait_10d') {
          word.status = 'wait_10d';
          word.dueDate = addDays(today, state.settings.interval1Days);
          if (!session.relearningP1Ids.includes(word.id)) {
            session.relearningP1Ids.push(word.id);
          }
        } else {
          word.status = 'new';
          word.dueDate = null;
        }
        word.updatedAt = today;
      }

      queue.push(word.id);
    }

    // Immediate auto-save after every single word action
    saveState();

    isRevealed = false;
    renderStudyView();
  }

  function handleUndo() {
    if (undoStack.length === 0) return;
    const snap = undoStack.pop();
    const target = getWordById(snap.wordSnapshot.id);
    if (target) {
      Object.assign(target, snap.wordSnapshot);
    }
    state.dailyStats[snap.todayKey] = { ...snap.statsSnapshot };
    state.dailySession = cloneSession(snap.sessionSnapshot);
    saveState();

    isRevealed = false;
    renderStudyView();
    showToast(`Đã hoàn tác "${snap.wordSnapshot.word}"`);
  }

  // =========================================================
  // Import Parser (.txt |, .tsv Tab / Excel paste, .csv)
  // Forgiving row-by-row parser: keeps every row with a word,
  // leaves missing fields empty instead of rejecting the row.
  // =========================================================

  function parseDelimitedText(text, delimiter) {
    // Full-text quote-aware parser (handles multiline quoted cells from Excel/CSV/TSV)
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let rowStartLine = 1;
    let currentLine = 1;

    const pushRow = () => {
      row.push(field.trim());
      if (row.some((cell) => cell !== '')) {
        rows.push({ lineNum: rowStartLine, parts: row });
      }
      row = [];
      field = '';
    };

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          if (ch === '\r') {
            if (text[i + 1] === '\n') i++;
            currentLine++;
            field += ' ';
          } else if (ch === '\n') {
            currentLine++;
            field += ' ';
          } else {
            field += ch;
          }
        }
      } else {
        if (ch === '"' && field.trim() === '' && delimiter !== '|') {
          inQuotes = true;
          field = '';
        } else if (ch === delimiter) {
          row.push(field.trim());
          field = '';
        } else if (ch === '\r' || ch === '\n') {
          if (ch === '\r' && text[i + 1] === '\n') i++;
          pushRow();
          currentLine++;
          rowStartLine = currentLine;
        } else {
          field += ch;
        }
      }
    }

    if (field.trim() !== '' || row.length > 0) {
      pushRow();
    }

    // Filter out comment lines starting with #
    return rows.filter((r) => !(r.parts.length > 0 && r.parts[0].startsWith('#')));
  }

  function detectDelimiter(cleanedText) {
    const sampleLines = cleanedText
      .split(/\r\n|\r|\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .slice(0, 30);

    if (sampleLines.length === 0) return '|';

    const candidates = ['\t', '|', ';', ','];
    let bestDelim = '|';
    let bestScore = -1;

    for (const d of candidates) {
      let linesWithDelim = 0;
      let headerBonus = 0;

      const firstParts = sampleLines[0].split(d).map((p) => p.trim().replace(/^"|"$/g, ''));
      if (firstParts.length >= 2 && looksLikeHeader(firstParts)) {
        headerBonus = 1000;
      }

      for (const line of sampleLines) {
        if (line.includes(d)) linesWithDelim++;
      }

      // Require delimiter to actually appear; prefer the one present in the most lines
      const score = headerBonus + linesWithDelim * 10 + (d === '\t' || d === '|' ? 1 : 0);
      if (linesWithDelim > 0 && score > bestScore) {
        bestScore = score;
        bestDelim = d;
      }
    }

    return bestDelim;
  }

  function mapHeaderColumn(rawName) {
    const k = rawName.trim().toLowerCase();
    if (['word', 'vocab', 'vocabulary', 'term', 'từ', 'từ vựng'].includes(k)) return 'word';
    if (['pos', 'type', 'part of speech', 'word type', 'từ loại', 'loại từ'].includes(k)) return 'pos';
    if (['pronounce', 'pronunciation', 'ipa', 'phonetic', 'phonetics', 'phiên âm'].includes(k)) return 'ipa';
    if (['meaning', 'meanings', 'definition', 'vietnamese', 'nghĩa', 'nghĩa tiếng việt'].includes(k)) return 'meaning';
    if (['example', 'examples', 'sentence', 'ví dụ', 'câu ví dụ'].includes(k)) return 'example';
    if (['note', 'notes', 'memo', 'ghi chú', 'mẹo nhớ'].includes(k)) return 'note';
    if (['group', 'topic', 'category', 'unit', 'chapter', 'list', 'nhóm', 'chủ đề', 'chương'].includes(k)) return 'group';
    return null;
  }

  function looksLikeHeader(parts) {
    const mapped = parts.map(mapHeaderColumn);
    const recognizedCount = mapped.filter(Boolean).length;
    return mapped.includes('word') && recognizedCount >= 2;
  }

  function hasVietnameseChars(str) {
    return /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(str);
  }

  function looksLikeIpa(str) {
    if (!str) return false;
    return /[əæɑɔɛɪʊʌʃʒθðŋˈˌ']/.test(str) || /^\/.+\/$/.test(str);
  }

  function inferColumnMap(rows, formatPref) {
    if (formatPref === 'word_type_pronounce_meaning') {
      return { word: 0, pos: 1, ipa: 2, meaning: 3, example: 4, note: 5, group: 6 };
    }
    if (formatPref === 'word_pos_meaning') {
      return { word: 0, pos: 1, meaning: 2, example: 3, ipa: 4, note: 5, group: 6 };
    }

    // Auto-detect when there is no header row
    let pronounceCol2Votes = 0;
    let meaningCol2Votes = 0;
    for (const parts of rows.slice(0, 25)) {
      const c2 = parts[2] || '';
      const c3 = parts[3] || '';
      if ((looksLikeIpa(c2) || c2 === '') && hasVietnameseChars(c3)) {
        pronounceCol2Votes++;
      } else if (hasVietnameseChars(c2)) {
        meaningCol2Votes++;
      }
    }

    if (pronounceCol2Votes > meaningCol2Votes) {
      return { word: 0, pos: 1, ipa: 2, meaning: 3, example: 4, note: 5, group: 6 };
    }
    return { word: 0, pos: 1, meaning: 2, example: 3, ipa: 4, note: 5, group: 6 };
  }

  function makeWordKey(wordText, pos) {
    const w = wordText.trim().toLowerCase();
    const p = (pos || '').trim().toLowerCase();
    return p ? `${w}||${p}` : w;
  }

  // =========================================================
  // Native .xlsx (Excel) Reader (zero dependencies)
  // =========================================================

  async function inflateRaw(compressedBytes) {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(compressedBytes);
    writer.close();
    const out = await new Response(ds.readable).arrayBuffer();
    return new Uint8Array(out);
  }

  async function unzipXlsxEntries(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);

    // Find End of Central Directory signature (0x06054b50)
    let eocdOffset = -1;
    const minSearch = Math.max(0, bytes.length - 65557);
    for (let i = bytes.length - 22; i >= minSearch; i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset === -1) {
      throw new Error('Không đọc được cấu trúc file Excel (.xlsx).');
    }

    const totalEntries = view.getUint16(eocdOffset + 10, true);
    const cdOffset = view.getUint32(eocdOffset + 16, true);
    const decoder = new TextDecoder('utf-8');
    const files = new Map();

    let ptr = cdOffset;
    for (let i = 0; i < totalEntries; i++) {
      if (view.getUint32(ptr, true) !== 0x02014b50) break;
      const method = view.getUint16(ptr + 10, true);
      const compSize = view.getUint32(ptr + 20, true);
      const nameLen = view.getUint16(ptr + 28, true);
      const extraLen = view.getUint16(ptr + 30, true);
      const commentLen = view.getUint16(ptr + 32, true);
      const localHeaderOffset = view.getUint32(ptr + 42, true);

      const fileName = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
      ptr += 46 + nameLen + extraLen + commentLen;

      const wanted =
        fileName === 'xl/sharedStrings.xml' ||
        fileName === 'xl/worksheets/sheet1.xml' ||
        /^xl\/worksheets\/sheet\d+\.xml$/i.test(fileName);
      if (!wanted) continue;

      const lNameLen = view.getUint16(localHeaderOffset + 26, true);
      const lExtraLen = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
      const compData = bytes.subarray(dataStart, dataStart + compSize);

      let rawData;
      if (method === 0) {
        rawData = compData;
      } else if (method === 8) {
        rawData = await inflateRaw(compData);
      } else {
        continue;
      }
      files.set(fileName, decoder.decode(rawData));
    }

    return files;
  }

  function excelColToIndex(colLetters) {
    let idx = 0;
    for (let i = 0; i < colLetters.length; i++) {
      idx = idx * 26 + (colLetters.charCodeAt(i) - 64);
    }
    return idx - 1;
  }

  async function parseXlsxToRows(arrayBuffer) {
    const files = await unzipXlsxEntries(arrayBuffer);
    const parser = new DOMParser();

    // Parse shared strings table
    const sharedStrings = [];
    const ssXml = files.get('xl/sharedStrings.xml');
    if (ssXml) {
      const ssDoc = parser.parseFromString(ssXml, 'application/xml');
      const siNodes = ssDoc.getElementsByTagName('si');
      for (let i = 0; i < siNodes.length; i++) {
        const tNodes = siNodes[i].getElementsByTagName('t');
        let text = '';
        for (let j = 0; j < tNodes.length; j++) {
          text += tNodes[j].textContent || '';
        }
        sharedStrings.push(text.replace(/\r?\n/g, ' ').trim());
      }
    }

    // Pick sheet1.xml (or first worksheet found)
    let sheetXml = files.get('xl/worksheets/sheet1.xml');
    if (!sheetXml) {
      for (const [name, xml] of files.entries()) {
        if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(name)) {
          sheetXml = xml;
          break;
        }
      }
    }
    if (!sheetXml) {
      throw new Error('Không tìm thấy trang tính (sheet) trong file Excel.');
    }

    const sheetDoc = parser.parseFromString(sheetXml, 'application/xml');
    const rowNodes = sheetDoc.getElementsByTagName('row');
    const parsedRows = [];

    for (let i = 0; i < rowNodes.length; i++) {
      const rowEl = rowNodes[i];
      const lineNum = parseInt(rowEl.getAttribute('r') || String(i + 1), 10);
      const cellNodes = rowEl.getElementsByTagName('c');
      const parts = [];

      for (let j = 0; j < cellNodes.length; j++) {
        const cell = cellNodes[j];
        const ref = cell.getAttribute('r') || '';
        const colMatch = ref.match(/^([A-Z]+)/i);
        const colIdx = colMatch ? excelColToIndex(colMatch[1].toUpperCase()) : j;
        const type = cell.getAttribute('t') || '';

        let val = '';
        if (type === 's') {
          const vNode = cell.getElementsByTagName('v')[0];
          const ssIdx = vNode ? parseInt(vNode.textContent || '', 10) : -1;
          val = ssIdx >= 0 && ssIdx < sharedStrings.length ? sharedStrings[ssIdx] : '';
        } else if (type === 'inlineStr') {
          const tNodes = cell.getElementsByTagName('t');
          for (let k = 0; k < tNodes.length; k++) {
            val += tNodes[k].textContent || '';
          }
        } else {
          const vNode = cell.getElementsByTagName('v')[0];
          val = vNode ? vNode.textContent || '' : '';
        }

        while (parts.length <= colIdx) parts.push('');
        parts[colIdx] = val.replace(/\r?\n/g, ' ').trim();
      }

      if (parts.some((p) => p !== '')) {
        parsedRows.push({ lineNum, parts });
      }
    }

    return parsedRows;
  }

  function importParsedRows(parsedRows, options = {}) {
    const formatPref = options.format || 'auto';
    const defaultGroup = (options.defaultGroup || '').trim();
    const delimiter = options.delimiter || null;

    if (!parsedRows || parsedRows.length === 0) {
      return { added: 0, keptExisting: 0, updatedMeta: 0, duplicateInFile: 0, errorLines: [] };
    }

    let colMap = null;
    let startIdx = 0;

    // 1. Check if first row is a header row (e.g., Word | Type | Pronounce | Meaning)
    if (looksLikeHeader(parsedRows[0].parts)) {
      colMap = {};
      parsedRows[0].parts.forEach((h, idx) => {
        const field = mapHeaderColumn(h);
        if (field && colMap[field] === undefined) {
          colMap[field] = idx;
        }
      });
      startIdx = 1;
    } else {
      colMap = inferColumnMap(
        parsedRows.map((r) => r.parts),
        formatPref
      );
    }

    // Track highest mapped column index so extra unquoted commas in the last column (e.g. Meaning) are preserved
    const mappedEntries = Object.entries(colMap).filter(([, idx]) => typeof idx === 'number');
    let lastFieldName = null;
    let lastFieldIdx = -1;
    for (const [name, idx] of mappedEntries) {
      if (idx > lastFieldIdx) {
        lastFieldIdx = idx;
        lastFieldName = name;
      }
    }

    const existingByKey = new Map();
    for (const w of state.words) {
      existingByKey.set(w.key, w);
    }

    const seenInFile = new Set();
    let added = 0;
    let keptExisting = 0;
    let updatedMeta = 0;
    let duplicateInFile = 0;
    const errorLines = [];
    const today = getTodayStr();

    const getField = (parts, fieldName) => {
      const idx = colMap[fieldName];
      if (idx === undefined || idx < 0 || idx >= parts.length) return '';
      if (delimiter && fieldName === lastFieldName && parts.length > lastFieldIdx + 1) {
        const sep = delimiter === ',' ? ', ' : ' ';
        return parts.slice(idx).filter(Boolean).join(sep).trim();
      }
      return (parts[idx] || '').trim();
    };

    for (let i = startIdx; i < parsedRows.length; i++) {
      const { lineNum, parts } = parsedRows[i];

      const wordText = getField(parts, 'word');
      if (!wordText) {
        errorLines.push(`Dòng ${lineNum}: không có từ vựng`);
        continue;
      }

      const pos = getField(parts, 'pos');
      const meaning = getField(parts, 'meaning');
      const example = getField(parts, 'example');
      let ipa = getField(parts, 'ipa');
      const note = getField(parts, 'note');
      const group = getField(parts, 'group') || defaultGroup;

      if (ipa && !ipa.startsWith('/') && !ipa.startsWith('[')) {
        ipa = `/${ipa}/`;
      }

      const key = makeWordKey(wordText, pos);
      if (seenInFile.has(key)) {
        duplicateInFile += 1;
        continue;
      }
      seenInFile.add(key);

      const existing = existingByKey.get(key) || existingByKey.get(wordText.toLowerCase());
      if (existing) {
        keptExisting += 1;
        let metaChanged = false;
        if (!existing.pos && pos) { existing.pos = pos; metaChanged = true; }
        if (!existing.meaning && meaning) { existing.meaning = meaning; metaChanged = true; }
        if (!existing.example && example) { existing.example = example; metaChanged = true; }
        if (!existing.ipa && ipa) { existing.ipa = ipa; metaChanged = true; }
        if (!existing.note && note) { existing.note = note; metaChanged = true; }
        if (!existing.group && group) { existing.group = group; metaChanged = true; }
        if (metaChanged) updatedMeta += 1;
        continue;
      }

      const newWord = {
        id: makeId(),
        key,
        word: wordText,
        pos,
        meaning,
        example,
        ipa,
        note,
        group,
        status: 'new',
        dueDate: null,
        order: state.nextOrder++,
        createdAt: today,
        updatedAt: today,
      };

      state.words.push(newWord);
      existingByKey.set(key, newWord);
      added += 1;
    }

    if (added > 0 || updatedMeta > 0) {
      saveState();
      ensureDailySession(true);
    }

    return { added, keptExisting, updatedMeta, duplicateInFile, errorLines };
  }

  function importPipeText(rawText, options = {}) {
    const cleaned = rawText.replace(/^\uFEFF/, '');
    if (!cleaned.trim()) {
      return { added: 0, keptExisting: 0, updatedMeta: 0, duplicateInFile: 0, errorLines: [] };
    }
    const delimiter = detectDelimiter(cleaned);
    const parsedRows = parseDelimitedText(cleaned, delimiter);
    return importParsedRows(parsedRows, { ...options, delimiter });
  }

  function renderImportReport(res) {
    const lines = [
      `<strong>Đã thêm mới:</strong> ${res.added} từ`,
      `<strong>Giữ nguyên tiến độ từ đã có:</strong> ${res.keptExisting} từ${res.updatedMeta > 0 ? ` (bổ sung thông tin trống cho ${res.updatedMeta} từ)` : ''}`,
    ];
    if (res.duplicateInFile > 0) {
      lines.push(`<strong>Trùng lặp trong file (đã bỏ qua):</strong> ${res.duplicateInFile} dòng`);
    }
    if (res.errorLines.length > 0) {
      const preview = res.errorLines.slice(0, 4).join('; ');
      const extra = res.errorLines.length > 4 ? ` (+${res.errorLines.length - 4} dòng khác)` : '';
      lines.push(`<strong>Dòng lỗi (đã bỏ qua):</strong> ${res.errorLines.length} — ${escapeHtml(preview)}${extra}`);
    }
    els.importReport.innerHTML = lines.join('<br />');
    els.importReport.classList.remove('hidden');
  }

  // =========================================================
  // Rendering: Study View
  // =========================================================

  function renderStudyView() {
    const counts = getSessionCounts();

    // Update top quota bar
    els.statNewRemaining.textContent = String(counts.newRemaining);
    els.statNewQuota.textContent = String(state.settings.newQuota);
    els.statReviewRemaining.textContent = String(counts.reviewRemaining);
    els.statReviewQuota.textContent = String(state.settings.reviewQuota);
    els.inputNewQuota.value = String(state.settings.newQuota);
    els.inputReviewQuota.value = String(state.settings.reviewQuota);

    // Undo button visibility
    if (undoStack.length > 0) {
      els.btnUndo.classList.remove('hidden');
    } else {
      els.btnUndo.classList.add('hidden');
    }

    const item = getCurrentQueueItem();

    if (!item) {
      els.studyStage.classList.add('hidden');
      els.studyEmpty.classList.remove('hidden');
      renderEmptyState(counts);
      return;
    }

    const word = item.word;
    els.studyEmpty.classList.add('hidden');
    els.studyStage.classList.remove('hidden');

    // Badge
    const d1 = state.settings.interval1Days;
    const d2 = state.settings.interval2Days;
    const isRelearningP1 =
      state.dailySession &&
      Array.isArray(state.dailySession.relearningP1Ids) &&
      state.dailySession.relearningP1Ids.includes(word.id);
    els.cardBadge.className = 'card-badge';
    if (word.status === 'new' || isRelearningP1) {
      els.cardBadge.textContent = item.source === 'review' ? 'ÔN LẠI HÔM NAY' : 'TỪ MỚI';
      els.cardBadge.classList.add('badge-new');
      els.forgotSub.textContent = 'Lặp lại hôm nay';
      els.rememberSub.textContent = `→ Part 1 (${d1} ngày)`;
    } else if (word.status === 'wait_10d') {
      els.cardBadge.textContent = `ÔN PART 1 (${d1} NGÀY)`;
      els.cardBadge.classList.add('badge-10d');
      els.forgotSub.textContent = 'Về Mới & lặp lại';
      els.rememberSub.textContent = `→ Part 2 (${d2} ngày)`;
    } else if (word.status === 'wait_30d') {
      els.cardBadge.textContent = `ÔN PART 2 (${d2} NGÀY)`;
      els.cardBadge.classList.add('badge-30d');
      els.forgotSub.textContent =
        state.settings.forget30Rule === 'wait_10d' ? `Về Part 1 & lặp lại` : 'Về Mới & lặp lại';
      els.rememberSub.textContent = '→ Kho Đã thuộc';
    }

    els.cardGroup.textContent = word.group || '';
    els.cardWord.textContent = word.word;

    // Optional front fields (auto-hide when empty)
    if (word.pos) {
      els.cardPos.textContent = word.pos;
      els.cardPos.classList.remove('hidden');
    } else {
      els.cardPos.classList.add('hidden');
    }

    if (word.ipa) {
      els.cardIpa.textContent = word.ipa;
      els.cardIpa.classList.remove('hidden');
    } else {
      els.cardIpa.classList.add('hidden');
    }

    // Back fields
    els.cardMeaning.textContent = word.meaning || '(Chưa có nghĩa)';

    if (word.example) {
      els.cardExample.textContent = word.example;
      els.cardExample.classList.remove('hidden');
    } else {
      els.cardExample.classList.add('hidden');
    }

    if (word.note) {
      els.cardNote.textContent = `Ghi chú: ${word.note}`;
      els.cardNote.classList.remove('hidden');
    } else {
      els.cardNote.classList.add('hidden');
    }

    // Toggle meaning visibility on card (action buttons are always visible)
    els.cardDivider.classList.toggle('hidden', !isRevealed);
    els.cardBack.classList.toggle('hidden', !isRevealed);
    els.cardFlipHint.classList.toggle('hidden', isRevealed);
    els.btnMasterBack.classList.toggle('hidden', word.status === 'wait_30d');
  }

  function renderEmptyState(counts) {
    els.emptyStats.innerHTML = '';
    els.emptyActions.innerHTML = '';

    if (state.words.length === 0) {
      els.emptyIcon.textContent = '+';
      els.emptyTitle.textContent = 'Chưa có từ vựng nào';
      els.emptyDesc.textContent =
        'Vào tab Kho từ để nạp file danh sách từ hoặc dán trực tiếp từ Excel để bắt đầu học.';

      const btnGoImport = document.createElement('button');
      btnGoImport.className = 'btn btn-primary';
      btnGoImport.textContent = 'Nạp danh sách từ';
      btnGoImport.addEventListener('click', () => switchView('manage'));

      els.emptyActions.append(btnGoImport);
      return;
    }

    els.emptyIcon.textContent = '✓';
    els.emptyTitle.textContent = 'Đã hoàn thành phiên hôm nay';

    const extraDue = counts.duePool.length;
    const extraNew = counts.newPool.length;

    const descParts = [];
    if (extraDue > 0 || extraNew > 0) {
      descParts.push('Bạn đã hoàn thành đúng nhịp quota hôm nay. Các từ còn lại sẽ chờ sang ngày mai.');
    } else if (state.settings.studyGroup !== 'ALL') {
      descParts.push(`Nhóm "${state.settings.studyGroup}" hiện không còn từ mới hay từ đến hạn hôm nay.`);
    } else {
      descParts.push('Hiện không còn từ mới hoặc từ đến hạn ôn hôm nay.');
    }
    els.emptyDesc.textContent = descParts.join(' ');

    const pills = [
      `Hôm nay đã học mới: ${counts.stats.newDone}`,
      `Hôm nay đã ôn: ${counts.stats.reviewDone}`,
    ];
    if (extraDue > 0) pills.push(`Còn chờ ôn: ${extraDue}`);
    if (extraNew > 0) pills.push(`Kho từ mới: ${extraNew}`);

    for (const txt of pills) {
      const span = document.createElement('span');
      span.className = 'empty-stat-pill';
      span.textContent = txt;
      els.emptyStats.appendChild(span);
    }

    if (extraNew > 0) {
      const btnMoreNew = document.createElement('button');
      btnMoreNew.className = 'btn btn-subtle';
      btnMoreNew.textContent = '+10 từ mới hôm nay';
      btnMoreNew.addEventListener('click', () => {
        state.settings.newQuota += 10;
        ensureDailySession(true);
        saveState();
        renderAll();
      });
      els.emptyActions.appendChild(btnMoreNew);
    }

    if (extraDue > 0) {
      const btnMoreRev = document.createElement('button');
      btnMoreRev.className = 'btn btn-subtle';
      btnMoreRev.textContent = '+10 từ ôn hôm nay';
      btnMoreRev.addEventListener('click', () => {
        state.settings.reviewQuota += 10;
        ensureDailySession(true);
        saveState();
        renderAll();
      });
      els.emptyActions.appendChild(btnMoreRev);
    }

    if (state.settings.studyGroup !== 'ALL') {
      const btnAllGroups = document.createElement('button');
      btnAllGroups.className = 'btn btn-primary';
      btnAllGroups.textContent = 'Học tất cả nhóm';
      btnAllGroups.addEventListener('click', () => {
        state.settings.studyGroup = 'ALL';
        saveState();
        renderAll();
      });
      els.emptyActions.appendChild(btnAllGroups);
    }

    const btnManage = document.createElement('button');
    btnManage.className = 'btn btn-ghost';
    btnManage.textContent = 'Mở Kho từ';
    btnManage.addEventListener('click', () => switchView('manage'));
    els.emptyActions.appendChild(btnManage);
  }

  // =========================================================
  // Rendering: Manage View
  // =========================================================

  function getUniqueGroups() {
    const set = new Set();
    for (const w of state.words) {
      if (w.group) set.add(w.group);
    }
    return Array.from(set);
  }

  function populateGroupSelects() {
    const groups = getUniqueGroups();

    const fill = (selectEl, currentVal, allLabel) => {
      const prev = currentVal;
      selectEl.innerHTML = '';
      const optAll = document.createElement('option');
      optAll.value = 'ALL';
      optAll.textContent = allLabel;
      selectEl.appendChild(optAll);

      for (const g of groups) {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        selectEl.appendChild(opt);
      }

      selectEl.value = groups.includes(prev) ? prev : 'ALL';
    };

    fill(els.selectStudyGroup, state.settings.studyGroup, 'Tất cả nhóm');
    if (els.selectStudyGroup.value !== state.settings.studyGroup) {
      state.settings.studyGroup = 'ALL';
    }
  }

  function renderManageView() {
    const today = getTodayStr();
    let cNew = 0;
    let c10 = 0;
    let due10 = 0;
    let c30 = 0;
    let due30 = 0;
    let cMastered = 0;

    for (const w of state.words) {
      if (w.status === 'new') cNew++;
      else if (w.status === 'wait_10d') {
        c10++;
        if (w.dueDate && w.dueDate <= today) due10++;
      } else if (w.status === 'wait_30d') {
        c30++;
        if (w.dueDate && w.dueDate <= today) due30++;
      } else if (w.status === 'mastered') cMastered++;
    }

    els.totalWordsLabel.textContent = `${state.words.length} từ`;
    els.labelBucketP1.textContent = `Chờ ôn Part 1 (${state.settings.interval1Days} ngày)`;
    els.labelBucketP2.textContent = `Chờ ôn Part 2 (${state.settings.interval2Days} ngày)`;
    els.countNew.textContent = String(cNew);
    els.countWait10.textContent = String(c10);
    els.dueWait10.textContent = `Đến hạn: ${due10}`;
    els.countWait30.textContent = String(c30);
    els.dueWait30.textContent = `Đến hạn: ${due30}`;
    els.countMastered.textContent = String(cMastered);

    // Sync settings controls
    els.inputNewQuota.value = String(state.settings.newQuota);
    els.inputReviewQuota.value = String(state.settings.reviewQuota);
    els.inputInterval1.value = String(state.settings.interval1Days);
    els.inputInterval2.value = String(state.settings.interval2Days);
    els.selectNewOrder.value = state.settings.newOrder;
    els.selectForget30Rule.value = state.settings.forget30Rule;
  }

  function renderAll() {
    renderStudyView();
    if (currentView === 'manage') {
      renderManageView();
    }
  }

  // =========================================================
  // View Switching & Helpers
  // =========================================================

  function switchView(viewName) {
    currentView = viewName;
    const isStudy = viewName === 'study';

    els.tabStudy.classList.toggle('active', isStudy);
    els.tabStudy.setAttribute('aria-selected', String(isStudy));
    els.tabManage.classList.toggle('active', !isStudy);
    els.tabManage.setAttribute('aria-selected', String(!isStudy));

    els.viewStudy.classList.toggle('active', isStudy);
    els.viewManage.classList.toggle('active', !isStudy);

    if (isStudy) {
      renderStudyView();
    } else {
      renderManageView();
    }
  }

  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.classList.add('hidden');
    }, 2400);
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // =========================================================
  // Event Listeners
  // =========================================================

  // Navigation tabs
  els.tabStudy.addEventListener('click', () => switchView('study'));
  els.tabManage.addEventListener('click', () => switchView('manage'));

  // Daily quota & SRS interval settings (in Kho từ -> Cấu hình học & hiển thị)
  function applyNumericSettings() {
    const nq = Math.max(0, Math.min(500, parseInt(els.inputNewQuota.value, 10) || 0));
    const rq = Math.max(0, Math.min(500, parseInt(els.inputReviewQuota.value, 10) || 0));
    const d1 = Math.max(1, Math.min(365, parseInt(els.inputInterval1.value, 10) || 1));
    const d2 = Math.max(1, Math.min(365, parseInt(els.inputInterval2.value, 10) || 1));
    const quotaChanged = nq !== state.settings.newQuota || rq !== state.settings.reviewQuota;
    state.settings.newQuota = nq;
    state.settings.reviewQuota = rq;
    state.settings.interval1Days = d1;
    state.settings.interval2Days = d2;
    els.inputNewQuota.value = String(nq);
    els.inputReviewQuota.value = String(rq);
    els.inputInterval1.value = String(d1);
    els.inputInterval2.value = String(d2);
    if (quotaChanged) {
      undoStack = [];
    }
    ensureDailySession(true);
    saveState();
    renderAll();
  }

  els.inputNewQuota.addEventListener('change', applyNumericSettings);
  els.inputReviewQuota.addEventListener('change', applyNumericSettings);
  els.inputInterval1.addEventListener('change', applyNumericSettings);
  els.inputInterval2.addEventListener('change', applyNumericSettings);

  document.querySelectorAll('.stepper-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      const delta = parseInt(btn.dataset.delta, 10);
      const min = parseInt(input.min || '0', 10);
      const max = parseInt(input.max || '500', 10);
      const nextVal = Math.max(min, Math.min(max, (parseInt(input.value, 10) || 0) + delta));
      input.value = String(nextVal);
      applyNumericSettings();
    });
  });

  els.btnUndo.addEventListener('click', handleUndo);

  // Flashcard tap to toggle meaning & always-available action buttons
  function toggleRevealCard() {
    if (!getCurrentQueueItem()) return;
    isRevealed = !isRevealed;
    renderStudyView();
  }

  els.flashcard.addEventListener('click', toggleRevealCard);
  els.btnForgot.addEventListener('click', () => handleAction('forgot'));
  els.btnRemembered.addEventListener('click', () => handleAction('remember'));
  els.btnMasterBack.addEventListener('click', () => handleAction('master'));

  // Keyboard shortcuts on Desktop (only on Study view when not typing in an input)
  document.addEventListener('keydown', (e) => {
    if (currentView !== 'study') return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.metaKey || e.altKey) return;

    const key = e.key.toLowerCase();

    if ((key === 'z' && !e.shiftKey) || (e.ctrlKey && key === 'z')) {
      if (undoStack.length > 0) {
        e.preventDefault();
        handleUndo();
      }
      return;
    }

    if (e.ctrlKey) return;
    if (!getCurrentQueueItem()) return;

    if (key === ' ' || key === 'enter') {
      e.preventDefault();
      toggleRevealCard();
      return;
    }

    if (key === '1' || key === 'q' || key === 'arrowleft') {
      e.preventDefault();
      handleAction('forgot');
    } else if (key === '2' || key === 't' || key === 'arrowright') {
      e.preventDefault();
      handleAction('remember');
    } else if (key === '3' || key === 'm') {
      e.preventDefault();
      handleAction('master');
    }
  });

  // Clear entire vocabulary store
  els.btnClearAll.addEventListener('click', () => {
    if (state.words.length === 0) {
      showToast('Kho từ đang trống.');
      return;
    }
    if (!window.confirm(`Xóa toàn bộ ${state.words.length} từ trong kho? Hành động này không thể hoàn tác.`)) return;

    state.words = [];
    state.nextOrder = 1;
    state.settings.studyGroup = 'ALL';
    state.dailySession = null;
    undoStack = [];
    saveState();
    renderAll();
    showToast('Đã xóa toàn bộ kho từ');
  });

  // Import XLSX / TXT / CSV / TSV file
  els.fileImportTxt.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    e.target.value = '';

    try {
      const buf = await file.arrayBuffer();
      const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
      const isZip = head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
      const isXlsx = file.name.toLowerCase().endsWith('.xlsx') || isZip;

      let res;
      if (isXlsx) {
        const rows = await parseXlsxToRows(buf);
        res = importParsedRows(rows, { format: els.selectImportFormat.value });
      } else {
        const text = new TextDecoder('utf-8').decode(buf);
        res = importPipeText(text, { format: els.selectImportFormat.value });
      }

      renderImportReport(res);
      renderAll();
      showToast(`Nạp xong: +${res.added} từ mới`);
    } catch (err) {
      console.error('Import failed:', err);
      showToast(err && err.message ? err.message : 'Không thể đọc file này.');
    }
  });

  // Paste import box
  els.btnTogglePaste.addEventListener('click', () => {
    els.pasteBox.classList.toggle('hidden');
    if (!els.pasteBox.classList.contains('hidden')) {
      els.pasteTextarea.focus();
    }
  });

  els.btnCancelPaste.addEventListener('click', () => {
    els.pasteBox.classList.add('hidden');
  });

  els.btnImportPaste.addEventListener('click', () => {
    const text = els.pasteTextarea.value.trim();
    if (!text) {
      showToast('Hãy dán ít nhất một dòng từ vựng.');
      return;
    }
    const res = importPipeText(text, {
      format: els.selectImportFormat.value,
    });
    renderImportReport(res);
    els.pasteTextarea.value = '';
    els.pasteBox.classList.add('hidden');
    renderAll();
    showToast(`Nạp xong: +${res.added} từ mới`);
  });

  // Settings listeners
  els.selectNewOrder.addEventListener('change', () => {
    state.settings.newOrder = els.selectNewOrder.value;
    saveState();
  });

  els.selectForget30Rule.addEventListener('change', () => {
    state.settings.forget30Rule = els.selectForget30Rule.value;
    saveState();
    renderStudyView();
  });

  function getSortedWordsForExport() {
    return state.words.slice().sort((a, b) => a.order - b.order);
  }

  function csvEscape(val) {
    const str = String(val || '');
    if (/[",\r\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  // Export entire vocabulary store to .txt (UTF-8, pipe-delimited)
  els.btnExportTxt.addEventListener('click', () => {
    if (state.words.length === 0) {
      showToast('Kho từ đang trống.');
      return;
    }
    const header = 'Word | Type | Pronounce | Meaning | Example | Note';
    const rows = getSortedWordsForExport().map((w) =>
      [w.word, w.pos, w.ipa, w.meaning, w.example, w.note]
        .map((v) => (v || '').replace(/\|/g, '/'))
        .join(' | ')
    );
    const content = [header, ...rows].join('\n');
    downloadFile(`mestar-eng-words-${getTodayStr()}.txt`, content, 'text/plain;charset=utf-8');
    showToast(`Đã xuất ${state.words.length} từ ra file .txt`);
  });

  // Export entire vocabulary store to .csv (UTF-8 with BOM for Excel Vietnamese support)
  els.btnExportCsv.addEventListener('click', () => {
    if (state.words.length === 0) {
      showToast('Kho từ đang trống.');
      return;
    }
    const header = ['Word', 'Type', 'Pronounce', 'Meaning', 'Example', 'Note'].join(',');
    const rows = getSortedWordsForExport().map((w) =>
      [w.word, w.pos, w.ipa, w.meaning, w.example, w.note].map(csvEscape).join(',')
    );
    const content = '\uFEFF' + [header, ...rows].join('\r\n');
    downloadFile(`mestar-eng-words-${getTodayStr()}.csv`, content, 'text/csv;charset=utf-8');
    showToast(`Đã xuất ${state.words.length} từ ra file .csv`);
  });

  // =========================================================
  // Initial Boot & PWA Service Worker Registration
  // =========================================================
  renderStudyView();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
