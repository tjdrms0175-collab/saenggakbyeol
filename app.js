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
  const state = {
    grade: ['초1~2','초3~4','초5~6'].includes(savedPreferences.grade) ? savedPreferences.grade : '초3~4', subject: '자동', detectedSubject: '자동', mode: 'live', provider: savedPreferences.modeVersion === 11 && /^[a-z]+$/.test(savedPreferences.provider || '') ? savedPreferences.provider : 'gemini', model: savedPreferences.modeVersion === 11 && /^[a-zA-Z0-9_.:/+\-]{1,145}$/.test(savedPreferences.model || '') ? (savedPreferences.provider==='gemini' ? 'gemini-3.5-flash-lite' : savedPreferences.model) : 'gemini-3.5-flash-lite', baseUrl: typeof savedPreferences.baseUrl === 'string' ? savedPreferences.baseUrl.slice(0,300) : '',
    active: null, hintLevel: 0, answerShown: false, photo: null, busy: false,
    messages: [], records: readRecords(), toastTimer: null
  };

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
      $('#messageInput').focus();
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
        const piece = result[0]?.transcript?.trim() || '';
        if (result.isFinal) segmentFinal += `${piece} `;
        else segmentInterim += `${piece} `;
      }
      voice.finalText = [voice.completedText, segmentFinal.trim()].filter(Boolean).join(' ');
      voice.currentInterim = segmentInterim.trim();
      if (voice.finalText || voice.currentInterim) {
        voice.heardAnything = true;
        voice.lastSpeechAt = Date.now();
        scheduleRecognitionEnd();
      }
      $('#messageInput').value = [voice.baseText, voice.finalText, voice.currentInterim].filter(Boolean).join(' ').slice(0, 1600);
      voiceNotice('🎤 듣고 있어요. 잠깐 쉬어도 괜찮아요! 말을 멈춘 뒤 약 5.5초 후 마무리해요.', 'listening');
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
      voice.completedText = [voice.finalText, voice.currentInterim].filter(Boolean).join(' ').trim();
      voice.finalText = voice.completedText;
      voice.currentInterim = '';
      $('#messageInput').value = [voice.baseText, voice.completedText].filter(Boolean).join(' ').slice(0, 1600);
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
    freellmapi: { label: 'FreeLLMAPI (개인 실험용)', model: 'auto:smart', guide: '<a href="https://github.com/tashfeenahmed/freellmapi" target="_blank" rel="noopener noreferrer">FreeLLMAPI 공식 저장소</a> · 개인용 무료 API 라우터를 별도로 설치·운영해야 해요. 모델 자동 선택: auto:smart. Render에서는 서버에서 접속 가능한 HTTPS 주소와 API 키가 필요해요. 다른 제공업체로 아이의 질문이 전송될 수 있어요. 다수 사용자 공개 서비스에는 권장하지 않아요.' },
    gemini: { label: 'Google Gemini', model: 'gemini-3.5-flash-lite', guide: 'Google AI Studio에서 Gemini API 키 발급 · <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">키 발급 페이지</a> · 자동 전환: ① Gemini 3.5 Flash-Lite → ② Gemini 3.6 Flash → ③ Gemini 3.8 Flash. 모델 선택과 전환은 Render 서버에서 관리해요. 429 제한에 걸린 모델은 일시적으로 건너뛰고 다시 확인합니다. 모델별 무료 한도와 요금은 계정마다 달라요.' },
    openai: { label: 'OpenAI', model: 'gpt-4.1-mini', guide: '<a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">OpenAI API 키 발급</a> · 별도 API 비용이 발생할 수 있어요.' },
    anthropic: { label: 'Anthropic Claude', model: 'claude-sonnet-4-5', guide: '<a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">Claude API 키 발급</a> · 계정별 요금이 적용돼요.' },
    openrouter: { label: 'OpenRouter', model: 'google/gemini-2.5-flash', guide: '<a href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener noreferrer">OpenRouter API 키 발급</a> · 모델 이름과 요금/무료 표시를 확인하세요.' },
    groq: { label: 'Groq', model: 'llama-3.3-70b-versatile', guide: '<a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer">Groq API 키 발급</a> · 이용 한도는 모델에 따라 달라요.' },
    deepseek: { label: 'DeepSeek', model: 'deepseek-chat', guide: '<a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer">DeepSeek API 키 발급</a>' },
    mistral: { label: 'Mistral AI', model: 'mistral-small-latest', guide: '<a href="https://console.mistral.ai/" target="_blank" rel="noopener noreferrer">Mistral AI Console</a>' },
    together: { label: 'Together AI', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', guide: '<a href="https://api.together.ai/settings/api-keys" target="_blank" rel="noopener noreferrer">Together AI API 키 발급</a>' },
    xai: { label: 'xAI', model: 'grok-4', guide: '<a href="https://console.x.ai/" target="_blank" rel="noopener noreferrer">xAI Console</a>' },
    custom: { label: '사용자 지정 API', model: '', guide: 'OpenAI Chat Completions 호환 API만 지원합니다. 신뢰할 수 있는 제공업체의 HTTPS 주소만 입력하세요.' }
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
        : (provider === 'freellmapi' ? '⚠️ FreeLLMAPI 실행 서버의 HTTPS 주소(FREELLMAPI_BASE_URL)와 통합 키(FREELLMAPI_API_KEY)를 Render에 입력하세요.' : `⚠️ ${item.label} API 키가 서버에 없어요. Render → Environment에서 ${item.env}를 등록해 주세요.`);
      if (provider === 'gemini' && data.geminiRoute) {
        const r=data.geminiRoute;
        el.textContent += ` · 자동 모델: ${(r.models||[r.primary,r.secondary,r.tertiary]).filter(Boolean).join(' → ')}` + (r.current ? ` · 현재 ${r.current} 사용 가능` : ' · 모두 대기 중');
      }
      if (provider === 'gemini' && data.freeRouterFallbackEnabled) el.textContent += ' · ⚠️ Gemini가 제한/장애로 응답하지 않으면 학습 질문이 FreeLLMAPI의 다른 제공업체로 전송될 수 있어요.';
      if (provider === 'freellmapi' && data.freeRouterGeminiReviewEnabled) el.textContent += ' · Gemini가 힌트/정답을 추가 검토하도록 설정되어 있어요.';
    } catch (_) {
      el.textContent = '서버 연결 상태를 확인하지 못했어요. 인터넷을 확인해 주세요.';
    }
  }
  function showGeminiRouteNotice(reply) {
    const el=$('#geminiRouteNotice');
    if (!el) return;
    const fallback=state.provider==='gemini' && reply?.geminiRoute?.fallbackActive &&
      reply.usedModel && reply.usedModel!==reply.geminiRoute.primary;
    if (fallback) {
      el.hidden=false;
      el.textContent=`🔄 앞선 Gemini 모델이 사용량 제한 상태여서 ${reply.usedModel} 모델로 자동 전환했어요. 제한이 풀리면 우선 모델을 다시 사용해요.`;
    } else el.hidden=true;
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
  // v16: A single queued question is retried until the temporary outage clears.
  // No timer runs when the AI is healthy; retries STOP as soon as a valid answer
  // arrives. 401/403/404 and exhausted 429 quotas are never retried endlessly.
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
    let quotaRetries = 0;
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
        if (failure.status === 429 && ++quotaRetries >= 3) {
          throw new Error('API 사용 한도가 계속 초과돼요. 자동 재연결을 중지했습니다. 무료 한도나 결제 상태를 확인해 주세요.');
        }
        retries++;
        // Exponential backoff + jitter, capped at 2 minutes. Prevents a thundering herd
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
  async function getLiveHint(photoDataUrl, attemptText = '', recheck = false) {
    const result = await requestTutorWithReconnect({
      provider:state.provider, model:state.model, baseUrl:state.provider==='custom'?state.baseUrl:'',
      grade:state.grade, subject:state.subject, hintLevel:state.hintLevel,
      problemId:state.active?.id||'', attemptText, recheck,
      problem:state.active?.question||'', messages:state.messages.slice(-12), imageDataUrl:photoDataUrl||null
    });
    return { hint:result.hint.trim(), detectedSubject: ['국어','수학','사회','과학','영어','기타'].includes(result.detectedSubject) ? result.detectedSubject : '자동', problemFocus:typeof result.problemFocus==='string'?result.problemFocus.slice(0,140):'',
      verdict:['correct','incorrect','step_correct'].includes(result.verdict)?result.verdict:'uncertain',
      hintCount:Number.isInteger(result.hintCount)?result.hintCount:state.hintLevel,
      usedModel:typeof result.model==='string'?result.model:'', geminiRoute:result.geminiRoute||null };
  }
  async function sendMessage(text, { fromHintButton = false, fromRecheck = false } = {}) {
    if (state.busy) return;
    cancelAnswerScroll();
    const typed = (text || '').trim().slice(0, 1600);
    if (voice.listening) stopListening();

    const uploadedImage = state.photo ? state.photo.dataUrl : null;
    if (!typed && !uploadedImage) { showToast('질문을 적거나 사진을 올려 주세요!'); return; }
    // Close the phone keyboard on send: retaining input focus made the browser
    // jump to the question box even after a teacher reply had been rendered.
    const focused = document.activeElement;
    if (focused === $('#messageInput') || focused?.closest?.('#messageForm')) focused.blur();
    const isNew = !state.active;
    if (isNew) makeProblem(typed, !!uploadedImage);
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
      visibleReply = addMessage('teacher', error.name === 'AbortError' ? '자동 재연결을 중지했어요. 🌷 같은 문제를 다시 보내면 이어서 도와줄게요.' : '정확하지 않은 힌트는 보여주지 않을게요. 🌷 AI 설정과 문제 원문을 확인해 주세요.');
      showToast(error.name === 'AbortError' ? '연결 시간이 오래 걸리고 있어요.' : error.message);
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
  async function prepareImage(file) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { showToast('JPG, PNG, WEBP 사진만 올릴 수 있어요.'); return; }
    if (file.size > 12 * 1024 * 1024) { showToast('12MB보다 작은 사진을 골라 주세요.'); return; }
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const dataUrl = canvas.toDataURL('image/jpeg', .82);
      if (dataUrl.length > 4 * 1024 * 1024) { showToast('사진 용량이 너무 커요. 다른 사진을 사용해 주세요.'); return; }
      state.photo = { dataUrl };
      $('#photoThumbnail').src = dataUrl;
      $('#photoPreview').hidden = false;
      showToast(state.mode === 'demo' ? '사진을 첨부했어요! 데모에서는 사진의 글자를 읽지 못해요.' : '사진을 첨부했어요! AI가 문제를 살펴볼 수 있어요.');
    } catch (_) { showToast('사진을 열 수 없어요. 다른 파일을 골라 주세요.'); }
    finally { $('#photoInput').value = ''; }
  }
  function clearPhoto() {
    state.photo = null;
    $('#photoThumbnail').removeAttribute('src');
    $('#photoPreview').hidden = true;
    $('#photoInput').value = '';
  }
  function resetParentSession() {
    parentVerifiedPin = null;
    $('#parentGate').hidden = false;
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
    document.body.style.overflow = 'hidden';
    (id === 'parentModal' ? $('#parentPinInput') : modal.querySelector('.close-modal')).focus({preventScroll:true});
  }
  function closeModal(id, { restoreFocus = true } = {}) {
    $(`#${id}`).hidden = true;
    document.body.style.overflow = '';
    if (id === 'parentModal') resetParentSession();
    if (restoreFocus) $('#parentBtn').focus({preventScroll:true});
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
      $('#parentPinInput').value = '';
      $('#parentGate').hidden = true;
      $('#parentDashboard').hidden = false;
      status.textContent = '';
      renderReport();
      updateParentAnswerAccess();
      refreshAnswerPinStatus();
    } catch (error) {
      status.textContent = `❌ ${error.message}`;
      parentVerifiedPin = null;
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
    const model = provider==='gemini' ? 'gemini-3.5-flash-lite' : $('#apiModelInput').value.trim();
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
    const model = provider==='gemini' ? 'gemini-3.5-flash-lite' : $('#apiModelInput').value.trim();
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
      status.textContent = `✅ 연결 성공! 실제 응답 모델: ${result.model || model}. 자동 재연결을 중지했어요.`;
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
      $('#answerPinScope').textContent=data.pinChanged
        ? '✅ 이 기기에서 변경한 비밀번호가 적용되어 있어요. 브라우저 데이터 삭제 시 초기 비밀번호로 돌아갈 수 있어요.'
        : '⚠️ 초기 비밀번호는 0000이에요. 다른 사람이 추측하기 쉬우므로 꼭 변경해 주세요. 비밀번호는 이 기기에만 적용돼요.';
    } catch (_) { $('#answerPinScope').textContent='정답 비밀번호 상태를 불러오지 못했어요.'; }
  }
  async function changeAnswerPin() {
    const button=$('#changeAnswerPinBtn'), status=$('#changeAnswerPinStatus');
    const oldPin=$('#oldAnswerPin').value.trim();
    const newPin=$('#newAnswerPin').value.trim();
    const checkPin=$('#newAnswerPinConfirm').value.trim();
    if (!/^\d{4,12}$/.test(newPin) || newPin==='0000') { status.textContent='새 비밀번호는 0000이 아닌 숫자 4~12자리로 입력해 주세요.'; return; }
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
        provider:state.provider, model:state.model, baseUrl:state.provider === 'custom'?state.baseUrl:'', imageDataUrl:state.active.photoDataUrl};
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
  initializePwa();
  $('#messageForm').addEventListener('submit', (event) => { event.preventDefault(); sendMessage($('#messageInput').value); });
  $('#messageInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); sendMessage($('#messageInput').value); }
  });
  $('#moreHintBtn').addEventListener('click', () => sendMessage('힌트를 하나 더 주세요.', { fromHintButton: true }));
  $('#parentRevealBtn').addEventListener('click',revealAnswer);
  $('#unlockParentBtn').addEventListener('click',unlockParentMode);
  $('#parentPinInput').addEventListener('keydown',e=>{ if (e.key==='Enter') {e.preventDefault();unlockParentMode();} });
  $('#changeAnswerPinBtn').addEventListener('click',changeAnswerPin);
  $('#recheckProblemBtn').addEventListener('click', () => sendMessage('문제를 다시 읽어 주세요.', { fromRecheck: true }));
  $('#understoodBtn').addEventListener('click', markUnderstood);
  $('#newProblemBtn').addEventListener('click', () => { if (!state.busy) { resetConversation(); $('#messageInput').focus(); } });
  $('#photoInput').addEventListener('change', (event) => prepareImage(event.target.files?.[0]));
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
