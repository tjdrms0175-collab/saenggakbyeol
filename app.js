'use strict';

/* 생각별: children-first demo; no SDK or external resources required. */
(() => {
  const $ = (selector) => document.querySelector(selector);
  const nowDay = () => {
    const d = new Date();
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  };
  const SUBJECT_EMOJI = { 국어: '📖', 수학: '🔢', 사회: '🌍', 과학: '🔬', 영어: '🔤' };
  // Installable mobile PWA (same UI as v7). No API keys or learner content cached by the service worker.
  let installPrompt = null;
  function standalone() { return window.matchMedia('(display-mode: standalone)').matches || Boolean(navigator.standalone); }
  function toggleOfflineBanner() { $('#offlineBanner').hidden = navigator.onLine; }
  function closeInstallDialog() { $('#installModal').hidden = true; document.body.style.overflow = ''; }
  function showInstallInstructions() {
    if (standalone()) { showToast('이미 생각별 앱으로 실행 중이에요. 🌷'); return; }
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isAndroid = /Android/i.test(navigator.userAgent);
    const secure = window.isSecureContext;
    const msg = $('#installInstructions');
    if (!secure) msg.textContent = '휴대폰에서 앱을 설치하고 음성을 사용하려면 HTTPS 주소로 접속해 주세요. 노트북의 127.0.0.1 주소는 휴대폰에서 사용할 수 없어요.';
    else if (isIos) msg.textContent = '아이폰 Safari에서 공유(□↑) → 홈 화면에 추가 → 추가를 선택해 주세요. 그러면 생각별 아이콘을 눌러 앱처럼 열 수 있어요.';
    else if (isAndroid) msg.textContent = '안드로이드 Chrome에서 오른쪽 위 ⋮ → 앱 설치 또는 홈 화면에 추가 → 설치를 선택해 주세요.';
    else msg.textContent = '브라우저 주소창의 앱 설치 아이콘 또는 메뉴에서 설치를 선택해 주세요.';
    $('#installModal').hidden = false;
    document.body.style.overflow = 'hidden';
    $('#installCloseBtn').focus();
  }
  async function startAppInstall() {
    if (installPrompt && window.isSecureContext) {
      const prompt = installPrompt; installPrompt = null;
      prompt.prompt();
      try { await prompt.userChoice; } catch (_) { /* User may dismiss. */ }
    } else showInstallInstructions();
  }
  function initializePwa() {
    $('#installAppBtn').addEventListener('click', startAppInstall);
    $('#installCloseBtn').addEventListener('click', closeInstallDialog);
    $('#installModalCloseBtn').addEventListener('click', closeInstallDialog);
    $('#installModal').addEventListener('click', e => { if (e.target.id === 'installModal') closeInstallDialog(); });
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });
    window.addEventListener('appinstalled', () => { installPrompt = null; $('#installAppBtn').hidden = true; showToast('생각별이 홈 화면에 설치되었어요! ✨'); });
    if (standalone()) $('#installAppBtn').hidden = true;
    window.addEventListener('online', toggleOfflineBanner);
    window.addEventListener('offline', toggleOfflineBanner);
    toggleOfflineBanner();
    if ('serviceWorker' in navigator && window.isSecureContext) {
      window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}), {once: true});
    }
  }
  const EXAMPLES = {
    국어: ['주인공의 마음을 어떻게 알 수 있나요?', '글의 중심 생각은 어떻게 찾나요?'],
    수학: ['사과 12개를 3명에게 나누려면?', '7 × 6은 어떻게 생각해야 하나요?'],
    사회: ['우리 동네에 지도가 필요한 이유는?', '우리 주변의 공공기관은 무슨 일을 하나요?'],
    과학: ['얼음이 녹으면 무엇이 달라질까요?', '그림자는 왜 생기나요?'],
    영어: ['영어 문장에서 주어는 어떻게 찾나요?', '현재형과 과거형은 무엇이 달라요?']
  };

  // Save UI preferences; API keys remain server-side.
  const savedPreferences = (() => {
    try { const v = JSON.parse(localStorage.getItem('thinkstar-prefs-v8') || '{}'); return v && typeof v === 'object' ? v : {}; }
    catch (_) { return {}; }
  })();
  let parentVerifiedPin = null; // Kept in memory only while parent mode is open.
  let reportAnswerExcerpt = ''; // Ephemeral AI reply text; never queued in localStorage.
  const state = {
    grade: ['초1~2','초3~4','초5~6'].includes(savedPreferences.grade) ? savedPreferences.grade : '초3~4', subject: '자동', detectedSubject: '자동', mode: 'live', provider: 'gemini', model: 'auto', baseUrl: typeof savedPreferences.baseUrl === 'string' ? savedPreferences.baseUrl.slice(0,300) : '',
    active: null, hintLevel: 0, answerShown: false, photo: null, busy: false,
    messages: [], records: readRecords(), toastTimer: null
  };

  // v32: treat each browser recognition segment as an updated hypothesis, not a new sentence.
  // Chrome/WebView sometimes re-emits the same phrase after restarting recognition.
  function cleanSpeechText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }
  function comparableSpeech(value) {
    return cleanSpeechText(value).toLocaleLowerCase('ko-KR').replace(/[,.!?，、。！？]/g, '').replace(/\s+/g, ' ').trim();
  }
  function joinSpeechWithoutRepeats(previous, incoming) {
    const a = cleanSpeechText(previous), b = cleanSpeechText(incoming);
    if (!a) return b;
    if (!b) return a;
    const ca = comparableSpeech(a), cb = comparableSpeech(b);
    if (ca === cb || ca.endsWith(cb)) return a;
    if (cb.startsWith(ca)) return b;
    // Match the longest repeated suffix/prefix, including single Korean words.
    const aa = a.split(' '), bb = b.split(' ');
    const ac = ca.split(' '), bc = cb.split(' ');
    for (let n = Math.min(ac.length, bc.length); n >= 1; n--) {
      if (ac.slice(-n).join(' ') === bc.slice(0, n).join(' ')) {
        return cleanSpeechText(aa.concat(bb.slice(n)).join(' '));
      }
    }
    // Browser segments sometimes omit spaces between the same Korean syllables.
    const max = Math.min(ca.length, cb.length);
    for (let n = max; n >= 3; n--) {
      if (ca.slice(-n) === cb.slice(0, n)) return cleanSpeechText(a + b.slice(n));
    }
    return `${a} ${b}`;
  }
  function collapseSpeechEchoes(value) {
    // A repeated partial hypothesis can become a transcript such as "우리나라 우리나라 우리나라".
    const words = cleanSpeechText(value).split(' ');
    const out = [];
    for (const word of words) {
      if (word && comparableSpeech(out[out.length-1]) !== comparableSpeech(word)) out.push(word);
    }
    return out.join(' ');
  }
  function composedSpeechDraft() {
    const recognized = joinSpeechWithoutRepeats(voice.finalText, voice.currentInterim);
    return collapseSpeechEchoes(joinSpeechWithoutRepeats(voice.baseText, recognized)).slice(0,1600);
  }

  // Browser Web Speech API: no paid API required. Microphone recognition may use
  // the browser vendor's online recognition service (not guaranteed offline).
  const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
  const voice = {
    recognition:null, listening:false, baseText:'', finalText:'', heardAnything:false,
    error:'', completedText:'', currentInterim:'',
    startedAt:0,lastSpeechAt:0,silenceTimer:null,restartTimer:null,restartCount:0
  };
  function savePreferences() {
    try {
      localStorage.setItem('thinkstar-prefs-v8', JSON.stringify({
        grade: state.grade, mode: state.mode, modeVersion: 11,
        provider: state.provider, model: state.model, baseUrl: state.baseUrl
      }));
    } catch (_) { /* Storage disabled; use session only. */ }
  }
  function voiceNotice(text, type = '') {
    const el = $('#voiceFeedback');
    el.className = `voice-feedback${type ? ` is-${type}` : ''}`;
    el.textContent = text;
  }
  function updateMicrophoneUi() {
    const button = $('#micBtn');
    button.disabled = state.busy || !SpeechRecognitionClass;
    button.classList.toggle('is-listening', voice.listening);
    button.setAttribute('aria-pressed', String(voice.listening));
    button.setAttribute('aria-label', voice.listening ? '음성 인식 끝내기' : '음성으로 질문하기');
    $('#micLabel').textContent = voice.listening ? '듣기 끝내기' : '말로 질문';
  }
  // Keep a listening session alive while the learner speaks or pauses briefly.
  // Chromium may end one recognition instance early, so restart it within the
  // grace window. SpeechRecognition has no portable silence-timeout setting.
  const SILENCE_GRACE_MS = 5500; // >3 extra seconds of silence after speech
  const FIRST_SPEECH_WAIT_MS = 15000;
  function stopListening({ announce = false } = {}) {
    const recognition = voice.recognition;
    voice.recognition = null;
    voice.listening = false;
    clearTimeout(voice.silenceTimer);
    clearTimeout(voice.restartTimer);
    voice.silenceTimer = null;
    voice.restartTimer = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try { recognition.stop(); } catch (_) { /* already ended */ }
    }
    updateMicrophoneUi();
    if (announce) {
      voiceNotice(voice.error || (voice.heardAnything
        ? '✅ 음성 질문이 글자로 바뀌었어요. 내용을 확인하고 보내기를 눌러 주세요.'
        : '아직 목소리를 인식하지 못했어요. 마이크를 눌러 다시 말해 주세요.'),
      voice.error || !voice.heardAnything ? 'error' : 'success');
      // Do not refocus: opening the mobile keyboard hides the question and answer area.
    }
  }
  function scheduleRecognitionEnd() {
    clearTimeout(voice.silenceTimer);
    if (!voice.listening) return;
    const last = voice.lastSpeechAt || voice.startedAt;
    const wait = (voice.lastSpeechAt ? SILENCE_GRACE_MS : FIRST_SPEECH_WAIT_MS) - (Date.now() - last);
    voice.silenceTimer = setTimeout(() => stopListening({ announce: true }), Math.max(100, wait));
  }
  function beginRecognitionSegment() {
    if (!voice.listening) return;
    let recognition;
    try { recognition = new SpeechRecognitionClass(); }
    catch (_) { voice.error = '마이크를 시작하지 못했어요. 크롬이나 엣지에서 다시 시도해 주세요.'; stopListening({ announce: true }); return; }
    recognition.lang = 'ko-KR';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;
    voice.recognition = recognition;
    voice.currentInterim = '';
    recognition.onresult = (event) => {
      if (voice.recognition !== recognition || !voice.listening) return;
      let segmentFinal = '', segmentInterim = '';
      for (const result of event.results) {
        const piece = cleanSpeechText(result[0]?.transcript);
        if (!piece) continue;
        if (result.isFinal) segmentFinal = joinSpeechWithoutRepeats(segmentFinal, piece);
        else segmentInterim = joinSpeechWithoutRepeats(segmentInterim, piece);
      }
      // event.results already contains every result in the current segment. Replace
      // this segment's hypothesis rather than appending it on every onresult event.
      voice.finalText = joinSpeechWithoutRepeats(voice.completedText, segmentFinal);
      voice.currentInterim = segmentInterim;
      const draft = composedSpeechDraft();
      const oldDraft = $('#messageInput').value;
      if (draft && draft !== oldDraft) {
        voice.heardAnything = true;
        voice.lastSpeechAt = Date.now();
        scheduleRecognitionEnd();
        $('#messageInput').value = draft;
      }
      voiceNotice('🎤 듣고 있어요. 잠시 쉬어도 괜찮아요. 완료 후 문장을 확인해 주세요.', 'listening');
    };
    recognition.onerror = (event) => {
      if (voice.recognition !== recognition || !voice.listening) return;
      if (event.error === 'no-speech' || event.error === 'aborted') return; // restart until grace expires
      const messages = {
        'not-allowed': '마이크 사용 권한이 차단되었어요. 주소창 왼쪽에서 마이크를 허용해 주세요.',
        'service-not-allowed': '브라우저의 음성 인식 서비스가 차단되었어요.',
        'audio-capture': '마이크를 찾지 못했어요. 윈도우 마이크 설정을 확인해 주세요.',
        'network': '브라우저 음성 인식 서비스에 연결되지 않았어요. 인터넷을 확인해 주세요.',
        'language-not-supported': '한국어 음성 인식을 지원하지 않는 환경이에요.'
      };
      voice.error = messages[event.error] || '음성 인식 도중 문제가 발생했어요. 다시 시도해 주세요.';
      stopListening({ announce: true });
    };
    recognition.onend = () => {
      if (voice.recognition !== recognition || !voice.listening) return;
      // Preserve finalized words across short-lived browser recognition instances.
      // A final result sometimes never arrives before onend: keep partial text.
      voice.completedText = collapseSpeechEchoes(joinSpeechWithoutRepeats(voice.finalText, voice.currentInterim));
      voice.finalText = voice.completedText;
      voice.currentInterim = '';
      $('#messageInput').value = composedSpeechDraft();
      voice.recognition = null;
      const expired = Date.now() - (voice.lastSpeechAt || voice.startedAt) >=
        (voice.lastSpeechAt ? SILENCE_GRACE_MS : FIRST_SPEECH_WAIT_MS);
      if (expired || voice.restartCount >= 40) { stopListening({ announce: true }); return; }
      voice.restartCount += 1;
      clearTimeout(voice.restartTimer);
      voice.restartTimer = setTimeout(beginRecognitionSegment, 180);
    };
    try { recognition.start(); }
    catch (_) {
      voice.error = '마이크를 시작할 수 없어요. 브라우저 권한을 확인해 주세요.';
      stopListening({ announce: true });
    }
  }
  function toggleMicrophone() {
    if (!SpeechRecognitionClass) {
      voiceNotice('이 브라우저는 음성 인식을 지원하지 않아요. 최신 크롬 또는 엣지에서 열어 주세요.', 'error');
      return;
    }
    if (voice.listening) { stopListening({ announce: true }); return; }
    if (state.busy) return;
    voice.listening = true;
    voice.baseText = $('#messageInput').value.trim();
    voice.finalText = '';
    voice.completedText = '';
    voice.currentInterim = '';
    voice.heardAnything = false;
    voice.error = '';
    voice.startedAt = Date.now();
    voice.lastSpeechAt = 0;
    voice.restartCount = 0;
    updateMicrophoneUi();
    voiceNotice('🔴 듣고 있어요! 처음 말을 시작할 때는 15초까지 기다리고, 말하는 중에는 5.5초 쉬어도 괜찮아요.', 'listening');
    scheduleRecognitionEnd();
    beginRecognitionSegment();
  }
  function initVoice() {
    $('#micBtn').addEventListener('click', toggleMicrophone);
    if (!SpeechRecognitionClass) {
      voiceNotice('이 브라우저에서는 말로 질문하기를 지원하지 않아요. 최신 크롬 또는 엣지에서 열어 주세요.', 'error');
      $('#micBtn').title = '현재 브라우저에서는 음성 인식이 지원되지 않습니다';
    }
    updateMicrophoneUi();
  }

  function readRecords() {
    try {
      const raw = localStorage.getItem('thinkstar-report-v1') || sessionStorage.getItem('thinkstar-report-v1');
      const result = JSON.parse(raw || '[]');
      return Array.isArray(result) ? result.filter((r) => r && r.day === nowDay()).slice(-60) : [];
    } catch (_) { return []; }
  }
  function saveRecords() {
    try { localStorage.setItem('thinkstar-report-v1', JSON.stringify(state.records.slice(-60))); }
    catch (_) { /* Private browsing may disable sessionStorage. */ }
  }
  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
  }
  function updateSelectors() {
    document.querySelectorAll('[data-grade]').forEach((button) => {
      const active = button.dataset.grade === state.grade;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    $('#currentClass').textContent = `${state.grade} · ${state.detectedSubject === '자동' ? '과목 자동 인식' : state.detectedSubject}`;
    renderSamples();
  }
  function renderSamples() {
    const wrap = $('#samplePrompts');
    wrap.replaceChildren();
    // Mix subjects; selecting a grade never restricts which questions are allowed.
    [EXAMPLES.수학[0], EXAMPLES.과학[1], EXAMPLES.국어[0], EXAMPLES.영어[0]].forEach((example) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'sample-prompt';
      b.textContent = `✦ ${example}`;
      b.addEventListener('click', () => sendMessage(example));
      wrap.appendChild(b);
    });
  }
  function changeGrade(nextGrade) {
    if (state.busy) { showToast('선생님이 힌트를 생각하고 있어요. 잠깐 후에 바꿔주세요.'); return; }
    if (state.grade === nextGrade) return;
    state.grade = nextGrade;
    state.detectedSubject = '자동';
    savePreferences();
    resetConversation();
    updateSelectors();
    showToast(`${state.grade} 수준에 맞춰 쉽게 설명할게요!`);
  }
  function updateProgress() {
    const stars = $('#starTrack');
    stars.textContent = state.hintLevel === 0 ? '✦' : '⭐'.repeat(Math.min(state.hintLevel, 5)) + (state.hintLevel > 5 ? ' +' : '');
    stars.setAttribute('aria-label', `지금까지 힌트 ${state.hintLevel}회, 횟수 제한 없음`);
    $('#progressCounter').textContent = `${state.hintLevel}회 · 무제한`;
    $('#moreHintBtn').disabled = !state.active || state.busy;
    updateParentAnswerAccess();
    $('#recheckProblemBtn').disabled = !state.active || state.busy;
    $('#understoodBtn').disabled = !state.active || state.busy;
    $('#sendBtn').disabled = state.busy;
    $('#messageInput').disabled = state.busy;
    $('#photoInput').disabled = state.busy;
    $('#cameraInput').disabled = state.busy;
    $('#photoMenuBtn').disabled = state.busy;
    if (state.busy) closePhotoMenu();
    $('#newProblemBtn').disabled = state.busy;
    updateMicrophoneUi();
    document.querySelectorAll('.sample-prompt').forEach((btn) => { btn.disabled = state.busy; });
  }
  function resetConversation() {
    cancelAnswerScroll();
    stopListening();

    voiceNotice('🎤 마이크를 누르면 질문을 글자로 바꿀 수 있어요.');
    state.active = null;
    state.messages = [];
    state.hintLevel = 0;
    state.answerShown = false;
    state.detectedSubject = '자동';
    updateSelectors();
    clearPhoto();
    $('#messageInput').value = '';
    $('#chatBody').replaceChildren($('#welcomeCard'));
    $('#welcomeCard').hidden = false;
    updateProgress();
  }
  function addMessage(role, message, { photo = false, loading = false, focus = '' } = {}) {
    $('#welcomeCard').hidden = true;
    const box = document.createElement('div');
    box.className = `chat-message ${role}`;
    if (role === 'teacher') {
      const avatar = document.createElement('div');
      avatar.className = 'message-avatar';
      avatar.textContent = '🌟';
      avatar.setAttribute('aria-hidden', 'true');
      box.appendChild(avatar);
    }
    const content = document.createElement('div');
    content.className = 'message-content';
    if (role === 'teacher') {
      const meta = document.createElement('div');
      meta.className = 'message-meta'; meta.textContent = '생각별 선생님';
      content.appendChild(meta);
    }
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    if (loading) {
      const waiting = document.createElement('div');
      waiting.className = 'thinking'; waiting.setAttribute('aria-label', '힌트를 생각하고 있어요');
      for (let i = 0; i < 3; i++) waiting.appendChild(document.createElement('span'));
      bubble.appendChild(waiting);
    } else {
      if (photo) {
        const p = document.createElement('span'); p.className = 'photo-tag'; p.textContent = '📷 문제 사진 첨부';
        bubble.appendChild(p);
      }
      if (message) bubble.appendChild(document.createTextNode(message));
    }
    content.appendChild(bubble);
    // Keep problem analysis as internal tutor context, not a learner-facing bubble.
    // The user sees the hint only, freeing space on mobile.
    if (!loading) {
      const time = document.createElement('div');
      time.className = 'message-time';
      time.textContent = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
      content.appendChild(time);
      if (role === 'teacher' && message) {
        const reportButton=document.createElement('button');
        reportButton.type='button'; reportButton.className='ai-report-button';
        reportButton.textContent='🚩 이 답변 신고';
        reportButton.setAttribute('aria-label','방금 나온 AI 답변 신고하기');
        reportButton.addEventListener('click',()=>openAiReport(message));
        content.appendChild(reportButton);
      }
    }
    box.appendChild(content);
    $('#chatBody').appendChild(box);
    // Desktop has an inner chat scroll; phones use one continuous PAGE scroll.
    if (!window.matchMedia('(max-width:750px)').matches) {
      $('#chatBody').scrollTop = $('#chatBody').scrollHeight;
    }
    return box;
  }
  // v23: Galaxy/PWA mobile answer navigation. A fixed-height inner chat plus
  // the outer page scroller caused scrollIntoView to leave the viewport at the
  // composer. Mobile now uses one document scroller (see styles.css), and
  // scrolls to the *new answer* after keyboard/viewport resize settles.
  let answerScrollTimers = [];
  let cancelAnswerScrollOnGesture = null;
  function cancelAnswerScroll() {
    answerScrollTimers.forEach(clearTimeout);
    answerScrollTimers = [];
    if (cancelAnswerScrollOnGesture) {
      for (const type of ['touchstart','pointerdown','wheel','keydown']) {
        window.removeEventListener(type, cancelAnswerScrollOnGesture, true);
      }
      cancelAnswerScrollOnGesture = null;
    }
  }
  function positionTeacherReply(answer) {
    if (!answer.isConnected) return;
    if (!window.matchMedia('(max-width:750px)').matches) {
      // Keep desktop's independent chat scroller intact.
      answer.scrollIntoView({ behavior:'auto', block:'nearest', inline:'nearest' });
      return;
    }
    // Do NOT focus the textarea: that reopens the Samsung keyboard and scrolls
    // the page back down to the composer. Scroll the page, not the inner chat.
    const page = document.scrollingElement || document.documentElement;
    const visualTop = window.visualViewport?.offsetTop || 0;
    const target = page.scrollTop + answer.getBoundingClientRect().top - visualTop - 14;
    const maxScroll = Math.max(0, page.scrollHeight - page.clientHeight);
    window.scrollTo(0, Math.max(0, Math.min(Math.round(target), maxScroll)));
  }
  function revealNewTutorReply(messageElement) {
    if (!messageElement?.isConnected) return;
    cancelAnswerScroll();
    const answer = messageElement.querySelector('.message-bubble') || messageElement;
    // Keyboard close / layout resize can arrive after the async Gemini reply.
    // Reposition briefly, but immediately cancel if the student starts
    // scrolling or typing, so the UI never fights a deliberate gesture.
    requestAnimationFrame(() => requestAnimationFrame(() => positionTeacherReply(answer)));
    if (!window.matchMedia('(max-width:750px)').matches) return;
    cancelAnswerScrollOnGesture = () => cancelAnswerScroll();
    for (const type of ['touchstart','pointerdown','wheel','keydown']) {
      window.addEventListener(type, cancelAnswerScrollOnGesture, { capture:true, passive:true });
    }
    answerScrollTimers = [180, 450, 850, 1250].map(delay => setTimeout(() => positionTeacherReply(answer), delay));
    answerScrollTimers.push(setTimeout(cancelAnswerScroll, 1450));
  }
  function makeProblem(question, photo) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    state.active = { id, question, hadPhoto: photo, photoDataUrl: null };
    state.hintLevel = 0;
    state.answerShown = false;
    state.messages = [];
    const routeNotice=$('#geminiRouteNotice'); if(routeNotice) routeNotice.hidden=true;
    state.detectedSubject = '자동';
    updateSelectors();
    state.records.push({ id, day: nowDay(), time: new Date().toISOString(), grade: state.grade, subject: '자동', question: question || '사진으로 올린 문제', hints: 0, understood: false, solved: false, revealed: false, stepCorrect: 0, wrongAttempts: 0, assessedAttempts: 0, hintsAtSolve: null });
    saveRecords();
  }
  function updateRecord(changes) {
    if (!state.active) return;
    const record = state.records.find((r) => r.id === state.active.id);
    if (!record) return;
    Object.assign(record, changes);
    saveRecords();
  }
  const PROVIDER_SETTINGS = {
    gemini: { label: 'Google Gemini', model: 'auto', guide: 'Google Gemini를 사용해 문제를 분석하고 힌트를 검토해요. 모델 선택과 자동 전환은 서버에서 관리합니다.' }
  };
  async function refreshApiServerStatus() {
    const el = $('#serverKeyStatus');
    if (!el) return;
    const provider = $('#apiProviderSelect').value;
    el.textContent = '서버에 등록된 API 키 상태를 확인하고 있어요…';
    try {
      const response = await fetch('/api/provider-config', { cache: 'no-store' });
      if (!response.ok) {
        el.textContent = '서버 연결 또는 AI 설정을 확인할 수 없어요. 잠시 후 다시 시도해 주세요.';
        return;
      }
      const data = await response.json();
      const item = data.providers?.[provider];
      if (!item) { el.textContent = '선택한 AI 제공업체 정보를 확인할 수 없어요.'; return; }
      el.textContent = item.configured
        ? `✅ ${item.label} 연결 설정이 서버에 등록되어 있어요. 앱에 키를 넣을 필요가 없어요.`
        : '⚠️ Google Gemini 연결 설정을 확인해 주세요. 관리자에게 문의해 주세요.';
    } catch (_) {
      el.textContent = '서버 연결 상태를 확인하지 못했어요. 인터넷을 확인해 주세요.';
    }
  }
  function showGeminiRouteNotice(_reply) {
    // Model IDs are intentionally kept private to the server.
    const el=$('#geminiRouteNotice'); if (el) el.hidden=true;
  }
  function syncProviderFields({ switched = false } = {}) {
    const mode = document.querySelector('input[name="mode"]:checked')?.value || 'live';
    $('#apiProviderFields').hidden = mode !== 'live';
    if (mode !== 'live') return;
    const provider = $('#apiProviderSelect').value;
    const config = PROVIDER_SETTINGS[provider];
    $('#providerGuide').innerHTML = config.guide; // Only static, developer-authored markup.
    $('#customApiRow').hidden = provider !== 'custom';
    if (switched || provider === 'gemini') { $('#apiModelInput').value = config.model; }
    $('#apiModelInput').readOnly = provider === 'gemini';
    $('#geminiAutoHelp').hidden = provider !== 'gemini';
    refreshApiServerStatus();
    $('#apiConnectionStatus').textContent = '';
    delete $('#apiConnectionStatus').dataset.result;
  }
  // v37: One question gets at most 3 network attempts (first + 2 retries).
  // An error must never trigger an unbounded sequence of paid Gemini calls.
  // Authentication and quota errors are not retried automatically.
  const MAX_AUTO_RETRIES = 2;
  let reconnectOperation = null;
  function newTutorRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }
  function retryAbortError() {
    const e = new Error('자동 재연결을 중지했어요. 다시 시도하려면 질문을 보내 주세요.');
    e.name = 'AbortError';
    return e;
  }
  function updateReconnectNotice(message, source) {
    if (source === 'test') {
      $('#apiConnectionStatus').dataset.result = 'testing';
      $('#apiConnectionStatus').textContent = message;
      $('#cancelApiReconnectBtn').hidden = false;
    } else {
      $('#retryNotice').hidden = false;
      $('#retryNoticeText').textContent = message;
    }
  }
  function cancelReconnect() {
    reconnectOperation?.controller.abort();
  }
  function pauseBeforeRetry(delay, signal, source) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(retryAbortError());
      const start = Date.now();
      const offlineAtStart = !navigator.onLine;
      let ended = false;
      const done = (error) => {
        if (ended) return;
        ended = true;
        clearInterval(timer);
        signal.removeEventListener('abort', onAbort);
        window.removeEventListener('online', onOnline);
        error ? reject(error) : resolve();
      };
      const onAbort = () => done(retryAbortError());
      const onOnline = () => { if (offlineAtStart && navigator.onLine) done(); };
      const timer = setInterval(() => {
        if (!navigator.onLine) {
          updateReconnectNotice('📴 인터넷 연결을 기다리고 있어요. 복구되면 자동으로 이어서 질문할게요.', source);
          return;
        }
        const left = Math.max(0, Math.ceil((delay - (Date.now() - start)) / 1000));
        if (left === 0) return done();
        updateReconnectNotice(`🔄 AI가 혼잡해요. ${left}초 뒤 자동 재연결해요. 요청 횟수가 늘 수 있어요. 중지할 수 있습니다.`,source);
      }, 1000);
      signal.addEventListener('abort', onAbort, {once:true});
      window.addEventListener('online', onOnline);
      if (!navigator.onLine) updateReconnectNotice('📴 인터넷 연결을 기다리는 중이에요.',source);
      else updateReconnectNotice(`🔄 AI가 혼잡해요. ${Math.ceil(delay/1000)}초 뒤 다시 연결할게요.`,source);
    });
  }
  async function requestTutorWithReconnect(payload, source = 'tutor') {
    if (reconnectOperation) throw new Error('다른 AI 요청의 재연결이 진행 중이에요.');
    const operation = {controller:new AbortController(), source};
    reconnectOperation = operation;
    const body = JSON.stringify({...payload, retryRequestId:newTutorRequestId()});
    let retries = 0;
    try {
      while (!operation.controller.signal.aborted) {
        while (!navigator.onLine) await pauseBeforeRetry(15000, operation.controller.signal, source);
        const attemptController = new AbortController();
        const onAbort = () => attemptController.abort();
        operation.controller.signal.addEventListener('abort', onAbort, {once:true});
        const timer = setTimeout(() => attemptController.abort(), 105000);
        let failure;
        try {
          if (retries > 0) updateReconnectNotice(`🔄 AI 연결을 다시 시도하고 있어요. (${retries}회 재시도)`,source);
          const response = await fetch('/api/tutor', {
            method:'POST',headers:{'Content-Type':'application/json'},body,signal:attemptController.signal,cache:'no-store'
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) {
            const error = new Error(result.error || `AI 연결 오류 (HTTP ${response.status})`);
            error.status = response.status;
            error.retryable = result.retryable === true;
            error.retryAfterSeconds = Number(result.retryAfterSeconds) || 0;
            throw error;
          }
          if (!result || typeof result.hint !== 'string' || !result.hint.trim()) throw new Error('AI가 읽을 수 있는 힌트를 반환하지 않았어요.');
          if (retries > 0) showToast('✅ AI 연결이 복구됐어요! 질문에 대한 답변을 받았어요.');
          return result;
        } catch (error) {
          if (operation.controller.signal.aborted) throw retryAbortError();
          if (error.name === 'AbortError' || error.name === 'TypeError') {
            error.retryable = true; // dropped connection or per-request timeout
          }
          failure = error;
        } finally {
          clearTimeout(timer);
          operation.controller.signal.removeEventListener('abort', onAbort);
        }
        if (!failure.retryable) throw failure;
        // 429 from an upstream model can be a daily quota. The server already
        // tries other Gemini models on 429, so waiting and resubmitting here
        // would create unnecessary costs and repeated failed attempts.
        if (failure.status === 429) throw failure;
        if (retries >= MAX_AUTO_RETRIES) {
          throw new Error('AI 연결이 계속 불안정해 자동 재시도를 중지했어요. 잠시 후 직접 다시 질문해 주세요.');
        }
        retries++;
        // Exponential backoff + jitter, with a strict attempt cap. Prevents a thundering herd
        // and excessive API charges when Google is overloaded. Retry-After wins when set.
        const expMs = Math.min(120000, 4000 * 2 ** Math.min(retries-1,5));
        const jitter = Math.floor(Math.random() * Math.min(3000,expMs * .3));
        const waitMs = Math.min(120000, Math.max(expMs + jitter, Math.min(120000, (failure.retryAfterSeconds||0)*1000)));
        await pauseBeforeRetry(waitMs, operation.controller.signal, source);
      }
      throw retryAbortError();
    } finally {
      if (reconnectOperation === operation) reconnectOperation = null;
      $('#retryNotice').hidden = true;
      $('#cancelApiReconnectBtn').hidden = true;
    }
  }
  // An attached photo must first be converted to visible text and checked by
  // the learner; otherwise the tutor's hint reviewer sees a placeholder.
  let photoReviewInProgress = false;
  let photoReviewReady = null;
  async function beginPhotoRecognition(imageDataUrl) {
    if (photoReviewInProgress || state.busy) return;
    photoReviewInProgress = true;
    state.busy = true;
    updateProgress();
    showToast('📷 사진 속 문제와 선택지를 읽고 있어요…');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 75000);
    try {
      const response=await fetch('/api/photo/read', {method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({imageDataUrl}),signal:controller.signal,cache:'no-store'});
      const result=await response.json().catch(()=>({}));
      if (!response.ok) throw Error(result.error || `사진 인식 오류 (${response.status})`);
      if (!result.problem || result.problem.trim().length<12) throw Error('사진에서 문제를 충분히 읽지 못했어요. 다시 촬영해 주세요.');
      if (state.photo?.dataUrl!==imageDataUrl) return;
      photoReviewReady = {imageDataUrl,recognizedText:result.problem.trim()};
      $('#photoRecognizedText').value=result.problem.trim();
      $('#photoReadWarning').textContent=result.warning || '문제 글자를 확인해 주세요.';
      openModal('photoReadModal');
    } catch (error) {
      if (error.name==='AbortError') showToast('사진 인식 시간이 길어졌어요. 잠시 후 다시 시도해 주세요.');
      else showToast('사진을 분석하지 못했어요. '+error.message);
      // The image remains attached; the student may retry or type the question.
    } finally {
      clearTimeout(timeout);
      photoReviewInProgress=false;
      state.busy=false;
      updateProgress();
    }
  }
  function cancelPhotoReview() {
    photoReviewReady=null;
    closeModal('photoReadModal',{restoreFocus:false});
  }
  function confirmPhotoReview() {
    const accepted=$('#photoRecognizedText').value.trim().slice(0,1600);
    if (!photoReviewReady || state.photo?.dataUrl!==photoReviewReady.imageDataUrl) {
      showToast('사진이 변경됐어요. 다시 인식해 주세요.'); return;
    }
    if (accepted.length<12) { showToast('문제 문장을 확인하거나 고쳐 주세요.'); return; }
    photoReviewReady=null;
    closeModal('photoReadModal',{restoreFocus:false});
    sendMessage(accepted,{photoReviewed:true});
  }
  async function getLiveHint(photoDataUrl, attemptText = '', recheck = false) {
    const result = await requestTutorWithReconnect({
      provider:state.provider, model:state.model, baseUrl:state.provider==='custom'?state.baseUrl:'',
      grade:state.grade, subject:state.subject, hintLevel:state.hintLevel,
      problemId:state.active?.id||'', attemptText, recheck,
      problem:state.active?.question||'', messages:state.messages.slice(-8),
      imageDataUrl:state.active?.photoReviewed ? null : (photoDataUrl||null),
      photoTextConfirmed: Boolean(state.active?.photoReviewed)
    });
    return { hint:result.hint.trim(), detectedSubject: ['국어','수학','사회','과학','영어','기타'].includes(result.detectedSubject) ? result.detectedSubject : '자동', problemFocus:typeof result.problemFocus==='string'?result.problemFocus.slice(0,140):'',
      verdict:['correct','incorrect','step_correct'].includes(result.verdict)?result.verdict:'uncertain',
      hintCount:Number.isInteger(result.hintCount)?result.hintCount:state.hintLevel,
      usedModel:typeof result.model==='string'?result.model:'', geminiRoute:result.geminiRoute||null };
  }
  async function sendMessage(text, { fromHintButton = false, fromRecheck = false, photoReviewed = false } = {}) {
    if (state.busy) return;
    cancelAnswerScroll();
    const typed = (text || '').trim().slice(0, 1600);
    if (voice.listening) stopListening();

    const uploadedImage = state.photo ? state.photo.dataUrl : null;
    if (!typed && !uploadedImage) { showToast('질문을 적거나 사진을 올려 주세요!'); return; }
    if (uploadedImage && (fromHintButton || fromRecheck)) {
      showToast('새 사진은 먼저 보내기를 눌러 문제 문장을 확인해 주세요.'); return;
    }
    if (uploadedImage && !photoReviewed && !fromHintButton && !fromRecheck) {
      await beginPhotoRecognition(uploadedImage);
      return;
    }
    // Close the phone keyboard on send: retaining input focus made the browser
    // jump to the question box even after a teacher reply had been rendered.
    const focused = document.activeElement;
    if (focused === $('#messageInput') || focused?.closest?.('#messageForm')) focused.blur();
    let isNew = !state.active;
    // A newly attached photo is a new exercise, not an extra hint about the
    // preceding exercise. Keep the photo through a full conversation reset.
    if (uploadedImage && state.active && state.active.photoDataUrl !== uploadedImage) {
      resetConversation();
      state.photo={dataUrl:uploadedImage};
      $('#photoThumbnail').src=uploadedImage;$('#photoPreview').hidden=false;
    }
    isNew=!state.active;
    if (isNew) makeProblem(typed, !!uploadedImage);
    if (photoReviewed && state.active) state.active.photoReviewed=true;
    if (uploadedImage && state.active) state.active.photoDataUrl = uploadedImage; // kept only in memory for next hints
    if (!isNew && uploadedImage && typed && state.active.question === '사진으로 올린 문제') {
      updateRecord({ question: typed });
      state.active.question = typed;
    }
    state.hintLevel += 1;
    const studentText = fromRecheck ? '처음 문제의 숫자와 조건, 무엇을 구하는지를 다시 확인하고 앞의 힌트를 고쳐 주세요.' : fromHintButton ? '힌트를 하나 더 주세요.' : typed;
    state.messages.push({ role: 'user', content: studentText || '첨부한 사진 속 문제를 풀기 위한 힌트를 주세요.' });
    addMessage('student', fromRecheck ? '문제를 다시 읽어 주세요! 🔎' : fromHintButton ? '힌트 더 주세요! 💡' : typed, { photo: !!uploadedImage });
    $('#messageInput').value = '';
    clearPhoto();
    state.busy = true;
    updateProgress();
    const pending = addMessage('teacher', '', { loading: true });
    let visibleReply = null;
    try {
      const attemptText = !isNew && !fromHintButton && !fromRecheck && typed ? typed : '';
      const reply = await getLiveHint(uploadedImage || state.active?.photoDataUrl || null, attemptText, fromRecheck);
      state.hintLevel = reply.hintCount;
      if (reply.detectedSubject !== '자동') {
        state.detectedSubject = reply.detectedSubject;
        updateSelectors();
        updateRecord({ subject: reply.detectedSubject });
      }
      showGeminiRouteNotice(reply);
      pending.remove();
      visibleReply = addMessage('teacher', reply.hint, { focus: reply.problemFocus });
      state.messages.push({ role: 'assistant', content: reply.hint });
      const record = state.records.find((r) => r.id === state.active?.id);
      if (attemptText && record) {
        if (reply.verdict === 'correct' || reply.verdict === 'step_correct' || reply.verdict === 'incorrect') {
          const changes = { assessedAttempts: (record.assessedAttempts || 0) + 1 };
          if (reply.verdict === 'step_correct') changes.stepCorrect = (record.stepCorrect || 0) + 1;
          if (reply.verdict === 'incorrect') changes.wrongAttempts = (record.wrongAttempts || 0) + 1;
          updateRecord(changes);
        }
      }
      if (reply.verdict === 'correct') {
        updateRecord({ solved: true, hints: state.hintLevel, hintsAtSolve: state.hintLevel });
        state.active = null;
        state.messages = [];
        showToast('🎉 스스로 문제를 맞혔어요! 새로운 문제도 풀어 볼까요?');
      } else {
        updateRecord({ hints: state.hintLevel });
      }
    } catch (error) {
      pending.remove();
      state.hintLevel = Math.max(0, state.hintLevel - 1);
      state.messages.pop();
      if (isNew) {
        const failedId = state.active?.id;
        state.records = state.records.filter(r => r.id !== failedId);
        saveRecords();
        state.active = null; state.messages = []; state.hintLevel = 0;
        if (typed) $('#messageInput').value = typed;
      }
      const safeNotice = error.name === 'AbortError'
        ? '자동 재연결을 중지했어요. 🌷 같은 문제를 다시 보내면 이어서 도와줄게요.'
        : error.status === 429
          ? '지금은 AI 요청 한도에 도달했어요. 잠시 뒤 다시 시도해 주세요.'
          : /(?:힌트|검토|학년|과목)/.test(error.message || '')
            ? '이번 힌트는 아직 충분히 확인되지 않았어요. 🌷 같은 문제에서 힌트 더 받기를 다시 눌러 주세요.'
            : '지금은 힌트를 받지 못했어요. 🌷 잠시 후 다시 질문해 주세요.';
      visibleReply = addMessage('teacher', safeNotice);
      showToast(error.name === 'AbortError' ? '연결 시간이 오래 걸리고 있어요.' : error.status === 422 ? '이번 힌트는 다시 준비해 주세요.' : error.message);
    } finally {
      state.busy = false;
      updateProgress();
      revealNewTutorReply(visibleReply);
    }
  }
  function markUnderstood() {
    if (!state.active || state.busy) return;
    updateRecord({ understood: true });
    addMessage('student', '이해했어요! 🌟');
    const encouragement = '와, 스스로 생각해 봤군요! 정말 멋져요! 🎉 다음 문제도 도전해 볼까요?';
    const confirmation = addMessage('teacher', encouragement);
    state.active = null; state.messages = [];
    updateProgress();
    revealNewTutorReply(confirmation);
    showToast('오늘의 공부 기록에 반짝 별이 추가됐어요! ✨');
  }
  // v33: In-page video capture works without relying on Android's file-return intent.
  // Use the native camera file picker only as an explicit, user-initiated fallback.
  let cameraStream = null;
  let cameraOpenRequest = 0;
  function closePhotoMenu() {
    const menu = $('#photoChooser');
    if (menu) menu.hidden = true;
    $('#photoMenuBtn')?.setAttribute('aria-expanded', 'false');
  }
  function togglePhotoMenu() {
    if (state.busy) return;
    const menu = $('#photoChooser');
    menu.hidden = !menu.hidden;
    $('#photoMenuBtn').setAttribute('aria-expanded', String(!menu.hidden));
  }
  function openDevicePhotoPicker(camera) {
    closePhotoMenu();
    if (state.busy) return;
    const input = camera ? $('#cameraInput') : $('#photoInput');
    input.value = '';
    input.click();
  }
  function stopCameraTracks() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      cameraStream = null;
    }
    const video = $('#cameraLiveVideo');
    video.pause();
    video.srcObject = null;
    $('#cameraSnapBtn').disabled = true;
  }
  function closeCameraCapture() {
    cameraOpenRequest++;
    stopCameraTracks();
    $('#cameraCaptureModal').hidden = true;
    // Avoid focusing the question box (Android would open the keyboard and hide the photo).
  }
  async function startCameraCapture() {
    closePhotoMenu();
    if (state.busy) return;
    const modal = $('#cameraCaptureModal');
    modal.hidden = false;
    const session = ++cameraOpenRequest;
    stopCameraTracks();
    $('#cameraVideoPlaceholder').hidden = false;
    $('#cameraVideoPlaceholder').textContent = '카메라를 연결하고 있어요…';
    $('#cameraStatus').textContent = '카메라 권한 요청이 나타나면 허용해 주세요.';
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      $('#cameraStatus').textContent = '이 앱에서 카메라 직접 열기를 지원하지 않아요. 아래 카메라 앱 또는 앨범 버튼을 이용해 주세요.';
      $('#cameraVideoPlaceholder').textContent = '카메라 직접 열기 미지원';
      return;
    }
    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:960}},audio:false});
      } catch (error) {
        if (error.name !== 'OverconstrainedError' && error.name !== 'NotFoundError') throw error;
        stream = await navigator.mediaDevices.getUserMedia({video:true,audio:false});
      }
      if (session !== cameraOpenRequest || modal.hidden) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      cameraStream = stream;
      const video = $('#cameraLiveVideo');
      video.srcObject = stream;
      try { await video.play(); } catch (_) { /* Some browsers play automatically once metadata arrives. */ }
      if (session !== cameraOpenRequest || modal.hidden) return;
      $('#cameraVideoPlaceholder').hidden = true;
      $('#cameraStatus').textContent = '문제를 화면 안에 맞추고 촬영해서 첨부를 눌러 주세요.';
      $('#cameraSnapBtn').disabled = false;
    } catch (error) {
      if (session !== cameraOpenRequest) return;
      const denied = ['NotAllowedError','SecurityError','PermissionDeniedError'].includes(error?.name);
      $('#cameraStatus').textContent = denied
        ? '카메라 권한이 거부됐어요. 갤럭시 설정과 브라우저 사이트 권한을 확인하거나 아래 앨범에서 선택해 주세요.'
        : '카메라를 직접 열지 못했어요. 휴대폰 카메라 앱이나 앨범에서 선택해 주세요.';
      $('#cameraVideoPlaceholder').textContent = '카메라를 사용할 수 없어요';
    }
  }
  function makePhotoDataUrl(canvas) {
    let quality = .85;
    let result = '';
    for (let attempt=0;attempt<8;attempt++) {
      result = canvas.toDataURL('image/jpeg', quality);
      if (result.startsWith('data:image/jpeg') && result.length <= 4*1024*1024) return result;
      quality = Math.max(.32, quality-.10);
      if (quality <= .33 && (canvas.width>400 || canvas.height>400)) {
        const next = document.createElement('canvas');
        next.width = Math.max(1,Math.floor(canvas.width*.74));
        next.height = Math.max(1,Math.floor(canvas.height*.74));
        next.getContext('2d').drawImage(canvas,0,0,next.width,next.height);
        canvas.width = next.width;canvas.height = next.height;
        canvas.getContext('2d').drawImage(next,0,0);
      }
    }
    throw Error('image-too-large');
  }
  function attachPhotoDataUrl(dataUrl, origin) {
    state.photo = {dataUrl};
    $('#photoThumbnail').src = dataUrl;
    $('#photoPreview').hidden = false;
    voiceNotice('✅ 사진이 첨부됐어요. 사진을 확인하고 보내기를 눌러 주세요.', 'success');
    showToast(origin === 'camera' ? '📷 촬영 사진이 첨부됐어요! 이제 보내기를 눌러 주세요.' : '🖼️ 사진을 첨부했어요! 이제 보내기를 눌러 주세요.');
  }
  function snapInAppCamera() {
    const video=$('#cameraLiveVideo');
    if (!cameraStream || !video.videoWidth || !video.videoHeight) {
      $('#cameraStatus').textContent = '카메라 화면을 불러오는 중이에요. 화면이 보이면 다시 눌러 주세요.';
      return;
    }
    try {
      const canvas=document.createElement('canvas');
      const scale=Math.min(1,1500/Math.max(video.videoWidth,video.videoHeight));
      canvas.width=Math.max(1,Math.round(video.videoWidth*scale));
      canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
      canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
      const dataUrl=makePhotoDataUrl(canvas);
      closeCameraCapture();
      attachPhotoDataUrl(dataUrl,'camera');
    } catch (error) {
      $('#cameraStatus').textContent = '촬영한 사진을 처리하지 못했어요. 앨범에서 선택하거나 다시 촬영해 주세요.';
    }
  }
  async function decodePhoto(file) {
    // Some Samsung browsers/WebViews support file input but not createImageBitmap.
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        if (bitmap.width && bitmap.height) return {source:bitmap, width:bitmap.width, height:bitmap.height, release:()=>bitmap.close?.()};
        bitmap.close?.();
      } catch (_) { /* Fall back to an <img> decoder below. */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('image-decode'));
        img.src = url;
      });
      if (!img.naturalWidth || !img.naturalHeight) throw Error('image-decode');
      return {source:img, width:img.naturalWidth, height:img.naturalHeight, release:()=>URL.revokeObjectURL(url)};
    } catch (error) { URL.revokeObjectURL(url); throw error; }
  }
  async function prepareImage(file, origin = 'gallery') {
    if (!file || state.busy) return;
    if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || '')) {
      showToast('이미지 파일을 골라 주세요.'); return;
    }
    if (file.size > 20 * 1024 * 1024) { showToast('사진이 너무 커요. 20MB 이하의 사진을 골라 주세요.'); return; }
    let decoded;
    try {
      voice.listening && stopListening();
      voiceNotice('📷 사진을 확인하는 중이에요. 잠시 기다려 주세요.');
      decoded = await decodePhoto(file);
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1500 / Math.max(decoded.width, decoded.height));
      canvas.width = Math.max(1, Math.round(decoded.width * scale));
      canvas.height = Math.max(1, Math.round(decoded.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw Error('canvas-unavailable');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
      const dataUrl = makePhotoDataUrl(canvas);
      attachPhotoDataUrl(dataUrl, origin);
    } catch (error) {
      voiceNotice('사진을 읽지 못했어요. 다른 사진이나 JPG 촬영 모드를 사용해 주세요.', 'error');
      showToast('사진을 읽지 못했어요. 카메라가 HEIC 형식이면 JPG로 변경해 주세요.');
    } finally {
      decoded?.release();
      $('#cameraInput').value = '';
      $('#photoInput').value = '';
    }
  }
  function clearPhoto() {
    photoReviewReady = null;
    state.photo = null;
    $('#photoThumbnail').removeAttribute('src');
    $('#photoPreview').hidden = true;
    $('#photoInput').value = '';
    $('#cameraInput').value = '';
    closePhotoMenu();
  }
  function resetParentSession() {
    parentVerifiedPin = null;
    $('#parentSetup').hidden = true;
    $('#parentSetupStatus').textContent='';
    $('#setupParentPin').value='';
    $('#setupParentPinConfirm').value='';
    $('#guardianConfirm').checked=false;
    $('#parentGate').hidden = true;
    $('#parentDashboard').hidden = true;
    $('#parentPinInput').value = '';
    $('#parentAuthStatus').textContent = '';
    $('#parentAnswerOutput').hidden = true;
    $('#parentAnswerOutput').replaceChildren();
    $('#revealAnswerStatus').textContent = '';
    $('#oldAnswerPin').value = '';
    $('#newAnswerPin').value = '';
    $('#newAnswerPinConfirm').value = '';
    $('#changeAnswerPinStatus').textContent = '';
  }
  function openModal(id) {
    if (id === 'settingsModal') return; // Child-facing AI configuration has been hidden since v27.
    const modal = $(`#${id}`);
    if (id === 'parentModal') resetParentSession();
    modal.hidden = false;
    if (id === 'parentModal') refreshParentGate();
    document.body.style.overflow = 'hidden';
    (id === 'parentModal' ? $('#parentModal .close-modal') : modal.querySelector('.close-modal')).focus({preventScroll:true});
  }
  function closeModal(id, { restoreFocus = true } = {}) {
    $(`#${id}`).hidden = true;
    document.body.style.overflow = '';
    if (id === 'parentModal') resetParentSession();
    if (id === 'aiReportModal') reportAnswerExcerpt='';
    if (restoreFocus && id === 'parentModal') $('#parentBtn').focus({preventScroll:true});
  }
  async function refreshParentGate() {
    const setup=$('#parentSetup'), gate=$('#parentGate');
    setup.hidden=true; gate.hidden=true;
    try {
      const response=await fetch('/api/answer/config',{cache:'no-store'});
      const data=await response.json();
      if (!response.ok) throw Error(data.error||'비밀번호 상태를 확인할 수 없어요.');
      if ($('#parentModal').hidden || !$('#parentDashboard').hidden) return;
      setup.hidden=!!data.pinConfigured;
      gate.hidden=!data.pinConfigured;
      (data.pinConfigured ? $('#parentPinInput') : $('#setupParentPin')).focus({preventScroll:true});
    } catch(e) {
      gate.hidden=false;
      $('#parentAuthStatus').textContent='비밀번호 상태를 확인하지 못했어요. 다시 열어 주세요.';
    }
  }
  async function createParentPin() {
    const pin=$('#setupParentPin').value.trim();
    const confirmPin=$('#setupParentPinConfirm').value.trim();
    const button=$('#createParentPinBtn'), status=$('#parentSetupStatus');
    if (!/^\d{6,12}$/.test(pin) || /^(\d)\1+$/.test(pin) ||
        ['123456','12345678','123456789','1234567890','654321','87654321'].includes(pin)) {
      status.textContent='반복·연속 숫자를 피해서 숫자 6~12자리로 설정해 주세요.'; return;
    }
    if (pin!==confirmPin) {status.textContent='확인 비밀번호가 달라요.'; return;}
    if (!$('#guardianConfirm').checked) {status.textContent='보호자 확인란을 선택해 주세요.'; return;}
    button.disabled=true; status.textContent='보호자 비밀번호를 설정하는 중이에요…';
    try {
      const response=await fetch('/api/parent/setup',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({newPin:pin,confirmPin,guardianConfirmed:true})});
      const data=await response.json().catch(()=>({}));
      if (!response.ok || !data.ok) throw Error(data.error||'설정에 실패했어요.');
      parentVerifiedPin=pin;
      setupParentDashboard();
      showToast('이 브라우저의 학부모 비밀번호를 설정했어요.');
    } catch(e) {status.textContent='❌ '+e.message;}
    finally {button.disabled=false;}
  }
  function setupParentDashboard() {
    $('#parentPinInput').value='';
    $('#setupParentPin').value='';
    $('#setupParentPinConfirm').value='';
    $('#parentSetup').hidden=true;
    $('#parentGate').hidden=true;
    $('#parentDashboard').hidden=false;
    renderReport(); updateParentAnswerAccess(); refreshAnswerPinStatus();
  }
  function openAiReport(answer) {
    reportAnswerExcerpt=String(answer||'').slice(0,600);
    $('#aiReportReason').value='';
    $('#aiReportIncludeExcerpt').checked=false;
    $('#aiReportStatus').textContent='';
    $('#sendAiReportBtn').disabled=false;
    openModal('aiReportModal');
    $('#aiReportReason').focus({preventScroll:true});
  }
  async function submitAiReportForm() {
    const reason=$('#aiReportReason').value;
    const status=$('#aiReportStatus'), button=$('#sendAiReportBtn');
    if (!['unsafe','offensive','incorrect','privacy','other'].includes(reason)) {
      status.textContent='신고 이유를 먼저 선택해 주세요.'; return;
    }
    const answerExcerpt=$('#aiReportIncludeExcerpt').checked ? reportAnswerExcerpt : undefined;
    button.disabled=true; status.textContent='신고 내용을 안전하게 보내고 있어요…';
    try {
      const res=await fetch('/api/ai/report',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({reason, ...(answerExcerpt?{answerExcerpt}:{})})});
      const data=await res.json().catch(()=>({}));
      if (!res.ok || !data.ok) throw Error(data.error||'신고를 보내지 못했어요.');
      status.textContent='✅ 신고가 접수됐어요. 알려줘서 고마워요.';
      reportAnswerExcerpt=''; button.disabled=true;
    } catch(e) { status.textContent='❌ '+e.message;button.disabled=false; }
  }
  async function unlockParentMode() {
    const pin = $('#parentPinInput').value.trim();
    const status = $('#parentAuthStatus');
    const button = $('#unlockParentBtn');
    if (!/^\d{4,12}$/.test(pin)) { status.textContent = '숫자 4~12자리 비밀번호를 입력해 주세요.'; return; }
    button.disabled = true;
    status.textContent = '보호자 비밀번호를 확인하고 있어요…';
    try {
      const response = await fetch('/api/parent/verify', {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({pin})
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.verified !== true) throw Error(data.error || '비밀번호 확인에 실패했어요.');
      parentVerifiedPin = pin;
      status.textContent = '';
      setupParentDashboard();
    } catch (error) {
      status.textContent = `❌ ${error.message}`;
      parentVerifiedPin = null;
      if (/먼저 설정/.test(error.message)) refreshParentGate();
    } finally { button.disabled = false; }
  }
  function updateParentAnswerAccess() {
    const button = $('#parentRevealBtn');
    if (!button) return;
    const hints = Math.min(5, state.hintLevel);
    const canShow = !!(state.active && state.hintLevel >= 5 && !state.busy && parentVerifiedPin && !state.answerShown);
    button.disabled = !canShow;
    button.textContent = state.answerShown ? '✅ 이미 확인한 정답' : canShow ? '🔓 정답과 풀이 확인하기' : `🔒 힌트 ${hints}/5 · 정답 잠김`;
    $('#parentHintStatus').textContent = !state.active
      ? '현재 진행 중인 문제가 없어요. 아이가 문제를 시작하면 여기에서 확인할 수 있어요.'
      : state.answerShown ? '이번 문제의 정답을 보호자가 확인했어요.'
      : state.hintLevel < 5 ? `현재 힌트 ${state.hintLevel}회예요. 같은 문제에서 ${5-state.hintLevel}회 더 받은 뒤 열 수 있어요.`
      : '힌트 5회 조건을 충족했어요. 아래 버튼에서 보호자가 정답을 확인할 수 있어요.';
    const output = $('#parentAnswerOutput');
    if (parentVerifiedPin && state.active?.revealedAnswer) {
      output.textContent = state.active.revealedAnswer;
      output.hidden = false;
    }
  }
  function updateMode() {
    const onlineAI = true;
    $('#modeBadge').classList.toggle('live', onlineAI);
    $('#modeBadge').lastChild.textContent = ` ${PROVIDER_SETTINGS[state.provider]?.label || 'AI 분석'}`;
    if(state.provider!=='gemini') $('#geminiRouteNotice').hidden=true;
    $('#photoNote').textContent = '사진은 선택한 외부 AI 서비스에 문제를 분석·검토할 때 전송돼요.';
  }
  function saveSettings() {
    if (state.busy) { $('#settingStatus').textContent = '응답이 끝난 뒤 설정을 바꿀 수 있어요.'; return; }
    const mode = document.querySelector('input[name="mode"]:checked')?.value || 'live';
    const provider = $('#apiProviderSelect').value;
    const model = provider==='gemini' ? 'auto' : $('#apiModelInput').value.trim();
    const baseUrl = $('#apiBaseUrlInput').value.trim();
    if (mode === 'live' && !/^[a-zA-Z0-9_.:/+\-]{1,145}$/.test(model)) {
      $('#settingStatus').textContent = 'AI 모델 이름을 입력해 주세요.'; return;
    }
    if (mode === 'live' && provider === 'custom' && !/^https:\/\/[^\s]+$/i.test(baseUrl)) {
      $('#settingStatus').textContent = '사용자 지정 기본 URL은 https://로 시작해야 해요.'; return;
    }
    if (state.mode !== mode || (mode === 'live' && (state.provider !== provider || state.model !== model))) resetConversation();
    state.mode = mode;
    state.provider = provider;
    state.model = model;
    state.baseUrl = baseUrl;
    savePreferences();
    updateMode(); closeModal('settingsModal');
    showToast(`${PROVIDER_SETTINGS[provider].label}을 선택했어요. AI 문제 분석과 힌트 검토를 진행해요.`);
  }
  async function testApiConnection() {
    const status = $('#apiConnectionStatus');
    const button = $('#testApiConnectionBtn');
    const mode = document.querySelector('input[name="mode"]:checked')?.value || 'live';
    const provider = $('#apiProviderSelect').value;
    const model = provider==='gemini' ? 'auto' : $('#apiModelInput').value.trim();
    const baseUrl = $('#apiBaseUrlInput').value.trim();
    if (mode !== 'live') { status.textContent = '먼저 외부 AI API 연결을 선택해 주세요.'; return; }
    if (reconnectOperation) { status.textContent = '다른 AI 질문이 진행 중이에요. 완료되면 연결을 시험해 주세요.'; return; }
    if (!/^[a-zA-Z0-9_.:/+\-]{1,145}$/.test(model)) { status.textContent = '유효한 모델명을 입력해 주세요.'; return; }
    if (provider === 'custom' && !/^https:\/\/[^\s]+$/i.test(baseUrl)) { status.textContent = 'HTTPS API 기본 주소를 입력하세요.'; return; }
    status.textContent = `⏳ ${PROVIDER_SETTINGS[provider]?.label || provider} 연결을 시험하고 있어요…`;
    status.dataset.result = 'testing';
    button.disabled = true;
    $('#cancelApiReconnectBtn').hidden = false;
    try {
      const result = await requestTutorWithReconnect({
        provider,model,baseUrl:provider === 'custom'?baseUrl:'',grade:'초3~4',subject:'수학',
        hintLevel:1,problem:'7 × 6을 어떻게 생각해야 하나요?',
        messages:[{role:'user',content:'7 × 6을 계산할 때 힌트 하나를 알려 주세요.'}]
      },'test');
      if (!result.hint) throw new Error('연결했지만 AI가 힌트를 반환하지 않았어요.');
      status.dataset.result = 'success';
      status.textContent = '✅ Google Gemini 연결 성공! 자동 재연결을 중지했어요.';
      showGeminiRouteNotice({usedModel:result.model, geminiRoute:result.geminiRoute});
    } catch (error) {
      status.dataset.result = 'error';
      status.textContent = error.name==='AbortError' ? '⏹ 자동 재연결을 중지했어요.' : `❌ ${error.message}`;
    } finally {
      button.disabled = false;
      $('#cancelApiReconnectBtn').hidden = true;
    }
  }

  async function refreshAnswerPinStatus() {
    try {
      const response=await fetch('/api/answer/config',{cache:'no-store'});
      const data=await response.json();
      if (!response.ok) throw Error(data.error || '설정을 불러오지 못했어요.');
      $('#answerPinScope').textContent=data.pinConfigured
        ? '✅ 이 브라우저에 설정한 비밀번호가 적용돼요. 사이트 데이터를 삭제하면 새로 설정해야 해요.'
        : '⚠️ 이 브라우저에 비밀번호가 아직 없어요. 최초 설정이 필요해요.';
    } catch (_) { $('#answerPinScope').textContent='정답 비밀번호 상태를 불러오지 못했어요.'; }
  }
  async function changeAnswerPin() {
    const button=$('#changeAnswerPinBtn'), status=$('#changeAnswerPinStatus');
    const oldPin=$('#oldAnswerPin').value.trim();
    const newPin=$('#newAnswerPin').value.trim();
    const checkPin=$('#newAnswerPinConfirm').value.trim();
    if (!/^\d{6,12}$/.test(newPin) || /^(\d)\1+$/.test(newPin) ||
        ['123456','12345678','123456789','1234567890','654321','87654321'].includes(newPin)) {
      status.textContent='반복·연속 숫자가 아닌 숫자 6~12자리로 입력해 주세요.'; return;
    }
    if (newPin!==checkPin) { status.textContent='새 비밀번호 두 개가 서로 달라요.'; return; }
    button.disabled=true; status.textContent='변경하고 있어요…';
    try {
      const response=await fetch('/api/answer/change-pin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({oldPin,newPin})});
      const data=await response.json();
      if (!response.ok) throw Error(data.error || '변경에 실패했어요.');
      parentVerifiedPin = newPin; // Authenticated parent remains in the current modal only.
      status.textContent='✅ 새 비밀번호로 변경했어요. 이 기기에만 적용됩니다.';
      $('#oldAnswerPin').value='';$('#newAnswerPin').value='';$('#newAnswerPinConfirm').value='';
      refreshAnswerPinStatus();
    } catch (error) { status.textContent=`❌ ${error.message}`; }
    finally { button.disabled=false; }
  }
  async function revealAnswer() {
    if (!parentVerifiedPin || !state.active || state.hintLevel < 5 || state.answerShown || state.busy) return;
    const pin = parentVerifiedPin;
    const status = $('#revealAnswerStatus'), button = $('#parentRevealBtn');
    state.busy = true; button.disabled = true;
    status.textContent = '🔎 AI가 정답을 두 번 확인하고 있어요…'; updateProgress();
    try {
      const body = {pin, problemId:state.active.id, problem:state.active.question, grade:state.grade, subject:state.subject,
        provider:state.provider, model:state.model, baseUrl:state.provider === 'custom'?state.baseUrl:'', imageDataUrl:state.active.photoDataUrl, photoTextConfirmed:!!state.active.photoReviewed};
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(),110000);
      let response, data;
      try { response = await fetch('/api/answer/reveal', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), signal:controller.signal}); data = await response.json().catch(()=>({})); }
      finally { clearTimeout(timeout); }
      if (!response.ok) throw Error(data.error || `서버 오류 (${response.status})`);
      if (typeof data.answer !== 'string' || !data.answer.trim()) throw Error('AI 정답을 확인하지 못했어요.');
      const msg = `학부모 확인 정답: ${data.answer.trim()}${data.explanation?'\n\n풀이 설명: '+data.explanation:''}`;
      state.active.revealedAnswer = msg; // Only in memory, never appended to the child's chat.
      state.answerShown = true;
      updateRecord({revealed:true});
      $('#parentAnswerOutput').textContent = msg;
      $('#parentAnswerOutput').hidden = false;
      status.textContent = '✅ 학부모 화면에서만 정답을 표시했어요.';
      renderReport();
    } catch(error) { status.textContent = error.name === 'AbortError' ? '요청 시간이 오래 걸렸어요. 다시 시도해 주세요.' : `❌ ${error.message}`; }
    finally { state.busy = false; updateProgress(); }
  }
  function renderReport() {
    const todayRecords = state.records.filter((r) => r.day === nowDay());
    $('#reportDate').textContent = `${new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })} · 이 기기에서 공부한 내용`;
    $('#statProblems').firstChild.textContent = String(todayRecords.length);
    $('#statHints').firstChild.textContent = String(todayRecords.reduce((sum, r) => sum + (r.hints || 0), 0));
    $('#statSolved').firstChild.textContent = String(todayRecords.filter((r) => r.solved).length);
    $('#statUnderstood').firstChild.textContent = String(todayRecords.filter((r) => r.understood).length);
    const groups = new Map();
    for (const r of todayRecords) {
      const subject = ['국어','수학','사회','과학','영어'].includes(r.subject) ? r.subject : '미분류';
      const stats = groups.get(subject) || {problems:0, solved:0, steps:0, wrong:0, needsHelp:0};
      stats.problems += 1;
      stats.solved += r.solved ? 1 : 0;
      stats.steps += Number(r.stepCorrect || 0);
      stats.wrong += Number(r.wrongAttempts || 0);
      if (!r.solved && (r.hints || 0) >= 3) stats.needsHelp += 1;
      groups.set(subject, stats);
    }
    const evidence = [...groups].filter(([subject]) => subject !== '미분류');
    const stronger = evidence.filter(([,s]) => s.solved > 0 || s.steps > 0)
      .sort((a,b) => (b[1].solved*3+b[1].steps)-(a[1].solved*3+a[1].steps))[0];
    const needsHelp = evidence.filter(([,s]) => s.wrong > 0 || s.needsHelp > 0)
      .sort((a,b) => (b[1].wrong+b[1].needsHelp)-(a[1].wrong+a[1].needsHelp))[0];
    $('#strengthInsight').textContent = stronger
      ? `${stronger[0]}: 최종 정답 ${stronger[1].solved}문제${stronger[1].steps ? `, 중간 단계 정답 ${stronger[1].steps}회` : ''}를 스스로 찾아냈어요.`
      : '아직 스스로 맞힌 기록이 충분하지 않아요. 다음에 아이가 직접 답해 볼 기회를 주세요.';
    $('#growthInsight').textContent = needsHelp
      ? `${needsHelp[0]}: 답을 다시 시도한 횟수 ${needsHelp[1].wrong}회, 힌트 3회 이상 사용한 미해결 문제 ${needsHelp[1].needsHelp}개가 있었어요. 어느 단계에서 어려웠는지 함께 살펴보세요.`
      : '반복해서 막힌 기록이 뚜렷하지 않아요. 지금은 여러 유형의 문제를 고르게 시도해 보세요.';
    $('#insightCaution').textContent = todayRecords.length < 3
      ? `오늘 기록은 ${todayRecords.length}문제로 아직 적어요. 강점·약점을 단정하지 않고 관찰한 풀이 과정만 표시합니다.`
      : 'AI의 정오 판정이 틀릴 수 있어요. 이 내용은 오늘의 풀이 경향일 뿐 아이의 능력·지능 평가가 아닙니다.';
    const list = $('#reportList'); list.replaceChildren();
    if (!todayRecords.length) {
      const empty = document.createElement('div');
      empty.className = 'report-empty';
      empty.textContent = '아직 질문 기록이 없어요. 첫 질문을 시작해 볼까요? 🌼';
      list.appendChild(empty);
      return;
    }
    [...todayRecords].reverse().forEach((record) => {
      const wrapper = document.createElement('article'); wrapper.className = 'report-entry';
      const top = document.createElement('div'); top.className = 'report-entry-top';
      const date = document.createElement('span');
      date.textContent = `${record.grade} · ${record.subject && record.subject !== '자동' ? `${SUBJECT_EMOJI[record.subject] || '📚'} ${record.subject} · ` : ''}${new Date(record.time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} · 힌트 ${record.hints}회`;
      const status = document.createElement('strong');
      status.textContent = record.solved ? '✅ 스스로 정답' : record.revealed ? '🔓 보호자 정답 열람' : record.understood ? '🌟 이해 표시' : '💭 생각 중';
      status.className = record.solved || record.understood ? 'self-reported' : 'pending';
      top.append(date, status);
      const q = document.createElement('p');
      q.textContent = record.question.slice(0, 250);
      wrapper.append(top, q); list.appendChild(wrapper);
    });
  }

  document.querySelectorAll('[data-grade]').forEach((button) => button.addEventListener('click', () => changeGrade(button.dataset.grade)));
  $('#photoReadConfirmBtn').addEventListener('click', confirmPhotoReview);
  $('#photoReadCancelBtn').addEventListener('click', cancelPhotoReview);
  $('#photoReadCloseBtn').addEventListener('click', cancelPhotoReview);
  $('#photoReadModal').addEventListener('click', event => { if (event.target.id==='photoReadModal') cancelPhotoReview(); });
  initializePwa();
  $('#messageForm').addEventListener('submit', (event) => { event.preventDefault(); sendMessage($('#messageInput').value); });
  $('#messageInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); sendMessage($('#messageInput').value); }
  });
  $('#moreHintBtn').addEventListener('click', () => sendMessage('힌트를 하나 더 주세요.', { fromHintButton: true }));
  $('#parentRevealBtn').addEventListener('click',revealAnswer);
  $('#unlockParentBtn').addEventListener('click',unlockParentMode);
  $('#createParentPinBtn').addEventListener('click',createParentPin);
  $('#sendAiReportBtn').addEventListener('click',submitAiReportForm);
  $('#parentPinInput').addEventListener('keydown',e=>{ if (e.key==='Enter') {e.preventDefault();unlockParentMode();} });
  $('#setupParentPinConfirm').addEventListener('keydown',e=>{ if (e.key==='Enter') {e.preventDefault();createParentPin();} });
  $('#changeAnswerPinBtn').addEventListener('click',changeAnswerPin);
  $('#recheckProblemBtn').addEventListener('click', () => sendMessage('문제를 다시 읽어 주세요.', { fromRecheck: true }));
  $('#understoodBtn').addEventListener('click', markUnderstood);
  $('#newProblemBtn').addEventListener('click', () => { if (!state.busy) { resetConversation(); $('#messageInput').focus(); } });
  $('#photoMenuBtn').addEventListener('click', togglePhotoMenu);
  $('#takePhotoBtn').addEventListener('click', startCameraCapture);
  $('#choosePhotoBtn').addEventListener('click', () => openDevicePhotoPicker(false));
  $('#cameraSnapBtn').addEventListener('click', snapInAppCamera);
  $('#cameraCloseBtn').addEventListener('click', closeCameraCapture);
  $('#cameraCaptureModal').addEventListener('click', event => { if (event.target.id === 'cameraCaptureModal') closeCameraCapture(); });
  $('#cameraNativeBtn').addEventListener('click', () => {closeCameraCapture();openDevicePhotoPicker(true);});
  $('#cameraGalleryBtn').addEventListener('click', () => {closeCameraCapture();openDevicePhotoPicker(false);});
  document.addEventListener('keydown', event => {if (event.key==='Escape' && !$('#cameraCaptureModal').hidden) closeCameraCapture();});
  window.addEventListener('pagehide', stopCameraTracks);
  $('#cameraInput').addEventListener('change', event => prepareImage(event.target.files?.[0], 'camera'));
  $('#photoInput').addEventListener('change', event => prepareImage(event.target.files?.[0], 'gallery'));
  document.addEventListener('click', event => { if (!event.target.closest('#photoPickerArea')) closePhotoMenu(); });
  $('#removePhotoBtn').addEventListener('click', clearPhoto);
  document.querySelectorAll('input[name="mode"]').forEach((input) => input.addEventListener('change', () => syncProviderFields()));
  $('#apiProviderSelect').addEventListener('change', () => syncProviderFields({ switched: true }));
  // Settings are hidden from children; API keys remain exclusively on Render.
  $('#parentBtn').addEventListener('click', () => openModal('parentModal'));
  $('#saveSettingsBtn').addEventListener('click', saveSettings);
  $('#testApiConnectionBtn').addEventListener('click', testApiConnection);
  $('#cancelRetryBtn').addEventListener('click', cancelReconnect);
  $('#cancelApiReconnectBtn').addEventListener('click', cancelReconnect);
  $('#clearReportBtn').addEventListener('click', () => {
    if (window.confirm('오늘의 학습 기록을 모두 지울까요?')) {
      state.records = []; saveRecords(); renderReport(); showToast('이 기기의 오늘 학습 기록을 지웠어요.');
    }
  });
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => closeModal(button.dataset.close)));
  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => backdrop.addEventListener('click', (event) => { if (event.target === backdrop) closeModal(backdrop.id); }));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const opened = document.querySelector('.modal-backdrop:not([hidden])');
      if (opened) closeModal(opened.id);
    }
  });

  updateSelectors();
  updateMode();
  initVoice();
  updateProgress();
})();
